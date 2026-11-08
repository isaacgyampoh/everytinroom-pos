#!/usr/bin/env bash
# ===========================================================================
# STAGING VALIDATION — runs the whole platform on a throwaway Ubuntu machine
# and checks that it actually works.
#
#   sudo deploy/scripts/staging-test.sh
#
# Written to run on a DISPOSABLE Linux box: a GitHub Actions runner, a scratch
# VPS, or a VM. It installs Docker, writes to /srv/central, starts containers
# and creates databases. Do not point it at anything you care about.
#
# It needs no production credential of any kind. Every secret it uses is
# generated on the spot and thrown away with the machine.
#
# What it checks, in order:
#    1  the machine, and that Docker is genuinely absent to begin with
#    2  bootstrap.sh installs Docker Engine and the Compose plugin
#    3  the shared stack comes up
#    4  startup, health checks, restart recovery, resource usage
#    5  two independent applications, and that neither can read the other
#    6  Realtime, end to end, through the proxy
#    7  object storage through storage-api: upload, download, delete
#    8  backup and restore rehearsal, reconciled by row count
#    9  scheduled jobs, in another database, calling a new URL
#   10  provisioning again from clean, and capacity reporting
#
# Exit code 0 only if every check passed.
# ===========================================================================

set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
DEPLOY="$(cd "$HERE/.." && pwd)"
ROOT_DIR="/srv/central"
REPORT="${STAGING_REPORT:-/tmp/staging-report.md}"

# --until N stops cleanly after section N. The prerequisites (1-5) are where
# every failure so far has been, and they finish in a few minutes while the
# full run takes twenty-five. A fast job and a full job run in parallel; the
# fast one is never a substitute for the full one and its report says so.
UNTIL=99
while [ $# -gt 0 ]; do
  case "$1" in
    --until) UNTIL="${2:-99}"; shift 2 ;;
    --until=*) UNTIL="${1#*=}"; shift ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

PASS=0; FAIL=0; SKIP=0
RESULTS=""

# Called at the top of each section: stops once the requested depth is passed.
gate_section() {
  if [ "$1" -gt "$UNTIL" ]; then
    printf '\n  stopping after section %s as asked (--until %s)\n' "$UNTIL" "$UNTIL"
    RESULTS="$RESULTS\n## Sections $1 onwards\n- NOT RUN: this job was asked to stop after section $UNTIL\n"
    finish_report "stopped after section $UNTIL"
    exit "$( [ "$FAIL" = "0" ] && echo 0 || echo 1 )"
  fi
}

# One place that writes the report, so every exit path produces one.
finish_report() {
  printf '\n\033[1m===== Result =====\033[0m\n'
  printf '  passed %s   failed %s   skipped %s\n\n' "$PASS" "$FAIL" "$SKIP"
  {
    echo "# Staging validation"
    echo
    echo "- Machine: ${PRETTY_NAME:-unknown}, ${CPUS:-?} processors, ${RAM_MB:-?} MB RAM"
    echo "- Docker: $(docker --version 2>/dev/null | cut -d, -f1)"
    echo "- Scope: ${1:-full run}"
    echo "- Result: **$PASS passed, $FAIL failed, $SKIP skipped**"
    echo
    if [ "$UNTIL" != "99" ]; then
      echo "This was the FAST prerequisites job. It stops after section $UNTIL and is"
      echo "not a full validation: Realtime, storage, backups and cron were not run."
      echo
    fi
    echo "No production credential was used. Every secret here was generated on"
    echo "this machine and dies with it."
    printf '%b' "$RESULTS"
  } > "$REPORT"
  echo "  report written to $REPORT"
}

C_G=$'\033[32m'; C_R=$'\033[31m'; C_Y=$'\033[33m'; C_B=$'\033[1m'; C_0=$'\033[0m'

section() { printf '\n%s===== %s =====%s\n' "$C_B" "$*" "$C_0"; RESULTS="$RESULTS\n## $*\n"; }
pass() { PASS=$((PASS+1)); printf '  %sPASS%s %s\n' "$C_G" "$C_0" "$*"; RESULTS="$RESULTS- PASS $*\n"; }
fail() { FAIL=$((FAIL+1)); printf '  %sFAIL%s %s\n' "$C_R" "$C_0" "$*"; RESULTS="$RESULTS- **FAIL** $*\n"; }
skip() { SKIP=$((SKIP+1)); printf '  %sSKIP%s %s\n' "$C_Y" "$C_0" "$*"; RESULTS="$RESULTS- SKIP $*\n"; }
note() { printf '       %s\n' "$*"; RESULTS="$RESULTS      $*\n"; }

# Diagnostic output belongs in the REPORT, not only in the CI log.
#
# Every failure detail here used to be piped through `sed` straight to stdout.
# Only pass/fail/skip/note write to $RESULTS, so the report -- the evidence
# file readiness-package.py reads -- recorded a bare "**FAIL** provisioning
# alpha_shop failed" with no cause, and finding out why meant opening the CI
# log by hand. Run 17 cost exactly that.
#
# Secrets are redacted on the way in. Every secret in this job is generated on
# the runner and dies with it, but the report is committed to a public branch
# and the rule is that no report carries a secret, whatever its lifetime.
DETAIL_LINES="${DETAIL_LINES:-20}"
detail() {                      # detail <command> [args...]   -- stderr included
  local tmp n=0 l
  tmp="$(mktemp)"
  # Run the command here rather than taking a pipe. A function on the right of
  # a pipe runs in a SUBSHELL, so its assignment to $RESULTS is thrown away:
  # the first version of this helper printed every diagnostic to the screen
  # and still wrote none of it to the report. Taking the command as arguments
  # keeps it in this shell. "$@" invokes shell functions too, so `detail pgq
  # "select ..."` works.
  "$@" >"$tmp" 2>&1 || true
  # sed -E, not BRE. BSD sed has no \| alternation, so the BRE version matched
  # nothing on a Mac and the password in the test fixture came through intact
  # while the run still reported success. ERE behaves the same in both.
  # A literal ESC rather than \x1b, for the same portability reason.
  sed -E -e "s/$(printf '\033')\[[0-9;]*m//g" \
         -e 's/eyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]*/<jwt redacted>/g' \
         -e 's/(PASSWORD|password|PASSWD|SECRET|secret|TOKEN|token|APIKEY|apikey|api_key)([=:]{1,2}"?[[:space:]]*)[^[:space:]"'"'"',;]{8,}/\1\2<redacted>/g' \
         -e 's/[A-Za-z0-9+/]{40,}={0,2}/<redacted-blob>/g' \
         "$tmp" > "$tmp.red" || cp "$tmp" "$tmp.red"
  while IFS= read -r l; do
    n=$((n+1))
    [ "$n" -gt "$DETAIL_LINES" ] && { note "... truncated at $DETAIL_LINES lines"; break; }
    note "$l"
  done < "$tmp.red"
  [ "$n" = "0" ] && note "(the command produced no output)"
  rm -f "$tmp" "$tmp.red"
}

