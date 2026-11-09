#!/usr/bin/env bash
# ===========================================================================
# Enter the Cloudflare R2 credentials, locally, without them touching chat,
# the shell history, the screen, this repository or CI.
#
#   deploy/scripts/setup-r2-credentials.sh
#
# WHAT IT WRITES
#   deploy/.r2.env, mode 600, owned by you, gitignored and checked by
#   validate-all.sh. Four values: the endpoint, the bucket, the access key id
#   and the secret access key.
#
# WHAT IT NEVER DOES
#   Print a secret, log one, put one in a command line where `ps` would show
#   it, or write one anywhere but that file. The secret is read with
#   `read -rs`, so it does not appear on screen and is not added to the shell
#   history.
#
# AFTERWARDS
#   deploy/scripts/test-r2.py --env-file deploy/.r2.env
#   runs the real upload, download, byte-comparison, list and delete against
#   Cloudflare. Nothing it prints contains a credential.
# ===========================================================================
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
DEPLOY="$(cd "$HERE/.." && pwd)"
ENVF="$DEPLOY/.r2.env"

C_B=$'\033[1m'; C_G=$'\033[32m'; C_Y=$'\033[33m'; C_R=$'\033[31m'; C_0=$'\033[0m'

printf '\n%sCloudflare R2 credentials%s\n\n' "$C_B" "$C_0"
printf '  They go into %s, mode 600.\n' "$ENVF"
printf '  That path is gitignored and validate-all.sh fails if it is ever tracked.\n'
printf '  The secret is read without echo and is never printed back.\n\n'

if [ -t 0 ]; then :; else
  printf '%sThis needs a terminal.%s Run it yourself:\n\n' "$C_R" "$C_0"
  printf '    %s\n\n' "$0"
  exit 2
fi

# --- the endpoint ---------------------------------------------------------
printf '%sThe S3 API endpoint%s\n' "$C_B" "$C_0"
printf '  In the Cloudflare dashboard: R2 > Overview > the bucket > Settings,\n'
printf '  shown as "S3 API". It looks like\n'
printf '    https://<account-id>.r2.cloudflarestorage.com\n'
printf '  WEUR is a location HINT, not a jurisdiction, so the standard endpoint\n'
printf '  is the right one. Only a bucket created under the EU *jurisdiction*\n'
printf '  uses https://<account-id>.eu.r2.cloudflarestorage.com\n\n'
printf '  Paste the full endpoint, or just the account id: '
read -r R2_IN
R2_IN="$(printf '%s' "$R2_IN" | tr -d '[:space:]')"
[ -n "$R2_IN" ] || { printf '\n%sNothing entered. Stopping.%s\n\n' "$C_R" "$C_0"; exit 2; }
case "$R2_IN" in
  https://*) R2_ENDPOINT="${R2_IN%/}" ;;
  http://*)  printf '\n%sThat is http://. R2 is https only.%s\n\n' "$C_R" "$C_0"; exit 2 ;;
  *.r2.cloudflarestorage.com) R2_ENDPOINT="https://$R2_IN" ;;
  *) R2_ENDPOINT="https://${R2_IN}.r2.cloudflarestorage.com" ;;
esac
# The account id is not a secret, but it is not interesting either, so only
# the shape is confirmed.
case "$R2_ENDPOINT" in
  *.r2.cloudflarestorage.com) printf '  endpoint accepted (%s characters)\n\n' "${#R2_ENDPOINT}" ;;
  *) printf '\n%sThat does not look like an R2 endpoint.%s\n\n' "$C_R" "$C_0"; exit 2 ;;
esac

# --- the bucket -----------------------------------------------------------
printf '%sThe bucket%s [everytinroom-media]: ' "$C_B" "$C_0"
read -r R2_BUCKET
R2_BUCKET="$(printf '%s' "${R2_BUCKET:-everytinroom-media}" | tr -d '[:space:]')"
printf '  bucket: %s\n\n' "$R2_BUCKET"

