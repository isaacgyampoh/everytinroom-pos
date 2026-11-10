#!/usr/bin/env bash
# ===========================================================================
# Build the migration-readiness package from the latest published staging run.
#
#   deploy/scripts/build-readiness.sh --inventory /tmp/inventory.json
#   deploy/scripts/build-readiness.sh --inventory /tmp/inventory.json --out ~/READINESS.md
#
# Runs on a laptop. No Docker, no server, no credentials.
#
# WHY IT IS NOT BUILT IN CI
#   The package needs the project inventory, which names every project, its
#   size, its extensions and its scheduled jobs. The staging workflow publishes
#   its report to a branch of a PUBLIC repository, so the inventory stays off
#   that machine entirely: CI computes the verdict from the acceptance tests
#   alone, and the full package is built here.
#
# WHAT IT READS
#   - the report the staging run published to the staging-results branch
#   - the inventory from inspect-supabase.py --json
#
# It writes OUTSIDE the repository by default, because the output contains the
# inventory's contents and must not be committed.
#
# It exits non-zero while any required acceptance test is unproven. That is
# deliberate: the package can be produced at any time, but it cannot be made
# to say the platform is ready by running it again.
# ===========================================================================
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
DEPLOY="$(cd "$HERE/.." && pwd)"
REPO="$(cd "$DEPLOY/.." && pwd)"

INVENTORY=""
OUT="${TMPDIR:-/tmp}/READINESS.md"
BRANCH="staging-results"
REPORT=""
while [ $# -gt 0 ]; do
  case "$1" in
    --inventory) INVENTORY="${2:-}"; shift 2 ;;
    --out) OUT="${2:-}"; shift 2 ;;
    --report) REPORT="${2:-}"; shift 2 ;;
    --branch) BRANCH="${2:-}"; shift 2 ;;
    -h|--help) sed -n '2,28p' "$0"; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

# Resolve to an absolute path FIRST. The check below compared the string
# against $REPO, so "--out ./READINESS.md" sailed past it and wrote the
# inventory's contents straight into the repository -- which is the one thing
# this check exists to prevent.
OUT_DIR="$(cd "$(dirname "$OUT")" 2>/dev/null && pwd)" || {
  echo "the directory for --out does not exist: $(dirname "$OUT")" >&2; exit 2; }
OUT="$OUT_DIR/$(basename "$OUT")"
case "$OUT" in
  "$REPO"/*|"$REPO")
    echo "REFUSING to write inside the repository:" >&2
    echo "  $OUT" >&2
    echo "This output contains the project inventory -- names, sizes, extensions" >&2
    echo "and scheduled jobs -- and this repository is public. Choose a path" >&2
    echo "outside $REPO." >&2
    exit 2 ;;
esac

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# --- the report ------------------------------------------------------------
if [ -n "$REPORT" ]; then
  [ -f "$REPORT" ] || { echo "$REPORT does not exist." >&2; exit 2; }
  cp "$REPORT" "$WORK/report.md"
  # The run id lives beside the report in the archive, so a package built from
  # an archived run names it instead of saying "(not given)".
  [ -f "$(dirname "$REPORT")/run-info.txt" ] \
    && cp "$(dirname "$REPORT")/run-info.txt" "$WORK/run-info.txt"
  echo "report: $REPORT"
else
  git -C "$REPO" fetch -q origin "$BRANCH" 2>/dev/null \
    || { echo "could not fetch origin/$BRANCH. Is there a published run?" >&2; exit 2; }
  git -C "$REPO" show "origin/$BRANCH:deploy/staging-results/report.md" > "$WORK/report.md" 2>/dev/null \
    || { echo "origin/$BRANCH has no deploy/staging-results/report.md." >&2; exit 2; }
  git -C "$REPO" show "origin/$BRANCH:deploy/staging-results/run-info.txt" > "$WORK/run-info.txt" 2>/dev/null || true
  echo "report: origin/$BRANCH (published $(git -C "$REPO" log -1 --format=%ad --date=iso "origin/$BRANCH"))"
fi
RUN_ID="$(sed -n 's/^Run: *//p' "$WORK/run-info.txt" 2>/dev/null | head -1)"
RUN_ID="${RUN_ID:-(not recorded)}"
COMMIT="$(sed -n 's/^Commit: *//p' "$WORK/run-info.txt" 2>/dev/null | head -1)"
echo "run:    $RUN_ID${COMMIT:+  commit $COMMIT}"
printf 'result: %s\n' "$(sed -n 's/^- Result: *//p' "$WORK/report.md" | head -1 | tr -d '*')"

# --- the sizing ------------------------------------------------------------
SIZING_ARG=()
if [ -n "$INVENTORY" ] && [ -f "$INVENTORY" ]; then
  if python3 "$DEPLOY/scripts/size-from-measurement.py" \
       --stats "$WORK/report.md" --inventory "$INVENTORY" > "$WORK/sizing.txt" 2>&1; then
    echo "sizing: produced from the run's measured peaks"
  else
    echo "sizing: could NOT be produced — the run did not measure what it needs:" >&2
    tail -3 "$WORK/sizing.txt" | sed 's/^/        /' >&2
  fi
  SIZING_ARG=(--sizing "$WORK/sizing.txt" --inventory "$INVENTORY")
else
  echo "sizing: skipped, no --inventory given. The package will say so and name no plan."
fi

# --- the package -----------------------------------------------------------
python3 "$DEPLOY/scripts/readiness-package.py" \
  --full "$WORK/report.md" \
  --repo "$REPO" \
  --run-id "$RUN_ID" \
  --evidence-dir "${STAGING_EVIDENCE:-$HOME/everytinroom-staging-evidence}" \
  "${SIZING_ARG[@]}" \
  --out "$OUT"
rc=$?
echo
echo "written: $OUT"
if [ "$rc" != "0" ]; then
  echo
  echo "The package reports the platform NOT READY. The failing and unverified"
  echo "tests are listed in it. This exit code comes from the evidence, not from"
  echo "a judgement, and running this again will not change it."
fi
exit "$rc"
