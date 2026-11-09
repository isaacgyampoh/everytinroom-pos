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
#    8  Supabase Auth, for the application that actually uses it
#    9  backup and restore rehearsal, reconciled by row count
#   10  scheduled jobs, in another database, calling a new URL
#   11  resource use UNDER LOAD, capacity, provisioning again from clean
#   12  the whole deployment re-run, and recovery from a full stop
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

# Site files are generated for https, and these hostnames have no public DNS,
# so staging rewrites them to plain http. ONE function, because there were
# three copies and two of them were wrong: provision-app.sh writes the site
# address with no scheme at all --
#     alpha-shop.staging.test {
# -- and the later copies matched `^https://`, which never appears. So the
# site file for an application provisioned mid-run stayed on automatic HTTPS,
# Caddy answered its http requests with 308, and its websocket never
# connected. It reports what it changed, so a no-op is visible.
staging_http_sites() {
  local f base changed=0
  for f in "$ROOT_DIR/compose/caddy-sites/"*.caddy; do
    [ -f "$f" ] || continue
    base="$(basename "$f")"
    grep -q "^# staging:" "$f" && continue
    sed -i "1s|^|# staging: plain HTTP, these hostnames have no public DNS\n|" "$f"
    sed -i -E "s|^([a-z0-9-]+\\.staging\\.test) \\{|http://\\1 {|" "$f"
    sed -i -E "s|^https://([a-z0-9-]+\\.staging\\.test)|http://\\1|" "$f"
    note "$base switched to http:// (no ACME in staging)"
    changed=$((changed+1))
  done
  [ "$changed" = "0" ] && return 1
  docker exec central-caddy caddy reload --config /etc/caddy/Caddyfile >/dev/null 2>&1 \
    || docker restart central-caddy >/dev/null 2>&1
  sleep 4
  return 0
}
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
# Every provisioned application's compose configuration must be VALID, for
# every one of them, before anything is started.
#
# Compose interpolates every service's environment when it reads the file,
# whatever profiles are active. app.compose.yml guards Realtime's three
# required secrets with ${VAR:?...}, and those were written only for
# applications that asked for Realtime -- so `compose up` for an application
# WITHOUT Realtime failed outright and started nothing at all, including the
# services it does use. Two of the five inventoried projects need no Realtime.
#
# It went unnoticed for eight runs because the application without Realtime
# was never started. This check costs nothing, needs no container, and would
# have caught it the first time.
for a in alpha_shop beta_shop; do
  if [ -x "$ROOT_DIR/apps/$a/compose.sh" ]; then
    if OUT="$(cd "$ROOT_DIR/apps/$a" && ./compose.sh config -q 2>&1)"; then
      pass "$a's compose configuration is valid, so every service it uses can start"
    else
      fail "$a's compose configuration is INVALID — nothing would start for it"
      DETAIL_LINES=12 detail bash -c "printf '%s\n' \"$OUT\" | grep -iE 'error|missing' | head -12"
    fi
  else
    fail "$a has no compose.sh, so provisioning did not finish"
  fi
done

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

# ---------------------------------------------------------------------------
# FIRST, the one privilege everything below depends on.
#
# Run 22 carried the GRANT SET ON PARAMETER log_min_messages that
# 21-realtime.sql makes, and the server still reported 29 of 91 migrations
# applied -- the same as before the grant. Either the grant did not take,
# because the provisioning role may not make it on this image, or it took and
# Realtime did not retry. Those need different fixes, and the difference is
# one query.
RT_ROLE="${APP}_realtime"
HAS_PARAM="$(pgq "select has_parameter_privilege('$RT_ROLE','log_min_messages','SET')::text")"
if [ "$HAS_PARAM" = "true" ]; then
  pass "$RT_ROLE may set log_min_messages, so migration 20230328144023 can create list_changes()"
else
  fail "$RT_ROLE may NOT set log_min_messages — Realtime's migration 30 cannot run"
  note "Without it realtime.list_changes() is never created and Realtime accepts"
  note "subscriptions while delivering nothing. 21-realtime.sql attempts the grant;"
  note "the lines below say whether this server's provisioning role is allowed to."
fi
# Who may grant it, which decides whether this is fixable from provisioning.
detail pgq "select 'provisioning role: ' || current_user || ', superuser=' || (select rolsuper::text from pg_roles where rolname = current_user)"
detail pgq "select 'parameter ACL: ' || coalesce((select array_to_string(paracl,' | ') from pg_parameter_acl where parname='log_min_messages'), '(none recorded)')"
detail pgq "select 'current_user may grant it: ' || has_parameter_privilege(current_user,'log_min_messages','SET WITH GRANT OPTION')::text"
# What provisioning itself said about it, which is where the explanation is.
note "----- what provisioning reported for realtime -----"
detail bash -c "grep -iE 'log_min_messages|list_changes|realtime' /tmp/prov-alpha_shop.log | head -14"

# ---------------------------------------------------------------------------
# Before any client: replay Realtime's OWN tenant migrations against this
# server, as a role shaped like the one it connects with.
#
# Realtime builds realtime.list_changes() with ninety-one tenant migrations
# and does not stop when one fails -- it accepts subscriptions and delivers
# nothing. Five runs were spent narrowing that down twenty-five minutes at a
# time. This answers it in seconds, here, against the real image, whose
# `postgres` is not a superuser either; and it checks BOTH directions, so if
# the grant in 21-realtime.sql ever stops being necessary the run says so
# instead of carrying it forever.
if [ -d /tmp/realtime-src/lib/realtime/tenants/repo/migrations ] \
   || "$DEPLOY/scripts/fetch-realtime-migrations.sh" /tmp/realtime-src >/tmp/rtfetch.log 2>&1; then
  if python3 "$DEPLOY/scripts/test-realtime-migrations.py" \
       --migrations /tmp/realtime-src/lib/realtime/tenants/repo/migrations \
       --via-docker central-postgres > /tmp/rtmig.log 2>&1; then
    pass "Realtime's own tenant migrations replay cleanly here, and list_changes() is created"
    detail bash -c "grep -E 'PASS' /tmp/rtmig.log | head -10"
  else
    fail "Realtime's tenant migrations do not replay on this server under its own privileges"
    detail bash -c "grep -E 'PASS|FAIL|ERROR|stops at' /tmp/rtmig.log | head -12"
  fi
  # And how far the WHOLE set gets, as information rather than a verdict. The
  # migration after list_changes needs a reserved role this image does not
  # have, so it is expected to stop there; this records where, so the claim
  # that only broadcast and presence are affected rests on a measurement.
  python3 "$DEPLOY/scripts/test-realtime-migrations.py" \
    --migrations /tmp/realtime-src/lib/realtime/tenants/repo/migrations \
    --via-docker central-postgres --all > /tmp/rtmig-all.log 2>&1 || true
  note "----- the whole set, best effort (expected to stop at the reserved-role migration) -----"
  detail bash -c "grep -E 'replayed with no failure|still stops at|ERROR|had no extractable' /tmp/rtmig-all.log | head -8"
