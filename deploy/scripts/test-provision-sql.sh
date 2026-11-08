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
A_DB="${PFX}_a"; A_OWNER="${PFX}_a_owner"; A_AUTHN="${PFX}_a_authn"
B_DB="${PFX}_b"; B_OWNER="${PFX}_b_owner"; B_AUTHN="${PFX}_b_authn"
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
  echo "Must be superuser to create databases and roles." >&2; exit 2; }

cleanup() {
  set +e
  for db in "$A_DB" "$B_DB"; do
    psql -qX -d postgres -c "DROP DATABASE IF EXISTS \"$db\" WITH (FORCE)" >/dev/null 2>&1
  done
  for r in "$A_AUTHN" "$B_AUTHN" "${PFX}_a_realtime" "${PFX}_a_storage" "$A_OWNER" "$B_OWNER"; do
    psql -qX -d postgres -c "DROP ROLE IF EXISTS \"$r\"" >/dev/null 2>&1
  done
  # Only if THIS run created it. If it was already there it belongs to
  # something else on this machine and is left alone.
  if [ "$MADE_MONITOR" = "1" ]; then
    psql -qX -d postgres -c "DROP ROLE IF EXISTS central_monitor" >/dev/null 2>&1
  fi
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
SKIPPED=""
GRANTS_SQL="$(mktemp)"; trap 'rm -f "$GRANTS_SQL"' RETURN 2>/dev/null || true
cp "$SQL_DIR/20-app-grants.sql" "$GRANTS_SQL"
for ext in pg_net pg_cron; do
  if [ "$(q "select count(*) from pg_available_extensions where name='$ext'")" = "0" ]; then
    SKIPPED="$SKIPPED $ext"
    sed -i.bak "s/^CREATE EXTENSION IF NOT EXISTS $ext;/-- skipped on this server: $ext/" "$GRANTS_SQL"
  fi
done
[ -n "$SKIPPED" ] && say "not available here, so not exercised:$SKIPPED"

provision() { # db owner authn password
  psql -qX -v ON_ERROR_STOP=1 -d postgres \
    -v app="$1" -v dbname="$1" -v owner="$2" -v authn="$3" \
    -f "$SQL_DIR/10-create-app-db.sql" >/dev/null
  psql -qX -v ON_ERROR_STOP=1 -d "$1" \
    -v dbname="$1" -v owner="$2" -v authn="$3" -v authn_password="$4" \
    -f "$GRANTS_SQL" >/dev/null
}

echo
echo "Creating two applications"
provision "$A_DB" "$A_OWNER" "$A_AUTHN" "$A_PW"; say "application A: $A_DB"
provision "$B_DB" "$B_OWNER" "$B_AUTHN" "$B_PW"; say "application B: $B_DB"

echo
echo "Idempotency"
provision "$A_DB" "$A_OWNER" "$A_AUTHN" "$A_PW" && pass "re-provisioning A changed nothing and did not error"

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
     -v dbname="$A_DB" -v owner="$A_OWNER" -v rt_user="$RT_USER" -v rt_password="$RT_PW" \
     -f "$SQL_DIR/21-realtime.sql" >/dev/null 2>&1; then
  pass "21-realtime.sql ran"
  [ "$(q "select count(*) from pg_namespace where nspname='_realtime'" "$A_DB")" = "1" ] \
    && pass "_realtime schema exists" || fail "_realtime schema missing"
else
  fail "21-realtime.sql failed: $(psql -qX -v ON_ERROR_STOP=1 -d "$A_DB" -v dbname="$A_DB" -v owner="$A_OWNER" -v rt_user="$RT_USER" -v rt_password="$RT_PW" -f "$SQL_DIR/21-realtime.sql" 2>&1 | head -2 | tr '\n' ' ')"
fi

if psql -qX -v ON_ERROR_STOP=1 -d "$A_DB" \
     -v dbname="$A_DB" -v owner="$A_OWNER" -v st_user="$ST_USER" -v st_password="$ST_PW" \
     -f "$SQL_DIR/22-storage.sql" >/dev/null 2>&1; then
  pass "22-storage.sql ran"
else
  fail "22-storage.sql failed: $(psql -qX -v ON_ERROR_STOP=1 -d "$A_DB" -v dbname="$A_DB" -v owner="$A_OWNER" -v st_user="$ST_USER" -v st_password="$ST_PW" -f "$SQL_DIR/22-storage.sql" 2>&1 | head -2 | tr '\n' ' ')"
fi

# The realtime role is privileged inside its own database. It must still be
# unable to open another application's.
rerr="$(PGPASSWORD="$RT_PW" psql -tAqX -h "${PGHOST:-localhost}" -U "$RT_USER" -d "$B_DB" -c 'select 1' 2>&1 || true)"
printf '%s' "$rerr" | grep -qi "permission denied for database" \
  && pass "A's realtime role is refused by B's database" \
  || fail "A's realtime role reached B, or failed for another reason: $(printf '%s' "$rerr" | head -1)"

echo
echo "Per-role limits"
cfg="$(q "select coalesce(array_to_string(setconfig,','),'') from pg_db_role_setting s join pg_roles r on r.oid=s.setrole join pg_database d on d.oid=s.setdatabase where r.rolname='anon' and d.datname='$A_DB'")"
printf '%s' "$cfg" | grep -q "statement_timeout=15s" \
  && pass "anon has a 15s statement timeout in A" \
  || fail "anon has no statement timeout in A (got: ${cfg:-none})"

echo
if [ "$FAILED" = "0" ]; then
  printf '  \033[32mAll checks passed.\033[0m'
  [ -n "$SKIPPED" ] && printf ' Not exercised here:%s' "$SKIPPED"
  printf '\n\n'
else
  printf '  \033[31m%d check(s) failed.\033[0m\n\n' "$FAILED"
  exit 1
fi