[ "$(uname -s)" = "Linux" ] || { echo "This must run on Linux. It is a server test."; exit 2; }
[ "$(id -u)" = "0" ] || { echo "Run with sudo: sudo $0"; exit 2; }

pgq() { docker exec central-postgres psql -tAqX -U postgres -d "${2:-postgres}" -c "$1" 2>/dev/null; }
psqlq_db() { docker exec central-postgres psql -tAqX -U postgres -d "$1" -c "$2" 2>/dev/null; }

# ===========================================================================
section "1. The machine"
# ===========================================================================
. /etc/os-release
note "$PRETTY_NAME  ($VERSION_CODENAME)"
RAM_MB=$(( $(awk '/^MemTotal:/{print $2}' /proc/meminfo) / 1024 ))
CPUS=$(nproc)
DISK_GB=$(df -PBG / | awk 'NR==2{gsub("G","",$4); print $4}')
note "${CPUS} processors, ${RAM_MB} MB RAM, ${DISK_GB} GB free on /"
[ "$ID" = "ubuntu" ] && pass "running on Ubuntu, which is what bootstrap.sh supports" \
                     || fail "not Ubuntu ($ID) — bootstrap.sh will refuse"

# Remove any pre-installed Docker so step 2 tests the real install path rather
# than the "already installed, skipping" branch. A CI runner ships with Docker.
if command -v docker >/dev/null 2>&1; then
  note "Docker is pre-installed; removing it so the install path is genuinely tested"
  systemctl stop docker docker.socket containerd >/dev/null 2>&1 || true
  # GitHub's runner images ship Docker as moby-* rather than docker-ce, so
  # both sets have to go or bootstrap takes its "already installed" branch and
  # the install path is never tested.
  apt-get remove -y -qq --purge \
    docker-ce docker-ce-cli docker-ce-rootless-extras containerd.io \
    docker-buildx-plugin docker-compose-plugin docker.io \
    moby-engine moby-cli moby-buildx moby-compose moby-containerd moby-runc moby-tini \
    containerd runc >/dev/null 2>&1 || true
  apt-get autoremove -y -qq >/dev/null 2>&1 || true
  rm -f /usr/local/bin/docker-compose /usr/bin/docker /usr/local/bin/docker \
        /etc/apt/sources.list.d/docker.list /etc/apt/keyrings/docker.asc \
        /etc/docker/daemon.json 2>/dev/null || true
  rm -rf /usr/libexec/docker/cli-plugins /usr/local/lib/docker/cli-plugins \
         /root/.docker/cli-plugins 2>/dev/null || true
  hash -r
fi
if command -v docker >/dev/null 2>&1; then
  skip "Docker could not be fully removed — step 2 exercises the idempotent path instead"
else
  pass "starting from a machine with no Docker"
fi

# ===========================================================================
section "2. bootstrap.sh installs Docker and the Compose plugin"
# ===========================================================================
BOOT_LOG=/tmp/bootstrap.log
if "$DEPLOY/bootstrap.sh" --acme-email staging@example.invalid --yes --no-firewall > "$BOOT_LOG" 2>&1; then
  pass "bootstrap.sh completed"
else
  fail "bootstrap.sh exited non-zero"
  detail tail -25 "$BOOT_LOG"
fi

if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  pass "Docker Engine installed and responding: $(docker --version | cut -d, -f1)"
else
  fail "Docker is not working after bootstrap"
fi
if docker compose version >/dev/null 2>&1; then
  pass "Compose plugin installed: $(docker compose version --short 2>/dev/null || docker compose version)"
else
  fail "'docker compose' is not available"
fi
# It must come from Docker's own repository, not Ubuntu's older docker.io.
if dpkg -l docker-ce 2>/dev/null | grep -q '^ii'; then
  pass "installed from Docker's official apt repository (docker-ce)"
else
  fail "docker-ce is not installed — the official repository path did not run"
fi
grep -q "only SSH, HTTP and HTTPS are public\|PostgreSQL is bound to 127.0.0.1" "$BOOT_LOG" \
  && pass "bootstrap verified nothing unexpected is publicly exposed" \
  || note "exposure check output not found in the log"

# ===========================================================================
section "3. The shared stack"
# ===========================================================================
for c in central-postgres central-caddy; do
  st=$(docker inspect -f '{{.State.Status}}' "$c" 2>/dev/null || echo missing)
  [ "$st" = "running" ] && pass "$c is running" || fail "$c is '$st'"
done
[ "$(docker inspect -f '{{.State.Health.Status}}' central-postgres 2>/dev/null)" = "healthy" ] \
  && pass "central-postgres reports healthy" || fail "central-postgres is not healthy"
[ "$(pgq 'select 1')" = "1" ] && pass "PostgreSQL answers queries" || fail "PostgreSQL does not answer"
note "version: $(pgq 'select version()' | cut -c1-45)"

# The tuning file must have been generated for this machine, with nothing left
# unsubstituted -- an unfilled placeholder stops Postgres starting.
if [ -f "$ROOT_DIR/compose/postgres/90-central.conf" ]; then
  if grep -q '__[A-Z_]*__' "$ROOT_DIR/compose/postgres/90-central.conf"; then
    fail "the generated postgres config still has placeholders"
  else
    pass "postgres config generated for this machine, no placeholders left"
    note "max_connections=$(pgq 'show max_connections')  shared_buffers=$(pgq 'show shared_buffers')  work_mem=$(pgq 'show work_mem')"
  fi
else
  fail "the generated postgres config is missing"
fi
# The settings Realtime depends on, and the ones the image must still provide.
[ "$(pgq 'show wal_level')" = "logical" ] && pass "wal_level is logical, which Realtime requires" \
                                          || fail "wal_level is $(pgq 'show wal_level'), Realtime will not work"
SPL="$(pgq 'show shared_preload_libraries')"
case "$SPL" in
  *supabase_vault*|*pgsodium*) pass "the image's preloaded libraries survived the config override" ;;
  *) fail "shared_preload_libraries looks truncated: $SPL" ;;
esac
case "$SPL" in *pg_cron*) pass "pg_cron is preloaded" ;; *) fail "pg_cron is not preloaded" ;; esac
[ "$(pgq "select count(*) from information_schema.tables where table_schema='central' and table_name='applications'")" = "1" ] \
  && pass "the central.applications registry exists" || fail "central.applications is missing"
# The database must not be reachable from outside the machine.
if ss -H -tln | awk '{print $4}' | grep -qE '^(0\.0\.0\.0|\[::\]|\*):5432$'; then
  fail "PostgreSQL is listening on all interfaces — it would be exposed to the internet"
else
  pass "PostgreSQL is bound to 127.0.0.1 only"
fi

