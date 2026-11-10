#!/usr/bin/env bash
# ===========================================================================
# Keep every staging run's evidence, outside the repository and outside the
# branch that gets force-pushed.
#
#   deploy/scripts/archive-run.sh                 # archive whatever is published now
#   deploy/scripts/archive-run.sh --list          # what has been kept so far
#
# WHY
#   The workflow force-pushes its results onto one branch, so each run
#   overwrites the last. That is fine for "what does the latest run say" and
#   useless for "what did the run that found this actually print". A report
#   read once and then overwritten has already caused one wrong conclusion in
#   this project.
#
#   This copies the published report, console log and run-info into a
#   per-run directory keyed by the run id, and never overwrites one that is
#   already there.
#
# WHERE
#   $STAGING_EVIDENCE, or ~/everytinroom-staging-evidence. Outside the
#   repository on purpose: the archive accumulates and none of it belongs in
#   version control.
# ===========================================================================
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
DEST="${STAGING_EVIDENCE:-$HOME/everytinroom-staging-evidence}"
LIST=0
BRANCHES="staging-results staging-results-fast"
while [ $# -gt 0 ]; do
  case "$1" in
    --list) LIST=1; shift ;;
    --dest) DEST="${2:-}"; shift 2 ;;
    -h|--help) sed -n '2,25p' "$0"; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

case "$DEST" in
  "$REPO"/*|"$REPO") echo "REFUSING: $DEST is inside the repository." >&2; exit 2 ;;
esac
mkdir -p "$DEST" || { echo "could not create $DEST" >&2; exit 2; }

if [ "$LIST" = "1" ]; then
  printf '\nKept in %s\n\n' "$DEST"
  found=0
  for d in "$DEST"/run-*; do
    [ -d "$d" ] || continue
    found=1
    res="$(sed -n 's/^- Result: *//p' "$d"/report.md 2>/dev/null | head -1 | tr -d '*')"
    [ -n "$res" ] || res="$(sed -n 's/^- Result: *//p' "$d"/prereq-report.md 2>/dev/null | head -1 | tr -d '*')"
    printf '  %-22s %s\n' "$(basename "$d")" "${res:-(no report)}"
    sed -n 's/^Commit: */    commit /p;s/^Finished: */    finished /p' "$d"/run-info.txt 2>/dev/null
  done
  [ "$found" = "1" ] || printf '  nothing archived yet\n'
  printf '\n'
  exit 0
fi

git -C "$REPO" fetch -q origin $BRANCHES 2>/dev/null || true
kept=0
for b in $BRANCHES; do
  subj="$(git -C "$REPO" log -1 --format='%s' "origin/$b" 2>/dev/null)" || continue
  [ -n "$subj" ] || continue
  id="$(printf '%s' "$subj" | sed -n 's/.*run \([0-9][0-9]*\).*/\1/p')"
  [ -n "$id" ] || { echo "  $b: cannot read a run id from \"$subj\""; continue; }
  case "$b" in *-fast) scope=prereq ;; *) scope=full ;; esac
  d="$DEST/run-$id"
  mkdir -p "$d"
  for f in report.md prereq-report.md console.log prereq-console.log run-info.txt \
           central-roles.log VERDICT.md; do
    # Never overwrite: the first copy of a run's evidence is the one to keep.
    [ -e "$d/$f" ] && continue
    git -C "$REPO" show "origin/$b:deploy/staging-results/$f" > "$d/$f" 2>/dev/null \
      || rm -f "$d/$f"
  done
  # A note of where it came from, so the directory explains itself later.
  if [ ! -e "$d/archived-from.txt" ]; then
    { echo "run id : $id"
      echo "scope  : $scope"
      echo "branch : origin/$b"
      echo "subject: $subj"
      echo "published: $(git -C "$REPO" log -1 --format=%ad --date=iso "origin/$b")"
      echo "archived : $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
    } > "$d/archived-from.txt"
  fi
  n="$(find "$d" -maxdepth 1 -type f | wc -l | tr -d ' ')"
  printf '  %-22s %s file(s) from origin/%s\n' "run-$id" "$n" "$b"
  kept=$((kept+1))
done
[ "$kept" -gt 0 ] && printf '\n  archive: %s\n\n' "$DEST" \
                  || printf '\n  nothing was published to archive\n\n'
