#!/usr/bin/env bash
# ===========================================================================
# What has to happen AFTER an application's services have started, because it
# cannot happen before.
#
#   deploy/scripts/post-start.sh --app alpha_shop
#   deploy/scripts/post-start.sh --app alpha_shop --wait 180
#
# Two services create their own schema on first boot and this platform cannot
# pre-empt either of them:
#
#   storage-api  creates storage.buckets, storage.objects and the rest as the
#                role it connects with. The roles it then switches INTO need
#                rights on those tables, and there is no way to arrange that
#                in advance -- see the header of deploy/sql/24-storage-grants.sql
#                for the two approaches that were tried and why each fails on
#                this image.
#
#   realtime     runs its own tenant migrations to build the `realtime` schema,
#                including realtime.list_changes, which is what reads the WAL.
#                Nothing here creates it; this script checks whether it
#                appeared and says plainly if it did not, because a Realtime
#                that accepts subscriptions and delivers nothing otherwise
#                looks like it is working.
#
# Safe to re-run. It grants on what exists and creates nothing.
# ===========================================================================
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
DEPLOY="$(cd "$HERE/.." && pwd)"
ROOT_DIR="${ROOT_DIR:-/srv/central}"
# shellcheck disable=SC1091
. "$DEPLOY/lib/common.sh"

APP=""; WAIT=180
while [ $# -gt 0 ]; do
  case "$1" in
    --app) APP="${2:-}"; shift 2 ;;
    --wait) WAIT="${2:-180}"; shift 2 ;;
    -h|--help) sed -n '2,27p' "$0"; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done
[ -n "$APP" ] || { echo "--app <name> is required." >&2; exit 2; }

APP_DNS="$(printf '%s' "$APP" | tr '_' '-')"
APP_ENV="$ROOT_DIR/apps/$APP/.env"
[ -f "$APP_ENV" ] || { echo "$APP is not provisioned on this server ($APP_ENV is missing)." >&2; exit 2; }
APP_DB="$(sed -n 's/^APP_DB=//p' "$APP_ENV" | tail -1)"
[ -n "$APP_DB" ] || { echo "could not read APP_DB from $APP_ENV" >&2; exit 2; }
PROFILES="$(sed -n 's/^COMPOSE_PROFILES=//p' "$APP_ENV" | tail -1)"

pg() { docker exec central-postgres psql -tAqX -U postgres -d "$1" -c "$2" 2>/dev/null; }

printf '\n%sPost-start steps for %s%s\n' "$C_BLD" "$APP" "$C_RESET"
printf '  database : %s\n' "$APP_DB"
printf '  profiles : %s\n\n' "${PROFILES:-none}"

RC=0

