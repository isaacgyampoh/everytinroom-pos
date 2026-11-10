# shellcheck shell=bash
# ===========================================================================
# The judgement half of capacity.sh: thresholds, formatting, and the headroom
# estimate. Kept separate from the measuring half so it can be tested on a
# laptop with no server and no Docker:
#
#   deploy/scripts/test-capacity.sh
# ===========================================================================

# --- thresholds -----------------------------------------------------------
# Chosen so a warning arrives while there is still time to act. A disk warning
# at 95% is not a warning, it is a postmortem.
CAP_RAM_WARN=80;   CAP_RAM_CRIT=92
CAP_DISK_WARN=75;  CAP_DISK_CRIT=88
CAP_CONN_WARN=70;  CAP_CONN_CRIT=88
CAP_LOAD_WARN=80;  CAP_LOAD_CRIT=150     # percent of one core per CPU
# The nightly backup runs at 02:15. Past 30 hours one has been missed; past
# 50, two.
CAP_BACKUP_WARN_H=30; CAP_BACKUP_CRIT_H=50

# What one Supabase-shaped application costs, measured from the memory limits
# in app.compose.yml rather than guessed. Used only for the headroom estimate.
CAP_APP_MB_MIN=512                        # PostgREST alone
CAP_APP_MB_FULL=$((512 + 1024 + 768 + 512 + 512))  # +realtime +storage +imgproxy +functions

# classify <value> <warn> <crit> -> OK | WARN | CRIT
# Integer comparison only: this runs on a server with no floating point in the
# shell, and a metric reported as "79.6" must not be silently truncated into a
# different verdict, so callers pass integers.
classify() {
  local v="$1" warn="$2" crit="$3"
  case "$v" in ''|*[!0-9-]*) echo "UNKNOWN"; return 0 ;; esac
  if   [ "$v" -ge "$crit" ]; then echo CRIT
  elif [ "$v" -ge "$warn" ]; then echo WARN
  else echo OK
  fi
}

# worst_of <state> <state> ... -> the most serious one present
worst_of() {
  local worst=OK s
  for s in "$@"; do
    case "$s" in
      CRIT) worst=CRIT ;;
      WARN) [ "$worst" = "CRIT" ] || worst=WARN ;;
      UNKNOWN) [ "$worst" = "OK" ] && worst=UNKNOWN ;;
    esac
  done
  echo "$worst"
}

# pct <part> <whole> -> integer percent, 0 when whole is 0
pct() {
  local part="$1" whole="$2"
  case "$whole" in ''|0|*[!0-9]*) echo 0; return 0 ;; esac
  case "$part" in ''|*[!0-9]*) echo 0; return 0 ;; esac
  echo $(( part * 100 / whole ))
}

# human_mb <mb> -> "6.0 GB" / "512 MB"
human_mb() {
  local mb="$1"
  case "$mb" in ''|*[!0-9]*) echo "?"; return 0 ;; esac
  if [ "$mb" -ge 1024 ]; then printf '%d.%d GB\n' $(( mb / 1024 )) $(( (mb % 1024) * 10 / 1024 ))
  else printf '%d MB\n' "$mb"; fi
}

# headroom <free_ram_mb> <free_disk_gb> <apps_now> <free_connections>
#
# Answers "how many more applications fit", and is deliberately the MINIMUM of
# the three limits rather than the friendliest one. Sets:
#   HR_BY_RAM HR_BY_DISK HR_BY_CONN HR_APPS HR_LIMIT
headroom() {
  local free_ram="$1" free_disk_gb="$2" apps_now="$3" free_conn="$4"

  # Memory, assuming a full Supabase-shaped application. An application that
  # needs only PostgREST is far cheaper, so this is the pessimistic count.
  HR_BY_RAM=$(( free_ram / CAP_APP_MB_FULL ))
  [ "$HR_BY_RAM" -lt 0 ] && HR_BY_RAM=0

  # Disk: 20 GB per application covers a database of Everytinroom's size
  # (21 MB today) with room for years of growth, backups and image cache.
  HR_BY_DISK=$(( free_disk_gb / 20 ))
  [ "$HR_BY_DISK" -lt 0 ] && HR_BY_DISK=0

  # Connections: PostgREST holds a pool of 10, Realtime a few more.
  HR_BY_CONN=$(( free_conn / 15 ))
  [ "$HR_BY_CONN" -lt 0 ] && HR_BY_CONN=0

  HR_APPS="$HR_BY_RAM"; HR_LIMIT="memory"
  if [ "$HR_BY_DISK" -lt "$HR_APPS" ]; then HR_APPS="$HR_BY_DISK"; HR_LIMIT="disk"; fi
  if [ "$HR_BY_CONN" -lt "$HR_APPS" ]; then HR_APPS="$HR_BY_CONN"; HR_LIMIT="database connections"; fi
  return 0
}