else
  skip "could not fetch Realtime's migration sources, so they were not replayed"
  detail tail -5 /tmp/rtfetch.log
fi

ENV="$ROOT_DIR/apps/$APP/.env"

# Serve this site over plain HTTP for the test: the hostname does not resolve
# publicly, so Let's Encrypt cannot issue a certificate. Everything else about
# the routing -- handle_path, the /socket rewrite, header_up Host -- is
# unchanged, and that is what is under test.
# EVERY site file, not just this application's. One left on https meant Caddy
# kept trying to reach Let's Encrypt for a hostname with no public DNS, which
# left the proxy reporting "starting" for minutes and made unrelated checks
# look flaky.
staging_http_sites || note "every site file was already on http://"
grep -q "staging.test" /etc/hosts || echo "127.0.0.1 alpha-shop.staging.test beta-shop.staging.test" >> /etc/hosts

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
    # A real supabase-js client. Parameterised, because one subscription on
    # one tenant is not enough: delivery is checked on two independent
    # tenants, a change in one must NOT appear on the other's channel, and
    # the whole thing is checked again after the service is restarted.
    #
    #   RT_EXPECT=event     a change must arrive
    #   RT_EXPECT=no-event  a change must NOT arrive (cross-tenant isolation)
    cat > rt.mjs <<'JS'
import { createClient } from '@supabase/supabase-js'
const url = process.env.RT_URL
const key = process.env.RT_KEY
const table = process.env.RT_TABLE || 'tick'
const label = process.env.RT_LABEL || 'realtime-probe'
const expect = process.env.RT_EXPECT || 'event'
// Where the INSERT goes. For the cross-tenant check it is a DIFFERENT
// application from the one being listened to, which is the whole point.
const insertUrl = process.env.RT_INSERT_URL || url
const insertKey = process.env.RT_INSERT_KEY || key

const sb = createClient(url, key, { realtime: { params: { eventsPerSecond: 10 } } })
let got = null
const ch = sb.channel('probe-' + Math.random().toString(36).slice(2))
  .on('postgres_changes', { event: 'INSERT', schema: 'public', table },
      p => { if (!got) got = p.new })
const sub = await new Promise(res => {
  ch.subscribe(s => { if (s === 'SUBSCRIBED' || s === 'CHANNEL_ERROR' || s === 'TIMED_OUT') res(s) })
  setTimeout(() => res('NO_STATUS'), 25000)
})
if (sub !== 'SUBSCRIBED') { console.log('SUBSCRIBE_FAILED:' + sub); process.exit(3) }
console.log('SUBSCRIBED')

// Insert through the REST API, so the whole path is the real one.
const r = await fetch(`${insertUrl}/rest/v1/${table}`, {
  method: 'POST',
  headers: { apikey: insertKey, Authorization: `Bearer ${insertKey}`,
             'Content-Type': 'application/json', Prefer: 'return=representation' },
  body: JSON.stringify({ label })
})
if (!r.ok) { console.log('INSERT_FAILED:' + r.status + ':' + (await r.text()).slice(0,200)); process.exit(4) }
console.log('INSERTED')

// 20s for an event that should come; the same 20s of silence is what proves
// one that should not. A shorter wait for the negative case would make the
// isolation check pass simply by not waiting long enough.
for (let i = 0; i < 100 && !got; i++) await new Promise(r => setTimeout(r, 200))

