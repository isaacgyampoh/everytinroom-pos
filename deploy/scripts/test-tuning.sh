#!/usr/bin/env bash
# Test the PostgreSQL memory arithmetic across the machines it might land on.
# The claim being tested: on every size of box, the worst-case memory demand
# stays inside the RAM that exists.
set -euo pipefail
. "$(cd "$(dirname "$0")/.." && pwd)/lib/tuning.sh"

FAIL=0
check() { # label condition_result detail
  if [ "$2" = "1" ]; then printf '    \033[32mok\033[0m   %s\n' "$1"
  else printf '    \033[31mFAIL\033[0m %s — %s\n' "$1" "$3"; FAIL=$((FAIL+1)); fi
}

printf '\n%-28s %5s %5s %6s %6s %5s %5s\n' "MACHINE" "conn" "shbuf" "cache" "maint" "work" "par"
printf '%s\n' "------------------------------------------------------------------------"

# name, ram_mb, cpus
while read -r name ram cpus; do
  [ -z "$name" ] && continue
  compute_tuning "$ram" "$cpus"
  printf '%-28s %5s %5s %6s %6s %5s %5s\n' "$name" \
    "$TUNE_MAX_CONNECTIONS" "$TUNE_SHARED_BUFFERS" "$TUNE_EFFECTIVE_CACHE" \
    "$TUNE_MAINTENANCE_WORK_MEM" "$TUNE_WORK_MEM" "$TUNE_MAX_PARALLEL_GATHER"

  worst=$(( TUNE_SHARED_BUFFERS + TUNE_WORK_MEM * TUNE_MAX_CONNECTIONS * 2 ))
  [ "$worst" -le "$ram" ] && r=1 || r=0
  check "worst case ${worst}MB fits in ${ram}MB" "$r" "worst case exceeds RAM"

  [ "$TUNE_SHARED_BUFFERS" -lt "$ram" ] && r=1 || r=0
  check "shared_buffers below total RAM" "$r" "shared_buffers >= RAM"

  # Postgres must not claim the whole machine; the other containers need some.
  [ "$(( TUNE_SHARED_BUFFERS * 100 / ram ))" -le 30 ] && r=1 || r=0
  check "shared_buffers <= 30% of RAM ($(( TUNE_SHARED_BUFFERS * 100 / ram ))%)" "$r" "too greedy for a shared box"

  [ "$TUNE_WORK_MEM" -ge 2 ] && r=1 || r=0
  check "work_mem at least 2MB" "$r" "work_mem collapsed to $TUNE_WORK_MEM"

  [ -n "$TUNE_NOTE" ] && printf '    note: %s\n' "$TUNE_NOTE"
  echo
done <<'BOXES'
Contabo_Cloud_VPS_8 24576 8
Contabo_VPS_4C_8G 8192 4
small_2GB_box 2048 2
minimum_1GB_box 1024 1
big_64GB_box 65536 16
odd_48_cores 32768 48
BOXES

echo "Refusals"
if compute_tuning 512 2 2>/dev/null; then check "refuses 512MB" 0 "accepted an impossible machine"; else check "refuses a 512MB machine" 1 ""; fi
if compute_tuning 8192 0 2>/dev/null; then check "refuses 0 CPUs" 0 "accepted zero CPUs"; else check "refuses zero CPUs" 1 ""; fi

echo
if [ "$FAIL" = "0" ]; then printf '  \033[32mAll tuning checks passed.\033[0m\n\n'
else printf '  \033[31m%d failed.\033[0m\n\n' "$FAIL"; exit 1; fi