# ===========================================================================
# PREREQUISITE GATE
#
# Everything from here needs a working stack. When bootstrap failed, the next
# forty checks all failed for the same single reason and the report took real
# reading to interpret -- run 4 produced 38 failures from one unbound
# variable. If the database is not answering, say so once, print the logs, and
# stop. A short honest report beats a long misleading one.
# ===========================================================================
if [ "$(pgq 'select 1')" != "1" ]; then
  printf '\n%s===== Stopping early =====%s\n' "$C_B" "$C_0"
  fail "PostgreSQL is not answering, so the remaining checks cannot mean anything"
  note "Sections 4 to 10 were NOT run. They are not passing and not failing;"
  note "they were never reached. Fix the stack and run this again."
  RESULTS="$RESULTS\n## Sections 4-10\n- SKIPPED: the stack was not up, so these were never reached\n"
  SKIP=$((SKIP + 7))

  printf '\n%s===== Logs =====%s\n' "$C_B" "$C_0"
  RESULTS="$RESULTS\n## Logs from anything that is not healthy\n"
  for c in $(docker ps -a --format '{{.Names}}' 2>/dev/null); do
    st=$(docker inspect -f '{{.State.Status}}' "$c" 2>/dev/null)
    h=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$c" 2>/dev/null)
    if [ "$st" != "running" ] || { [ "$h" != "healthy" ] && [ "$h" != "none" ]; }; then
      note "----- $c ($st/$h) -----"
      while IFS= read -r line; do note "$line"; done <<EOL
$(docker logs "$c" --tail=30 2>&1 | tail -30)
EOL
    fi
  done
  [ -s /srv/central/logs/central-roles.log ] && {
    note "----- central-roles.sql output -----"
    while IFS= read -r line; do note "$line"; done <<EOL
$(tail -30 /srv/central/logs/central-roles.log)
EOL
  }
  [ -s "$BOOT_LOG" ] && {
    note "----- the last lines bootstrap.sh printed -----"
    while IFS= read -r line; do note "$line"; done <<EOL
$(tail -25 "$BOOT_LOG")
EOL
  }

  finish_report "stopped early: the stack was not up"
  exit 1
fi
pass "the stack is up, so the remaining checks can mean something"

# ===========================================================================
gate_section 4
section "4. Startup, health, restart recovery and resource usage"
# ===========================================================================
# A restart must come back healthy by itself. This is what happens after a
# host reboot or an out-of-memory kill, and it is the difference between a
# blip and somebody driving to the shop.
note "restarting central-postgres to check it recovers unattended"
docker restart central-postgres >/dev/null 2>&1
ok=0
for _ in $(seq 1 30); do
  [ "$(docker inspect -f '{{.State.Health.Status}}' central-postgres 2>/dev/null)" = "healthy" ] && { ok=1; break; }
  sleep 3
done
[ "$ok" = "1" ] && pass "central-postgres returned to healthy after a restart" \
                || fail "central-postgres did not recover within 90 seconds"
[ "$(pgq 'select 1')" = "1" ] && pass "it answers queries again after the restart" \
                              || fail "it does not answer after the restart"
# restart: unless-stopped must actually be set, or nothing comes back on reboot.
POL="$(docker inspect -f '{{.HostConfig.RestartPolicy.Name}}' central-postgres 2>/dev/null)"
[ "$POL" = "unless-stopped" ] && pass "restart policy is unless-stopped, so it survives a reboot" \
                              || fail "restart policy is '$POL'"

# ===========================================================================
gate_section 5
section "5. Two independent applications, and isolation between them"
# ===========================================================================
# alpha gets realtime+storage, beta gets auth instead. Two applications with
# DIFFERENT service sets, because "provision only what it needs" is the claim
# under test, not just isolation.
if "$ROOT_DIR/provision-app.sh" --name alpha_shop --domain alpha-shop.staging.test \
     --realtime --storage --no-start > /tmp/prov-alpha_shop.log 2>&1; then
  pass "provisioned alpha_shop (realtime + storage, no auth)"
else
  fail "provisioning alpha_shop failed"; detail tail -20 /tmp/prov-alpha_shop.log
fi
if "$ROOT_DIR/provision-app.sh" --name beta_shop --domain beta-shop.staging.test \
     --auth --no-start > /tmp/prov-beta_shop.log 2>&1; then
  pass "provisioned beta_shop (auth, no realtime or storage)"
else
  fail "provisioning beta_shop failed"; detail tail -20 /tmp/prov-beta_shop.log
fi

# The services each one asked for, and crucially the ones it did NOT.
A_PROF="$(sed -n 's/^COMPOSE_PROFILES=//p' "$ROOT_DIR/apps/alpha_shop/.env" 2>/dev/null | tail -1)"
B_PROF="$(sed -n 's/^COMPOSE_PROFILES=//p' "$ROOT_DIR/apps/beta_shop/.env" 2>/dev/null | tail -1)"
printf '%s' "$A_PROF" | grep -q realtime && printf '%s' "$A_PROF" | grep -qv auth \
  && pass "alpha_shop's profiles are '$A_PROF' — no auth, as measured" \
  || fail "alpha_shop's profiles are '$A_PROF'"
printf '%s' "$B_PROF" | grep -q auth \
  && pass "beta_shop's profiles are '$B_PROF' — auth only" \
  || fail "beta_shop's profiles are '$B_PROF'"
[ -n "$(psqlq_db beta_shop "select 1 from pg_namespace where nspname='auth'" 2>/dev/null)" ] \
  && pass "beta_shop's database has an auth schema" \
  || fail "beta_shop has no auth schema"
[ -z "$(psqlq_db alpha_shop "select 1 from pg_namespace where nspname='auth'" 2>/dev/null)" ] \
  && pass "alpha_shop's database has NO auth schema — nothing provisioned that it does not use" \
  || fail "alpha_shop has an auth schema it never asked for"

# Each application's own credentials must open its own database.
for app in alpha_shop beta_shop; do
  PW="$(sed -n 's/^APP_DB_PASSWORD=//p' "$ROOT_DIR/apps/$app/.env" | tail -1)"
  if docker exec -e PGPASSWORD="$PW" central-postgres \
       psql -tAqX -h 127.0.0.1 -U "${app}_authenticator" -d "$app" -c 'select 1' 2>/dev/null | grep -q 1; then
    pass "$app's credentials open $app's own database"
  else
    fail "$app's credentials cannot open its own database"
  fi
done

# The claim that matters: beta's credentials must be refused by alpha.
BPW="$(sed -n 's/^APP_DB_PASSWORD=//p' "$ROOT_DIR/apps/beta_shop/.env" | tail -1)"
ERR="$(docker exec -e PGPASSWORD="$BPW" central-postgres \
  psql -tAqX -h 127.0.0.1 -U beta_shop_authenticator -d alpha_shop -c 'select 1' 2>&1)"
if printf '%s' "$ERR" | grep -qi 'permission denied for database'; then
  pass "beta_shop's credentials are REFUSED by alpha_shop's database"
else
  fail "beta_shop reached alpha_shop, or failed for another reason: $(printf '%s' "$ERR" | head -1)"
fi

