#!/usr/bin/env bash
# ===========================================================================
# Test the provisioning SQL against a real PostgreSQL server.
#
# The point of this test is ONE claim: that one application's database
# credentials cannot open another application's database. Everything else in
# deploy/ is configuration that is read by a daemon; this is the part that
# decides whether two businesses on one server can see each other's books,
# and a comment asserting it is not evidence.
#
# It provisions TWO throwaway applications and then tries to connect to the
# first using the second's password. That connection must be refused.
#
# Safe to run against a development server that has other databases on it:
# every object it creates carries the zzprovtest_ prefix, it records whether
# it had to create the shared supabase role names, and it drops only what it
# created. It never reads or writes an existing database.
#
#   deploy/scripts/test-provision-sql.sh
#
# Needs: psql, and a server you are superuser on. PGHOST/PGPORT/PGUSER are
# honoured. It refuses to run against anything that looks like production.
# ===========================================================================
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SQL_DIR="$HERE/../sql"
PFX="zzprovtest"
A_DB="${PFX}_a"; A_AUTHN="${PFX}_a_authn"
B_DB="${PFX}_b"; B_AUTHN="${PFX}_b_authn"
A_PW="$(openssl rand -hex 16)"
B_PW="$(openssl rand -hex 16)"
MADE_MONITOR=0
FAILED=0

say()  { printf '  %s\n' "$*"; }
pass() { printf '  \033[32mPASS\033[0m %s\n' "$*"; }
fail() { printf '  \033[31mFAIL\033[0m %s\n' "$*"; FAILED=$((FAILED+1)); }
q()    { psql -tAqX -d "${2:-postgres}" -c "$1"; }

# --- refuse to run anywhere that might be real ----------------------------
if [ -n "${PGHOST:-}" ] && [ "${PGHOST}" != "localhost" ] && [ "${PGHOST}" != "127.0.0.1" ]; then
  echo "REFUSING: PGHOST is '$PGHOST'. This test creates and drops databases;" >&2
  echo "run it only against a local development server." >&2
  exit 2
fi
psql -tAqX -c 'select 1' >/dev/null 2>&1 || {
  echo "Cannot reach a PostgreSQL server. Start one, or set PGHOST/PGPORT/PGUSER." >&2
  exit 2
}
[ "$(q "select current_setting('is_superuser')")" = "on" ] || {
  echo "Must be superuser to SET UP this test (it creates the non-superuser" >&2
  echo "role that then does the provisioning)." >&2; exit 2; }

# A role shaped like the one this will really run as.
#
# Supabase's `postgres` has CREATEDB and CREATEROLE and is NOT a superuser.
# That difference is not cosmetic: when a non-superuser creates a role,
# PostgreSQL 16+ gives the creator admin_option but NOT set_option, so
# `CREATE DATABASE ... OWNER <role>` fails with "must be able to SET ROLE".
# Provisioning as a superuser hides that completely, which is how it reached a
# staging run. The superuser here is used only to set this up and tear it down.
MGD="${PFX}_provisioner"
MGD_PW="$(openssl rand -hex 16)"

cleanup() {
  set +e
  for db in "$A_DB" "$B_DB" "${PFX}_central"; do
    psql -qX -d postgres -c "DROP DATABASE IF EXISTS \"$db\" WITH (FORCE)" >/dev/null 2>&1
  done
  for r in "$A_AUTHN" "$B_AUTHN" "${PFX}_a_realtime" "${PFX}_a_storage"; do
    psql -qX -d postgres -c "DROP ROLE IF EXISTS \"$r\"" >/dev/null 2>&1
  done
  # Only if THIS run created it. If it was already there it belongs to
  # something else on this machine and is left alone.
  if [ "$MADE_MONITOR" = "1" ]; then
    psql -qX -d postgres -c "DROP ROLE IF EXISTS central_monitor" >/dev/null 2>&1
  fi
  # The provisioning role LAST: it owns the databases and roles created above,
  # and DROP ROLE fails while anything it owns still exists. Dropping it first
  # left it behind on every run.
  psql -qX -d postgres -c "REASSIGN OWNED BY \"$MGD\" TO CURRENT_USER" >/dev/null 2>&1
  psql -qX -d postgres -c "DROP OWNED BY \"$MGD\"" >/dev/null 2>&1
  psql -qX -d postgres -c "DROP ROLE IF EXISTS \"$MGD\"" >/dev/null 2>&1
  set -e
}
trap cleanup EXIT

