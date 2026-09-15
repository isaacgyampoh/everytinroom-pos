#!/usr/bin/env bash
# Publish the built Windows installer so every till offers it under
# Terminal & printer -> Windows till app.
#
# Needs a Supabase personal access token with project access:
#   SUPABASE_ACCESS_TOKEN=sbp_... ./tools/publish_windows_build.sh [version]
#
# The token is read from the environment and never written to disk or echoed.
# Run from the repo root after building:
#   cd desktop && node prepare.js && npx electron-builder --win --publish never
set -euo pipefail

REF=noiiuwkovoojkcwzupye
URL="https://noiiuwkovoojkcwzupye.supabase.co"
VERSION="${1:-$(node -p "require('./desktop/package.json').version")}"
EXE="desktop/release/EVERYTINROOM-POS-${VERSION}-x64.exe"
OBJECT="windows/EVERYTINROOM-POS-${VERSION}.exe"

: "${SUPABASE_ACCESS_TOKEN:?set SUPABASE_ACCESS_TOKEN to a Supabase personal access token}"
[ -f "$EXE" ] || {
  echo "No installer at $EXE — build it first:"
  echo "  cd desktop && node prepare.js && npx electron-builder --win --publish never"
  exit 1
}

ANON=$(grep -oE "^const SUPABASE_ANON_KEY = '[^']+'" src/lib/supabase.js | sed "s/.*'\(.*\)'/\1/")
SIZE=$(wc -c < "$EXE" | tr -d ' ')
SHA=$(shasum -a 256 "$EXE" | awk '{print $1}')
echo "installer : $EXE"
echo "size      : $((SIZE / 1048576)) MB"
echo "sha256    : $SHA"

sql() {
  curl -fsS -X POST "https://api.supabase.com/v1/projects/$REF/database/query" \
    -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
    -H "Content-Type: application/json" \
    --data "$(python3 -c 'import json,sys;print(json.dumps({"query":sys.argv[1]}))' "$1")"
}

# 1. The project-wide storage ceiling must clear the installer. Buckets cap
#    themselves (migration 029), so raising this does not widen the image
#    buckets the way it would have before.
echo "==> raising project storage limit to 150 MB"
curl -fsS -X PATCH "https://api.supabase.com/v1/projects/$REF/config/storage" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"fileSizeLimit":157286400}' > /dev/null

echo "==> pinning per-bucket limits (migration 029)"
sql "$(cat supabase/migrations/029_bucket_size_limits.sql)" > /dev/null

# Without the SELECT policy this adds, the upload below fails with "new row
# violates row-level security policy" — because it upserts, and an upsert has
# to read the row it might replace.
echo "==> release bucket policies (migration 030)"
sql "$(cat supabase/migrations/030_release_upload_policies.sql)" > /dev/null

# 2. Upload. The anon key is enough: the bucket's insert policy allows it, and
#    a stray object stays invisible to every till until the row below exists.
echo "==> uploading"
code=$(curl -s -o /tmp/etr_upload.json -w '%{http_code}' \
  -X POST "$URL/storage/v1/object/app-releases/$OBJECT" \
  -H "apikey: $ANON" -H "Authorization: Bearer $ANON" \
  -H "content-type: application/vnd.microsoft.portable-executable" \
  -H "x-upsert: true" --data-binary "@$EXE")
[ "$code" = "200" ] || {
  echo "upload failed (HTTP $code):"
  cat /tmp/etr_upload.json
  exit 1
}

# 3. Record the release. Only the newest active row is offered to tills.
echo "==> recording the release"
sql "UPDATE app_releases SET active = false WHERE platform = 'windows' AND active;
     INSERT INTO app_releases (id, platform, version, object_path, size_bytes, notes, published_by)
     VALUES (short_id(), 'windows', '$VERSION', '$OBJECT', $SIZE,
             'sha256 $SHA', 'build script');" > /dev/null

# 4. Prove a till can actually fetch it, and that the bytes survived the trip.
echo "==> verifying the public download"
PUB="$URL/storage/v1/object/public/app-releases/$OBJECT"
got=$(curl -fsSL -o /tmp/etr_check.exe -w '%{http_code}' "$PUB")
gotsha=$(shasum -a 256 /tmp/etr_check.exe | awk '{print $1}')
rm -f /tmp/etr_check.exe /tmp/etr_upload.json
if [ "$got" = "200" ] && [ "$gotsha" = "$SHA" ]; then
  echo "PUBLISHED $VERSION — bytes verified, tills will offer it now"
else
  echo "download check FAILED (http $got, sha $gotsha)"
  exit 1
fi