if (expect === 'no-event') {
  if (got) { console.log('LEAKED:' + JSON.stringify(got)); process.exit(6) }
  console.log('NO_EVENT_AS_EXPECTED'); process.exit(0)
}
if (got) { console.log('EVENT_RECEIVED:' + JSON.stringify(got)); process.exit(0) }
console.log('NO_EVENT'); process.exit(5)
JS
    # Finish Realtime off BEFORE asking a client to subscribe. Its tenant
    # migrations stop at the first one the application's role cannot run, and
    # post-start applies that one as the image's superuser and waits for
    # Realtime to continue. Run 26 did this in section 7 instead -- after
    # these tests -- so the report showed 39 of 91 migrations beside a failed
    # delivery check and 83 of 91 two sections later.
    if "$ROOT_DIR/scripts/post-start.sh" --app "$APP" --only realtime \
         >/tmp/poststart-rt.log 2>&1; then
      pass "post-start completed Realtime's setup for $APP"
    else
      fail "post-start could not complete Realtime's setup for $APP"
    fi
    DETAIL_LINES=22 detail bash -c "grep -vE '^$' /tmp/poststart-rt.log | tail -22"
    # The three migrations that decide whether live updates work, named.
    for v in 20230328144023 20240401105812 20260326120000; do
      n="$(pgq "select count(*) from realtime.schema_migrations where version = $v" "$APP")"
      [ "${n:-0}" = "1" ] && pass "Realtime migration $v is applied" \
                          || fail "Realtime migration $v is NOT applied"
    done

    OUT=$(RT_URL="http://$APP_DNS.staging.test" RT_KEY="$ANON" timeout 90 node rt.mjs 2>&1)
    echo "$OUT" | grep -q '^SUBSCRIBED' && pass "a Realtime subscription was accepted through the proxy" \
                                        || fail "the subscription was not accepted: $(echo "$OUT" | head -2 | tr '\n' ' ')"
    # Realtime's log, unconditionally. It reports healthy while delivering
    # nothing, so a capture that only runs for unhealthy containers never
    # shows the one thing that would explain this.
    # The HEAD of the log, where the tenant migrations run. Run 18 captured
    # only the tail, which showed the downstream "schema realtime does not
    # exist" and not the migration failure that caused it.
    # Realtime runs TWO sets of migrations: Realtime.Repo.Migrations build
    # _realtime (its own tenants and extensions), and the tenant migrations
    # build `realtime` (subscription, apply_rls, list_changes). Run 19 showed
    # the first set succeeding and the second stopping after two tables, and
    # the 20-line cap hid where. So: the tenant set specifically, and enough
    # lines to contain the failure.
    # Realtime.Repo.Migrations build _realtime; Realtime.Tenants.Migrations
    # build `realtime`. Run 21 matched both and spent all sixty lines on the
    # first set, truncating before the one in question. The repo set is
    # excluded here.
    note "----- Realtime's TENANT migrations, and anything that stopped them -----"
    DETAIL_LINES=60 detail bash -c "docker logs '${APP_DNS}.realtime' 2>&1 | grep -vE 'Realtime[.]Repo[.]Migrations' | grep -iE 'Tenants[.]Migrations|MigrationsFailed|migrations_failed|tenant_db_dump|dump_not_found|== Migrated|== Running|\[error\]|permission denied|must be owner|already exists|does not exist|syntax error' | grep -v PoolingReplicationError | head -60"
    # A count and a boundary, not a list. The list is 91 rows long and a
    # truncated list answers nothing: what matters is how far it got and
    # whether the one that creates list_changes is among them.
    note "----- how far its own migration history got -----"
    detail pgq "select 'tenant migrations applied: ' || count(*) || ' of 91, highest ' || coalesce(max(version)::text,'none') from realtime.schema_migrations" "$APP"
    detail pgq "select 'the migration creating list_changes (20230328144023) applied: ' || count(*) from realtime.schema_migrations where version = 20230328144023" "$APP"
    detail pgq "select 'realtime functions: ' || coalesce(string_agg(p.proname, ', ' order by p.proname), '(none)') from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'realtime'" "$APP"
    # Which roles this image refuses to let anything modify. Four failures so
    # far have been a non-superuser trying to act as another role, and one of
    # Realtime's own migrations creates a role and moves ownership to it. When
    # that is the wall, this names it instead of leaving it to be guessed at.
    detail pgq "select 'reserved roles: ' || coalesce(current_setting('supautils.reserved_roles', true), '(not set)')"
    detail pgq "select 'rt_user attributes: createrole=' || rolcreaterole || ' superuser=' || rolsuper || ' bypassrls=' || rolbypassrls from pg_roles where rolname = '${APP}_realtime'"
    detail pgq "select 'supabase_realtime_admin exists: ' || count(*) from pg_roles where rolname='supabase_realtime_admin'"
    detail pgq "select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='realtime' order by 1" "$APP"
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

    # -------------------------------------------------------------------
    # A SECOND, INDEPENDENT TENANT.
    #
    # One tenant delivering proves Realtime works. It does not prove the
    # tenants are separate, and Realtime reads its tenant from the first
    # label of the Host header -- a mistake there would have every
    # application reading one tenant's changes without anything looking
    # wrong. beta_shop deliberately has no Realtime (section 5 proves the
    # platform runs none for an application that does not ask), so the
    # second Realtime tenant is its own application.
    # -------------------------------------------------------------------
    G_APP=gamma_rt
    G_DNS="$(printf '%s' "$G_APP" | tr '_' '-')"
    G_ENV="$ROOT_DIR/apps/$G_APP/.env"
    if "$ROOT_DIR/provision-app.sh" --name "$G_APP" --domain "$G_DNS.staging.test" \
         --realtime > /tmp/prov-gamma-rt.log 2>&1; then
      pass "a second Realtime application was provisioned and started"
    else
      fail "provisioning the second Realtime application failed"
      detail tail -20 /tmp/prov-gamma-rt.log
    fi
    grep -q "$G_DNS.staging.test" /etc/hosts || echo "127.0.0.1 $G_DNS.staging.test" >> /etc/hosts
    # The new application's site file needs the same staging rewrite, and it
    # was written after the first pass ran.
    staging_http_sites || note "no site file needed rewriting"

    if [ -f "$G_ENV" ]; then
      G_ANON="$(sed -n 's/^ANON_KEY=//p' "$G_ENV" | tail -1)"
      pgq "create table if not exists public.tick (id serial primary key, label text, at timestamptz default now())" "$G_APP" >/dev/null
      pgq "grant select, insert on public.tick to anon, authenticated, service_role" "$G_APP" >/dev/null
      pgq "grant usage, select on all sequences in schema public to anon, authenticated, service_role" "$G_APP" >/dev/null
      pgq "alter table public.tick replica identity full" "$G_APP" >/dev/null
      pgq "do \$\$ begin if not exists (select 1 from pg_publication where pubname='supabase_realtime')
           then create publication supabase_realtime; end if; end \$\$" "$G_APP" >/dev/null
      pgq "alter publication supabase_realtime add table public.tick" "$G_APP" >/dev/null 2>&1
      pgq "notify pgrst, 'reload schema'" "$G_APP" >/dev/null
      # Realtime reads its published tables at boot, so it is restarted after
      # the publication changes -- the same reason alpha's is.
      docker restart "$G_DNS.realtime" >/dev/null 2>&1 || true
      gok=0
      for _ in $(seq 1 24); do
        st="$(docker inspect -f '{{.State.Status}}' "$G_DNS.realtime" 2>/dev/null || echo absent)"
        [ "$st" = "running" ] && { gok=1; break; }
        sleep 5
      done
      [ "$gok" = "1" ] || note "$G_DNS.realtime is not running; the check below will show what that means"
      sleep 10

      "$ROOT_DIR/scripts/post-start.sh" --app "$G_APP" --only realtime \
        >/tmp/poststart-gamma.log 2>&1 || true
      detail bash -c "grep -E 'schema_migrations|list_changes|applied migration' /tmp/poststart-gamma.log | tail -6"
      OUT2=$(RT_URL="http://$G_DNS.staging.test" RT_KEY="$G_ANON" RT_LABEL="gamma-probe" \
             timeout 90 node rt.mjs 2>&1)
      if echo "$OUT2" | grep -q 'EVENT_RECEIVED'; then
        pass "the SECOND tenant also delivers a database change end to end"
      else
        fail "the second tenant delivered nothing: $(echo "$OUT2" | tail -2 | tr '\n' ' ')"
        detail docker logs "$G_DNS.realtime" --tail=20
      fi

      # -----------------------------------------------------------------
      # CROSS-TENANT: listen on gamma, write to alpha. Nothing may arrive.
      # A leak here would mean one shop seeing another's sales in real
      # time, and it would look like everything was working.
      # -----------------------------------------------------------------
      OUT3=$(RT_URL="http://$G_DNS.staging.test" RT_KEY="$G_ANON" \
             RT_INSERT_URL="http://$APP_DNS.staging.test" RT_INSERT_KEY="$ANON" \
             RT_LABEL="cross-tenant-probe" RT_EXPECT=no-event \
             timeout 90 node rt.mjs 2>&1)
      if echo "$OUT3" | grep -q 'NO_EVENT_AS_EXPECTED'; then
        pass "a change in alpha_shop did NOT reach $G_APP's channel — the tenants are separate"
      elif echo "$OUT3" | grep -q 'LEAKED'; then
        fail "a change in alpha_shop WAS delivered to $G_APP — one application can see another's data"
        note "$(echo "$OUT3" | grep LEAKED | cut -c1-140)"
      else
        fail "the cross-tenant check did not complete: $(echo "$OUT3" | tail -2 | tr '\n' ' ')"
      fi
    else
      fail "$G_APP has no environment file, so the second tenant was not tested"
    fi

    # -------------------------------------------------------------------
    # RECONNECTION. A restarted Realtime has to pick its tenant up again and
    # resume delivering, with nobody touching anything. A platform that
    # needs a human after every restart is not one to run a shop on.
    # -------------------------------------------------------------------
    docker restart "${APP_DNS}.realtime" >/dev/null 2>&1
    rok=0
    for _ in $(seq 1 24); do
      st="$(docker inspect -f '{{.State.Status}}' "${APP_DNS}.realtime" 2>/dev/null || echo absent)"
      [ "$st" = "running" ] && { rok=1; break; }
      sleep 5
    done
    [ "$rok" = "1" ] && pass "${APP_DNS}.realtime came back up after a restart" \
                     || fail "${APP_DNS}.realtime did not come back after a restart"
    sleep 10
    OUT4=$(RT_URL="http://$APP_DNS.staging.test" RT_KEY="$ANON" RT_LABEL="after-restart" \
           timeout 90 node rt.mjs 2>&1)
    if echo "$OUT4" | grep -q 'EVENT_RECEIVED'; then
      pass "delivery resumed after the Realtime service was restarted, unattended"
    else
      fail "nothing was delivered after the restart: $(echo "$OUT4" | tail -2 | tr '\n' ' ')"
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
# WHICH S3 SERVER STANDS IN FOR R2, AND WHY IT HAS CHANGED THREE TIMES
#
# MinIO first, which is what storage-api is developed against. It is no longer
# published to Docker Hub and its server image carries no client, so the first
# run skipped this section entirely.
#
# Then adobe/s3mock. It got further and then stopped being useful: storage-api
# issues a multi-object delete while writing, s3mock's response does not
# satisfy the AWS SDK, and every upload failed with
#   HTTP 500 "Backend did not confirm deletion of 2 of 2 keys"
#
# Then LocalStack, whose S3 is a full implementation -- and which now refuses
# to start without a licence token:
#   License activation failed! No credentials were found in the environment.
#   Localstack returning with exit code 55.
# A paid service for a staging double is not something to take on.
#
# Now SeaweedFS, which implements the S3 API including DeleteObjects, is
# published with version tags, and needs no licence. Unconfigured it accepts
# anonymous requests, which is what makes the verification below possible
# without putting a client inside the fixture.
#
# AND THE CHECKS NO LONGER DEPEND ON THE FIXTURE. "Did the object really reach
# the object store" is asked through the S3 API with an ordinary HTTP client,
# not by looking for files on the server's disk (s3mock) or by running a tool
# that happens to be installed in it (LocalStack's awslocal). The same
# question, asked the same way, works against Cloudflare R2.
#
# Credentials are generated rather than written down: a literal credential in
# a repository is a bad habit even when the value is a throwaway, and the
# repository's own secret scan correctly refuses one.
S3_KEY="stg$(openssl rand -hex 6)"
S3_SECRET="$(openssl rand -hex 16)"
S3_BUCKET=staging-images
S3_HOST="http://staging-s3:8333"
# One place that makes an HTTP request inside the platform's network, so the
# fixture needs no client of its own.
s3curl() { docker run --rm --network central_edge curlimages/curl:8.11.1 "$@" 2>/dev/null; }