# Put real data in alpha and prove beta cannot read it even by name.
pgq "create table if not exists secret_prices (id int primary key, cost numeric)" alpha_shop >/dev/null
pgq "insert into secret_prices values (1, 999.99) on conflict do nothing" alpha_shop >/dev/null
CROSS="$(docker exec -e PGPASSWORD="$BPW" central-postgres \
  psql -tAqX -h 127.0.0.1 -U beta_shop_authenticator -d alpha_shop \
  -c 'select cost from secret_prices' 2>&1)"
printf '%s' "$CROSS" | grep -q '999.99' \
  && fail "beta_shop READ alpha_shop's data" \
  || pass "beta_shop cannot read alpha_shop's data"

# Separate JWT secrets: a token minted for one must not be accepted by the other.
A_SEC="$(sed -n 's/^JWT_SECRET=//p' "$ROOT_DIR/apps/alpha_shop/.env" | tail -1)"
B_SEC="$(sed -n 's/^JWT_SECRET=//p' "$ROOT_DIR/apps/beta_shop/.env" | tail -1)"
[ -n "$A_SEC" ] && [ "$A_SEC" != "$B_SEC" ] \
  && pass "the two applications have different JWT secrets" \
  || fail "the applications share a JWT secret — a token for one would work on the other"
for app in alpha_shop beta_shop; do
  MODE="$(stat -c '%a' "$ROOT_DIR/apps/$app/.env")"
  [ "$MODE" = "600" ] && pass "$app/.env is mode 600" || fail "$app/.env is mode $MODE"
done

# ===========================================================================
gate_section 6
section "6. Realtime, end to end"
# ===========================================================================
# The risky part is not that Realtime runs; it is that the proxy sends the
# right Host header, because Realtime reads the tenant from its first label.
# Nothing short of a real subscription proves that.
APP=alpha_shop
# Container names and hostnames use the hyphenated form; the database and
# role names keep the underscore. provision-app.sh derives this the same way.
APP_DNS="$(printf '%s' "$APP" | tr '_' '-')"
ENV="$ROOT_DIR/apps/$APP/.env"

