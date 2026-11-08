#!/usr/bin/env bash
# ===========================================================================
# RESTORE one application database from a backup.
#
#   restore.sh --app everytinroom --file /srv/central/backups/everytinroom-20261108-021500.sql.gz
#   restore.sh --app everytinroom --file ... --into everytinroom_check   # rehearsal
#
# THE DEFAULT IS A REHEARSAL, NOT A RESTORE.
#   Without --into, this restores into a NEW database named
#   <app>_restore_<timestamp> and leaves the live one untouched. That is the
#   safe thing to want nearly every time: you find out whether the backup is
#   good without betting the live data on it.
#
#   Overwriting the live database needs --overwrite AND typing the database
#   name when asked. There is no flag combination that does it silently.
# ===========================================================================

SCRIPT_NAME="restore.sh"
HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/../lib/common.sh"

APP=""; FILE=""; INTO=""; OVERWRITE=0
while [ $# -gt 0 ]; do
  case "$1" in
    --app) APP="${2:-}"; shift 2 ;;
    --app=*) APP="${1#*=}"; shift ;;
    --file) FILE="${2:-}"; shift 2 ;;
    --file=*) FILE="${1#*=}"; shift ;;
    --into) INTO="${2:-}"; shift 2 ;;
    --into=*) INTO="${1#*=}"; shift ;;
    --overwrite) OVERWRITE=1; shift ;;
    -h|--help) sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "Unknown option: $1" "Run $0 --help" ;;
  esac
done

[ -n "$APP" ]  || die "--app is required."
[ -n "$FILE" ] || die "--file is required." "List what you have:  ls -lt /srv/central/backups/"
[ -r "$FILE" ] || die "Cannot read '$FILE'." "ls -lt /srv/central/backups/"

need_linux "restores a database on an Ubuntu server"
pgc() { docker exec -i central-postgres psql -v ON_ERROR_STOP=1 -U postgres "$@"; }
pgq() { docker exec central-postgres psql -tAqX -U postgres -d postgres -c "$1" 2>/dev/null; }

docker inspect -f '{{.State.Health.Status}}' central-postgres 2>/dev/null | grep -q healthy \
  || die "central-postgres is not healthy." "  docker logs central-postgres --tail=40"

gzip -t "$FILE" 2>/dev/null || die \
  "'$FILE' is not a readable gzip archive — it is truncated or corrupt." \
  "Try another backup:  ls -lt /srv/central/backups/" \
  "Nothing has been changed."

LIVE_DB="$(pgq "select database_name from central.applications where name='$APP'")"
[ -n "$LIVE_DB" ] || die "No application named '$APP' is registered." \
  "Registered: $(pgq 'select string_agg(name, \", \") from central.applications')"

if [ "$OVERWRITE" = "1" ]; then
  TARGET="${INTO:-$LIVE_DB}"
else
  TARGET="${INTO:-${APP}_restore_$(date -u '+%Y%m%d%H%M%S')}"
fi

printf '\n%sRestore%s\n' "$C_BLD" "$C_RESET"
info "from   : $FILE ($(du -h "$FILE" | awk '{print $1}'))"
info "into   : $TARGET"
info "live db: $LIVE_DB"

if [ "$TARGET" = "$LIVE_DB" ]; then
  printf '\n'
  warn "This will REPLACE the live database '$LIVE_DB'."
  warn "Every row written since this backup was taken will be gone: sales,"
  warn "receipts, stock movements and orders."
  [ "$OVERWRITE" = "1" ] || die \
    "Refusing to overwrite the live database without --overwrite." \
    "To rehearse instead (recommended), leave out --overwrite and this will" \
    "restore into a brand new database and leave the live one alone."
  printf '\n  Type the database name to confirm: '
  read -r TYPED || true
  [ "$TYPED" = "$LIVE_DB" ] || die "That did not match, so nothing was changed."

  # Take a dump of what is about to be destroyed. If the backup turns out to
  # be bad, this is the only way back.
  SAFETY="/srv/central/backups/PRE-RESTORE-$LIVE_DB-$(date -u '+%Y%m%d-%H%M%S').sql.gz"
  info "dumping the current database first, to $SAFETY"
  docker exec central-postgres pg_dump -U postgres --format=plain --clean --if-exists \
    --quote-all-identifiers "$LIVE_DB" 2>/dev/null | gzip -9 > "$SAFETY" \
    || die "Could not dump the current database, so the restore was abandoned." \
           "There would have been no way back if the backup were bad."
  [ "$(stat -c %s "$SAFETY")" -gt 1024 ] || die \
    "The safety dump came out suspiciously small, so the restore was abandoned." \
    "Investigate before trying again: $SAFETY"
  chmod 600 "$SAFETY"
  ok "safety copy taken ($(du -h "$SAFETY" | awk '{print $1}'))"