echo
echo "Provisioning isolation test"
say "server : $(q "select version()" | cut -c1-40)"
say "as     : $(q 'select current_user')"

# The supabase/postgres image ships anon, authenticated and service_role.
# A laptop may or may not have them, and if it does they belong to some other
# project, so they are used as found and never dropped.
missing=""
for r in anon authenticated service_role; do
  [ "$(q "select count(*) from pg_roles where rolname='$r'")" = "1" ] || missing="$missing $r"
done
if [ -n "$missing" ]; then
  say "creating stand-ins for the supabase roles:$missing"
  for r in $missing; do psql -qX -c "CREATE ROLE \"$r\" NOLOGIN" >/dev/null; done
  echo "$missing" > /tmp/.zzprovtest_made_roles.$$
else
  say "using the anon/authenticated/service_role already on this server"
fi

if [ "$(q "select count(*) from pg_roles where rolname='central_monitor'")" = "0" ]; then
  psql -qX -c "CREATE ROLE central_monitor LOGIN" >/dev/null
  psql -qX -c "GRANT pg_monitor TO central_monitor" >/dev/null
  MADE_MONITOR=1
fi

# pg_net and pg_cron are in the supabase image but not usually on a laptop.
# The test runs the grants file with whatever is unavailable commented out,
# and says which lines it skipped rather than pretending it checked them.
# The SQL itself distinguishes "not available in this installation" from "not
# permitted". On a laptop pg_net is simply absent, so the file is run with
# require_extensions=off and it says which ones it therefore skipped. The file
# is NOT edited -- an earlier version rewrote it with sed, which meant the
# test exercised a different file from the one that ships.
SKIPPED=""
for ext in pg_net pg_cron; do
  [ "$(q "select count(*) from pg_available_extensions where name='$ext'")" = "0" ] \
    && SKIPPED="$SKIPPED $ext"
done
GRANTS_SQL="$SQL_DIR/20-app-grants.sql"
REQ_EXT=on
if [ -n "$SKIPPED" ]; then
  REQ_EXT=off
  printf '\n  \033[33mREDUCED CONFIDENCE\033[0m\n'
  say "These extensions are not installed on this server, so this run did NOT"
  say "verify them:$SKIPPED"
  say ""
  say "On a deployment they are REQUIRED and their absence stops the install:"
  say "  pg_cron  runs every application's scheduled jobs"
  say "  pg_net   is how those jobs make HTTP calls"
  say ""
  say "The shipped files are run unmodified with require_extensions=off. A real"
  say "deployment passes on, and bootstrap.sh and provision-app.sh pass it"
  say "explicitly so no default can drift."
  printf '\n'
fi

psql -qX -c "DROP ROLE IF EXISTS \"$MGD\"" >/dev/null 2>&1
psql -qX -c "CREATE ROLE \"$MGD\" LOGIN CREATEDB CREATEROLE PASSWORD '$MGD_PW'" >/dev/null
# On the real server the provisioning role holds ADMIN OPTION on these,
# because it is the role that created them. Mirrored here so the test exercises
# the same conditions rather than an accidentally weaker set.
for r in anon authenticated service_role; do
  psql -qX -c "GRANT \"$r\" TO \"$MGD\" WITH ADMIN OPTION" >/dev/null 2>&1
done
[ "$(q "select rolsuper::text from pg_roles where rolname='$MGD'")" = "false" ] \
  && say "provisioning as $MGD (CREATEDB, CREATEROLE, NOT superuser -- as on a managed server)" \
  || fail "the provisioning role came out as a superuser, so this test proves less than it should"

# Everything the provisioning SQL does runs through the non-superuser.
mgd() { PGPASSWORD="$MGD_PW" psql -qX -v ON_ERROR_STOP=1 -h "${PGHOST:-localhost}" -U "$MGD" "$@"; }

provision() { # db (unused) authn password
  mgd -d postgres \
    -v app="$1" -v dbname="$1" -v authn="$2" \
    -f "$SQL_DIR/10-create-app-db.sql" >/dev/null
  mgd -d "$1" \
    -v dbname="$1" -v authn="$2" -v authn_password="$3" \
    -v require_extensions="$REQ_EXT" \
    -f "$GRANTS_SQL" >/dev/null
}