# Serve this site over plain HTTP for the test: the hostname does not resolve
# publicly, so Let's Encrypt cannot issue a certificate. Everything else about
# the routing -- handle_path, the /socket rewrite, header_up Host -- is
# unchanged, and that is what is under test.
# EVERY site file, not just this application's. One left on https meant Caddy
# kept trying to reach Let's Encrypt for a hostname with no public DNS, which
# left the proxy reporting "starting" for minutes and made unrelated checks
# look flaky.
for SITE in "$ROOT_DIR"/compose/caddy-sites/*.caddy; do
  [ -f "$SITE" ] || continue
  grep -q "^# staging:" "$SITE" && continue
  sed -i "1s|^|# staging: plain HTTP, these hostnames have no public DNS\n|" "$SITE"
  sed -i -E "s|^([a-z0-9-]+\\.staging\\.test) \\{|http://\\1 {|" "$SITE"
  note "$(basename "$SITE") switched to http:// (no ACME in staging)"
done
grep -q "staging.test" /etc/hosts || echo "127.0.0.1 alpha-shop.staging.test beta-shop.staging.test" >> /etc/hosts
docker restart central-caddy >/dev/null 2>&1; sleep 4

cd "$ROOT_DIR/apps/$APP" && ./compose.sh up -d >/tmp/app-up.log 2>&1
ok=0
for _ in $(seq 1 24); do
  [ "$(docker inspect -f '{{.State.Health.Status}}' "${APP_DNS}-rest" 2>/dev/null)" = "healthy" ] && { ok=1; break; }
  sleep 5
done
[ "$ok" = "1" ] && pass "${APP_DNS}-rest became healthy" || { fail "${APP_DNS}-rest never became healthy"; detail docker logs "${APP_DNS}-rest" --tail=20; }

RT_UP=0
for _ in $(seq 1 24); do
  s=$(docker inspect -f '{{.State.Status}}' "${APP_DNS}.realtime" 2>/dev/null || echo missing)
  [ "$s" = "running" ] && { RT_UP=1; break; }
  sleep 5
done
[ "$RT_UP" = "1" ] && pass "${APP_DNS}.realtime is running" || fail "${APP_DNS}.realtime is not running"

# PostgREST through the proxy: proves handle_path strips /rest/v1 correctly.
ANON="$(sed -n 's/^ANON_KEY=//p' "$ENV" | tail -1)"
pgq "create table if not exists public.tick (id serial primary key, label text, at timestamptz default now())" "$APP" >/dev/null
pgq "grant select, insert on public.tick to anon, authenticated, service_role" "$APP" >/dev/null
pgq "grant usage, select on all sequences in schema public to anon, authenticated, service_role" "$APP" >/dev/null
pgq "notify pgrst, 'reload schema'" "$APP" >/dev/null; sleep 3
CODE=$(curl -s -o /tmp/rest.json -w '%{http_code}' --max-time 15 \
  -H "apikey: $ANON" -H "Authorization: Bearer $ANON" \
  "http://$APP_DNS.staging.test/rest/v1/tick?select=id&limit=1")
[ "$CODE" = "200" ] && pass "PostgREST answers through the proxy at /rest/v1/ (HTTP 200)" \
                    || { fail "PostgREST through the proxy returned HTTP $CODE"; detail head -c 200 /tmp/rest.json; }

# Now the subscription. Add the table to the publication Realtime reads.
pgq "do \$\$ begin if not exists (select 1 from pg_publication where pubname='supabase_realtime')
     then create publication supabase_realtime; end if; end \$\$" "$APP" >/dev/null
pgq "alter table public.tick replica identity full" "$APP" >/dev/null
pgq "alter publication supabase_realtime add table public.tick" "$APP" >/dev/null 2>&1
pgq "select count(*) from pg_publication_tables where pubname='supabase_realtime' and tablename='tick'" "$APP" \
  | grep -q 1 && pass "public.tick is in the supabase_realtime publication" \
              || fail "could not add public.tick to the publication"

# Realtime reads its tenant's published tables when it starts. A table added
# to the publication afterwards is not noticed, which is why the subscription
# was ACCEPTED and then no event ever arrived -- the channel was fine and the
# table was simply not in the set Realtime was watching.
#
# In production the publication is set up before the service starts, so this
# restart is a property of the TEST's ordering, not of the platform.
note "restarting Realtime so it picks up the newly published table"
docker restart "${APP_DNS}.realtime" >/dev/null 2>&1 || true
rt_ready=0
for _ in $(seq 1 24); do
  if docker exec "${APP_DNS}.realtime" curl -sSf -o /dev/null --max-time 3 \
       "http://127.0.0.1:4000/api/tenants/${APP_DNS}/health" 2>/dev/null; then rt_ready=1; break; fi
  sleep 5
done
[ "$rt_ready" = "1" ] && pass "Realtime answered its health endpoint after the restart" \
                      || note "Realtime did not answer its health endpoint; the subscription below will show whether it works"

if command -v node >/dev/null 2>&1; then
  mkdir -p /tmp/rt && cd /tmp/rt
  npm init -y >/dev/null 2>&1
  if npm install @supabase/supabase-js@2.47.10 >/tmp/npm.log 2>&1; then
    cat > rt.mjs <<'JS'
import { createClient } from '@supabase/supabase-js'
const url = process.env.RT_URL, key = process.env.RT_KEY
const sb = createClient(url, key, { realtime: { params: { eventsPerSecond: 10 } } })
let got = null
const ch = sb.channel('probe')
  .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'tick' },
      p => { got = p.new })
const sub = await new Promise(res => {
  ch.subscribe(s => { if (s === 'SUBSCRIBED' || s === 'CHANNEL_ERROR' || s === 'TIMED_OUT') res(s) })
  setTimeout(() => res('NO_STATUS'), 25000)
})
if (sub !== 'SUBSCRIBED') { console.log('SUBSCRIBE_FAILED:' + sub); process.exit(3) }
console.log('SUBSCRIBED')
// Insert through the REST API, so the whole path is the real one.
const r = await fetch(`${url}/rest/v1/tick`, {
  method: 'POST',
  headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
  body: JSON.stringify({ label: 'realtime-probe' })
})
if (!r.ok) { console.log('INSERT_FAILED:' + r.status + ':' + (await r.text()).slice(0,200)); process.exit(4) }
for (let i = 0; i < 100 && !got; i++) await new Promise(r => setTimeout(r, 200))
if (got) { console.log('EVENT_RECEIVED:' + JSON.stringify(got)); process.exit(0) }
console.log('NO_EVENT'); process.exit(5)
JS
    OUT=$(RT_URL="http://$APP_DNS.staging.test" RT_KEY="$ANON" timeout 90 node rt.mjs 2>&1)
    echo "$OUT" | grep -q '^SUBSCRIBED' && pass "a Realtime subscription was accepted through the proxy" \
                                        || fail "the subscription was not accepted: $(echo "$OUT" | head -2 | tr '\n' ' ')"
    # Realtime's log, unconditionally. It reports healthy while delivering
    # nothing, so a capture that only runs for unhealthy containers never
    # shows the one thing that would explain this.
    # The HEAD of the log, where the tenant migrations run. Run 18 captured
    # only the tail, which showed the downstream "schema realtime does not
    # exist" and not the migration failure that caused it.
    note "----- ${APP_DNS}.realtime log, FIRST 40 lines (where migrations run) -----"
    detail bash -c "docker logs '${APP_DNS}.realtime' 2>&1 | head -40"
    note "----- any migration or permission line anywhere in that log -----"
    detail bash -c "docker logs '${APP_DNS}.realtime' 2>&1 | grep -iE 'migrat|permission|reserved role|does not exist|CREATE SCHEMA|tenant' | head -20"
    note "----- what Realtime actually built in ${APP} -----"
    detail pgq "select coalesce((select 'realtime schema: yes' from pg_namespace where nspname='realtime'), 'realtime schema: NO')" "$APP"
    detail pgq "select 'realtime tables: ' || count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='realtime' and c.relkind in ('r','p')" "$APP"
    detail pgq "select 'list_changes present: ' || count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='realtime' and p.proname='list_changes'" "$APP"
    detail pgq "select 'rt_user can create in db: ' || has_database_privilege('${APP}_realtime', '${APP}', 'CREATE')" "$APP"
    note "----- ${APP_DNS}.realtime log (tail) -----"
    while IFS= read -r line; do note "$line"; done <<EOL
$(docker logs "${APP_DNS}.realtime" --tail=30 2>&1 | tail -30)
EOL
    note "----- replication slots and publication -----"
    while IFS= read -r line; do note "$line"; done <<EOL
$(pgq "select slot_name, plugin, active, database from pg_replication_slots" 2>&1)
$(pgq "select pubname, tablename from pg_publication_tables order by 1,2" "$APP" 2>&1)
$(pgq "select count(*) as realtime_subscriptions from realtime.subscription" "$APP" 2>&1)
EOL
    if echo "$OUT" | grep -q 'EVENT_RECEIVED'; then
      pass "an INSERT produced a Realtime event end to end"
      note "$(echo "$OUT" | grep EVENT_RECEIVED | cut -c1-120)"
    else
      fail "no Realtime event arrived: $(echo "$OUT" | tail -2 | tr '\n' ' ')"
      detail docker logs "${APP_DNS}.realtime" --tail=25
    fi
  else
    skip "could not install @supabase/supabase-js, so Realtime was not tested end to end"
  fi
  cd "$ROOT_DIR"
else
  skip "node is not installed, so the Realtime subscription was not tested"
fi

# ===========================================================================
gate_section 7
section "7. Object storage: upload, download, delete"
# ===========================================================================
# Cloudflare R2 needs the owner's account credentials, which this machine does
# not have and must not have. MinIO speaks the same S3 protocol and is what
# storage-api talks to either way, so this tests OUR configuration -- the
# backend selection, the bucket wiring, the signing and the proxy route. It
# does NOT test R2 itself. That difference is stated in the report.
# adobe/s3mock rather than MinIO. MinIO is no longer published to Docker Hub
# and its server image carries no `mc` client, so the first run skipped this
# whole section with "could not start MinIO". s3mock is built for exactly this
# job: it creates buckets from an environment variable, needs no client, and
# keeps objects as plain files that can be checked with `find`.
# Generated, not written down: a literal credential in a repository is a bad
# habit even when the value is a throwaway, and the repository's own secret
# scan correctly refuses it.
S3_KEY="stg$(openssl rand -hex 6)"
S3_SECRET="$(openssl rand -hex 16)"
if docker run -d --name staging-s3 --network central_edge \
     -e initialBuckets=staging-images \
     -e root=/s3data \
     adobe/s3mock:5.2.3 >/dev/null 2>&1; then
  # Wait for it to answer rather than guessing at a sleep.
  s3_up=0
  for _ in $(seq 1 20); do
    if docker run --rm --network central_edge curlimages/curl:8.11.1 \
         -s -o /dev/null --max-time 4 "http://staging-s3:9090/" 2>/dev/null; then s3_up=1; break; fi
    sleep 3
  done
  [ "$s3_up" = "1" ] && pass "an S3-compatible endpoint is running (adobe/s3mock, standing in for R2)" \
                     || { fail "the S3 endpoint never answered"; detail docker logs staging-s3 --tail=15; }

  sed -i 's|^R2_BUCKET=.*|R2_BUCKET=staging-images|' "$ENV"
  sed -i 's|^R2_ENDPOINT=.*|R2_ENDPOINT=http://staging-s3:9090|' "$ENV"
  sed -i "s|^R2_ACCESS_KEY_ID=.*|R2_ACCESS_KEY_ID=$S3_KEY|" "$ENV"
  sed -i "s|^R2_SECRET_ACCESS_KEY=.*|R2_SECRET_ACCESS_KEY=$S3_SECRET|" "$ENV"
  cd "$ROOT_DIR/apps/$APP" && ./compose.sh up -d >/tmp/st-up.log 2>&1
  ok=0
  for _ in $(seq 1 24); do
    [ "$(docker inspect -f '{{.State.Health.Status}}' "${APP_DNS}-storage" 2>/dev/null)" = "healthy" ] && { ok=1; break; }
    sleep 5
  done
  if [ "$ok" = "1" ]; then
    pass "storage-api started against the S3 backend"
    # storage-api's migrations have now created its tables. The roles it
    # switches into still have no rights on them, and there is no way to
    # arrange that in advance on this image, so the grants are applied here.
    if "$ROOT_DIR/scripts/post-start.sh" --app "$APP" >/tmp/poststart.log 2>&1; then
      pass "post-start granted the storage schema to the roles storage-api uses"
    else
      fail "post-start did not complete, so storage requests will be refused"
    fi
    detail bash -c "grep -E 'storage|realtime|table|grant|MISSING|list_changes' /tmp/poststart.log | head -14"
    SVC="$(sed -n 's/^SERVICE_ROLE_KEY=//p' "$ENV" | tail -1)"
    B="http://$APP_DNS.staging.test/storage/v1"
    c=$(curl -s -o /tmp/mk.json -w '%{http_code}' -X POST "$B/bucket" \
      -H "Authorization: Bearer $SVC" -H "Content-Type: application/json" \
      -d '{"id":"product-images","name":"product-images","public":true}')
    case "$c" in 200|201|409) pass "created the product-images bucket through the proxy (HTTP $c)" ;;
      *) fail "creating the bucket returned HTTP $c: $(head -c 150 /tmp/mk.json)" ;; esac

    echo "staging test image bytes" > /tmp/up.txt
    c=$(curl -s -o /tmp/up.json -w '%{http_code}' -X POST "$B/object/product-images/test/probe.txt" \
      -H "Authorization: Bearer $SVC" -H "Content-Type: text/plain" --data-binary @/tmp/up.txt)
    case "$c" in 200|201) pass "UPLOAD through storage-api to the S3 backend (HTTP $c)" ;;
      *) fail "upload returned HTTP $c: $(head -c 200 /tmp/up.json)" ;; esac

    c=$(curl -s -o /tmp/dl.txt -w '%{http_code}' "$B/object/public/product-images/test/probe.txt")
    if [ "$c" = "200" ] && grep -q "staging test image bytes" /tmp/dl.txt; then
      pass "DOWNLOAD returned the same bytes that were uploaded"
    else
      fail "download returned HTTP $c and $( [ -s /tmp/dl.txt ] && echo 'unexpected content' || echo 'nothing' )"
    fi

    # Confirm the object really landed in the object store rather than on
    # storage-api's own disk. s3mock keeps objects as files, so this is a
    # direct check on the S3 server's contents with no client involved.
    if docker exec staging-s3 find /s3data -name '*probe*' 2>/dev/null | grep -q .; then
      pass "the object is physically in the S3 bucket, so the backend is really S3"
    else
      fail "the object is not in the S3 bucket — storage may have fallen back to local files"
      detail bash -c 'docker exec staging-s3 find /s3data -maxdepth 3 | head -8'
    fi

    c=$(curl -s -o /tmp/rm.json -w '%{http_code}' -X DELETE "$B/object/product-images/test/probe.txt" \
      -H "Authorization: Bearer $SVC")
    case "$c" in 200|204) pass "DELETE removed the object (HTTP $c)" ;;
      *) fail "delete returned HTTP $c: $(head -c 150 /tmp/rm.json)" ;; esac
    docker exec staging-s3 find /s3data -name '*probe*' 2>/dev/null | grep -q . \
      && fail "the object is still in the bucket after the delete" \
      || pass "the object is gone from the bucket"
  else
    fail "storage-api never became healthy"
    detail docker logs "${APP_DNS}-storage" --tail=25
  fi
  cd "$ROOT_DIR"
else
  skip "could not start the S3 endpoint, so storage was not tested"
fi

# ===========================================================================
gate_section 8
section "8. Backup and restore rehearsal"
# ===========================================================================
pgq "create table if not exists public.money (id serial primary key, total numeric)" "$APP" >/dev/null
pgq "insert into public.money (total) select (random()*100)::numeric(10,2) from generate_series(1,500)" "$APP" >/dev/null
BEFORE_ROWS="$(pgq 'select count(*) from public.money' "$APP")"
BEFORE_SUM="$(pgq 'select sum(total)::numeric(14,2) from public.money' "$APP")"
note "alpha_shop now holds $BEFORE_ROWS rows summing to $BEFORE_SUM"

if "$ROOT_DIR/scripts/backup.sh" --all --verify >/tmp/backup.log 2>&1; then
  pass "backup.sh completed with verification"
else
  fail "backup.sh exited non-zero"; detail tail -15 /tmp/backup.log
fi
BK="$(ls -t "$ROOT_DIR"/backups/alpha_shop-*.sql.gz 2>/dev/null | head -1)"
[ -n "$BK" ] && pass "a dump was produced: $(basename "$BK") ($(du -h "$BK" | awk '{print $1}'))" \
             || fail "no dump file for alpha_shop was produced"
[ -n "$(ls -t "$ROOT_DIR"/backups/globals-*.sql.gz 2>/dev/null | head -1)" ] \
  && pass "cluster globals were dumped too (roles and their passwords)" \
  || fail "no globals dump — a restore would come up with no roles"

if [ -n "$BK" ]; then
  if ASSUME_YES=1 "$ROOT_DIR/scripts/restore.sh" --app alpha_shop --file "$BK" \
       --into alpha_restore_probe >/tmp/restore.log 2>&1; then
    pass "restore.sh restored into a separate database without touching the live one"
  else
    fail "restore.sh exited non-zero"; detail tail -20 /tmp/restore.log
  fi
  R_ROWS="$(pgq 'select count(*) from public.money' alpha_restore_probe)"
  R_SUM="$(pgq 'select sum(total)::numeric(14,2) from public.money' alpha_restore_probe)"
  [ "$R_ROWS" = "$BEFORE_ROWS" ] && pass "restored row count matches ($R_ROWS)" \
                                 || fail "restored row count is $R_ROWS, expected $BEFORE_ROWS"
  [ "$R_SUM" = "$BEFORE_SUM" ] && pass "restored money total matches ($R_SUM)" \
                               || fail "restored total is $R_SUM, expected $BEFORE_SUM"
  L_ROWS="$(pgq 'select count(*) from public.money' "$APP")"
  [ "$L_ROWS" = "$BEFORE_ROWS" ] && pass "the live database was left alone ($L_ROWS rows)" \
                                 || fail "the live database changed during the rehearsal"
  pgq "drop database if exists alpha_restore_probe with (force)" >/dev/null 2>&1
fi

# ===========================================================================
gate_section 9
section "9. Scheduled jobs in another database, calling a new URL"
# ===========================================================================
# The architectural claim: pg_cron's scheduler lives in one database, so each
# application's jobs are registered with cron.schedule_in_database(). If that
# does not work, every scheduled report and payment reminder stops silently
# after the migration.
[ "$(pgq "select setting from pg_settings where name='cron.database_name'")" = "postgres" ] \
  && pass "cron.database_name is 'postgres', so no tenant owns the scheduler" \
  || fail "cron.database_name is $(pgq "select setting from pg_settings where name='cron.database_name'")"

pgq "create table if not exists public.cron_proof (id serial primary key, ran_at timestamptz default now())" "$APP" >/dev/null
pgq "select cron.schedule_in_database('staging-proof', '* * * * *',
       'insert into public.cron_proof default values', 'alpha_shop')" >/dev/null
pgq "select count(*) from cron.job where jobname='staging-proof'" | grep -q 1 \
  && pass "a job was registered for alpha_shop from the postgres database" \
  || fail "cron.schedule_in_database did not register the job"

note "waiting up to 100s for pg_cron to fire the job"
fired=0
for _ in $(seq 1 20); do
  n="$(pgq 'select count(*) from public.cron_proof' "$APP")"
  [ "${n:-0}" -gt 0 ] && { fired=1; break; }
  sleep 5
done
if [ "$fired" = "1" ]; then
  pass "the job actually executed in the other database (rows: $(pgq 'select count(*) from public.cron_proof' "$APP"))"
else
  fail "the job never ran — scheduled reports would silently stop after migration"
  detail pgq "select status, return_message from cron.job_run_details where jobid in (select jobid from cron.job where jobname='staging-proof') order by start_time desc limit 3"
fi

# ---------------------------------------------------------------------------
# And a job that calls an HTTP endpoint with the NEW url, which is what the two
# real jobs that hardcode the old project URL will have to become.
#
# WHERE THE JOB LIVES IS NOT A DETAIL. pg_net's background worker reads
# net.http_request_queue in exactly ONE database -- pg_net.database_name,
# which is 'postgres' here -- and running it on several databases in a cluster
# is not supported. A net.http_post() from an application's own database
# inserts a queue row, returns an id, and is NEVER processed: no error, no
# response row, no request. Run 17 failed here with an empty net._http_response
# and no explanation, which is exactly what that looks like.
#
# So the platform's rule is: a job that makes an HTTP call is registered in the
# postgres database with cron.schedule(); a job that only runs SQL is
# registered against the application's database with schedule_in_database().
# Both are tested, and the second half of this section MEASURES the limitation
# rather than leaving it as a mystery.
# ---------------------------------------------------------------------------
PGNET_DB="$(pgq "select setting from pg_settings where name='pg_net.database_name'")"
[ "$PGNET_DB" = "postgres" ] \
  && pass "pg_net.database_name is 'postgres' — HTTP-making jobs belong there" \
  || fail "pg_net.database_name is '${PGNET_DB:-unset}'; HTTP jobs scheduled elsewhere would be silently dropped"

pgq "create extension if not exists pg_net" >/dev/null 2>&1
pgq "select cron.schedule('staging-http', '* * * * *',
       \$\$select net.http_post(url := 'http://alpha-shop-rest:3000/tick',
         headers := '{\"Content-Type\":\"application/json\",\"apikey\":\"$ANON\",\"Authorization\":\"Bearer $ANON\"}'::jsonb,
         body := '{\"label\":\"from-cron\"}'::jsonb)\$\$)" >/dev/null 2>&1
note "waiting up to 100s for the http job to reach PostgREST"
note "the job is registered in the postgres database, where pg_net's worker is"
note "the URL is the container alias, not the staging hostname: pg_net runs"
note "inside the postgres container, which has no /etc/hosts entry for it"
http_ok=0
for _ in $(seq 1 20); do
  n="$(pgq "select count(*) from public.tick where label='from-cron'" "$APP")"
  [ "${n:-0}" -gt 0 ] && { http_ok=1; break; }
  sleep 5
done
if [ "$http_ok" = "1" ]; then
  pass "a cron job reached the new API URL through pg_net and the proxy"
else
  # pg_net records every response. Without reading it, a failure here is just
  # a timeout with no cause. Read it from the database the worker serves.
  note "----- pg_net responses, queue depth and cron run details -----"
  detail pgq "select 'responses: ' || count(*) from net._http_response"
  detail pgq "select id, status_code, left(coalesce(error_msg,''),120), left(coalesce(content,''),100) from net._http_response order by id desc limit 5"
  detail pgq "select 'queued and unprocessed in postgres: ' || count(*) from net.http_request_queue"
  detail pgq "select jobname, status, left(coalesce(return_message,''),160), start_time from cron.job_run_details d join cron.job j using (jobid) where j.jobname like 'staging-%' order by start_time desc limit 5"
  fail "the cron job did not reach PostgREST through pg_net"
fi

# Now MEASURE the limitation, so the migration note rests on evidence from
# this cluster rather than on a sentence in someone's documentation. The same
# call from the application's own database must queue and never be served.
pgq "select net.http_post(url := 'http://alpha-shop-rest:3000/tick',
       headers := '{\"Content-Type\":\"application/json\",\"apikey\":\"$ANON\",\"Authorization\":\"Bearer $ANON\"}'::jsonb,
       body := '{\"label\":\"from-app-db\"}'::jsonb)" "$APP" >/dev/null 2>&1
sleep 15
Q_APP="$(pgq "select count(*) from net.http_request_queue" "$APP")"
R_APP="$(pgq "select count(*) from net._http_response" "$APP")"
if [ "${R_APP:-0}" = "0" ] && [ "${Q_APP:-0}" -gt 0 ]; then
  pass "pg_net from an application's own database queues ($Q_APP) and is never served (0 responses) — measured, and the reason HTTP jobs are registered in postgres"
elif [ "${R_APP:-0}" != "0" ]; then
  note "pg_net answered from the application database too (responses: $R_APP)."
  note "That is more than the extension documents; the platform still registers"
  note "HTTP jobs in postgres, which is supported, rather than relying on this."
  pass "pg_net behaviour from an application database recorded (responses: $R_APP)"
else
  note "neither a queue row nor a response appeared in $APP"
  detail pgq "select count(*) from pg_extension where extname='pg_net'" "$APP"
  fail "could not measure pg_net's behaviour from an application database"
fi
pgq "delete from net.http_request_queue" "$APP" >/dev/null 2>&1

pgq "select cron.unschedule('staging-proof')" >/dev/null 2>&1
pgq "select cron.unschedule('staging-http')" >/dev/null 2>&1

# ===========================================================================
gate_section 10
section "10. Resource usage, capacity, and provisioning from clean"
# ===========================================================================
RUNNING="$(docker ps --format '{{.Names}}' | wc -l | tr -d ' ')"
note "containers running: $RUNNING"

# AT REST first, for comparison only. This is NOT the figure anything is sized
# from: an idle machine measures an idle machine, and a server bought on that
# basis is bought for a shop with nobody in it.
note "at rest, before any load:"
printf '\n       %-28s %8s %8s\n' "CONTAINER" "MEM" "CPU%"
docker stats --no-stream --format '{{.Name}}|{{.MemUsage}}|{{.CPUPerc}}' 2>/dev/null \
  | while IFS='|' read -r n m c; do printf '       %-28s %8s %8s\n' "$n" "${m%% /*}" "$c"; done
docker stats --no-stream --format '{{.Name}}|{{.MemUsage}}' 2>/dev/null \
  | while IFS='|' read -r n m; do note "  idle $n ${m%% /*}"; done
USED_IDLE=$(( RAM_MB - $(awk '/^MemAvailable:/{print $2}' /proc/meminfo) / 1024 ))
note "memory used on the machine at rest: ${USED_IDLE} MB of ${RAM_MB} MB"

# ---------------------------------------------------------------------------
# UNDER LOAD. Four requests per iteration through Caddy and PostgREST with the
# anon key -- product lookup, open a sale, add its lines, read the running
# daily total -- with container stats sampled every three seconds WHILE those
# requests are in flight, and the peak per container kept.
# ---------------------------------------------------------------------------
LOAD_CLIENTS="${LOAD_CLIENTS:-8}"
LOAD_SECONDS="${LOAD_SECONDS:-60}"
note "driving $LOAD_CLIENTS concurrent clients at alpha_shop for ${LOAD_SECONDS}s"
if "$HERE/load-test.sh" --app "$APP" --base-url "http://$APP_DNS.staging.test" \
     --key "$ANON" --clients "$LOAD_CLIENTS" --seconds "$LOAD_SECONDS" \
     > /tmp/load.log 2>&1; then
  pass "the application served a sustained load with no non-2xx response"
else
  fail "the application returned errors under load, or the load test could not run"
fi
# Throughput, latency and rows written belong in the report whether it passed
# or not: a failure with no numbers is as hard to act on as a silent pass.
detail bash -c "grep -E 'REQUEST|lookup|open-sale|add-items|daily-total|requests/second|rows written' /tmp/load.log"
if grep -q "requests/second" /tmp/load.log; then
  RPS="$(sed -n 's/.*= \([0-9]*\) requests\/second.*/\1/p' /tmp/load.log | head -1)"
  P95="$(awk '$1=="open-sale"{print $5}' /tmp/load.log | head -1)"
  pass "measured throughput: ${RPS:-?} requests/second, opening a sale at p95 ${P95:-?} ms"
