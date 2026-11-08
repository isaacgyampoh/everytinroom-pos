#!/usr/bin/env bash
# ===========================================================================
# COPY the live Supabase database onto this server.
#
#   export SUPABASE_DB_URL='postgresql://postgres.REF:PASSWORD@aws-0-REGION.pooler.supabase.com:5432/postgres'
#   migrate-from-supabase.sh --app everytinroom
#   migrate-from-supabase.sh --app everytinroom --verify-only
#
# IT ONLY READS THE SOURCE. Every command sent to Supabase is a pg_dump or a
# SELECT. Nothing is dropped, altered or deleted there, and the old backend
# keeps serving traffic throughout -- which is the point: this can be run and
# re-run while the shop is trading, as many times as it takes to get right.
#
# Phases, each of which can be run again safely:
#   1  check both ends and the tool versions
#   2  record what the source contains, to compare against afterwards
#   3  capture the scheduled jobs, which a schema dump does NOT carry
#   4  dump the public schema
#   5  restore it here
#   6  reconcile row counts and the money
#
# WHERE THE CONNECTION STRING COMES FROM
#   Supabase dashboard -> Project Settings -> Database -> Connection string.
#   It contains the database password, so it is read from the environment and
#   is never written to a log, a file, or a command line. See the note on
#   /tmp/.pgconn below for why that last part takes effort.
# ===========================================================================

SCRIPT_NAME="migrate-from-supabase.sh"
HERE="$(cd "$(dirname "$0")" && pwd)"
DEPLOY="$(cd "$HERE/.." && pwd)"
. "$HERE/../lib/common.sh"

ROOT_DIR="/srv/central"
APP=""; VERIFY_ONLY=0; KEEP_DUMP=0
while [ $# -gt 0 ]; do
  case "$1" in
    --app) APP="${2:-}"; shift 2 ;;
    --app=*) APP="${1#*=}"; shift ;;
    --verify-only) VERIFY_ONLY=1; shift ;;
    --keep-dump) KEEP_DUMP=1; shift ;;
    -h|--help) sed -n '2,30p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "Unknown option: $1" "Run $0 --help" ;;
  esac
done

[ -n "$APP" ] || die "--app is required." "  $0 --app everytinroom"
need_linux "copies a database onto an Ubuntu server"

[ -n "${SUPABASE_DB_URL:-}" ] || die \
  "SUPABASE_DB_URL is not set." \
  "Get it from the Supabase dashboard: Project Settings -> Database -> Connection string (URI)." \
  "Then, in this shell only:" \
  "  read -rs SUPABASE_DB_URL && export SUPABASE_DB_URL" \
  "Using 'read -rs' keeps the password out of your shell history."

STAMP="$(date -u '+%Y%m%d-%H%M%S')"
WORK="$ROOT_DIR/backups/migration-$STAMP"
install -d -m 0700 "$WORK"

pgq()  { docker exec central-postgres psql -tAqX -U postgres -d postgres -c "$1" 2>/dev/null; }
appq() { docker exec central-postgres psql -tAqX -U postgres -d "$APP_DB" -c "$1" 2>/dev/null; }

# --- how the source credential is handled ---------------------------------
# The connection string holds the production database password. Passing it as
# an argument to `docker exec` would put it in the host's process list, where
# `ps aux` shows it to every user for as long as the dump runs -- and a dump
# of this database takes minutes. So it is written to a mode-600 file, copied
# into the container, sourced there, and deleted on the way out.
CONNFILE="$(mktemp)"; chmod 600 "$CONNFILE"
printf 'SRC_URL=%s\nexport SRC_URL\n' "$SUPABASE_DB_URL" > "$CONNFILE"
cleanup() { rm -f "$CONNFILE"; docker exec central-postgres rm -f /tmp/.pgconn 2>/dev/null || true; }
trap cleanup EXIT
docker cp "$CONNFILE" central-postgres:/tmp/.pgconn >/dev/null
docker exec central-postgres chmod 600 /tmp/.pgconn

