#!/usr/bin/env bash
# Test the capacity thresholds and the headroom estimate with synthetic
# numbers, so the logic is checked without waiting for a server to fill up.
set -euo pipefail
. "$(cd "$(dirname "$0")/.." && pwd)/lib/capacity-lib.sh"

FAIL=0
eq() { # label actual expected
  if [ "$2" = "$3" ]; then printf '    \033[32mok\033[0m   %s = %s\n' "$1" "$2"
  else printf '    \033[31mFAIL\033[0m %s = %s, expected %s\n' "$1" "$2" "$3"; FAIL=$((FAIL+1)); fi
}

echo
echo "classify (RAM: warn ${CAP_RAM_WARN}%, crit ${CAP_RAM_CRIT}%)"
eq "40% used"  "$(classify 40 $CAP_RAM_WARN $CAP_RAM_CRIT)" OK
eq "79% used"  "$(classify 79 $CAP_RAM_WARN $CAP_RAM_CRIT)" OK
eq "80% used"  "$(classify 80 $CAP_RAM_WARN $CAP_RAM_CRIT)" WARN
eq "91% used"  "$(classify 91 $CAP_RAM_WARN $CAP_RAM_CRIT)" WARN
eq "92% used"  "$(classify 92 $CAP_RAM_WARN $CAP_RAM_CRIT)" CRIT
eq "100% used" "$(classify 100 $CAP_RAM_WARN $CAP_RAM_CRIT)" CRIT
# A metric that could not be read must never be reported as healthy.
eq "unreadable"   "$(classify '' 80 92)" UNKNOWN
eq "non-numeric"  "$(classify 'n/a' 80 92)" UNKNOWN

echo
echo "worst_of"
eq "all ok"          "$(worst_of OK OK OK)" OK
eq "one warn"        "$(worst_of OK WARN OK)" WARN
eq "warn and crit"   "$(worst_of WARN CRIT OK)" CRIT
eq "crit outranks"   "$(worst_of CRIT WARN WARN)" CRIT
eq "unknown over ok" "$(worst_of OK UNKNOWN)" UNKNOWN
eq "warn over unknown" "$(worst_of UNKNOWN WARN)" WARN

echo
echo "pct"
eq "1 of 4"       "$(pct 1 4)" 25
eq "divide by 0"  "$(pct 5 0)" 0
eq "empty whole"  "$(pct 5 '')" 0

echo
echo "human_mb"
eq "512"   "$(human_mb 512)"   "512 MB"
eq "1024"  "$(human_mb 1024)"  "1.0 GB"
eq "6082"  "$(human_mb 6082)"  "5.9 GB"
eq "24576" "$(human_mb 24576)" "24.0 GB"

echo
echo "headroom — a full application needs $(human_mb $CAP_APP_MB_FULL)"
# Contabo Cloud VPS 8 running Everytinroom only: 24GB, ~17GB free after
# postgres and one app, 280GB free disk, 185 free connections.
headroom 17000 280 1 185
eq "VPS 8, one app: more apps"  "$HR_APPS" 5
eq "VPS 8: limiting factor"     "$HR_LIMIT" "memory"

# Plenty of RAM, nearly full disk: disk must be the answer, not memory.
headroom 60000 25 1 185
eq "full disk: more apps"       "$HR_APPS" 1
eq "full disk: limiting factor" "$HR_LIMIT" "disk"

# Plenty of both, but the connection ceiling is nearly reached.
headroom 60000 500 8 10
eq "few connections: more apps" "$HR_APPS" 0
eq "few connections: limit"     "$HR_LIMIT" "database connections"

# A server with nothing left must say zero, not a negative number.
headroom 100 2 12 3
eq "server is full"             "$HR_APPS" 0

echo
if [ "$FAIL" = "0" ]; then printf '  \033[32mAll capacity checks passed.\033[0m\n\n'
else printf '  \033[31m%d failed.\033[0m\n\n' "$FAIL"; exit 1; fi
