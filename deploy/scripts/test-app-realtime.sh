#!/usr/bin/env bash
# ===========================================================================
# Does EVERYTINROOM'S OWN APPLICATION receive a live update and show it?
#
#   deploy/scripts/test-app-realtime.sh --app alpha_shop --other gamma_rt
#
# Not a synthetic client and not a reimplementation of the subscription: this
# builds the actual application from this repository, points it at the staging
# platform, opens it in a real Chromium, logs in through the real PIN screen,
# and waits for the sale popup that App.jsx renders when a `sales` INSERT
# arrives on its `pos-live` channel.
#
# WHAT THE APPLICATION NEEDS, AND WHY THIS IS NOT A SHORTCUT
#   setupRealtime() runs on mount and is NOT gated on login, so the three
#   subscriptions -- whatsapp_orders, products, sales -- exist before anyone
#   signs in. But the popup is inside `if (!user) return <Login/>`, so showing
#   it in the interface does require a session. That is why this seeds a staff
#   row: the UI-render requirement cannot be met without one.
#
#   PINs are bcrypt in staff.pin_hash (migration 018), so the row is seeded
#   with crypt(). The PIN is generated per run and never printed.
#
# WHAT IT DOES NOT TOUCH
#   Production, DNS, customer data: nothing. It works only in the disposable
#   staging databases, and removes the rows it inserts.
# ===========================================================================
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
DEPLOY="$(cd "$HERE/.." && pwd)"
REPO="$(cd "$DEPLOY/.." && pwd)"
ROOT_DIR="${ROOT_DIR:-/srv/central}"

APP=""; OTHER=""
while [ $# -gt 0 ]; do
  case "$1" in
    --app) APP="${2:-}"; shift 2 ;;
    --other) OTHER="${2:-}"; shift 2 ;;
    -h|--help) sed -n '2,28p' "$0"; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done
[ -n "$APP" ] || { echo "--app <name> is required" >&2; exit 2; }

DNS="$(printf '%s' "$APP" | tr '_' '-')"
ENVF="$ROOT_DIR/apps/$APP/.env"
[ -f "$ENVF" ] || { echo "BLOCKED $APP is not provisioned ($ENVF missing)"; exit 2; }
ANON="$(sed -n 's/^ANON_KEY=//p' "$ENVF" | tail -1)"
BASE="http://$DNS.staging.test"
pg() { docker exec central-postgres psql -tAqX -U postgres -d "${2:-$APP}" -c "$1" 2>&1; }

say()  { printf '  %s\n' "$*"; }
good() { printf '  PASS %s\n' "$*"; }
bad()  { printf '  FAIL %s\n' "$*"; }
blocked() { printf '  BLOCKED %s\n' "$*"; }

printf '\nEverytinroom, in a real browser, against the staging platform\n'
say "application database : $APP"
say "through              : $BASE"