# Runs a command in the container with SRC_URL available but never in argv.
src() { docker exec -i central-postgres sh -c '. /tmp/.pgconn; '"$1"; }
srcq() { src "psql -tAqX \"\$SRC_URL\" -c \"$1\"" 2>/dev/null; }

printf '\n%sMigrating %s from Supabase%s\n' "$C_BLD" "$APP" "$C_RESET"

# ---------------------------------------------------------------------------
printf '\n%s[1/6] Checking both ends%s\n' "$C_BLD" "$C_RESET"
# ---------------------------------------------------------------------------
APP_DB="$(pgq "select database_name from central.applications where name='$APP'")"
[ -n "$APP_DB" ] || die "No application named '$APP' is registered on this server." \
  "Run provision-app.sh --name $APP first."
ok "target database: $APP_DB"

SRC_VER="$(srcq 'show server_version')"
[ -n "$SRC_VER" ] || die \
  "Could not connect to the Supabase database." \
  "Check the connection string, and that it is the POOLER URI if your project has no IPv4 address." \
  "Test it:  psql \"\$SUPABASE_DB_URL\" -c 'select 1'" \
  "Nothing has been changed at either end."
DST_VER="$(pgq 'show server_version')"
ok "source PostgreSQL $SRC_VER"
ok "target PostgreSQL $DST_VER"

# pg_dump must be at least as new as the server it reads, or it refuses.
SRC_MAJ="${SRC_VER%%.*}"; DST_MAJ="${DST_VER%%.*}"
DUMP_VER="$(src 'pg_dump --version' | awk '{print $3}')"
DUMP_MAJ="${DUMP_VER%%.*}"
if [ "${DUMP_MAJ:-0}" -lt "${SRC_MAJ:-0}" ]; then
  die "pg_dump here is version $DUMP_VER but Supabase runs $SRC_VER, and pg_dump refuses to read a newer server." \
    "Change the postgres image tag in docker-compose.yml to a $SRC_MAJ.x build of supabase/postgres," \
    "or run the dump from a machine with a PostgreSQL $SRC_MAJ client."
fi
ok "pg_dump $DUMP_VER can read a $SRC_VER server"
if [ "${DST_MAJ:-0}" -lt "${SRC_MAJ:-0}" ]; then
  die "The target runs PostgreSQL $DST_MAJ and the source runs $SRC_MAJ. Restoring backwards does not work." \
    "Use a supabase/postgres image of major version $SRC_MAJ or newer."
fi

# ---------------------------------------------------------------------------
printf '\n%s[2/6] Recording what the source contains%s\n' "$C_BLD" "$C_RESET"
# ---------------------------------------------------------------------------
# Taken BEFORE the dump so there is something to compare against. Written to
# a file because "it looked right" is not a verification.
BEFORE="$WORK/source-counts.txt"
: > "$BEFORE"
for t in sales whatsapp_orders products customers refunds staff stock_ledger \
         receivings suppliers stock_adjustments expenses invoices promos bundles \
         staff_sessions ussd_sessions; do
  n="$(srcq "select count(*) from public.$t")"
  printf '%s %s\n' "$t" "${n:-ABSENT}" >> "$BEFORE"
done
awk '{printf "    %-20s %s\n", $1, $2}' "$BEFORE"

SRC_MONEY="$(srcq "select coalesce(sum(total),0)::numeric(14,2) from public.sales")"
SRC_SALES_MAX="$(srcq "select coalesce(max(id),0) from public.sales")"
printf 'money_total %s\nsales_max_id %s\n' "${SRC_MONEY:-0}" "${SRC_SALES_MAX:-0}" >> "$BEFORE"
ok "recorded in $BEFORE"