# ---------------------------------------------------------------------------
# Central setup first. It was not exercised here before, and a change to it
# broke a staging run at the step that creates the application registry --
# which then made provisioning, isolation and everything downstream fail.
# It is the first thing bootstrap runs, so it is the first thing tested.
# ---------------------------------------------------------------------------
echo
echo "Central setup (00-central-roles.sql)"
CENTRAL_DB="${PFX}_central"
psql -qX -d postgres -c "CREATE DATABASE \"$CENTRAL_DB\"" >/dev/null 2>&1
if psql -qX -v ON_ERROR_STOP=1 -v require_extensions="$REQ_EXT" -d "$CENTRAL_DB" \
     -f "$SQL_DIR/00-central-roles.sql" >/dev/null 2>&1; then
  pass "00-central-roles.sql ran"
else
  fail "00-central-roles.sql failed: $(psql -X -v ON_ERROR_STOP=1 -v require_extensions="$REQ_EXT" -d "$CENTRAL_DB" -f "$SQL_DIR/00-central-roles.sql" 2>&1 | grep -i error | head -1)"
fi
[ "$(psql -tAqX -d "$CENTRAL_DB" -c "select count(*) from information_schema.tables where table_schema='central' and table_name='applications'")" = "1" ] \
  && pass "the central.applications registry exists" || fail "central.applications was not created"
[ "$(psql -tAqX -d "$CENTRAL_DB" -c "select count(*) from information_schema.columns where table_schema='central' and table_name='applications' and column_name='needs_auth'")" = "1" ] \
  && pass "the registry has the needs_auth column" || fail "needs_auth column missing"
psql -qX -v ON_ERROR_STOP=1 -v require_extensions="$REQ_EXT" -d "$CENTRAL_DB" \
  -f "$SQL_DIR/00-central-roles.sql" >/dev/null 2>&1 \
  && pass "re-running central setup changed nothing and did not error" \
  || fail "central setup is not idempotent"

echo
echo "Creating two applications"
provision "$A_DB" "$A_AUTHN" "$A_PW"; say "application A: $A_DB"
provision "$B_DB" "$B_AUTHN" "$B_PW"; say "application B: $B_DB"

echo
echo "Idempotency"
provision "$A_DB" "$A_AUTHN" "$A_PW" && pass "re-provisioning A changed nothing and did not error"

echo
echo "Isolation"
# The claim under test. B's own credentials must open B and be refused by A.
if PGPASSWORD="$B_PW" psql -tAqX -h "${PGHOST:-localhost}" -U "$B_AUTHN" -d "$B_DB" -c 'select 1' >/dev/null 2>&1; then
  pass "B's credentials open B's own database"
else
  fail "B's credentials cannot open B's own database -- provisioning is broken"
fi

err="$(PGPASSWORD="$B_PW" psql -tAqX -h "${PGHOST:-localhost}" -U "$B_AUTHN" -d "$A_DB" -c 'select 1' 2>&1 || true)"
if printf '%s' "$err" | grep -qi "permission denied for database"; then
  pass "B's credentials are REFUSED by A's database"
else
  fail "B reached A's database, or failed for the wrong reason: $(printf '%s' "$err" | head -1)"
fi

if [ "$(q "select count(*) from aclexplode((select datacl from pg_database where datname='$A_DB')) a where a.grantee=0 and a.privilege_type='CONNECT'")" = "0" ]; then
  pass "PUBLIC has no CONNECT on A"
else
  fail "PUBLIC can still CONNECT to A -- every role on the server can open it"
fi

echo
echo "PostgREST's role switching"
[ "$(q "select rolinherit from pg_roles where rolname='$A_AUTHN'")" = "f" ] \
  && pass "authenticator is NOINHERIT (holds no privileges of its own)" \
  || fail "authenticator INHERITS -- an anonymous request would carry service_role's rights"

for r in anon authenticated service_role; do
  [ "$(q "select pg_has_role('$A_AUTHN','$r','MEMBER')")" = "t" ] \
    && pass "authenticator may SET ROLE $r" \
    || fail "authenticator cannot SET ROLE $r -- PostgREST will reject every request"
done

# A JWT names its role; PostgREST does SET ROLE. If those roles could log in,
# the anon key -- which ships in the browser -- would be a database password.
for r in anon authenticated service_role; do
  [ "$(q "select rolcanlogin from pg_roles where rolname='$r'")" = "f" ] \
    && pass "$r cannot log in directly" \
    || fail "$r CAN log in -- the anon key becomes a usable database password"
done

echo
echo "The grants file added no table privileges"
# A restored dump carries the application's own grants and RLS policies. If
# provisioning added its own, it would be overriding real security work.
n="$(q "select count(*) from information_schema.role_table_grants where grantee in ('anon','authenticated','service_role')" "$A_DB")"
[ "$n" = "0" ] && pass "no table grants were created ($n)" \
               || fail "$n table grants exist -- provisioning is overriding the application's own policy"