if docker run -d --name staging-s3 --network central_edge \
     chrislusf/seaweedfs:4.52 \
     server -s3 -dir=/data -ip.bind=0.0.0.0 -master.volumeSizeLimitMB=64 \
     >/dev/null 2>&1; then
  s3_up=0
  for _ in $(seq 1 40); do
    code="$(s3curl -s -o /dev/null -w '%{http_code}' --max-time 4 "$S3_HOST/" || echo 000)"
    case "$code" in 200|403|404) s3_up=1; break ;; esac
    sleep 3
  done
  if [ "$s3_up" = "1" ]; then
    pass "an S3-compatible endpoint is running (SeaweedFS, standing in for R2)"
  else
    fail "the S3 endpoint never answered on $S3_HOST"
    detail docker logs staging-s3 --tail=25
  fi

  # The bucket, created through the S3 API.
  code="$(s3curl -s -o /dev/null -w '%{http_code}' --max-time 15 -X PUT "$S3_HOST/$S3_BUCKET" || echo 000)"
  case "$code" in
    200|201|204|409) pass "the S3 bucket exists (HTTP $code)" ;;
    *) fail "creating the S3 bucket returned HTTP $code"; detail docker logs staging-s3 --tail=20 ;;
  esac

  sed -i "s|^R2_BUCKET=.*|R2_BUCKET=$S3_BUCKET|" "$ENV"
  sed -i "s|^R2_ENDPOINT=.*|R2_ENDPOINT=$S3_HOST|" "$ENV"
  sed -i "s|^R2_ACCESS_KEY_ID=.*|R2_ACCESS_KEY_ID=$S3_KEY|" "$ENV"
  sed -i "s|^R2_SECRET_ACCESS_KEY=.*|R2_SECRET_ACCESS_KEY=$S3_SECRET|" "$ENV"
  # R2's region is 'auto'; other S3 servers reject it. Production keeps 'auto'.
  grep -q '^R2_REGION=' "$ENV" && sed -i 's|^R2_REGION=.*|R2_REGION=us-east-1|' "$ENV" \
                               || printf 'R2_REGION=us-east-1\n' >> "$ENV"
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
    "$ROOT_DIR/scripts/post-start.sh" --app "$APP" >/tmp/poststart.log 2>&1 || true
    # Read the per-service result rather than one exit code: this application
    # has both storage and realtime, and a report that blames storage for
    # Realtime's incomplete migrations is simply wrong about storage.
    PS_LINE="$(grep '^RESULT ' /tmp/poststart.log | tail -1)"
    case "$PS_LINE" in
      *storage=0*) pass "post-start granted the storage schema to the roles storage-api uses" ;;
      *storage=1*) fail "post-start could not grant the storage schema, so storage requests will be refused" ;;
      *) fail "post-start produced no result line; it did not get far enough to try" ;;
    esac
    detail bash -c "grep -E 'storage|realtime|table|grant|MISSING|list_changes' /tmp/poststart.log | head -14"
    # ---------------------------------------------------------------------
    # EFFECTIVE PRIVILEGES, not "the grant statement ran".
    #
    # post-start.sh applies the grants and reports success. That is not proof:
    # a GRANT by a role that does not own the object only WARNS and grants
    # nothing, and psql still exits 0 -- which is exactly how this was broken
    # for two runs. So the privileges are read back out of the catalogue, for
    # each role and each table storage-api actually created.
    # ---------------------------------------------------------------------
    ST_TABLES="$(pgq "select string_agg(c.relname, ' ' order by c.relname) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='storage' and c.relkind in ('r','p')" "$APP")"
    note "storage tables storage-api created: ${ST_TABLES:-none}"
    if [ -z "$ST_TABLES" ]; then
      fail "storage-api created no tables, so there is nothing to grant and nothing to check"
    else
      missing=""
      for r in anon authenticated service_role; do
        for t in $ST_TABLES; do
          got="$(pgq "select has_table_privilege('$r','storage.$t','SELECT')::text" "$APP")"
          [ "$got" = "true" ] || missing="$missing $r:$t"
        done
      done
      if [ -z "$missing" ]; then
        pass "every storage table is readable by anon, authenticated and service_role — checked as effective privileges"
      else
        fail "effective privileges are MISSING on:$missing"
      fi
      # service_role has to write, not just read.
      w=""
      for t in $ST_TABLES; do
        got="$(pgq "select has_table_privilege('service_role','storage.$t','INSERT')::text" "$APP")"
        [ "$got" = "true" ] || w="$w $t"
      done
      [ -z "$w" ] && pass "service_role can INSERT into every storage table" \
                  || fail "service_role cannot INSERT into:$w"
      # And the functions its migrations created, which is where the
      # owner-only rule bit: granting these as the provisioning role warned
      # and did nothing.
      nf="$(pgq "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='storage'" "$APP")"
      ng="$(pgq "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='storage' and has_function_privilege('service_role', p.oid, 'EXECUTE')" "$APP")"
      if [ "${nf:-0}" -gt 0 ] && [ "${nf:-0}" = "${ng:-0}" ]; then
        pass "service_role may EXECUTE all $nf storage function(s)"
      else
        fail "service_role may execute only ${ng:-0} of ${nf:-0} storage functions"
      fi
    fi

    SVC="$(sed -n 's/^SERVICE_ROLE_KEY=//p' "$ENV" | tail -1)"
    B="http://$APP_DNS.staging.test/storage/v1"
    # One place that asks the S3 server what it holds, through its own API.
    s3list() { s3curl -s --max-time 20 "$S3_HOST/$S3_BUCKET?list-type=2&max-keys=200"; }

    c=$(curl -s -o /tmp/mk.json -w '%{http_code}' -X POST "$B/bucket" \
      -H "Authorization: Bearer $SVC" -H "Content-Type: application/json" \
      -d '{"id":"product-images","name":"product-images","public":true}')
    case "$c" in 200|201|409) pass "created the product-images bucket through the proxy (HTTP $c)" ;;
      *) fail "creating the bucket returned HTTP $c: $(head -c 150 /tmp/mk.json)" ;; esac

    # A payload with a known checksum, so "the same bytes came back" is a
    # comparison rather than a substring match.
    head -c 4096 /dev/urandom > /tmp/up.bin
    UP_SHA="$(sha256sum /tmp/up.bin | cut -d' ' -f1)"
    c=$(curl -s -o /tmp/up.json -w '%{http_code}' -X POST "$B/object/product-images/test/probe.bin" \
      -H "Authorization: Bearer $SVC" -H "Content-Type: application/octet-stream" \
      --data-binary @/tmp/up.bin)
    case "$c" in 200|201) pass "UPLOAD through storage-api to the S3 backend (HTTP $c)" ;;
      *) fail "upload returned HTTP $c: $(head -c 200 /tmp/up.json)" ;; esac

    c=$(curl -s -o /tmp/dl.bin -w '%{http_code}' "$B/object/public/product-images/test/probe.bin")
    DL_SHA="$(sha256sum /tmp/dl.bin 2>/dev/null | cut -d' ' -f1)"
    if [ "$c" = "200" ] && [ -n "$DL_SHA" ] && [ "$DL_SHA" = "$UP_SHA" ]; then
      pass "DOWNLOAD returned byte-identical content ($(wc -c </tmp/dl.bin | tr -d ' ') bytes, sha256 matches)"
    else
      fail "download returned HTTP $c and the bytes differ (uploaded ${UP_SHA:0:12}…, got ${DL_SHA:0:12}…)"
    fi

    # Confirm the object really landed in the object store rather than on
    # storage-api's own disk -- asked through the S3 API with an ordinary HTTP
    # client. Earlier versions poked at s3mock's files and then ran
    # LocalStack's awslocal; both tied the check to the fixture. This is the
    # same question R2 can be asked.
    s3list > /tmp/s3ls.xml 2>&1
    if grep -q 'probe.bin' /tmp/s3ls.xml; then
      pass "the object is physically in the S3 bucket, so the backend is really S3"
      detail bash -c "grep -o '<Key>[^<]*</Key>' /tmp/s3ls.xml | head -4"
    else
      fail "the object is not in the S3 bucket — storage may have fallen back to local files"
      detail bash -c "head -c 600 /tmp/s3ls.xml"
    fi

    # MULTI-DELETE, explicitly. storage-api issues a DeleteObjects for more
    # than one key, and a backend whose response does not satisfy the AWS SDK
    # fails the whole write with HTTP 500 -- which is what retired the
    # previous stand-in. Two objects are uploaded and removed in one call so
    # that path is exercised on purpose rather than incidentally.
    for n in 1 2; do
      curl -s -o /dev/null -X POST "$B/object/product-images/test/multi-$n.bin" \
        -H "Authorization: Bearer $SVC" -H "Content-Type: application/octet-stream" \
        --data-binary @/tmp/up.bin
    done
    s3list > /tmp/s3ls2.xml 2>&1
    MN="$(grep -c 'multi-' /tmp/s3ls2.xml || true)"
    [ "${MN:-0}" -ge 1 ] && pass "two more objects were written for the multi-delete test" \
                         || { fail "the multi-delete fixtures were not written"; detail bash -c "head -c 400 /tmp/s3ls2.xml"; }
    # DELETE /object/{bucket} with a prefixes body. The first version used
    # /objects/{bucket}, which storage-api answers with
    #   Route DELETE:/objects/product-images not found
    # so the multi-delete path was never actually exercised.
    c=$(curl -s -o /tmp/rmm.json -w '%{http_code}' -X DELETE "$B/object/product-images" \
      -H "Authorization: Bearer $SVC" -H "Content-Type: application/json" \
      -d '{"prefixes":["test/multi-1.bin","test/multi-2.bin"]}')
    case "$c" in
      200|204) pass "MULTI-DELETE of two objects accepted (HTTP $c)" ;;
      *) fail "multi-delete returned HTTP $c: $(head -c 200 /tmp/rmm.json)" ;;
    esac
    s3list > /tmp/s3ls3.xml 2>&1
    if grep -q 'multi-' /tmp/s3ls3.xml; then
      fail "the multi-deleted objects are still in the bucket"
      detail bash -c "grep -o '<Key>[^<]*</Key>' /tmp/s3ls3.xml | head -4"
    else
      pass "both objects are gone from the bucket after the multi-delete"
    fi

    c=$(curl -s -o /tmp/rm.json -w '%{http_code}' -X DELETE "$B/object/product-images/test/probe.bin" \
      -H "Authorization: Bearer $SVC")
    case "$c" in 200|204) pass "DELETE removed the object (HTTP $c)" ;;
      *) fail "delete returned HTTP $c: $(head -c 150 /tmp/rm.json)" ;; esac
    s3list > /tmp/s3ls4.xml 2>&1
    if grep -q 'probe.bin' /tmp/s3ls4.xml; then
      fail "the object is still in the bucket after the delete"
    else
      pass "the object is gone from the bucket, confirmed through the S3 API"
    fi
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
section "8. Supabase Auth, for the application that actually uses it"
# ===========================================================================
# Everytinroom does NOT use Supabase Auth -- it checks a PIN against its own
# staff_sessions table -- and the platform is built so that an application
# which does not use it runs no GoTrue at all. That is tested in section 5.
#
# But three of the inventoried projects DO need it, and until now nothing
# started GoTrue or made a single request to it. The run proved beta_shop had
# an `auth` schema and the right compose profile, which are both static facts
# about a database and a file. A broken GoTrue would have passed every check.
#
# This starts beta_shop and exercises the thing that matters: sign a user up,
# sign them in, and use the token. It runs here, before the resource and
# recovery sections, so GoTrue is measured under load with everything else and
# has to come back from the restart like everything else.
B_APP=beta_shop
B_DNS="$(printf '%s' "$B_APP" | tr '_' '-')"
B_ENV="$ROOT_DIR/apps/$B_APP/.env"
if [ -f "$B_ENV" ]; then
  ( cd "$ROOT_DIR/apps/$B_APP" && ./compose.sh up -d >/tmp/beta-up.log 2>&1 ) || true
  # Long enough to cover a first-time image pull. The previous 120s expired
  # while compose was still extracting supabase/gotrue, so the run reported
  # "never became healthy" for a container that had not finished being
  # created -- and the real failure, a crash loop, was a minute behind that.
  bok=0
  for _ in $(seq 1 48); do
    st="$(docker inspect -f '{{.State.Status}}' "${B_DNS}-auth" 2>/dev/null || echo absent)"
    h="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "${B_DNS}-auth" 2>/dev/null)"
    [ "$st" = "running" ] && { [ "$h" = "healthy" ] || [ "$h" = "none" ]; } && { bok=1; break; }
    sleep 5
  done
  if [ "$bok" = "1" ]; then
    pass "GoTrue is running for the application that asked for auth"
  else
    # Say WHICH of the three it is: absent, restarting, or up but unhealthy.
    BSTAT="$(docker inspect -f '{{.State.Status}}' "${B_DNS}-auth" 2>/dev/null || echo absent)"
    BRESTARTS="$(docker inspect -f '{{.RestartCount}}' "${B_DNS}-auth" 2>/dev/null || echo 0)"
    fail "GoTrue did not become healthy for $B_APP (state: $BSTAT, restarts: $BRESTARTS)"
    # Why it is not there at all is in compose's own output, which the first
    # version captured and never printed -- the report said only
    # "No such container: beta-shop-auth".
    note "----- what compose said when starting $B_APP -----"
    DETAIL_LINES=25 detail tail -25 /tmp/beta-up.log
    detail bash -c "grep -E '^COMPOSE_PROFILES=' '$B_ENV' || echo '(no COMPOSE_PROFILES line)'"
    detail bash -c "docker ps -a --format '{{.Names}} {{.Status}}' | grep '^${B_DNS}' || echo '(no ${B_DNS} containers at all)'"
    detail docker logs "${B_DNS}-auth" --tail=25
  fi

  B_ANON="$(sed -n 's/^ANON_KEY=//p' "$B_ENV" | tail -1)"
  AUTH_URL="http://$B_DNS.staging.test/auth/v1"
  grep -q "$B_DNS.staging.test" /etc/hosts || echo "127.0.0.1 $B_DNS.staging.test" >> /etc/hosts

  CODE="$(curl -s -o /tmp/gt-health.json -w '%{http_code}' --max-time 15 \
    -H "apikey: $B_ANON" "$AUTH_URL/health" 2>/dev/null || echo 000)"
  [ "$CODE" = "200" ] && pass "GoTrue answers /auth/v1/health through the proxy (HTTP 200)" \
                      || { fail "GoTrue health returned HTTP $CODE through the proxy"; detail head -c 200 /tmp/gt-health.json; }

  # Created through the ADMIN endpoint with the service role key, not through
  # /signup. provision-app.sh sets GOTRUE_DISABLE_SIGNUP=true by default --
  # open self-registration on a shop's backend is not a default worth having
  # -- so /signup correctly refuses. Weakening that to make a test pass would
  # be testing a configuration nobody runs. The admin path is also what an
  # application that creates its own users actually uses, and it proves the
  # service role key works against GoTrue.
  B_SVC="$(sed -n 's/^SERVICE_ROLE_KEY=//p' "$B_ENV" | tail -1)"
  B_EMAIL="probe-$(openssl rand -hex 4)@staging.invalid"
  B_PASS="$(openssl rand -hex 16)"
  CODE="$(curl -s -o /tmp/gt-signup.json -w '%{http_code}' --max-time 20 \
    -X POST "$AUTH_URL/admin/users" -H "apikey: $B_SVC" \
    -H "Authorization: Bearer $B_SVC" -H "Content-Type: application/json" \
    -d "{\"email\":\"$B_EMAIL\",\"password\":\"$B_PASS\",\"email_confirm\":true}" \
    2>/dev/null || echo 000)"
  if [ "$CODE" = "200" ] || [ "$CODE" = "201" ]; then
    pass "a user was created through GoTrue's admin API with the service role key (HTTP $CODE)"
  else
    fail "admin user creation returned HTTP $CODE"
    # The body can carry a token, so it goes through the redacting path.
    detail head -c 300 /tmp/gt-signup.json
  fi

  # And open self-registration really is refused, which is the other half of
  # that default being correct.
  CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 \
    -X POST "$AUTH_URL/signup" -H "apikey: $B_ANON" -H "Content-Type: application/json" \
    -d "{\"email\":\"open-$(openssl rand -hex 3)@staging.invalid\",\"password\":\"$B_PASS\"}" \
    2>/dev/null || echo 000)"
  case "$CODE" in
    403|422|400) pass "open self-registration is refused (HTTP $CODE), as the default intends" ;;
    200|201) fail "anyone can register on this application — GOTRUE_DISABLE_SIGNUP is not in effect" ;;
    *) note "self-registration returned HTTP $CODE; expected a refusal" ;;
  esac

  # And the row really exists in that application's database, not somewhere else.
  NUSERS="$(psqlq_db "$B_APP" "select count(*) from auth.users where email='$B_EMAIL'" 2>/dev/null | tr -d ' ')"
  [ "${NUSERS:-0}" = "1" ] && pass "the user is in ${B_APP}'s own auth.users table" \
                           || fail "the user is not in ${B_APP}'s auth.users (found ${NUSERS:-0})"
  # And NOT in the other application's database, which has no auth schema at all.
  OTHER="$(psqlq_db "$APP" "select count(*) from pg_namespace where nspname='auth'" 2>/dev/null | tr -d ' ')"
  [ "${OTHER:-0}" = "0" ] && pass "$APP still has no auth schema, so the two do not share users" \
                          || fail "$APP has an auth schema it never asked for"

  # Sign in, and check the token is usable.
  CODE="$(curl -s -o /tmp/gt-login.json -w '%{http_code}' --max-time 20 \
    -X POST "$AUTH_URL/token?grant_type=password" -H "apikey: $B_ANON" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$B_EMAIL\",\"password\":\"$B_PASS\"}" 2>/dev/null || echo 000)"
  if [ "$CODE" = "200" ] && grep -q access_token /tmp/gt-login.json; then
    pass "sign-in returned an access token"
    B_TOKEN="$(sed -n 's/.*"access_token":"\([^"]*\)".*/\1/p' /tmp/gt-login.json | head -1)"
    UCODE="$(curl -s -o /tmp/gt-user.json -w '%{http_code}' --max-time 15 \
      "$AUTH_URL/user" -H "apikey: $B_ANON" -H "Authorization: Bearer $B_TOKEN" 2>/dev/null || echo 000)"
    if [ "$UCODE" = "200" ] && grep -q "$B_EMAIL" /tmp/gt-user.json; then
      pass "the token identifies that user to GoTrue, so the whole path works"
    else
      fail "/auth/v1/user returned HTTP $UCODE and did not identify the user"
    fi
    # The token must be useless against the OTHER application: a separate JWT
    # secret per application is what makes that true, and it is worth proving
    # with a real token rather than by comparing two secrets.
    XCODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 \
      -H "apikey: $B_ANON" -H "Authorization: Bearer $B_TOKEN" \
      "http://$APP_DNS.staging.test/rest/v1/tick?select=id&limit=1" 2>/dev/null || echo 000)"
    case "$XCODE" in
      401|403) pass "beta_shop's token is REJECTED by alpha_shop's API (HTTP $XCODE)" ;;
      *) fail "beta_shop's token got HTTP $XCODE from alpha_shop's API — the JWT secrets are not separating them" ;;
    esac
  else
    fail "sign-in returned HTTP $CODE with no access token"
    detail head -c 200 /tmp/gt-login.json
  fi
