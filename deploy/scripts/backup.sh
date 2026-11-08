#!/usr/bin/env bash
# ===========================================================================
# BACK UP every application database on this server.
#
#   backup.sh --all                 every registered application
#   backup.sh --app everytinroom    just one
#   backup.sh --all --verify        also check each dump can be read back
#
# Installed in /etc/cron.d/central-platform to run nightly at 02:15.
#
# WHAT MAKES A DUMP COMPLETE HERE
#   pg_dump of one database does NOT include roles, their passwords, or
#   database-level grants -- those live in the cluster, not the database. A
#   restore from a database-only dump comes up with no roles, so PostgREST
#   cannot log in and every policy that names a role fails to apply. This
#   takes both: one globals dump for the cluster and one dump per database.
# ===========================================================================

SCRIPT_NAME="backup.sh"
HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/../lib/common.sh"

ROOT_DIR="/srv/central"
OUT="$ROOT_DIR/backups"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
ALL=0; ONE=""; VERIFY=0

while [ $# -gt 0 ]; do
  case "$1" in
    --all) ALL=1; shift ;;
    --app) ONE="${2:-}"; shift 2 ;;
    --app=*) ONE="${1#*=}"; shift ;;
    --verify) VERIFY=1; shift ;;
    --keep-days) KEEP_DAYS="${2:-14}"; shift 2 ;;
    -h|--help) sed -n '2,18p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "Unknown option: $1" "Run $0 --help" ;;
  esac
done
[ "$ALL" = "1" ] || [ -n "$ONE" ] || die "Say what to back up." "  $0 --all" "  $0 --app NAME"

need_linux "backs up the databases on an Ubuntu server"
command -v docker >/dev/null 2>&1 || die "Docker is not installed, so the database cannot be reached."
docker inspect -f '{{.State.Health.Status}}' central-postgres 2>/dev/null | grep -q healthy \
  || die "central-postgres is not healthy, so no backup was attempted." \
         "A backup taken from a sick database is worse than none, because it looks like safety." \
         "  docker logs central-postgres --tail=40"

install -d -m 0700 "$OUT"
STAMP="$(date -u '+%Y%m%d-%H%M%S')"
FAILED=0

pgq() { docker exec central-postgres psql -tAqX -U postgres -d postgres -c "$1" 2>/dev/null; }

# --- cluster globals ------------------------------------------------------
# Roles and their (hashed) passwords, plus database-level grants. Without this
# a restore has no anon, no authenticator and no per-app roles.
G="$OUT/globals-$STAMP.sql.gz"
if docker exec central-postgres pg_dumpall -U postgres --globals-only 2>/dev/null | gzip -9 > "$G"; then
  chmod 600 "$G"
  ok "globals: $(basename "$G") ($(du -h "$G" | awk '{print $1}'))"
else
  warn "could not dump cluster globals"; FAILED=$((FAILED+1))
fi

# --- which databases ------------------------------------------------------
if [ -n "$ONE" ]; then
  DBS="$(pgq "select database_name from central.applications where name='$ONE'")"
  [ -n "$DBS" ] || die "No application named '$ONE' is registered." \
    "Registered: $(pgq 'select string_agg(name, \", \") from central.applications')"
else
  DBS="$(pgq "select database_name from central.applications order by name")"
  [ -n "$DBS" ] || warn "No applications are registered yet, so only the globals were dumped."
fi

for db in $DBS; do
  F="$OUT/$db-$STAMP.sql.gz"
  printf '  %s ... ' "$db"
  # --no-owner is deliberately NOT used: ownership is part of the security
  # model here, and a restore that makes everything owned by one role undoes
  # the isolation the provisioning SQL set up.
  if docker exec central-postgres pg_dump -U postgres --format=plain --clean --if-exists \
       --quote-all-identifiers "$db" 2>/dev/null | gzip -9 > "$F"; then
    SZ="$(stat -c %s "$F" 2>/dev/null || echo 0)"
    if [ "$SZ" -lt 1024 ]; then
      printf 'FAILED (only %s bytes)\n' "$SZ"
      warn "the dump for $db is too small to be real; it has been kept for inspection as $(basename "$F")"
      FAILED=$((FAILED+1))
    else
      chmod 600 "$F"
      printf '%s\n' "$(du -h "$F" | awk '{print $1}')"
      if [ "$VERIFY" = "1" ]; then
        # Reading the whole file back through gzip is the only way to know the
        # archive is not truncated. It does not prove the SQL restores, but it
        # does prove the bytes are all there and uncorrupted.
        if gzip -t "$F" 2>/dev/null; then
          LINES="$(gzip -dc "$F" | wc -l | tr -d ' ')"
          ok "  verified: archive intact, $LINES lines"
        else
          warn "  $(basename "$F") is a CORRUPT archive"; FAILED=$((FAILED+1))
        fi
      fi
    fi
  else
    printf 'FAILED\n'
    warn "pg_dump failed for $db"
    FAILED=$((FAILED+1))
  fi
done

# --- retention ------------------------------------------------------------
# Deletes only files this script's own naming produces, and only ones older
# than the window. It never touches anything else in the directory.
OLD="$(find "$OUT" -maxdepth 1 -name '*.sql.gz' -type f -mtime "+$KEEP_DAYS" 2>/dev/null | wc -l | tr -d ' ')"
if [ "${OLD:-0}" -gt 0 ]; then
  # Refuse to prune when the newest backup failed: that is exactly when the
  # old ones are the only copies that exist.
  if [ "$FAILED" -gt 0 ]; then
    warn "$OLD backups are older than $KEEP_DAYS days but NOTHING was deleted,"
    warn "because this run had $FAILED failure(s) and those files may be the only copies left."
  else
    find "$OUT" -maxdepth 1 -name '*.sql.gz' -type f -mtime "+$KEEP_DAYS" -delete
    ok "removed $OLD backup(s) older than $KEEP_DAYS days"
  fi
fi

TOTAL="$(du -sh "$OUT" 2>/dev/null | awk '{print $1}')"
info "$OUT now holds $(ls -1 "$OUT"/*.sql.gz 2>/dev/null | wc -l | tr -d ' ') files, $TOTAL"

cat <<'EOT'

  These backups are ON THE SAME DISK as the database they came from. That
  covers a bad migration or a dropped table; it does not cover losing the
  server. Copy them somewhere else -- Cloudflare R2 holds 10 GB free, and the
  bucket you are already using for images will do:
    rclone sync /srv/central/backups r2:everytinroom-backups/

EOT

if [ "$FAILED" -gt 0 ]; then
  printf '  %s%d failure(s) -- do not treat tonight as backed up.%s\n\n' "$C_RED" "$FAILED" "$C_RESET"
  exit 1
fi
ok "backup complete"
