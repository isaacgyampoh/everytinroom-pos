#!/usr/bin/env bash
# ===========================================================================
# Mint the anon / service_role API keys for one application.
#
# WHY THIS EXISTS
#   supabase-js sends its API key twice: as the `apikey` header and as
#   `Authorization: Bearer <key>`. PostgREST does not treat that key as a
#   password -- it verifies it as an HS256 JWT against PGRST_JWT_SECRET, reads
#   the `role` claim, and does SET ROLE to it. So the "anon key" is not a
#   random string: it is a signed token whose payload says {"role":"anon"}.
#   A random string here means every request comes back 401 and the till shows
#   an empty catalogue.
#
# USAGE
#   JWT_SECRET=... deploy/scripts/mint-jwt.sh anon [years]
#   JWT_SECRET=... deploy/scripts/mint-jwt.sh service_role [years]
#
# It prints ONE token on stdout and nothing else, so it can be captured:
#   ANON="$(JWT_SECRET=... mint-jwt.sh anon)"
#
# The anon token is public by design -- it ships inside the browser bundle and
# is safe there only because row-level security decides what it may read.
# The service_role token bypasses RLS entirely and must never reach a browser,
# a log or a git repository.
# ===========================================================================
set -euo pipefail

ROLE="${1:-}"
YEARS="${2:-10}"

case "$ROLE" in
  anon|authenticated|service_role) ;;
  *) echo "usage: $0 {anon|authenticated|service_role} [years]" >&2; exit 2 ;;
esac

if [ -z "${JWT_SECRET:-}" ]; then
  echo "JWT_SECRET is not set. It must be the same secret PostgREST and" >&2
  echo "Realtime are given, and at least 32 characters." >&2
  exit 2
fi
if [ "${#JWT_SECRET}" -lt 32 ]; then
  echo "JWT_SECRET is ${#JWT_SECRET} characters. HS256 with a short secret is" >&2
  echo "brute-forceable; use at least 32. Generate one with: openssl rand -hex 32" >&2
  exit 2
fi

# base64url: standard base64, then the two substitutions and no padding.
# A '+' or '/' left in a JWT makes it invalid in a URL and some verifiers
# reject it outright.
b64url() { openssl base64 -A | tr '+/' '-_' | tr -d '='; }

NOW="$(date +%s)"
EXP=$(( NOW + YEARS * 31536000 ))

HEADER='{"alg":"HS256","typ":"JWT"}'
PAYLOAD="$(printf '{"role":"%s","iss":"supabase","iat":%s,"exp":%s}' "$ROLE" "$NOW" "$EXP")"

H="$(printf '%s' "$HEADER"  | b64url)"
P="$(printf '%s' "$PAYLOAD" | b64url)"

# -mac HMAC -macopt is the portable spelling; `-hmac` is deprecated in
# OpenSSL 3 and absent from some builds.
SIG="$(printf '%s' "$H.$P" \
  | openssl dgst -sha256 -mac HMAC -macopt "key:$JWT_SECRET" -binary \
  | b64url)"

printf '%s.%s.%s\n' "$H" "$P" "$SIG"