else
  fail "$B_APP is not provisioned, so Supabase Auth was not tested at all"
fi

# ===========================================================================
gate_section 9
section "9. Backup and restore rehearsal"
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
gate_section 10
section "10. Scheduled jobs in another database, calling a new URL"
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
gate_section 11
section "11. Resource usage, capacity, and provisioning from clean"
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
# --force: by this point alpha_shop holds the tables earlier sections created,
# so load-test.sh's "this is not an empty database" guard would stop. Here
# that guard is exactly what should be overridden — this machine is disposable
# and every row on it was generated by this script.
if "$HERE/load-test.sh" --app "$APP" --base-url "http://$APP_DNS.staging.test" \
     --key "$ANON" --clients "$LOAD_CLIENTS" --seconds "$LOAD_SECONDS" --force \
     > /tmp/load.log 2>&1; then
  pass "the application served a sustained load with no non-2xx response"
else
  fail "the application returned errors under load, or the load test could not run"
fi
# Throughput, latency and rows written belong in the report whether it passed
# or not: a failure with no numbers is as hard to act on as a silent pass.
detail bash -c "grep -E 'REQUEST|lookup|open-sale|add-items|daily-total|requests/second|failed \\(non-2xx|rows written' /tmp/load.log"
if grep -q "NOTHING SUCCEEDED" /tmp/load.log; then
  # Run 19 printed "measured throughput: 444 requests/second" for a run in
  # which every one of 27,124 requests was non-2xx. That is the speed of
  # producing errors and it was reported as a pass.
  fail "no request succeeded, so nothing was measured — the latency figures above are meaningless"