else
  info "the live database will NOT be touched"
fi

# Stop the application's containers while the database is swapped, so nothing
# writes into a half-restored schema.
if [ "$TARGET" = "$LIVE_DB" ] && [ -x "/srv/central/apps/$APP/compose.sh" ]; then
  info "stopping $APP's containers"
  "/srv/central/apps/$APP/compose.sh" stop >/dev/null 2>&1 || true
fi

if [ "$TARGET" != "$LIVE_DB" ]; then
  pgq "select 1 from pg_database where datname='$TARGET'" | grep -q 1 \
    && die "Database '$TARGET' already exists." "Pick another name with --into, or drop that one first."
  OWNER="$(pgq "select db_role from central.applications where name='$APP'")"
  pgc -d postgres -c "CREATE DATABASE \"$TARGET\"" >/dev/null \
    || die "Could not create '$TARGET'."
  ok "created $TARGET"
fi

info "restoring (this takes a while on a large dump)"
LOG="$(mktemp)"
if gzip -dc "$FILE" | docker exec -i central-postgres psql -U postgres -d "$TARGET" >"$LOG" 2>&1; then
  ERRS="$(grep -ci '^ERROR' "$LOG" 2>/dev/null || echo 0)"
  if [ "${ERRS:-0}" -gt 0 ]; then
    warn "the restore finished with $ERRS error line(s)"
    grep -i '^ERROR' "$LOG" | head -10 | sed 's/^/      /'
    warn "full log: $LOG"
    warn "A dump made with --clean reports errors for objects that did not exist"
    warn "yet, which are harmless. Anything else is not. Read them before trusting this."
  else
    ok "restored with no errors"
    rm -f "$LOG"
  fi
else
  warn "psql exited non-zero; last lines:"
  tail -20 "$LOG" | sed 's/^/      /'
  die "The restore failed. Log kept at $LOG" \
    "$( [ "$TARGET" = "$LIVE_DB" ] && echo "Put the live database back from the safety copy taken above." || echo "The live database was never touched." )"
fi

# --- what actually arrived ------------------------------------------------
printf '\n  %swhat is in %s%s\n' "$C_BLD" "$TARGET" "$C_RESET"
docker exec central-postgres psql -U postgres -d "$TARGET" -tAqX -c "
  select '    tables      ' || count(*) from information_schema.tables where table_schema='public'
  union all select '    functions   ' || count(*) from information_schema.routines where routine_schema='public'
  union all select '    policies    ' || count(*) from pg_policies where schemaname='public'
  union all select '    indexes     ' || count(*) from pg_indexes where schemaname='public'
  union all select '    size        ' || pg_size_pretty(pg_database_size('$TARGET'))
" 2>/dev/null

# Row counts for the tables that hold money and history. A restore that
# brought the schema but not the rows looks fine until somebody looks for a
# receipt, so the numbers are printed whether anyone asked or not.
printf '\n  %srows in the tables that matter%s\n' "$C_BLD" "$C_RESET"
for t in sales whatsapp_orders products customers refunds staff stock_ledger; do
  n="$(docker exec central-postgres psql -U postgres -d "$TARGET" -tAqX \
        -c "select count(*) from public.$t" 2>/dev/null || echo "-")"
  printf '    %-18s %s\n' "$t" "$n"
done

if [ "$TARGET" = "$LIVE_DB" ] && [ -x "/srv/central/apps/$APP/compose.sh" ]; then
  printf '\n'
  info "starting $APP's containers again"
  "/srv/central/apps/$APP/compose.sh" up -d >/dev/null 2>&1 \
    && ok "containers started" \
    || warn "could not start them: cd /srv/central/apps/$APP && ./compose.sh up -d"
fi

printf '\n'
if [ "$TARGET" != "$LIVE_DB" ]; then
  cat <<EOT
  This was a rehearsal. '$LIVE_DB' was not touched.

  Compare the two before trusting the backup:
    docker exec central-postgres psql -U postgres -d $TARGET -c 'select count(*) from sales'
    docker exec central-postgres psql -U postgres -d $LIVE_DB -c 'select count(*) from sales'

  Then remove the rehearsal copy:
    docker exec central-postgres psql -U postgres -c 'DROP DATABASE "$TARGET"'

EOT
fi
ok "done"
