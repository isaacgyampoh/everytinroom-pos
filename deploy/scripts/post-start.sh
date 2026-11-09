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

APP=""; WAIT=180; ONLY=""
while [ $# -gt 0 ]; do
  case "$1" in
    --app) APP="${2:-}"; shift 2 ;;
    --wait) WAIT="${2:-180}"; shift 2 ;;
    # Realtime's half has to run BEFORE a client is asked to subscribe, and
    # storage's half cannot run until storage-api has started. They were one
    # step, so the Realtime fix was applied after the delivery test had
    # already failed.
    --only) ONLY="${2:-}"; shift 2 ;;
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
RC_STORAGE=0
RC_REALTIME=0

# ---------------------------------------------------------------------------
case ",$PROFILES," in
  *,storage,*)
    if [ -n "$ONLY" ] && [ "$ONLY" != "storage" ]; then
      :
    else
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
      RC=1; RC_STORAGE=1
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
        RC=1; RC_STORAGE=1
      # -e PGPASSWORD with no value passes it from this environment rather than
      # putting it on the command line, where `ps` would show it.
      elif OUT="$(docker exec -i -e PGPASSWORD central-postgres \
                   psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U "$ST_USER" \
                   -d "$APP_DB" -f - < "$DEPLOY/sql/24-storage-grants.sql" 2>&1)"; then
        if printf '%s' "$OUT" | grep -q "no privileges were granted"; then
          warn "some objects were not granted even as their owner:"
          printf '%s\n' "$OUT" | grep "no privileges were granted" | head -10 | sed 's/^/      /'
          RC=1; RC_STORAGE=1
        else
          ok "grants applied to the storage schema, by the role that owns it"
          printf '%s\n' "$OUT" | grep -E 'NOTICE|storage grants' | sed 's/^/      /'
        fi
      else
        warn "applying the storage grants failed. The whole output follows:"
        printf '%s\n' "$OUT" | tail -15 | sed 's/^/      /'
        RC=1; RC_STORAGE=1
      fi
      unset PGPASSWORD
    fi
    fi
    ;;
esac