[ "$(q "select count(*) from aclexplode((select nspacl from pg_namespace where nspname='public')) a where a.grantee=0" "$A_DB")" = "0" ] \
  && pass "PUBLIC has no rights on schema public" \
  || fail "PUBLIC still has rights on schema public"

echo
echo "Optional services (realtime + storage)"
# These two files pass values into DO blocks through session settings, because
# psql does not interpolate :variables inside a dollar-quoted string. That is
# easy to get wrong and silent until it runs, so it runs here.
RT_USER="${PFX}_a_realtime"; RT_PW="$(openssl rand -hex 16)"
ST_USER="${PFX}_a_storage";  ST_PW="$(openssl rand -hex 16)"
psql -qX -d postgres -c "CREATE ROLE \"$RT_USER\" LOGIN REPLICATION" >/dev/null
psql -qX -d postgres -c "CREATE ROLE \"$ST_USER\" LOGIN" >/dev/null

if psql -qX -v ON_ERROR_STOP=1 -d "$A_DB" \
     -v dbname="$A_DB" -v rt_user="$RT_USER" -v rt_password="$RT_PW" \
     -f "$SQL_DIR/21-realtime.sql" >/dev/null 2>&1; then
  pass "21-realtime.sql ran"
  [ "$(q "select count(*) from pg_namespace where nspname='_realtime'" "$A_DB")" = "1" ] \
    && pass "_realtime schema exists" || fail "_realtime schema missing"
  # A different schema, and the one whose absence made Realtime accept
  # subscriptions and deliver nothing. Ecto creates its migration table inside
  # this prefix but will not create the prefix, and an application database
  # made from template0 does not have it.
  [ "$(q "select count(*) from pg_namespace where nspname='realtime'" "$A_DB")" = "1" ] \
    && pass "realtime schema exists — Realtime's migrations have somewhere to go" \
    || fail "realtime schema missing; realtime.list_changes could never be created"
  # The role that runs those migrations must be able to create in it.
  [ "$(q "select has_schema_privilege('$RT_USER','realtime','CREATE')::text" "$A_DB")" = "true" ] \
    && pass "the realtime role may CREATE in the realtime schema" \
    || fail "the realtime role cannot create in the realtime schema, so its migrations would fail"
  # And nothing was granted on its tables speculatively.
  for r in anon authenticated service_role; do
    [ "$(q "select has_schema_privilege('$r','realtime','USAGE')::text" "$A_DB")" = "true" ] \
      && pass "$r has USAGE on the realtime schema" \
      || fail "$r has no USAGE on the realtime schema"
  done
else
  fail "21-realtime.sql failed: $(psql -qX -v ON_ERROR_STOP=1 -d "$A_DB" -v dbname="$A_DB" -v rt_user="$RT_USER" -v rt_password="$RT_PW" -f "$SQL_DIR/21-realtime.sql" 2>&1 | head -2 | tr '\n' ' ')"
fi

if psql -qX -v ON_ERROR_STOP=1 -d "$A_DB" \
     -v dbname="$A_DB" -v st_user="$ST_USER" -v st_password="$ST_PW" \
     -f "$SQL_DIR/22-storage.sql" >/dev/null 2>&1; then
  pass "22-storage.sql ran"
else
  fail "22-storage.sql failed: $(psql -qX -v ON_ERROR_STOP=1 -d "$A_DB" -v dbname="$A_DB" -v st_user="$ST_USER" -v st_password="$ST_PW" -f "$SQL_DIR/22-storage.sql" 2>&1 | head -2 | tr '\n' ' ')"
fi

# ---------------------------------------------------------------------------
# 24-storage-grants.sql runs AFTER storage-api has created its tables, so the
# interesting case is what it does when they are not there. It must refuse
# loudly rather than report success over an empty schema: a silent pass there
# would mean the roles storage-api switches into end up with no rights and
# every request fails later, at a point far from the cause.
# ---------------------------------------------------------------------------
echo
echo "Storage grants, applied after the service's own migrations"
err="$(psql -qX -v ON_ERROR_STOP=1 -d "$A_DB" -f "$SQL_DIR/24-storage-grants.sql" 2>&1 || true)"
printf '%s' "$err" | grep -qi "has not created its tables yet\|is empty" \
  && pass "it refuses to grant over an empty storage schema, and says why" \
  || fail "it did not refuse on an empty schema (got: $(printf '%s' "$err" | head -1))"

