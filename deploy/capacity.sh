#!/usr/bin/env bash
# ===========================================================================
# CENTRAL SERVER CAPACITY
#
#   /srv/central/capacity.sh              full report
#   /srv/central/capacity.sh --quiet      print only warnings (for cron)
#   /srv/central/capacity.sh --json       machine-readable
#
# Exit code is the verdict, so cron and any uptime checker can act on it:
#   0  everything within limits
#   1  at least one warning
#   2  at least one critical, or something could not be measured
#
# It reads. It never restarts a container, prunes an image or touches data.
#
# The database is read through the container's own unix socket as the postgres
# user, so no password is passed on a command line where `ps` would show it.
# (central_monitor, created by bootstrap.sh, is the least-privilege role for an
# external monitoring agent that connects over TCP.)
# ===========================================================================

SCRIPT_NAME="capacity.sh"
HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/lib/common.sh"
. "$HERE/lib/capacity-lib.sh"

ROOT_DIR="/srv/central"

# Every measurement here comes from /proc, df, or the Docker daemon. On a Mac
# /proc does not exist, so the arithmetic would quietly produce "0% of 0 MB"
# and call it healthy -- the one thing a monitor must never do.
need_linux "measures an Ubuntu server through /proc, df and Docker"

QUIET=0; JSON=0
while [ $# -gt 0 ]; do
  case "$1" in
    --quiet|-q) QUIET=1; shift ;;
    --json) JSON=1; shift ;;
    -h|--help) sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "Unknown option: $1" "Run $0 --help" ;;
  esac
done

STATES=""
JSON_PARTS=""
note() { STATES="$STATES $1"; }
jadd() { JSON_PARTS="$JSON_PARTS$1,"; }

# A line of the report. Hidden by --quiet unless it is not OK, so a cron job
# stays silent on a healthy server and speaks up the moment it is not.
row() { # state label value detail
  local state="$1" label="$2" value="$3" detail="${4:-}" colour mark
  case "$state" in
    OK)      colour="$C_GRN"; mark="ok  " ;;
    WARN)    colour="$C_YEL"; mark="WARN" ;;
    CRIT)    colour="$C_RED"; mark="CRIT" ;;
    *)       colour="$C_YEL"; mark="??  " ;;
  esac
  if [ "$QUIET" = "1" ] && [ "$state" = "OK" ]; then return 0; fi
  [ "$JSON" = "1" ] && return 0
  printf '  %s%s%s  %-22s %-22s %s\n' "$colour" "$mark" "$C_RESET" "$label" "$value" "$C_DIM$detail$C_RESET"
}

have_docker=0
command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1 && have_docker=1
pg() { docker exec central-postgres psql -tAqX -U postgres -d postgres -c "$1" 2>/dev/null; }
pg_up=0
[ "$have_docker" = "1" ] && [ "$(pg 'select 1')" = "1" ] && pg_up=1

if [ "$JSON" = "0" ] && [ "$QUIET" = "0" ]; then
  printf '\n%sCentral server capacity%s   %s\n\n' "$C_BLD" "$C_RESET" "$(date -u '+%Y-%m-%d %H:%M UTC')"
fi

# --- 1. memory ------------------------------------------------------------
RAM_TOTAL=$(( $(awk '/^MemTotal:/{print $2}' /proc/meminfo 2>/dev/null || echo 0) / 1024 ))
RAM_AVAIL=$(( $(awk '/^MemAvailable:/{print $2}' /proc/meminfo 2>/dev/null || echo 0) / 1024 ))
RAM_USED=$(( RAM_TOTAL - RAM_AVAIL ))
RAM_PCT="$(pct "$RAM_USED" "$RAM_TOTAL")"
S="$(classify "$RAM_PCT" "$CAP_RAM_WARN" "$CAP_RAM_CRIT")"; note "$S"
row "$S" "memory" "${RAM_PCT}% of $(human_mb "$RAM_TOTAL")" "$(human_mb "$RAM_AVAIL") available"
jadd "\"memory_pct\":$RAM_PCT,\"memory_total_mb\":$RAM_TOTAL,\"memory_state\":\"$S\""