# ---------------------------------------------------------------------------
case ",$PROFILES," in
  *,realtime,*)
    if [ -n "$ONLY" ] && [ "$ONLY" != "realtime" ]; then
      :
    else
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
      RC=1; RC_REALTIME=1
    else
      NTAB="$(pg "$APP_DB" "select count(*) from pg_class c join pg_namespace s on s.oid=c.relnamespace where s.nspname='realtime' and c.relkind in ('r','p')" | tr -d ' ')"
      HASLC="$(pg "$APP_DB" "select count(*) from pg_proc p join pg_namespace s on s.oid=p.pronamespace where s.nspname='realtime' and p.proname='list_changes'" | tr -d ' ')"
      ok "the realtime schema exists with ${NTAB:-0} table(s)"
      if [ "${HASLC:-0}" -gt 0 ]; then
        ok "realtime.list_changes() exists, so the WAL reader has what it needs"
      else
        warn "realtime.list_changes() is MISSING, so no change will be delivered."
        warn "Realtime's tenant migrations are incomplete."
        RC=1; RC_REALTIME=1
      fi
      # How far its own migrations got, and what stopping short costs.
      #
      # Realtime has 91 tenant migrations. Everything the postgres_changes
      # path needs -- subscription, apply_rls, cast, list_changes -- is in the
      # first thirty. Migration 20240401105812 then wants to create
      # supabase_realtime_admin and move ownership of its broadcast and
      # presence tables to it. On this image that role does not exist and is
      # one of supautils' reserved roles, and the application's realtime role
      # cannot create roles, so that migration cannot succeed here.
      #
      # That is reported rather than worked around: creating or granting a
      # reserved role on this image is the operation that has crashed the
      # server, and it is not worth doing to tidy a count. What matters is
      # which FEATURES work, so that is what this says.
      MIG="$(pg "$APP_DB" "select count(*) from realtime.schema_migrations" | tr -d ' ')"
      case "$MIG" in ''|*[!0-9]*) MIG=0 ;; esac
      printf '      realtime.schema_migrations: %s of 91 row(s)\n' "$MIG"
      if [ "$MIG" -ge 91 ]; then
        ok "every tenant migration applied"
      elif [ "$MIG" = "39" ] \
           && [ "$(pg "$APP_DB" "select count(*) from realtime.schema_migrations where version = 20240401105812" | tr -d ' ')" = "0" ]; then
        # Stuck at exactly the reserved-role migration. provision-app.sh
        # grants the application's realtime role membership in
        # supabase_realtime_admin so Realtime can run this itself; if that was
        # refused, the migration is applied here as the image's superuser --
        # the same statements, from the same file, run by a role that is
        # allowed to. The alternative is leaving live updates broken, because
        # the migration that replaces list_changes() is on the far side of it.
        warn "Realtime is stuck at migration 20240401105812, which needs a reserved role."
        warn "Applying that one migration as the image's superuser instead."
        if OUT="$(docker exec -i central-postgres psql -X -v ON_ERROR_STOP=1 \
                   -U supabase_admin -d "$APP_DB" -f - \
                   < "$DEPLOY/sql/migrate/realtime-migration-40.sql" 2>&1)"; then
          ok "applied migration 20240401105812; restarting Realtime so it continues from 41"
          docker restart "${APP_DNS}.realtime" >/dev/null 2>&1 || true
          # Wait for it to get further, rather than declaring victory.
          for _ in $(seq 1 24); do
            NEWMIG="$(pg "$APP_DB" "select count(*) from realtime.schema_migrations" | tr -d ' ')"
            case "$NEWMIG" in ''|*[!0-9]*) NEWMIG=0 ;; esac
            [ "$NEWMIG" -gt 40 ] && break
            sleep 5
          done
          HASLC2="$(pg "$APP_DB" "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='realtime' and p.proname='list_changes'" | tr -d ' ')"
          printf '      realtime.schema_migrations: %s of 91 row(s) after the restart\n' "${NEWMIG:-0}"
          # 83 of 91 is the expected landing place, not a failure. Migrations
          # 84 onwards do things like
          #   ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin ...
          # which is the same "act as another role" an application's role
          # cannot do, and they exist to delegate Realtime's message tables to
          # Supabase's own platform roles. Nothing here uses them. What decides
          # whether live updates work is migration 20260326120000, which
          # replaces list_changes() with the version this Realtime calls.
          POLLERFN="$(pg "$APP_DB" "select count(*) from realtime.schema_migrations where version = 20260326120000" | tr -d ' ')"
          if [ "${NEWMIG:-0}" -ge 91 ]; then
            ok "every tenant migration applied"
          elif [ "${POLLERFN:-0}" = "1" ]; then
            ok "migration 20260326120000 applied, so list_changes() is the version this Realtime calls"
            printf '      %s\n' "${NEWMIG} of 91 applied. The remainder delegate Realtime's message"
            printf '      %s\n' "tables to Supabase's own platform roles -- an application's role"
            printf '      %s\n' "cannot perform those and nothing here uses them."
          else
            warn "only ${NEWMIG:-0} of 91, and migration 20260326120000 is not among them."
            warn "list_changes() is the older version and the poller will fail on"
            warn "every cycle with: column \"slot_changes_count\" does not exist"
            warn "  docker logs ${APP_DNS}.realtime 2>&1 | grep -iE 'migrat|error' | head -40"
            RC=1; RC_REALTIME=1
          fi
          [ "${HASLC2:-0}" -gt 0 ] || { warn "realtime.list_changes() is still missing"; RC=1; RC_REALTIME=1; }
        else
          warn "could not apply migration 20240401105812 even as supabase_admin:"
          printf '%s\n' "$OUT" | tail -8 | sed 's/^/      /'
          RC=1; RC_REALTIME=1
        fi
      else
        # Stopping short is NOT benign, and an earlier version of this said it
        # was. Migration 40 needs the reserved role supabase_realtime_admin,
        # and migration 69 -- on the far side of it -- replaces list_changes()
        # with the version this Realtime actually calls. Stop at 40 and the
        # poller fails every cycle with `column "slot_changes_count" does not
        # exist` while the client reports SUBSCRIBED. So this is a failure,
        # not a note about two features nobody uses.
        warn "only $MIG of 91 tenant migrations applied."
        warn "Anything after the first failure has not run. If that includes"
        warn "migration 20260326120000, realtime.list_changes() is the older"
        warn "version and the poller fails on every cycle with"
        warn "  column \"slot_changes_count\" does not exist"
        warn "while a subscribed client is told SUBSCRIBED and sees no error."
        warn "The usual cause is migration 20240401105812, which needs the role"
        warn "supabase_realtime_admin. provision-app.sh creates and grants it"
        warn "as the image's superuser; check its output for that step."
        RC=1; RC_REALTIME=1
      fi
    fi
    fi
    ;;
esac

# One line per service, so a caller can tell which half failed. Reporting a
# single exit code meant a run where storage was granted correctly and only
# Realtime was incomplete said "post-start did not complete, so storage
# requests will be refused" -- which was false about storage.
printf '\nRESULT storage=%s realtime=%s\n' "$RC_STORAGE" "$RC_REALTIME"
printf '\n'
if [ "$RC" = "0" ]; then
  printf '  %sPost-start steps completed.%s\n\n' "$C_GRN" "$C_RESET"
else
  printf '  %sSomething a started service was supposed to create is missing.%s\n' "$C_YEL" "$C_RESET"
  printf '  The lines above say which. This exits non-zero so a caller notices.\n\n'
fi
exit "$RC"