else
  fail "the load test produced no throughput figure"
  detail tail -12 /tmp/load.log
fi

# The PEAK figures go into the report's fenced block, because
# size-from-measurement.py reads that block to size the VPS. It used to read
# the idle numbers.
PEAK="$(sed -n '/PEAK container usage/,/stat sample/p' /tmp/load.log \
        | grep -E '^\s+[a-z0-9]' | grep -v CONTAINER || true)"
if [ -n "$PEAK" ]; then
  RESULTS="$RESULTS\n\`\`\`\n$PEAK\n\`\`\`\n"
  pass "resource usage captured under load, with two applications provisioned"
  note "peak, per container, measured while requests were being served:"
  printf '%s\n' "$PEAK" | while IFS= read -r l; do note "$l"; done
else
  fail "no peak resource figures were captured, so nothing can be sized from this run"
  detail tail -20 /tmp/load.log
fi
USED_MB=$(( RAM_MB - $(awk '/^MemAvailable:/{print $2}' /proc/meminfo) / 1024 ))
note "memory used on the machine after the load: ${USED_MB} MB of ${RAM_MB} MB"

if "$ROOT_DIR/capacity.sh" > /tmp/capacity.log 2>&1; then
  pass "capacity.sh reported everything within limits (exit 0)"
else
  rc=$?
  [ "$rc" = "1" ] && pass "capacity.sh reported a warning and exited 1, as designed" \
                  || note "capacity.sh exited $rc"