SWAP_TOTAL=$(( $(awk '/^SwapTotal:/{print $2}' /proc/meminfo 2>/dev/null || echo 0) / 1024 ))
SWAP_FREE=$(( $(awk '/^SwapFree:/{print $2}' /proc/meminfo 2>/dev/null || echo 0) / 1024 ))
if [ "$SWAP_TOTAL" -gt 0 ]; then
  SWAP_PCT="$(pct $(( SWAP_TOTAL - SWAP_FREE )) "$SWAP_TOTAL")"
  # Postgres swapping is much worse than Postgres being short of cache: a
  # query that would take 20ms takes seconds, and the till feels broken.
  S="$(classify "$SWAP_PCT" 25 60)"; note "$S"
  row "$S" "swap" "${SWAP_PCT}% of $(human_mb "$SWAP_TOTAL")" "swapping hurts the database badly"
fi

# --- 2. processors --------------------------------------------------------
CPUS="$(nproc 2>/dev/null || echo 1)"
LOAD1="$(awk '{print $1}' /proc/loadavg 2>/dev/null || echo 0)"
# Integer percent of total capacity: load 4.0 on 8 cores is 50%.
LOAD_PCT="$(awk -v l="$LOAD1" -v c="$CPUS" 'BEGIN{ if (c<1) c=1; printf "%d", (l/c)*100 }')"
S="$(classify "$LOAD_PCT" "$CAP_LOAD_WARN" "$CAP_LOAD_CRIT")"; note "$S"
row "$S" "cpu load (1 min)" "${LOAD_PCT}% of $CPUS cores" "load average $LOAD1"
jadd "\"cpu_pct\":$LOAD_PCT,\"cpus\":$CPUS,\"cpu_state\":\"$S\""

# --- 3. disk --------------------------------------------------------------
DISK_PCT="$(df -P / 2>/dev/null | awk 'NR==2{gsub("%","",$5); print $5}')"
DISK_FREE_GB="$(df -PBG / 2>/dev/null | awk 'NR==2{gsub("G","",$4); print $4}')"
DISK_TOTAL_GB="$(df -PBG / 2>/dev/null | awk 'NR==2{gsub("G","",$2); print $2}')"
S="$(classify "${DISK_PCT:-}" "$CAP_DISK_WARN" "$CAP_DISK_CRIT")"; note "$S"
row "$S" "disk /" "${DISK_PCT:-?}% of ${DISK_TOTAL_GB:-?} GB" "${DISK_FREE_GB:-?} GB free"
jadd "\"disk_pct\":${DISK_PCT:-0},\"disk_free_gb\":${DISK_FREE_GB:-0},\"disk_state\":\"$S\""

# Docker's own directory, which is where the database volume actually lives.
if [ "$have_docker" = "1" ]; then
  DOCKER_GB="$(du -sBG /var/lib/docker 2>/dev/null | awk '{gsub("G","",$1); print $1}')"
  [ -n "$DOCKER_GB" ] && row OK "  of which docker" "${DOCKER_GB} GB" "images, volumes and logs"
fi

# --- 4 & 5. database ------------------------------------------------------
if [ "$pg_up" = "1" ]; then
  MAXCONN="$(pg 'show max_connections')"
  CURCONN="$(pg 'select count(*) from pg_stat_activity')"
  CONN_PCT="$(pct "${CURCONN:-0}" "${MAXCONN:-0}")"
  S="$(classify "$CONN_PCT" "$CAP_CONN_WARN" "$CAP_CONN_CRIT")"; note "$S"
  row "$S" "db connections" "${CURCONN:-?} of ${MAXCONN:-?} (${CONN_PCT}%)" \
    "idle-in-transaction: $(pg "select count(*) from pg_stat_activity where state='idle in transaction'")"
  jadd "\"db_connections\":${CURCONN:-0},\"db_max_connections\":${MAXCONN:-0},\"db_conn_state\":\"$S\""

  TOTAL_DB_MB="$(pg "select coalesce(sum(pg_database_size(datname))/1024/1024,0)::bigint from pg_database where not datistemplate")"
  row OK "db size (all)" "$(human_mb "${TOTAL_DB_MB:-0}")" "every database on this server"
  jadd "\"db_total_mb\":${TOTAL_DB_MB:-0}"

  # A replication slot that stops being read retains WAL until the disk is
  # full. max_slot_wal_keep_size caps that, but an inactive slot still means
  # Realtime has stopped receiving changes -- the till would look fine and
  # quietly miss every sale notification.
  DEAD_SLOTS="$(pg "select count(*) from pg_replication_slots where not active")"
  if [ "${DEAD_SLOTS:-0}" -gt 0 ]; then
    note WARN
    row WARN "replication slots" "${DEAD_SLOTS} inactive" "Realtime may have stopped receiving changes"
  else
    row OK "replication slots" "$(pg 'select count(*) from pg_replication_slots') active" "Realtime reads the WAL through these"
  fi

  # Per-application sizes, from the registry rather than from guesswork.
  APPS="$(pg "select name || ' ' || database_name from central.applications order by name" 2>/dev/null || true)"
  APP_COUNT=0
  if [ -n "$APPS" ]; then
    [ "$QUIET" = "0" ] && [ "$JSON" = "0" ] && printf '\n  %sapplications%s\n' "$C_BLD" "$C_RESET"
    while read -r aname adb; do
      [ -z "$aname" ] && continue
      APP_COUNT=$(( APP_COUNT + 1 ))
      sz="$(pg "select (pg_database_size('$adb')/1024/1024)::bigint")"
      conns="$(pg "select count(*) from pg_stat_activity where datname='$adb'")"
      row OK "  $aname" "$(human_mb "${sz:-0}")" "${conns:-0} connections"
    done <<EOF
