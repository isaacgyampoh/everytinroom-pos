# shellcheck shell=bash
# ===========================================================================
# Work out PostgreSQL's memory settings from the machine it is actually on.
#
# Separate from bootstrap.sh so it can be tested without a server:
#   deploy/scripts/test-tuning.sh
#
# The numbers follow the ordinary rules (shared_buffers a quarter of RAM,
# effective_cache_size about two thirds) with two differences that matter for
# a box shared by several applications:
#
#   - work_mem is derived from max_connections rather than fixed. It is
#     allocated PER SORT, so the worst case is roughly
#     max_connections x sorts_per_query x work_mem, and a generous value is
#     how a server with plenty of RAM still dies under load.
#
#   - a quarter of RAM is left unclaimed for the other containers. On a
#     Supabase-shaped stack PostgREST, Realtime, Storage and Caddy together
#     want a couple of gigabytes, and Postgres taking 25% + 65% of RAM as if
#     it owned the machine is what makes the kernel kill something at the
#     worst moment.
# ===========================================================================

# compute_tuning <total_ram_mb> <cpu_count>
# Sets: TUNE_MAX_CONNECTIONS TUNE_SHARED_BUFFERS TUNE_EFFECTIVE_CACHE
#       TUNE_MAINTENANCE_WORK_MEM TUNE_WORK_MEM TUNE_MAX_WORKERS
#       TUNE_MAX_PARALLEL_GATHER TUNE_NOTE
compute_tuning() {
  local ram_mb="$1" cpus="$2"

  [ "$ram_mb" -ge 1024 ] 2>/dev/null || { echo "compute_tuning: RAM must be at least 1024 MB, got '$ram_mb'" >&2; return 1; }
  [ "$cpus" -ge 1 ]      2>/dev/null || { echo "compute_tuning: CPU count must be at least 1, got '$cpus'" >&2; return 1; }

  TUNE_NOTE=""

  # Postgres gets three quarters of the machine; the rest is for the other
  # containers and the kernel.
  local pg_mb=$(( ram_mb * 75 / 100 ))

  # How many connections the server can actually honour. Each backend is a
  # process, so this is a real cost, not a dial to turn up.
  if   [ "$ram_mb" -ge 16384 ]; then TUNE_MAX_CONNECTIONS=200
  elif [ "$ram_mb" -ge 8192 ];  then TUNE_MAX_CONNECTIONS=150
  elif [ "$ram_mb" -ge 4096 ];  then TUNE_MAX_CONNECTIONS=100
  else                               TUNE_MAX_CONNECTIONS=60
  fi

  TUNE_SHARED_BUFFERS=$(( pg_mb * 33 / 100 ))       # ~25% of total RAM
  TUNE_EFFECTIVE_CACHE=$(( pg_mb * 85 / 100 ))      # ~64% of total RAM

  # Big enough to build an index without spilling, small enough that three
  # autovacuum workers cannot take the machine down.
  TUNE_MAINTENANCE_WORK_MEM=$(( ram_mb / 16 ))
  [ "$TUNE_MAINTENANCE_WORK_MEM" -gt 2048 ] && TUNE_MAINTENANCE_WORK_MEM=2048
  [ "$TUNE_MAINTENANCE_WORK_MEM" -lt 64 ]   && TUNE_MAINTENANCE_WORK_MEM=64

  # Budget a quarter of Postgres's share for sorting, shared between all
  # connections, assuming about two sorts each.
  TUNE_WORK_MEM=$(( pg_mb / 4 / TUNE_MAX_CONNECTIONS / 2 ))
  [ "$TUNE_WORK_MEM" -lt 4 ]  && TUNE_WORK_MEM=4
  [ "$TUNE_WORK_MEM" -gt 64 ] && TUNE_WORK_MEM=64

  TUNE_MAX_WORKERS="$cpus"
  [ "$TUNE_MAX_WORKERS" -lt 2 ] && TUNE_MAX_WORKERS=2

  TUNE_MAX_PARALLEL_GATHER=$(( cpus / 4 ))
  [ "$TUNE_MAX_PARALLEL_GATHER" -lt 2 ] && TUNE_MAX_PARALLEL_GATHER=2
  [ "$TUNE_MAX_PARALLEL_GATHER" -gt 4 ] && TUNE_MAX_PARALLEL_GATHER=4

  if [ "$ram_mb" -lt 2048 ]; then
    TUNE_NOTE="Under 2 GB of RAM. Postgres plus PostgREST will fit, but adding Realtime and Storage on top will be tight."
  fi

  # The check that matters: the absolute worst case must still leave the
  # machine room to breathe. If it does not, the settings are wrong however
  # good the ratios look.
  local worst=$(( TUNE_SHARED_BUFFERS + (TUNE_WORK_MEM * TUNE_MAX_CONNECTIONS * 2) ))
  if [ "$worst" -gt "$ram_mb" ]; then
    # Pull work_mem down until the worst case fits inside RAM.
    local allowed=$(( (ram_mb - TUNE_SHARED_BUFFERS) / (TUNE_MAX_CONNECTIONS * 2) ))
    [ "$allowed" -lt 2 ] && allowed=2
    TUNE_WORK_MEM="$allowed"
    TUNE_NOTE="work_mem reduced to ${TUNE_WORK_MEM}MB so that max_connections sorting at once cannot exceed RAM."
  fi

  return 0
}