elif grep -q "successful requests/second" /tmp/load.log; then
  RPS="$(sed -n 's/.*= \([0-9]*\) successful requests\/second.*/\1/p' /tmp/load.log | head -1)"
  NFAIL="$(sed -n 's/^ *\([0-9]*\) failed (non-2xx.*/\1/p' /tmp/load.log | head -1)"
  P95="$(awk '$1=="open-sale"{print $5}' /tmp/load.log | head -1)"
  OKC="$(awk '$1=="open-sale"{print $3}' /tmp/load.log | head -1)"
  if [ "${OKC:-0}" -gt 0 ]; then
    pass "measured throughput: ${RPS:-?} successful requests/second, ${NFAIL:-0} failed, opening a sale at p95 ${P95:-?} ms over ${OKC} successful writes"
  else
    fail "no sale was successfully opened, so the write path was not measured"
  fi
else
  fail "the load test produced no throughput figure"
  detail tail -12 /tmp/load.log
fi

# The PEAK figures go into the report's fenced block, because
# size-from-measurement.py reads that block to size the VPS. It used to read
# the idle numbers.
# Only the container rows. The closing "84 stat sample(s)..." line begins with
# a digit and so matched the old pattern, which put it inside the fenced block
# the sizing script reads.
PEAK="$(sed -n '/PEAK container usage/,/stat sample/p' /tmp/load.log \
        | grep -E '^[[:space:]]+[a-z][a-z0-9_.-]*[[:space:]]+[0-9.]+[KMGT]?i?B' \
        | grep -v CONTAINER || true)"
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
  # The whole tail, not a grep for FAIL|WARN. Run 19 matched neither and the
  # report said "(the command produced no output)" beside a failure, which is
  # the least useful thing a diagnostic can do.
  DETAIL_LINES=45 detail tail -45 /tmp/health.log
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