$APPS
EOF
  fi
  jadd "\"applications\":$APP_COUNT"
else
  note CRIT
  row CRIT "database" "unreachable" "central-postgres is not responding"
  jadd "\"db_connections\":null,\"db_conn_state\":\"CRIT\""
  MAXCONN=0; CURCONN=0; APP_COUNT=0
fi

# --- 6. containers --------------------------------------------------------
if [ "$have_docker" = "1" ]; then
  [ "$QUIET" = "0" ] && [ "$JSON" = "0" ] && printf '\n  %scontainers%s\n' "$C_BLD" "$C_RESET"
  UNHEALTHY=0; RUNNING=0
  while read -r cname cstate chealth; do
    [ -z "$cname" ] && continue
    RUNNING=$(( RUNNING + 1 ))
    case "$chealth" in
      healthy|"<nil>"|"")
        if [ "$cstate" = "running" ]; then row OK "  $cname" "$cstate" "${chealth#<nil>}"
        else UNHEALTHY=$(( UNHEALTHY + 1 )); note CRIT; row CRIT "  $cname" "$cstate" "not running"; fi ;;
      starting) note WARN; row WARN "  $cname" "$cstate" "still starting" ;;
      *) UNHEALTHY=$(( UNHEALTHY + 1 )); note CRIT
         row CRIT "  $cname" "$cstate" "health: $chealth — docker logs $cname --tail=40" ;;
    esac
  done <<EOF
$(docker ps -a --format '{{.Names}}' 2>/dev/null | while read -r n; do
    printf '%s %s %s\n' "$n" \
      "$(docker inspect -f '{{.State.Status}}' "$n" 2>/dev/null)" \
      "$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}<nil>{{end}}' "$n" 2>/dev/null)"
  done)
EOF
  jadd "\"containers_running\":$RUNNING,\"containers_unhealthy\":$UNHEALTHY"
else
  note CRIT; row CRIT "docker" "unreachable" "the daemon is not responding"
fi

# --- 7. network -----------------------------------------------------------
# Cumulative counters since boot. Contabo's plans include a monthly traffic
# allowance, and this is enough to see whether it is anywhere near it.
if [ -r /proc/net/dev ]; then
  NET_RX_GB=$(awk -F'[: ]+' '/^ *(eth|ens|enp|eno)/{rx+=$3} END{printf "%d", rx/1024/1024/1024}' /proc/net/dev)
  NET_TX_GB=$(awk -F'[: ]+' '/^ *(eth|ens|enp|eno)/{for(i=1;i<=NF;i++) if(i==11) tx+=$i} END{printf "%d", tx/1024/1024/1024}' /proc/net/dev)
  UP_DAYS=$(( $(awk '{print int($1)}' /proc/uptime 2>/dev/null || echo 0) / 86400 ))
  row OK "network since boot" "${NET_RX_GB} GB in / ${NET_TX_GB} GB out" "${UP_DAYS} days up — vnstat gives monthly totals"
  jadd "\"net_rx_gb\":$NET_RX_GB,\"net_tx_gb\":$NET_TX_GB,\"uptime_days\":$UP_DAYS"