# ---------------------------------------------------------------------------
# 1. The application's own schema, from its own migrations.
# ---------------------------------------------------------------------------
MIG="$REPO/supabase/migrations"
[ -d "$MIG" ] || { blocked "no $MIG, so the application's schema cannot be built"; exit 2; }
APPLIED=0; FAILEDM=0
pg "create extension if not exists pgcrypto" >/dev/null
for f in "$MIG"/*.sql; do
  # ON_ERROR_STOP off on purpose: some migrations are environmental (cron jobs
  # naming the old project, storage buckets) and cannot apply here. What
  # matters is whether the tables and verify_pin exist afterwards, which is
  # checked rather than inferred from a clean run.
  if docker exec -i central-postgres psql -qX -U postgres -d "$APP" -f - < "$f" >/dev/null 2>&1; then
    APPLIED=$((APPLIED+1))
  else
    FAILEDM=$((FAILEDM+1))
  fi
done
say "migrations: $APPLIED applied, $FAILEDM could not apply (environmental ones are expected to fail here)"

MISSING=""
for t in products sales whatsapp_orders staff customers; do
  [ "$(pg "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='$t'")" = "1" ] \
    || MISSING="$MISSING $t"
done
if [ -n "$MISSING" ]; then
  blocked "the application's tables are missing:$MISSING — its schema could not be built here"
  exit 2
fi
good "the application's own tables exist (products, sales, whatsapp_orders, staff, customers)"
if [ "$(pg "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='verify_pin'")" = "0" ]; then
  blocked "verify_pin() does not exist, so the real login screen cannot authenticate"
  exit 2
fi
good "verify_pin() exists"
# EXISTING IS NOT ENOUGH. The browser calls it through PostgREST as the anon
# role, so what decides whether a cashier can sign in is the EXECUTE
# privilege, not the function's presence. Migration 015 grants it, and these
# migrations are applied with ON_ERROR_STOP off -- a file reports success
# while individual statements inside it have failed -- so "35 applied" says
# nothing about whether this particular grant landed. Asked directly.
PINX="$(pg "select has_function_privilege('anon','public.verify_pin(text)','EXECUTE')" 2>/dev/null | tr -d ' ')"
if [ "$PINX" = "t" ]; then
  good "the browser-facing role may EXECUTE verify_pin, so the real PIN screen can authenticate"
else
  bad "anon may NOT execute verify_pin (got '${PINX:-no answer}') — no cashier could sign in"
fi

# WHAT verify_pin READS AND WRITES, CHECKED BY NAME.
#
# The function exists, the grant is there, and it still answered HTTP 400 for
# a whole run. PostgREST puts the database's own error class into that status:
# a column the function reads that is not there is 42703, which is exactly a
# 400. The table check above looks at five tables; this function also needs
# pin_attempts, staff_sessions and staff.permissions, and none of those were
# being checked -- so a migration that failed silently (these are applied with
# error-stopping off) showed up only as an opaque 400 in a browser.
PINDEPS=""
for t in pin_attempts staff_sessions; do
  [ "$(pg "select count(*) from information_schema.tables where table_schema='public' and table_name='$t'" | tr -d ' ')" = "1" ] \
    || PINDEPS="$PINDEPS table:$t"
done
for c in permissions active pin_hash; do
  [ "$(pg "select count(*) from information_schema.columns where table_schema='public' and table_name='staff' and column_name='$c'" | tr -d ' ')" = "1" ] \
    || PINDEPS="$PINDEPS staff.$c"
done
if [ -z "$PINDEPS" ]; then
  good "everything verify_pin reads and writes exists (pin_attempts, staff_sessions, staff.permissions/active/pin_hash)"
else
  bad "verify_pin cannot work here, these are missing:$PINDEPS — that is the HTTP 400 the browser sees"
fi

# And call it, from the database, before asking a browser to. A function that
# raises here will raise there, and this says which with the actual message
# instead of a status code.
PINPROBE="$(pg "select (public.verify_pin('000000')::text)" 2>&1 | head -2 | tr '\n' ' ')"
case "$PINPROBE" in
  *success*) good "verify_pin returns a result when called directly (a wrong PIN, so no session was made)" ;;
  *)         bad "verify_pin RAISES when called directly: $(printf '%s' "$PINPROBE" | cut -c1-180)" ;;
esac


# ---------------------------------------------------------------------------
# 2. A staging staff member. The PIN is generated and never printed.
# ---------------------------------------------------------------------------
PIN="$(shuf -i 1000-9999 -n 1 2>/dev/null || echo $(( (RANDOM % 9000) + 1000 )))"
pg "delete from staff where name = 'Staging Probe'" >/dev/null
pg "insert into staff (name, role, pin_hash, active) values ('Staging Probe','Admin', crypt('${PIN}', gen_salt('bf',10)), true)" >/dev/null 2>&1 \
  || pg "insert into staff (name, role, pin_hash) values ('Staging Probe','Admin', crypt('${PIN}', gen_salt('bf',10)))" >/dev/null 2>&1
if [ "$(pg "select count(*) from staff where name='Staging Probe'")" != "1" ]; then
  blocked "could not seed a staging staff row, so the login screen cannot be driven"
  exit 2
fi
good "a staging staff member exists (PIN generated for this run, never printed)"

# A SECOND CASHIER, FOR THE SECOND TILL.
#
# verify_pin deletes any existing session belonging to the same staff member,
# so signing in at a second workstation with the same PIN signs the first one
# out. That is the application's design, and it means two tills are two
# people. The multi-workstation check used one PIN for both, which tested
# something no shop does. The second PIN is forced to differ from the first:
# verify_pin matches a PIN to whichever staff member has it, and two members
# with the same PIN would both resolve to one of them.
PIN2="$PIN"
while [ "$PIN2" = "$PIN" ]; do
  PIN2="$(shuf -i 1000-9999 -n 1 2>/dev/null || echo $(( (RANDOM % 9000) + 1000 )))"
done
pg "delete from staff where name = 'Staging Probe 2'" >/dev/null
pg "insert into staff (name, role, pin_hash, active) values ('Staging Probe 2','Admin', crypt('${PIN2}', gen_salt('bf',10)), true)" >/dev/null 2>&1 \
  || pg "insert into staff (name, role, pin_hash) values ('Staging Probe 2','Admin', crypt('${PIN2}', gen_salt('bf',10)))" >/dev/null 2>&1
if [ "$(pg "select count(*) from staff where name='Staging Probe 2'")" = "1" ]; then
  good "a second staging staff member exists, for the second workstation"
else
  bad "could not seed a second staff member, so two workstations cannot be tested as two cashiers"
fi

# AND WITH THE REAL PIN, WHICH SPLITS THE REMAINING POSSIBILITIES IN TWO.
#
# If this succeeds and the browser still gets HTTP 400, the function and the
# schema are fine and the fault is in the HTTP path -- PostgREST's schema
# cache, the argument name, the role. If this fails, the browser was telling
# the truth and the problem is below the API. One run, either answer.
#
# The PIN is interpolated into SQL that goes over a pipe to psql inside the
# container, never onto a command line, and the result is matched rather than
# printed -- a session token comes back in it.
PINREAL="$(pg "select case when (public.verify_pin('${PIN}')->>'success') = 'true'
                    then 'ACCEPTED' else 'REFUSED' end" 2>&1 | tr -d ' \n')"
case "$PINREAL" in
  ACCEPTED) good "verify_pin ACCEPTS the staging PIN when called in the database, so the auth path works below the API" ;;
  REFUSED)  bad "verify_pin REFUSES the staging PIN in the database — the seeded bcrypt hash does not match, so no browser could ever sign in" ;;
  *)        bad "verify_pin could not be called with the staging PIN: $(printf '%s' "$PINREAL" | cut -c1-160)" ;;
esac
# Sessions that probe made are not left behind.
pg "delete from staff_sessions where staff_id in (select id from staff where name = 'Staging Probe')" >/dev/null 2>&1 || true
pg "delete from pin_attempts where at > now() - interval '1 minute'" >/dev/null 2>&1 || true

# WHAT THE TILL NEEDS FOR LIVE UPDATES, NOW THAT IT POLLS.
#
# This used to publish the three tables for Realtime and restart it. The
# application no longer holds a websocket: it reads revision counters from
# public.live_state, which migration 034 creates along with a statement-level
# trigger on each watched table. So what has to exist is that table, those
# triggers, and a browser-facing role that may read it and may not write it.
#
# No publication, no replica identity, no replication slot, no Realtime
# container. Those are checked elsewhere as an optional platform component;
# nothing the till does depends on them any more.
for t in whatsapp_orders products sales; do
  pg "grant select, insert, update on public.$t to anon, authenticated, service_role" >/dev/null
done
pg "grant usage, select on all sequences in schema public to anon, authenticated, service_role" >/dev/null
pg "notify pgrst, 'reload schema'" >/dev/null

LS_ROWS="$(pg "select count(*) from public.live_state where source in ('sales','products','whatsapp_orders')" 2>/dev/null | tr -d ' ')"
LS_TRG="$(pg "select count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid where t.tgname='trg_live_state' and not t.tgisinternal and c.relname in ('sales','products','whatsapp_orders')" 2>/dev/null | tr -d ' ')"
if [ "${LS_ROWS:-0}" = "3" ] && [ "${LS_TRG:-0}" = "3" ]; then
  good "live_state has a row and a trigger for each of the three watched tables"
else
  bad "live_state is incomplete: ${LS_ROWS:-0} of 3 rows, ${LS_TRG:-0} of 3 triggers — migration 034 did not apply here"
fi
# The grant the till depends on, and the one it must NOT have. A writable
# live_state would let anything with the public key fake a change on every
# workstation in the shop.
LS_SEL="$(pg "select has_table_privilege('anon','public.live_state','SELECT')" | tr -d ' ')"
LS_INS="$(pg "select has_table_privilege('anon','public.live_state','INSERT')" | tr -d ' ')"
LS_UPD="$(pg "select has_table_privilege('anon','public.live_state','UPDATE')" | tr -d ' ')"
if [ "$LS_SEL" = "t" ] && [ "$LS_INS" = "f" ] && [ "$LS_UPD" = "f" ]; then
  good "the browser-facing role may READ live_state and may not write it"
else
  bad "live_state privileges are wrong for anon (select=$LS_SEL insert=$LS_INS update=$LS_UPD)"
fi
# And that the counter actually moves, before asking a browser to notice it.
# A revision that never changes would make every browser check below fail
# with no indication of why.
LS_BEFORE="$(pg "select rev from public.live_state where source='sales'" | tr -d ' ')"
pg "insert into public.sales (receipt_no, customer, total, payment, cashier) values ('LIVESTATE-PROBE','probe',1,'Cash','probe')" >/dev/null 2>&1 || true
LS_AFTER="$(pg "select rev from public.live_state where source='sales'" | tr -d ' ')"
pg "delete from public.sales where receipt_no='LIVESTATE-PROBE'" >/dev/null 2>&1 || true
if [ -n "${LS_AFTER:-}" ] && [ "${LS_AFTER:-0}" -gt "${LS_BEFORE:-0}" ]; then
  good "a write bumps live_state.rev ($LS_BEFORE to $LS_AFTER), so the till has something to poll"
else
  bad "a write did NOT bump live_state.rev (stayed at ${LS_BEFORE:-?}) — the trigger is not firing"
fi
# Deleting the probe bumps it again, which is correct and worth stating: the
# browser checks below seed their own baseline on the first poll, so a
# revision that has already moved does not disturb them.

# ---------------------------------------------------------------------------
# 3. Build the real application against this platform.
# ---------------------------------------------------------------------------
cd "$REPO" || exit 2
if [ ! -d node_modules ]; then
  say "installing the application's dependencies"
  npm ci >/tmp/app-npm.log 2>&1 || npm install >/tmp/app-npm.log 2>&1 \
    || { blocked "the application's dependencies could not be installed"; tail -5 /tmp/app-npm.log; exit 2; }
fi
say "building the application pointed at $BASE"
if ! VITE_SUPABASE_URL="$BASE" VITE_SUPABASE_ANON_KEY="$ANON" \
     npm run build >/tmp/app-build.log 2>&1; then
  blocked "the application did not build"
  tail -12 /tmp/app-build.log
  exit 2
fi
[ -d dist ] || { blocked "the build produced no dist/"; exit 2; }
good "the real application built against the staging platform"

# ---------------------------------------------------------------------------
# 4. Playwright with Chromium, installed here rather than asked for.
# ---------------------------------------------------------------------------
# `npm install`, not `npx`. npx fetches playwright into its own cache, which
# is enough to run its CLI and NOT enough for `import { chromium } from
# 'playwright'` to resolve -- the run got as far as launching the script and
# died with ERR_MODULE_NOT_FOUND. --no-save so the application's own
# package.json is left exactly as it is.
if ! npm install --no-save playwright@1.56.1 >/tmp/pw.log 2>&1; then
  blocked "playwright could not be installed"; tail -6 /tmp/pw.log; exit 2
fi
if ! npx playwright install --with-deps chromium >>/tmp/pw.log 2>&1; then
  blocked "chromium could not be installed"; tail -8 /tmp/pw.log; exit 2
fi
# Prove it resolves BEFORE building anything on the assumption that it does.
if ! node -e "import('playwright').then(m => { if (!m.chromium) { process.exit(1) } })" >>/tmp/pw.log 2>&1; then
  blocked "playwright installed but 'playwright' does not import"; tail -6 /tmp/pw.log; exit 2
fi
good "Playwright installed and importable, Chromium present"

PORT=5599
( cd dist && python3 -m http.server "$PORT" --bind 127.0.0.1 >/tmp/app-serve.log 2>&1 ) &
SERVE_PID=$!
trap 'kill "$SERVE_PID" 2>/dev/null || true' EXIT
for _ in $(seq 1 20); do
  curl -sf -o /dev/null "http://127.0.0.1:$PORT/" 2>/dev/null && break
  sleep 1
done

export APP_URL="http://127.0.0.1:$PORT/" APP_PIN="$PIN" APP_PIN2="$PIN2" APP_BASE="$BASE" \
       APP_ANON="$ANON" APP_DB="$APP" OTHER_DB="${OTHER:-}"
# Bounded. The browser flow now covers two workstations, a network
# interruption and a restart, so it legitimately takes minutes -- and an
# unbounded hang in Chromium would quietly eat the job's whole 45-minute
# budget and report nothing at all. Seven minutes is well clear of the
# measured run; past that it is a hang, and a hang is a failure.
timeout 420 node "$HERE/app-realtime.mjs"
RC=$?
if [ "$RC" = "124" ]; then
  say "FAIL the browser run did not finish within 7 minutes; treating it as a failure"
fi

# ---------------------------------------------------------------------------
# 5. Clean up what was inserted.
# ---------------------------------------------------------------------------
pg "delete from sales where customer like 'STAGING-PROBE%'" >/dev/null 2>&1 || true
# The product and website-order probes, which the products and whatsapp_orders
# subscription checks insert. Left behind they would accumulate one row per
# run in a database the next run then reports on.
pg "delete from products where name like 'STAGING-PROBE%'" >/dev/null 2>&1 || true
pg "delete from whatsapp_orders where order_no like 'STAGING-PROBE%'" >/dev/null 2>&1 || true
pg "delete from staff_sessions where staff_id in (select id from staff where name like 'Staging Probe%')" >/dev/null 2>&1 || true
pg "delete from staff where name like 'Staging Probe%'" >/dev/null 2>&1 || true
say "staging rows removed"
exit "$RC"