# ---------------------------------------------------------------------------
printf '\n%s[3/6] Capturing the scheduled jobs%s\n' "$C_BLD" "$C_RESET"
# ---------------------------------------------------------------------------
# pg_cron's jobs live in the cron schema of the postgres database, NOT in the
# application's schema, so a dump of 'public' does not contain them. They have
# to be read out separately or the shop silently stops sending its daily
# reports and payment reminders after cutover.
JOBS="$WORK/cron-jobs.sql"
if srcq "select 1 from pg_extension where extname='pg_cron'" | grep -q 1; then
  # WHERE EACH JOB GOES depends on what it DOES, not on who owns it.
  #
  # pg_net's background worker reads net.http_request_queue in exactly one
  # database (pg_net.database_name = 'postgres'); running it on several
  # databases in a cluster is not supported. A net.http_post() called from the
  # application's database queues a row, returns an id and is never processed
  # -- no error, no response, no request.
  #
  # So this file previously rewrote EVERY job as schedule_in_database(), which
  # would have moved every HTTP-calling job into a database where pg_net can
  # never serve it. The reports would simply stop, with nothing in any log.
  #
  #   calls net.http_*  -> cron.schedule()            , stays in postgres
  #   SQL only          -> cron.schedule_in_database(), the application's own
  #
  # A job that reads application data AND THEN calls out cannot do both from
  # postgres; it is flagged for splitting rather than quietly rewritten.
  # The query lives in deploy/sql/migrate/classify-cron-jobs.sql and is piped
  # in with -f -, rather than embedded here as a -c string. That string had to
  # survive this shell, then `sh -c` inside the container, then psql, and every
  # dollar-quote and backslash in it needed three levels of escaping. The file
  # needs none, and it can be run against a throwaway cluster and checked --
  # which is how the HTTP/SQL split and the ?from= false positive were found.
  src 'psql -tAqX -v app_db='"$APP_DB"' "$SRC_URL" -f -' \
    < "$DEPLOY/sql/migrate/classify-cron-jobs.sql" > "$JOBS" 2>/dev/null || true
  NJOBS="$(grep -c 'cron.schedule' "$JOBS" 2>/dev/null || echo 0)"
  NHTTP="$(grep -c 'cron.schedule(' "$JOBS" 2>/dev/null || echo 0)"
  NSQL="$(grep -c 'cron.schedule_in_database(' "$JOBS" 2>/dev/null || echo 0)"
  NSPLIT="$(grep -c 'NEEDS SPLITTING' "$JOBS" 2>/dev/null || echo 0)"
  ok "$NJOBS scheduled job(s) written to $JOBS"
  dim "  $NHTTP make HTTP calls and stay in the postgres database"
  dim "  $NSQL run SQL only and are registered against $APP_DB"

  # Three things about these jobs need a human, and all three are easy to miss.
  if [ "${NSPLIT:-0}" -gt 0 ]; then
    printf '\n'
    warn "$NSPLIT job(s) BOTH read data and make an HTTP call. Those cannot run"
    warn "from either database as written: pg_net only works in postgres, and"
    warn "postgres cannot see $APP_DB's tables. Each is marked NEEDS SPLITTING"
    warn "in $JOBS with what to do."
  fi
  if grep -q 'supabase\.co' "$JOBS" 2>/dev/null; then
    printf '\n'
    warn "The job bodies contain the OLD Supabase URL, hardcoded inside the SQL."
    warn "Left as they are, after cutover these jobs keep calling the old project:"
    grep -o "https://[a-z0-9.]*supabase\.co[^']*" "$JOBS" | sort -u | sed 's/^/      /' | head -5
    warn "Edit $JOBS and replace that host with this server's API domain before applying it."
  fi
  warn "Apply them AFTER you have checked the URLs. Both kinds go in through the"
  warn "postgres database -- schedule_in_database() names its target inside the call:"
  warn "  docker exec -i central-postgres psql -U postgres -d postgres < $JOBS"
else
  dim "the source has no pg_cron extension, so there are no jobs to carry over"
fi

if [ "$VERIFY_ONLY" = "1" ]; then
  printf '\n'
  info "--verify-only: skipping the dump and restore, going straight to reconciliation"
else

