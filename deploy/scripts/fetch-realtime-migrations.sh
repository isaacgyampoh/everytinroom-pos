#!/usr/bin/env bash
# ===========================================================================
# Fetch Realtime's tenant migration sources, so they can be replayed.
#
#   deploy/scripts/fetch-realtime-migrations.sh
#
# The version is taken from deploy/VERSIONS.md, so this cannot drift from the
# image the platform actually runs. Nothing is executed from what it
# downloads: the files are read as data by test-realtime-migrations.py, which
# lifts the SQL out of them.
# ===========================================================================
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
DEPLOY="$(cd "$HERE/.." && pwd)"
DEST="${1:-/tmp/realtime-src}"

VER="$(sed -n 's/.*supabase\/realtime`* *| *`*v\([0-9.]*\)`*.*/\1/p' "$DEPLOY/VERSIONS.md" | head -1)"
[ -n "$VER" ] || VER="$(grep -oE 'supabase/realtime:v[0-9.]+' "$DEPLOY/compose/app.compose.yml" | head -1 | sed 's/.*:v//')"
[ -n "$VER" ] || { echo "could not work out which Realtime version this platform runs" >&2; exit 2; }

echo "Realtime v$VER (from the version this platform pins)"
rm -rf "$DEST"
mkdir -p "$DEST"
URL="https://codeload.github.com/supabase/realtime/tar.gz/refs/tags/v$VER"
if ! curl -fsSL --max-time 120 -o "$DEST/src.tar.gz" "$URL"; then
  echo "could not download $URL" >&2
  exit 1
fi
# Only the migrations directory, and only as data.
if ! tar -xzf "$DEST/src.tar.gz" -C "$DEST" --strip-components=1 \
       "realtime-$VER/lib/realtime/tenants/repo/migrations" 2>/dev/null; then
  echo "the archive does not contain lib/realtime/tenants/repo/migrations" >&2
  exit 1
fi
rm -f "$DEST/src.tar.gz"
N="$(find "$DEST/lib/realtime/tenants/repo/migrations" -name '*.ex' | wc -l | tr -d ' ')"
echo "  $N migration file(s) in $DEST/lib/realtime/tenants/repo/migrations"
echo
echo "  REALTIME_MIGRATIONS=$DEST/lib/realtime/tenants/repo/migrations"