# ---------------------------------------------------------------------------
case ",$PROFILES," in
  *,storage,*)
    printf '  %sstorage%s\n' "$C_BLD" "$C_RESET"
    # Wait for the tables, not for the container: a healthy container with a
    # rolled-back migration has no tables, and that is the failure this is
    # here to catch rather than paper over.
    n=0; deadline=$(( $(date +%s) + WAIT ))
    while [ "$(date +%s)" -lt "$deadline" ]; do
      n="$(pg "$APP_DB" "select count(*) from pg_class c join pg_namespace s on s.oid=c.relnamespace where s.nspname='storage' and c.relkind in ('r','p')" | tr -d ' ')"
      case "$n" in ''|*[!0-9]*) n=0 ;; esac
      [ "$n" -gt 0 ] && break
      sleep 5
    done
    if [ "${n:-0}" -eq 0 ]; then
      warn "storage-api has created no tables in $APP_DB after ${WAIT}s."
      warn "Its migrations have not run or were rolled back. Nothing was granted."
      warn "  docker logs ${APP_DNS}-storage --tail=40"
      RC=1
    else
      ok "storage-api has created $n table(s)"
      # Run the grants AS THE STORAGE ROLE, not as postgres.
      #
      # storage-api's migrations create those tables and functions, so the
      # storage role owns them -- and in PostgreSQL only an object's owner (or
      # a member of its owning role) may grant on it. Running them as postgres
      # produced a WARNING per object, "no privileges were granted for
      # \"search\"", and left the roles storage-api switches into with nothing.
      # The warnings are not errors, so this looked close to working.
      #
      # Granting the storage role to postgres would make postgres a member and
      # is the other way to do it. It is not taken: the membership grants on
      # this image are the operation that crashed the server twice already.
      # The owner granting on its own objects needs no new privilege at all.
      ST_USER="$(sed -n 's/^APP_STORAGE_USER=//p' "$APP_ENV" | tail -1)"
      PGPASSWORD="$(sed -n 's/^APP_STORAGE_PASSWORD=//p' "$APP_ENV" | tail -1)"
      export PGPASSWORD
      if [ -z "$ST_USER" ] || [ -z "$PGPASSWORD" ]; then
        warn "could not read the storage role's credentials from $APP_ENV"
        RC=1
      # -e PGPASSWORD with no value passes it from this environment rather than
      # putting it on the command line, where `ps` would show it.
      elif OUT="$(docker exec -i -e PGPASSWORD central-postgres \
                   psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U "$ST_USER" \
                   -d "$APP_DB" -f - < "$DEPLOY/sql/24-storage-grants.sql" 2>&1)"; then
        if printf '%s' "$OUT" | grep -q "no privileges were granted"; then
          warn "some objects were not granted even as their owner:"
          printf '%s\n' "$OUT" | grep "no privileges were granted" | head -10 | sed 's/^/      /'
          RC=1
        else
          ok "grants applied to the storage schema, by the role that owns it"
          printf '%s\n' "$OUT" | grep -E 'NOTICE|storage grants' | sed 's/^/      /'
        fi
      else
        warn "applying the storage grants failed. The whole output follows:"
        printf '%s\n' "$OUT" | tail -15 | sed 's/^/      /'
        RC=1
      fi
      unset PGPASSWORD
    fi
    ;;
esac

# ---------------------------------------------------------------------------
case ",$PROFILES," in
  *,realtime,*)
    printf '\n  %srealtime%s\n' "$C_BLD" "$C_RESET"
    deadline=$(( $(date +%s) + WAIT ))
    have=0
    while [ "$(date +%s)" -lt "$deadline" ]; do
      have="$(pg "$APP_DB" "select count(*) from pg_namespace where nspname='realtime'" | tr -d ' ')"
      case "$have" in ''|*[!0-9]*) have=0 ;; esac
      [ "$have" -gt 0 ] && break
      sleep 5
    done
    if [ "${have:-0}" -eq 0 ]; then
      warn "there is no \"realtime\" schema in $APP_DB after ${WAIT}s."
      warn "Realtime builds it with its own tenant migrations, and without it"
      warn "realtime.list_changes does not exist: subscriptions are ACCEPTED"
      warn "and no database change is ever delivered. That is the failure that"
      warn "looks most like success, so it is reported rather than ignored."
      warn "  docker logs ${APP_DNS}.realtime 2>&1 | head -60"
      RC=1
    else
      NTAB="$(pg "$APP_DB" "select count(*) from pg_class c join pg_namespace s on s.oid=c.relnamespace where s.nspname='realtime' and c.relkind in ('r','p')" | tr -d ' ')"
      HASLC="$(pg "$APP_DB" "select count(*) from pg_proc p join pg_namespace s on s.oid=p.pronamespace where s.nspname='realtime' and p.proname='list_changes'" | tr -d ' ')"
      ok "the realtime schema exists with ${NTAB:-0} table(s)"
      if [ "${HASLC:-0}" -gt 0 ]; then
        ok "realtime.list_changes() exists, so the WAL reader has what it needs"
      else
        warn "realtime.list_changes() is MISSING, so no change will be delivered."
        warn "Realtime's tenant migrations are incomplete."
        RC=1
      fi
      # Its own migration history, which says how far it got.
      MIG="$(pg "$APP_DB" "select count(*) from realtime.schema_migrations" | tr -d ' ')"
      [ -n "$MIG" ] && printf '      realtime.schema_migrations: %s row(s)\n' "$MIG"
    fi
    ;;
esac

printf '\n'
if [ "$RC" = "0" ]; then
  printf '  %sPost-start steps completed.%s\n\n' "$C_GRN" "$C_RESET"
else
  printf '  %sSomething a started service was supposed to create is missing.%s\n' "$C_YEL" "$C_RESET"
  printf '  The lines above say which. This exits non-zero so a caller notices.\n\n'
fi
exit "$RC"
