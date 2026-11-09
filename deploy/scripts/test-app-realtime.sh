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
good "verify_pin() exists, so the real PIN screen can authenticate"

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

# The three tables the application subscribes to must be published, with full
# replica identity, or Realtime has nothing to send.
for t in whatsapp_orders products sales; do
  pg "alter table public.$t replica identity full" >/dev/null
  pg "alter publication supabase_realtime add table public.$t" >/dev/null 2>&1
  pg "grant select, insert, update on public.$t to anon, authenticated, service_role" >/dev/null
done
pg "grant usage, select on all sequences in schema public to anon, authenticated, service_role" >/dev/null
pg "notify pgrst, 'reload schema'" >/dev/null
PUBBED="$(pg "select count(*) from pg_publication_tables where pubname='supabase_realtime' and tablename in ('whatsapp_orders','products','sales')")"
[ "${PUBBED:-0}" = "3" ] && good "all three subscribed tables are in the publication" \
                         || bad "only ${PUBBED:-0} of 3 subscribed tables are published"
# Realtime reads its published set at boot.
docker restart "$DNS.realtime" >/dev/null 2>&1 || true
for _ in $(seq 1 30); do
  h="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$DNS.realtime" 2>/dev/null | tr -d '[:space:]' || true)"
  [ "$h" = "healthy" ] || [ "$h" = "none" ] && break
  sleep 5
done
sleep 8

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
if ! npx --yes playwright@1.56.1 --version >/tmp/pw.log 2>&1; then
  blocked "playwright could not be fetched"; tail -4 /tmp/pw.log; exit 2
fi
if ! npx --yes playwright@1.56.1 install --with-deps chromium >>/tmp/pw.log 2>&1; then
  blocked "chromium could not be installed"; tail -6 /tmp/pw.log; exit 2
fi
good "Playwright and Chromium installed in this disposable environment"

PORT=5599
( cd dist && python3 -m http.server "$PORT" --bind 127.0.0.1 >/tmp/app-serve.log 2>&1 ) &
SERVE_PID=$!
trap 'kill "$SERVE_PID" 2>/dev/null || true' EXIT
for _ in $(seq 1 20); do
  curl -sf -o /dev/null "http://127.0.0.1:$PORT/" 2>/dev/null && break
  sleep 1
done

export APP_URL="http://127.0.0.1:$PORT/" APP_PIN="$PIN" APP_BASE="$BASE" \
       APP_ANON="$ANON" APP_DB="$APP" OTHER_DB="${OTHER:-}"
node "$HERE/app-realtime.mjs"
RC=$?

# ---------------------------------------------------------------------------
# 5. Clean up what was inserted.
# ---------------------------------------------------------------------------
pg "delete from sales where customer like 'STAGING-PROBE%'" >/dev/null 2>&1 || true
pg "delete from staff where name = 'Staging Probe'" >/dev/null 2>&1 || true
say "staging rows removed"
exit "$RC"