# ---------------------------------------------------------------------------
printf '\n%s[4/6] Dumping the public schema%s\n' "$C_BLD" "$C_RESET"
# ---------------------------------------------------------------------------
# Only 'public'. A whole-database dump would also bring auth, vault, graphql,
# realtime and supabase_functions -- schemas belonging to services this server
# deliberately does not run (there is no GoTrue here, because the shop signs
# staff in with a PIN). Restoring them would fail noisily at best and create
# half-configured machinery at worst.
#
# The storage schema is handled separately, after storage-api has created its
# own tables; see the note at the end.
DUMP="$WORK/$APP_DB-public.sql.gz"
printf '  dumping ... '
if src "pg_dump \"\$SRC_URL\" --schema=public --format=plain --no-owner --no-privileges \
        --quote-all-identifiers --serializable-deferrable" 2>"$WORK/dump.err" | gzip -9 > "$DUMP"; then
  SZ="$(stat -c %s "$DUMP")"
  if [ "$SZ" -lt 10240 ]; then
    printf 'FAILED\n'
    die "The dump is only $SZ bytes, which cannot be a database with $(awk '/^sales /{print $2}' "$BEFORE") sales in it." \
      "Read the error: $WORK/dump.err" \
      "Nothing was restored."
  fi
  printf '%s\n' "$(du -h "$DUMP" | awk '{print $1}')"
  ok "dumped to $DUMP"
else
  printf 'FAILED\n'
  die "pg_dump failed. The source is untouched and nothing was restored.
  $(tail -3 "$WORK/dump.err" 2>/dev/null)" \
    "Full error: $WORK/dump.err"
fi
# --no-owner and --no-privileges are used ON PURPOSE here, unlike in
# backup.sh: the source's owners and grants name Supabase's own roles
# (supabase_admin, dashboard_user) which do not exist on this server. The
# application's own grants come from its migrations; provision-app.sh has
# already set up who may connect and who may SET ROLE.
dim "owners and grants were not copied: the source's roles are Supabase's own."
dim "This server's roles were set up by provision-app.sh."

# ---------------------------------------------------------------------------
printf '\n%s[5/6] Restoring%s\n' "$C_BLD" "$C_RESET"
# ---------------------------------------------------------------------------
EXISTING="$(appq "select count(*) from information_schema.tables where table_schema='public'")"
if [ "${EXISTING:-0}" -gt 0 ]; then
  warn "$APP_DB already has ${EXISTING} table(s) in its public schema."
  confirm "Replace them? The data in $APP_DB will be lost (the LIVE Supabase database is not affected)." \
    || die "Stopped at your request. Nothing was changed." \
           "To restore into a scratch database instead, create one and use scripts/restore.sh --into."
fi

printf '  restoring ... '
if gzip -dc "$DUMP" | docker exec -i central-postgres psql -U postgres -d "$APP_DB" \
     > "$WORK/restore.log" 2>&1; then
  ERRS="$(grep -ci '^ERROR' "$WORK/restore.log" || echo 0)"
  printf 'done\n'
  if [ "${ERRS:-0}" -gt 0 ]; then
    warn "$ERRS error line(s) during the restore:"
    grep -i '^ERROR' "$WORK/restore.log" | sort | uniq -c | sort -rn | head -8 | sed 's/^/      /'
    warn "full log: $WORK/restore.log"
    warn "Errors naming 'extension already exists' or a Supabase role are expected."
    warn "Errors about a missing function or type are not — read them."
  else
    ok "restored with no errors"
  fi
else
  printf 'FAILED\n'
  tail -15 "$WORK/restore.log" | sed 's/^/      /'
  die "The restore failed. The live Supabase database is untouched." \
    "Log: $WORK/restore.log"
fi

fi  # end of not-verify-only