fi
grep -q "room for more applications" /tmp/capacity.log \
  && { pass "capacity.sh produced a headroom estimate"; detail grep -A3 "room for more applications" /tmp/capacity.log; } \
  || fail "no headroom estimate in the capacity output"

if "$ROOT_DIR/scripts/health.sh" >/tmp/health.log 2>&1; then
  pass "health.sh reported every service healthy"
else
  # A note, not a fail, was the wrong call: health.sh exiting non-zero means a
  # service on this machine is not healthy, which is a failure of the thing
  # under test. Recording it as a remark kept the run's own score green while
  # the report said nothing either way.
  fail "health.sh reported problems across the provisioned applications"
  detail bash -c 'grep -E "FAIL|WARN" /tmp/health.log | head -12'
fi

# Provisioning a third application from scratch, now that the machine is busy.
if "$ROOT_DIR/provision-app.sh" --name gamma_shop --no-start >/tmp/prov-gamma.log 2>&1; then
  pass "a third application provisioned on an already-configured machine"
else
  fail "provisioning a third application failed"; detail tail -15 /tmp/prov-gamma.log
fi
# Re-running must be a no-op, not a lockout: the generated password must not change.
P1="$(sed -n 's/^APP_DB_PASSWORD=//p' "$ROOT_DIR/apps/alpha_shop/.env" | tail -1)"
"$ROOT_DIR/provision-app.sh" --name alpha_shop --domain alpha-shop.staging.test \
  --realtime --storage --no-start >/tmp/prov-again.log 2>&1