gate_section 12
section "12. Running the whole deployment again, and surviving a reboot"
# ===========================================================================
# Two things an operator does that nothing above tests.
#
# FIRST: run bootstrap.sh a second time on a machine that is already set up.
# That happens on every upgrade and after every interrupted run, and the way
# it goes wrong is not an error -- it is a regenerated POSTGRES_PASSWORD. The
# old password lives inside the existing data volume, so a new one locks the
# server out of its own database, silently, until the next restart. The unit
# tests cover the helper that writes it; this covers the real script on a real
# machine with a real volume.
PW_BEFORE="$(sed -n 's/^POSTGRES_PASSWORD=//p' "$ROOT_DIR/.env" | tail -1)"
APPS_BEFORE="$(pgq "select count(*) from central.applications")"
ROWS_BEFORE="$(pgq 'select count(*) from public.load_sales' "$APP" 2>/dev/null || echo 0)"

if "$DEPLOY/bootstrap.sh" --acme-email staging@example.invalid --yes --no-firewall \
     > /tmp/bootstrap2.log 2>&1; then
  pass "bootstrap.sh ran a second time on an already-configured machine"
else
  fail "re-running bootstrap.sh failed on a machine it had already set up"
  detail tail -20 /tmp/bootstrap2.log
fi

PW_AFTER="$(sed -n 's/^POSTGRES_PASSWORD=//p' "$ROOT_DIR/.env" | tail -1)"
if [ -n "$PW_BEFORE" ] && [ "$PW_BEFORE" = "$PW_AFTER" ]; then
  pass "the database password was NOT regenerated, so the server keeps access to its volume"