# --- the keys -------------------------------------------------------------
printf '%sThe two parts of the API token%s\n' "$C_B" "$C_0"
printf '  R2 > API > Manage API tokens. The token needs Object Read & Write on\n'
printf '  this bucket and nothing more. Neither value is echoed.\n\n'
printf '  Access Key ID: '
read -rs R2_ACCESS_KEY_ID; printf '\n'
printf '  Secret Access Key: '
read -rs R2_SECRET_ACCESS_KEY; printf '\n\n'
[ -n "$R2_ACCESS_KEY_ID" ] && [ -n "$R2_SECRET_ACCESS_KEY" ] || {
  printf '%sOne of the keys was empty. Nothing was written.%s\n\n' "$C_R" "$C_0"; exit 2; }
printf '  access key id     : %s characters\n' "${#R2_ACCESS_KEY_ID}"
printf '  secret access key : %s characters\n\n' "${#R2_SECRET_ACCESS_KEY}"

# --- write it, restrictively ---------------------------------------------
umask 077
: > "$ENVF"
chmod 600 "$ENVF"
{
  printf '# Cloudflare R2, for the Everytinroom migration staging work.\n'
  printf '# Written by deploy/scripts/setup-r2-credentials.sh on %s.\n' "$(date -u '+%Y-%m-%d %H:%M:%S UTC')"
  printf '# Mode 600, gitignored, never copied into CI. Delete it when done:\n'
  printf '#   rm %s\n' "$ENVF"
  printf 'R2_ENDPOINT=%s\n' "$R2_ENDPOINT"
  printf 'R2_BUCKET=%s\n' "$R2_BUCKET"
  printf 'R2_ACCESS_KEY_ID=%s\n' "$R2_ACCESS_KEY_ID"
  printf 'R2_SECRET_ACCESS_KEY=%s\n' "$R2_SECRET_ACCESS_KEY"
} >> "$ENVF"
unset R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY

MODE="$(stat -f '%OLp' "$ENVF" 2>/dev/null || stat -c '%a' "$ENVF" 2>/dev/null)"
printf '%s  written: %s (mode %s)%s\n' "$C_G" "$ENVF" "$MODE" "$C_0"
if [ "$MODE" != "600" ]; then
  printf '%s  expected mode 600. Fix with: chmod 600 %s%s\n' "$C_R" "$ENVF" "$C_0"
fi

# --- is it ignored? -------------------------------------------------------
if git -C "$DEPLOY/.." check-ignore -q "$ENVF" 2>/dev/null; then
  printf '%s  git ignores it%s\n\n' "$C_G" "$C_0"
else
  printf '\n%s  GIT DOES NOT IGNORE IT. Stopping before anything can commit it.%s\n' "$C_R" "$C_0"
  printf '  Add this line to .gitignore, then run this again:\n'
  printf '    deploy/.r2.env\n\n'
  exit 2
fi

printf '%sThe test%s\n' "$C_B" "$C_0"
printf '  Upload, download with a byte-for-byte comparison, list, delete, and a\n'
printf '  confirmation that the object is gone -- against the real Cloudflare\n'
printf '  service. Plus how R2 answers the AWS SDK default trailing checksum,\n'
printf '  which no stand-in reproduces.\n\n'
printf '  It writes only under a probe prefix and removes what it writes.\n'
printf '  Nothing else in the bucket is read or modified, and no public access\n'
printf '  is enabled.\n\n'
REPORT="$HOME/everytinroom-staging-evidence/r2-verification-$(date -u '+%Y%m%d-%H%M%S').md"
printf '  Run it now? [Y/n] '
read -r ANSWER
case "${ANSWER:-Y}" in
  [Nn]*)
    printf '\n  When you are ready:\n'
    printf '    deploy/scripts/test-r2.py --env-file %s \\\n' "$ENVF"
    printf '      --report %s\n\n' "$REPORT"
    ;;
  *)
    mkdir -p "$(dirname "$REPORT")"
    printf '\n'
    python3 "$HERE/test-r2.py" --env-file "$ENVF" --report "$REPORT"
    RC=$?
    printf '  report: %s\n' "$REPORT"
    if [ "$RC" = "0" ]; then
      printf '%s  Every R2 check passed against the real service.%s\n\n' "$C_G" "$C_0"
    else
      printf '%s  Something failed. The report and the output above say which.%s\n\n' "$C_Y" "$C_0"
    fi
    exit "$RC"
    ;;
esac
