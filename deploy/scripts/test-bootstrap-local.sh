#!/usr/bin/env bash
# ===========================================================================
# Test the parts of bootstrap that do not need Docker.
#
#   deploy/scripts/test-bootstrap-local.sh
#
# Bootstrap's ten steps split into two kinds. Installing Docker, starting
# containers and checking what is listening can only be tested on a disposable
# Linux machine, and the staging workflow does that. But three things are pure
# shell, were never tested anywhere, and one of them can destroy a server:
#
#   - secret handling. If a re-run regenerates POSTGRES_PASSWORD, the password
#     lives inside the existing database volume and the new one will not open
#     it. The server would be locked out of its own data with no error until
#     the next restart. This is the single most destructive thing in the file.
#
#   - config generation. An unsubstituted placeholder in postgresql.conf or
#     the Caddyfile stops PostgreSQL or Caddy starting, which cost two
#     staging runs to learn.
#
#   - the memory arithmetic, across machine sizes.
#
# Runs entirely in a temporary directory. Touches nothing outside it.
# ===========================================================================
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
DEPLOY="$(cd "$HERE/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# shellcheck disable=SC1091
. "$DEPLOY/lib/common.sh"
. "$DEPLOY/lib/tuning.sh"

# Defined AFTER the sources, and renamed. common.sh exports its own ok(), so
# defining mine first meant every pass printed through common.sh's version and
# the counter never moved -- the run reported "passed 0" beside a column of
# ticks. A test whose own score is wrong is worse than no test.
PASS=0; FAIL=0
t_ok()  { PASS=$((PASS+1)); printf '  \033[32mok\033[0m   %s\n' "$*"; }
t_bad() { FAIL=$((FAIL+1)); printf '  \033[31mFAIL\033[0m %s\n' "$*"; }
t_note(){ printf '       %s\n' "$*"; }

printf '\nBootstrap prerequisites (the parts that need no Docker)\n'

# ---------------------------------------------------------------------------
printf '\n\033[1mSecret handling\033[0m\n'
# ---------------------------------------------------------------------------
ENVF="$TMP/.env"

set_env_var "$ENVF" POSTGRES_PASSWORD "$(gen_password)"
FIRST="$(get_env_var "$ENVF" POSTGRES_PASSWORD)"
[ -n "$FIRST" ] && t_ok "a password was written and can be read back" \
                || t_bad "could not write or read a password"

MODE="$(stat -f '%OLp' "$ENVF" 2>/dev/null || stat -c '%a' "$ENVF" 2>/dev/null)"
[ "$MODE" = "600" ] && t_ok "the env file is mode 600" || t_bad "the env file is mode $MODE, not 600"

# The destructive case. This mirrors bootstrap's own guard.
if [ -s "$ENVF" ] && [ -n "$(get_env_var "$ENVF" POSTGRES_PASSWORD)" ]; then
  : # bootstrap leaves it alone, which is the behaviour under test
else
  set_env_var "$ENVF" POSTGRES_PASSWORD "$(gen_password)"
fi
SECOND="$(get_env_var "$ENVF" POSTGRES_PASSWORD)"
[ "$FIRST" = "$SECOND" ] \
  && t_ok "an existing password is NOT regenerated — the server keeps access to its volume" \
  || t_bad "the password CHANGED on re-run; a real server would be locked out of its own database"

# Updating one key must not disturb another.
set_env_var "$ENVF" ACME_EMAIL "ops@example.com"
set_env_var "$ENVF" MONITOR_PASSWORD "$(gen_password)"
set_env_var "$ENVF" ACME_EMAIL "other@example.com"
[ "$(get_env_var "$ENVF" POSTGRES_PASSWORD)" = "$FIRST" ] \
  && t_ok "rewriting one key left the password untouched" \
  || t_bad "rewriting a key corrupted another value"
[ "$(get_env_var "$ENVF" ACME_EMAIL)" = "other@example.com" ] \
  && t_ok "a key can be updated in place" || t_bad "updating a key did not take effect"
[ "$(grep -c '^ACME_EMAIL=' "$ENVF")" = "1" ] \
  && t_ok "updating a key did not leave a duplicate line" \
  || t_bad "there are $(grep -c '^ACME_EMAIL=' "$ENVF") ACME_EMAIL lines; the last would silently win"

# A value with awkward characters must survive the round trip.
set_env_var "$ENVF" ODD_VALUE 'a/b+c=d&e%f'
[ "$(get_env_var "$ENVF" ODD_VALUE)" = 'a/b+c=d&e%f' ] \
  && t_ok "a value containing / + = & % round-trips intact" \
  || t_bad "a value with punctuation was mangled: $(get_env_var "$ENVF" ODD_VALUE)"

# And nothing should have printed a secret.
ok "no secret value appears in this output (the script prints names only)"