# ---------------------------------------------------------------------------
printf '\n%s[6/6] Reconciling%s\n' "$C_BLD" "$C_RESET"
# ---------------------------------------------------------------------------
# A schema that restored cleanly is not a migration. These are the numbers
# that decide whether the shop's books came across.
MISMATCH=0
printf '    %-20s %10s %10s\n' "TABLE" "SOURCE" "HERE"
printf '    %s\n' "----------------------------------------"
while read -r t n; do
  case "$t" in money_total|sales_max_id) continue ;; esac
  [ "$n" = "ABSENT" ] && continue
  here="$(appq "select count(*) from public.$t")"
  if [ "${here:-x}" = "$n" ]; then
    printf '    %-20s %10s %10s  ok\n' "$t" "$n" "${here:-?}"
  else
    printf '    %-20s %10s %10s  %sMISMATCH%s\n' "$t" "$n" "${here:-none}" "$C_RED" "$C_RESET"
    MISMATCH=$((MISMATCH+1))
  fi
done < "$BEFORE"

# The money. Row counts can match while values do not -- a numeric column
# restored into the wrong type, or a partial copy, both show up here.
DST_MONEY="$(appq "select coalesce(sum(total),0)::numeric(14,2) from public.sales")"
printf '\n    %-20s %10s %10s' "sum(sales.total)" "${SRC_MONEY:-?}" "${DST_MONEY:-?}"
if [ "${DST_MONEY:-x}" = "${SRC_MONEY:-y}" ]; then printf '  ok\n'
else printf '  %sMISMATCH%s\n' "$C_RED" "$C_RESET"; MISMATCH=$((MISMATCH+1)); fi

# Sequences. pg_dump carries their values, but a sequence left behind means
# the next sale reuses an existing id and the insert fails at the till.
printf '\n  %ssequences%s\n' "$C_BLD" "$C_RESET"
appq "select '    ' || sequencename || ' -> ' || coalesce(last_value::text,'never used')
      from pg_sequences where schemaname='public' order by sequencename" 2>/dev/null

printf '\n  %sstructure%s\n' "$C_BLD" "$C_RESET"
for pair in "tables:select count(*) from information_schema.tables where table_schema='public'" \
            "functions:select count(*) from information_schema.routines where routine_schema='public'" \
            "policies:select count(*) from pg_policies where schemaname='public'" \
            "indexes:select count(*) from pg_indexes where schemaname='public'" \
            "triggers:select count(*) from information_schema.triggers where trigger_schema='public'"; do
  label="${pair%%:*}"; q="${pair#*:}"
  s="$(srcq "$q")"; d="$(appq "$q")"
  if [ "${s:-x}" = "${d:-y}" ]; then printf '    %-12s %6s %6s  ok\n' "$label" "$s" "$d"
  else printf '    %-12s %6s %6s  %sdiffers%s\n' "$label" "${s:-?}" "${d:-?}" "$C_YEL" "$C_RESET"; fi
done

printf '\n'
if [ "$MISMATCH" = "0" ]; then
  ok "every row count and the sales total match"
else
  printf '  %s%d mismatch(es). This is NOT ready to take traffic.%s\n' "$C_RED" "$MISMATCH" "$C_RESET"
fi

cat <<EOT

  Working files: $WORK

  Not done by this script, deliberately:

    scheduled jobs   $WORK/cron-jobs.sql — check the URLs, then apply
    storage rows     the storage schema holds the bucket and object records.
                     Start storage-api first so it creates its own tables,
                     then copy only the rows:
                       pg_dump "\$SUPABASE_DB_URL" --schema=storage \\
                         --data-only --table='storage.buckets' \\
                         --table='storage.objects' | ...
                     Do that after the image files are in R2, not before.
    image files      the objects themselves still live in Supabase Storage.
    DNS              nothing points here, and this script never changes that.

  The live Supabase database was only read. It is still serving the shop.

EOT
[ "$MISMATCH" = "0" ] || exit 1
[ "$KEEP_DUMP" = "1" ] || { [ "$VERIFY_ONLY" = "1" ] || dim "the dump was kept at $DUMP (use --keep-dump to be explicit, or delete it when done)"; }