# Now stand in for storage-api: create what its migrations create, as the
# storage role, and check the grants actually land on those tables.
PGPASSWORD="$ST_PW" psql -qX -h "${PGHOST:-localhost}" -U "$ST_USER" -d "$A_DB" \
  -c "create table storage.buckets (id text primary key, name text)" \
  -c "create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text)" \
  -c "create sequence storage.probe_seq" >/tmp/st-create.log 2>&1 \
  || fail "the storage role could not create tables in its own schema: $(tail -2 /tmp/st-create.log | tr '\n' ' ')"
if psql -qX -v ON_ERROR_STOP=1 -d "$A_DB" -f "$SQL_DIR/24-storage-grants.sql" >/dev/null 2>&1; then
  pass "24-storage-grants.sql ran once the tables existed"
else
  fail "24-storage-grants.sql failed with tables present: $(psql -qX -v ON_ERROR_STOP=1 -d "$A_DB" -f "$SQL_DIR/24-storage-grants.sql" 2>&1 | head -2 | tr '\n' ' ')"
fi
for r in anon authenticated service_role; do
  g="$(q "select has_table_privilege('$r','storage.objects','SELECT')::text" "$A_DB")"
  [ "$g" = "true" ] && pass "$r can read storage.objects" \
                    || fail "$r still cannot read storage.objects, so requests would be refused"
done
g="$(q "select has_table_privilege('service_role','storage.buckets','INSERT')::text" "$A_DB")"
[ "$g" = "true" ] && pass "service_role can write storage.buckets" \
                  || fail "service_role cannot write storage.buckets"
# Re-running must be a no-op, not an error: storage-api upgrades add tables.
if psql -qX -v ON_ERROR_STOP=1 -d "$A_DB" -f "$SQL_DIR/24-storage-grants.sql" >/dev/null 2>&1; then
  pass "re-running it is idempotent"
else
  fail "re-running 24-storage-grants.sql failed"
fi

# The realtime role is privileged inside its own database. It must still be
# unable to open another application's.
rerr="$(PGPASSWORD="$RT_PW" psql -tAqX -h "${PGHOST:-localhost}" -U "$RT_USER" -d "$B_DB" -c 'select 1' 2>&1 || true)"
printf '%s' "$rerr" | grep -qi "permission denied for database" \
  && pass "A's realtime role is refused by B's database" \
  || fail "A's realtime role reached B, or failed for another reason: $(printf '%s' "$rerr" | head -1)"

# The storage role too. CONNECT on its OWN database was just moved into the
# SQL, and a grant like that is exactly the kind that gets widened by accident,
# so the other side of it is checked rather than assumed.
serr="$(PGPASSWORD="$ST_PW" psql -tAqX -h "${PGHOST:-localhost}" -U "$ST_USER" -d "$B_DB" -c 'select 1' 2>&1 || true)"
printf '%s' "$serr" | grep -qi "permission denied for database" \
  && pass "A's storage role is refused by B's database" \
  || fail "A's storage role reached B, or failed for another reason: $(printf '%s' "$serr" | head -1)"
# And it must still be able to open its own.
sown="$(PGPASSWORD="$ST_PW" psql -tAqX -h "${PGHOST:-localhost}" -U "$ST_USER" -d "$A_DB" -c 'select 1' 2>&1 || true)"
[ "$(printf '%s' "$sown" | tr -d ' ')" = "1" ] \
  && pass "A's storage role can open A — the grant it needs is in the SQL, not in shell" \
  || fail "A's storage role cannot open its own database: $(printf '%s' "$sown" | head -1)"

echo
echo "Per-role limits"
cfg="$(q "select coalesce(array_to_string(setconfig,','),'') from pg_db_role_setting s join pg_roles r on r.oid=s.setrole join pg_database d on d.oid=s.setdatabase where r.rolname='anon' and d.datname='$A_DB'")"
printf '%s' "$cfg" | grep -q "statement_timeout=15s" \
  && pass "anon has a 15s statement timeout in A" \
  || fail "anon has no statement timeout in A (got: ${cfg:-none})"

echo
if [ "$FAILED" = "0" ]; then
  printf '  \033[32mAll checks passed.\033[0m\n'
  if [ -n "$SKIPPED" ]; then
    printf '  \033[33mBut this run did not verify:%s — it is NOT a full pass.\033[0m\n' "$SKIPPED"
    printf '  Only a run on a server that has them proves those paths.\n'
  fi
  printf '\n'
else
  printf '  \033[31m%d check(s) failed.\033[0m\n\n' "$FAILED"
  exit 1
fi