fi

# --- 8. backups -----------------------------------------------------------
NEWEST="$(ls -t "$ROOT_DIR"/backups/*.sql.gz 2>/dev/null | head -1)"
if [ -z "$NEWEST" ]; then
  note CRIT
  row CRIT "backups" "none found" "$ROOT_DIR/backups is empty — nothing can be restored"
  jadd "\"backup_age_hours\":null,\"backup_state\":\"CRIT\""
else
  NOW="$(date +%s)"
  MTIME="$(stat -c %Y "$NEWEST" 2>/dev/null || stat -f %m "$NEWEST" 2>/dev/null || echo "$NOW")"
  AGE_H=$(( (NOW - MTIME) / 3600 ))
  S="$(classify "$AGE_H" "$CAP_BACKUP_WARN_H" "$CAP_BACKUP_CRIT_H")"; note "$S"
  SIZE="$(du -m "$NEWEST" 2>/dev/null | awk '{print $1}')"
  COUNT="$(ls -1 "$ROOT_DIR"/backups/*.sql.gz 2>/dev/null | wc -l | tr -d ' ')"
  row "$S" "newest backup" "${AGE_H}h old, $(human_mb "${SIZE:-0}")" "$COUNT kept — $(basename "$NEWEST")"
  jadd "\"backup_age_hours\":$AGE_H,\"backup_state\":\"$S\""

  # A backup file that exists but is tiny is worse than none, because it looks
  # like safety. A real dump of this schema cannot be a few kilobytes.
  if [ "${SIZE:-0}" -lt 1 ] && [ "$(stat -c %s "$NEWEST" 2>/dev/null || echo 99999)" -lt 10240 ]; then
    note CRIT
    row CRIT "backup size" "under 10 KB" "this dump is almost certainly truncated — test a restore"
  fi
fi

# --- headroom -------------------------------------------------------------
FREE_CONN=$(( ${MAXCONN:-0} - ${CURCONN:-0} ))
[ "$FREE_CONN" -lt 0 ] && FREE_CONN=0
headroom "$RAM_AVAIL" "${DISK_FREE_GB:-0}" "${APP_COUNT:-0}" "$FREE_CONN"
jadd "\"headroom_apps\":$HR_APPS,\"headroom_limit\":\"$HR_LIMIT\""

OVERALL="$(worst_of $STATES)"
jadd "\"overall\":\"$OVERALL\""

if [ "$JSON" = "1" ]; then
  printf '{%s"generated":"%s"}\n' "$JSON_PARTS" "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
elif [ "$QUIET" = "0" ]; then
  printf '\n  %sroom for more applications%s\n' "$C_BLD" "$C_RESET"
  printf '    about %s more, and the limit would be %s\n' "$HR_APPS" "$HR_LIMIT"
  printf '      %sby memory %s   by disk %s   by connections %s%s\n' \
    "$C_DIM" "$HR_BY_RAM" "$HR_BY_DISK" "$HR_BY_CONN" "$C_RESET"
  cat <<EOT

    This is an estimate from what is free RIGHT NOW, assuming each new
    application runs the full set of services. It is not a promise. A busy
    application costs far more than an idle one, and no server hosts an
    unlimited number.

    When this reaches zero: Contabo resizes a VPS in place, so more RAM does
    not mean rebuilding the platform. Stop the stack, resize, start it again,
    and re-run bootstrap.sh -- it recalculates PostgreSQL's memory settings
    for the new size. Nothing in the database or in any .env changes.

EOT
  case "$OVERALL" in
    OK)      printf '  %sEverything is within limits.%s\n\n' "$C_GRN" "$C_RESET" ;;
    WARN)    printf '  %sAt least one measure is approaching its limit.%s\n\n' "$C_YEL" "$C_RESET" ;;
    CRIT)    printf '  %sSomething needs attention now.%s\n\n' "$C_RED" "$C_RESET" ;;
    UNKNOWN) printf '  %sSomething could not be measured — not the same as healthy.%s\n\n' "$C_YEL" "$C_RESET" ;;
  esac
fi

case "$OVERALL" in
  OK) exit 0 ;;
  WARN) exit 1 ;;
  *) exit 2 ;;
esac