else
  fail "the database password CHANGED on re-run; a real server would be locked out of its own data"
fi

# The database must still answer, and still hold what it held.
if [ "$(pgq 'select 1')" = "1" ]; then
  pass "PostgreSQL still answers after the second bootstrap"
else
  fail "PostgreSQL does not answer after re-running bootstrap"
fi
APPS_AFTER="$(pgq "select count(*) from central.applications")"
[ -n "$APPS_BEFORE" ] && [ "$APPS_BEFORE" = "$APPS_AFTER" ] \
  && pass "the application registry is unchanged ($APPS_AFTER application(s))" \
  || fail "the registry changed across a re-run: $APPS_BEFORE -> $APPS_AFTER"

# SECOND: a reboot. Everything is stopped and started the way a restart policy
# would, and every container must come back on its own with the data intact.
# Section 4 restarts one container; this restarts the machine's whole stack.
note "stopping every container, then starting the stack again — a reboot, in effect"
RESTART_LIST="$(docker ps --format '{{.Names}}' | sort | tr '\n' ' ')"
note "containers before: $RESTART_LIST"
docker stop $(docker ps -q) >/dev/null 2>&1 || true
sleep 3
STOPPED="$(docker ps -q | wc -l | tr -d ' ')"
[ "${STOPPED:-1}" = "0" ] && pass "every container stopped cleanly" \
                          || note "$STOPPED container(s) were still running after stop"

# --env-file, exactly as bootstrap.sh starts it. Without it the shared stack's
# variables are unset and compose refuses, which would have looked like a
# failure to recover rather than a mistake in this test.
( cd "$ROOT_DIR/compose" \
  && docker compose --env-file "$ROOT_DIR/.env" -f docker-compose.yml up -d \
       >/tmp/restack.log 2>&1 ) || true
# staging-s3 is this test's own fixture, started with `docker run` and so not
# part of any compose project. Stopping every container stops it too, and
# nothing above would bring it back -- the health loop below would then wait
# for a container that is never coming and fail the recovery check for a
# reason that has nothing to do with recovery.
docker start staging-s3 >>/tmp/restack.log 2>&1 || true
for a in $(pgq "select name from central.applications order by name"); do
  [ -x "$ROOT_DIR/apps/$a/compose.sh" ] || continue
  # Only applications that were actually running before the stop. gamma_shop
  # is provisioned with --no-start on purpose, and starting it here would be
  # starting an application for the first time while calling the result
  # "recovery" -- as well as risking failures that have nothing to do with it.
  adns="$(printf '%s' "$a" | tr '_' '-')"
  case " $RESTART_LIST " in
    *" $adns-rest "*|*" $adns.realtime "*|*" $adns-storage "*|*" $adns-auth "*|*" $adns-functions "*) ;;
    *) note "  $a was not running before the stop, so it is left alone"; continue ;;
  esac
  ( cd "$ROOT_DIR/apps/$a" && ./compose.sh up -d >>/tmp/restack.log 2>&1 ) || true
done

# Wait for health rather than assuming it.
back=0
for _ in $(seq 1 36); do
  bad=0
  # Only the containers that were running before the stop. Anything that was
  # already absent or deliberately stopped is not part of what recovery means.
  for c in $RESTART_LIST; do
    st="$(docker inspect -f '{{.State.Status}}' "$c" 2>/dev/null || echo missing)"
    h="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$c" 2>/dev/null)"
    [ "$st" = "running" ] || { bad=$((bad+1)); continue; }
    [ "$h" = "healthy" ] || [ "$h" = "none" ] || bad=$((bad+1))
  done
  [ "$bad" = "0" ] && { back=1; break; }
  sleep 5
done
if [ "$back" = "1" ]; then
  pass "every container came back running and healthy after the whole stack was stopped"
else
  fail "$bad container(s) did not come back healthy after a full stop and start"
  detail bash -c "docker ps -a --format '{{.Names}} {{.Status}}'"
fi

# And the data is still there. A stack that comes back empty is worse than one
# that does not come back.
ROWS_AFTER="$(pgq 'select count(*) from public.load_sales' "$APP" 2>/dev/null || echo 0)"
if [ "${ROWS_BEFORE:-0}" -gt 0 ] && [ "$ROWS_BEFORE" = "$ROWS_AFTER" ]; then
  pass "the application's data survived the restart ($ROWS_AFTER rows, unchanged)"
elif [ "${ROWS_BEFORE:-0}" = "0" ]; then
  fail "there were no rows to check, so data survival was not proven"
else
  fail "row count changed across the restart: $ROWS_BEFORE -> $ROWS_AFTER"
fi

# Re-apply the staging rewrite in case the second bootstrap or the restart
# reinstated a site file written for https.
staging_http_sites || note "every site file was already on http://"

# Requests must work again without anyone touching anything.
CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 \
  -H "apikey: $ANON" -H "Authorization: Bearer $ANON" \
  "http://$APP_DNS.staging.test/rest/v1/load_sales?select=id&limit=1" 2>/dev/null || echo 000)"
if [ "$CODE" = "200" ]; then
  pass "the API answers again after the restart, unattended (HTTP 200)"
else
  fail "the API returned HTTP $CODE after the restart"
  # A 308 means Caddy is redirecting, which means this host is being served
  # over https somewhere. Say where, rather than leaving it to be guessed:
  # the redirect target, what the site file actually starts with, and which
  # hosts Caddy's running configuration has.
  note "----- why -----"
  detail bash -c "curl -s -o /dev/null -D - --max-time 10 -H 'apikey: $ANON' 'http://$APP_DNS.staging.test/rest/v1/load_sales?select=id&limit=1' | grep -iE '^(HTTP|location)' | head -4"
  detail bash -c "head -3 '$ROOT_DIR/compose/caddy-sites/${APP}.caddy' 2>/dev/null || ls '$ROOT_DIR/compose/caddy-sites/'"
  detail bash -c "docker exec central-caddy caddy adapt --config /etc/caddy/Caddyfile --adapter caddyfile 2>/dev/null | grep -oE '\"[a-z0-9-]+\\.staging\\.test\"' | sort -u | head -8"
fi

# ===========================================================================
section "Logs from anything that is not healthy"
# ===========================================================================
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