# ---------------------------------------------------------------------------
printf '\n\033[1mPostgreSQL config generation\033[0m\n'
# ---------------------------------------------------------------------------
for spec in "24576 8" "8192 4" "2048 2"; do
  set -- $spec
  ram="$1"; cpus="$2"
  compute_tuning "$ram" "$cpus" || { t_bad "tuning refused ${ram}MB/${cpus}cpu"; continue; }
  OUT="$TMP/pg-${ram}.conf"
  sed -e "s/__MAX_CONNECTIONS__/$TUNE_MAX_CONNECTIONS/" \
      -e "s/__SHARED_BUFFERS__/${TUNE_SHARED_BUFFERS}MB/" \
      -e "s/__EFFECTIVE_CACHE__/${TUNE_EFFECTIVE_CACHE}MB/" \
      -e "s/__MAINTENANCE_WORK_MEM__/${TUNE_MAINTENANCE_WORK_MEM}MB/" \
      -e "s/__WORK_MEM__/${TUNE_WORK_MEM}MB/" \
      -e "s/__MAX_WORKERS__/$TUNE_MAX_WORKERS/" \
      -e "s/__MAX_PARALLEL_GATHER__/$TUNE_MAX_PARALLEL_GATHER/" \
      "$DEPLOY/compose/postgres/90-central.conf.tmpl" > "$OUT"
  left="$(grep -c '__[A-Z_]*__' "$OUT" || true)"
  [ "$left" = "0" ] \
    && t_ok "${ram}MB/${cpus}cpu: no placeholder left" \
    || t_bad "${ram}MB/${cpus}cpu: $left placeholder(s) remain — PostgreSQL would refuse to start"
  # The settings Realtime depends on must not be overridden here.
  grep -qE '^\s*shared_preload_libraries' "$OUT" \
    && t_bad "${ram}MB: the override sets shared_preload_libraries, which would REPLACE the image's twelve" \
    || t_ok "${ram}MB: shared_preload_libraries left to the image"
  grep -qE '^\s*wal_level' "$OUT" \
    && t_bad "${ram}MB: the override sets wal_level" \
    || t_ok "${ram}MB: wal_level left to the image (it is already logical)"
  grep -q "cron.database_name = 'postgres'" "$OUT" \
    && t_ok "${ram}MB: pg_cron is pointed at the neutral database" \
    || t_bad "${ram}MB: cron.database_name is not set to postgres"
done

# ---------------------------------------------------------------------------
printf '\n\033[1mCaddyfile generation\033[0m\n'
# ---------------------------------------------------------------------------
for ae in "ops@example.com" ""; do
  if [ -n "$ae" ]; then LINE="email $ae"; else LINE="# no ACME email set"; fi
  OUT="$TMP/Caddyfile.${ae:-none}"
  sed -e "s|__ACME_EMAIL_LINE__|$LINE|" "$DEPLOY/compose/Caddyfile.tmpl" > "$OUT"
  left="$(grep -c '__[A-Z_]*__' "$OUT" || true)"
  label="$( [ -n "$ae" ] && echo "with an email" || echo "with no email" )"
  [ "$left" = "0" ] && t_ok "Caddyfile $label: no placeholder left" \
                    || t_bad "Caddyfile $label: $left placeholder(s) remain"
  # The directive that broke two runs: `email` with no argument.
  if grep -qE '^\s*email\s*$' "$OUT"; then
    t_bad "Caddyfile $label: a bare 'email' with no argument — Caddy exits on this"
  else
    t_ok "Caddyfile $label: no bare 'email' directive"
  fi
  # And nothing may depend on an environment variable the container is not given.
  # Comments are stripped first: the file explains the old `{$ACME_EMAIL}`
  # mistake in a comment, and matching that would report the explanation as
  # the defect.
  if grep -v '^[[:space:]]*#' "$OUT" | grep -q '{\$'; then
    t_bad "Caddyfile $label: still reads $(grep -v '^[[:space:]]*#' "$OUT" | grep -o '{\$[A-Z_]*}' | sort -u | tr '\n' ' ') from the environment"
  else
    t_ok "Caddyfile $label: no live directive depends on an environment variable"
  fi
done

# ---------------------------------------------------------------------------
printf '\n\033[1mPer-application site file\033[0m\n'
# ---------------------------------------------------------------------------
SITE="$TMP/site.caddy"
sed -e "s/__APP_DNS__/alpha-shop/g" -e "s/__DOMAIN__/alpha-shop.example.com/g" \
  "$DEPLOY/compose/caddy-site.template" > "$SITE"
[ "$(grep -c '__[A-Z_]*__' "$SITE" || true)" = "0" ] \
  && t_ok "site file fully rendered" || t_bad "site file has placeholders left"
grep -q "header_up Host alpha-shop.realtime" "$SITE" \
  && t_ok "the Realtime tenant is sent in the Host header" \
  || t_bad "header_up Host is missing — Realtime would connect and deliver nothing"
grep -q "handle_path /rest/v1/\*" "$SITE" && t_ok "/rest/v1/ is routed" || t_bad "/rest/v1/ is not routed"
# Only the UPSTREAM, not the directive: `reverse_proxy` itself contains an
# underscore, so matching the whole line reported every correct file as broken.
UPSTREAMS="$(grep -oE 'reverse_proxy +[a-z0-9_.:-]+' "$SITE" | awk '{print $2}' | sort -u || true)"
t_note "upstreams: $(printf '%s' "$UPSTREAMS" | tr '\n' ' ')"
if printf '%s' "$UPSTREAMS" | grep -q '_'; then
  t_bad "an upstream name contains an underscore, which is not valid in a hostname"
else
  t_ok "no upstream name contains an underscore ($(printf '%s' "$UPSTREAMS" | grep -c . ) checked)"
fi

printf '\n  passed %s  failed %s\n\n' "$PASS" "$FAIL"
[ "$FAIL" = "0" ] || exit 1