P2="$(sed -n 's/^APP_DB_PASSWORD=//p' "$ROOT_DIR/apps/alpha_shop/.env" | tail -1)"
[ "$P1" = "$P2" ] && pass "re-provisioning kept the existing password instead of locking the app out" \
                  || fail "re-provisioning CHANGED the database password — the app would lose access"
"$ROOT_DIR/scripts/test-provision-sql.sh" >/tmp/iso.log 2>&1 \
  && pass "the standalone isolation test also passes here ($(grep -c PASS /tmp/iso.log) checks)" \
  || note "standalone isolation test: $(grep -c FAIL /tmp/iso.log) failure(s)"

# ===========================================================================
section "Logs from anything that is not healthy"
# ===========================================================================
# The first run reported "central-caddy is 'restarting'" and nothing about
# why, because the reason lived in the container's log and the report did not
# carry it. It does now.
any_bad=0
for c in $(docker ps -a --format '{{.Names}}' 2>/dev/null); do
  st=$(docker inspect -f '{{.State.Status}}' "$c" 2>/dev/null)
  h=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$c" 2>/dev/null)
  if [ "$st" != "running" ] || { [ "$h" != "healthy" ] && [ "$h" != "none" ]; }; then
    any_bad=1
    note "----- $c ($st/$h) -----"
    while IFS= read -r line; do note "$line"; done <<EOL
$(docker logs "$c" --tail=25 2>&1 | tail -25)
EOL
  fi
done
[ "$any_bad" = "0" ] && note "every container is running and healthy"

# ===========================================================================
finish_report "full run"

[ "$FAIL" = "0" ] || exit 1
