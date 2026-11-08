#!/usr/bin/env bash
# ===========================================================================
# PROVISION ONE APPLICATION on the central server.
#
#   /srv/central/provision-app.sh \
#     --name everytinroom \
#     --domain api.everytinroom.store \
#     --realtime --storage --functions
#
# Run it again with the same arguments whenever something needs rebuilding:
# passwords and keys are generated ONCE and then reused, so a second run
# cannot lock the application out of its own database.
#
# Options
#   --name NAME        lowercase letters, digits and underscores (required)
#   --domain HOST      the API hostname, e.g. api.everytinroom.store
#   --realtime         run Realtime for this application
#   --auth             run Supabase Auth (GoTrue). Only for applications that
#                      actually use it -- check with inspect-supabase.py, which
#                      counts rows in auth.users
#   --storage          run Storage (Cloudflare R2 behind it) and imgproxy
#   --functions        run the Deno edge-function runtime
#   --migrations DIR   apply *.sql from DIR in filename order
#   --no-start         configure everything, start nothing
#   --dry-run          print what would happen, change nothing
#
# WHAT IT DOES NOT DO
#   It does not touch DNS. Nothing points at this server until you create the
#   record yourself, which is what keeps provisioning safe to run while the
#   old backend is still live.
# ===========================================================================

SCRIPT_NAME="provision-app.sh"
HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/lib/common.sh"

STEP_TOTAL=11
ROOT_DIR="/srv/central"
CENTRAL_ENV="$ROOT_DIR/.env"

NAME=""; DOMAIN=""; WANT_RT=0; WANT_ST=0; WANT_FN=0; WANT_AUTH=0
MIGRATIONS=""; DRY=0; DO_START=1

while [ $# -gt 0 ]; do
  case "$1" in
    --name) NAME="${2:-}"; shift 2 ;;
    --name=*) NAME="${1#*=}"; shift ;;
    --domain) DOMAIN="${2:-}"; shift 2 ;;
    --domain=*) DOMAIN="${1#*=}"; shift ;;
    --migrations) MIGRATIONS="${2:-}"; shift 2 ;;
    --migrations=*) MIGRATIONS="${1#*=}"; shift ;;
    --realtime) WANT_RT=1; shift ;;
    --auth) WANT_AUTH=1; shift ;;
    --storage) WANT_ST=1; shift ;;
    --functions) WANT_FN=1; shift ;;
    --no-start) DO_START=0; shift ;;
    --dry-run) DRY=1; shift ;;
    -h|--help) sed -n '2,30p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "Unknown option: $1" "Run $0 --help" ;;
  esac
done

run()  { if [ "$DRY" = "1" ]; then printf '  %s[dry-run]%s %s\n' "$C_DIM" "$C_RESET" "$*"; else "$@"; fi; }
# Every database action goes through the container's local socket as the
# postgres superuser, so no password is ever placed on a command line (where
# `ps` would show it) or in a shell history file.
psqlc() { docker exec -i central-postgres psql -v ON_ERROR_STOP=1 -U postgres "$@"; }
psqlq() { docker exec -i central-postgres psql -tAqX -U postgres "$@"; }

printf '\n%sProvisioning an application%s\n' "$C_BLD" "$C_RESET"
[ "$DRY" = "1" ] && warn "DRY RUN — nothing will be changed"

# ---------------------------------------------------------------------------
step "Registering the application name"
# ---------------------------------------------------------------------------
[ -n "$NAME" ] || die "--name is required." \
  "Example: $0 --name everytinroom --domain api.everytinroom.store"

# The same rule as the CHECK constraint on central.applications. It is also
# what keeps the name safe to use as a database name, a role name, a container
# name and a DNS label without quoting any of them.
printf '%s' "$NAME" | grep -qE '^[a-z][a-z0-9_]{1,30}$' || die \
  "'$NAME' is not a usable application name." \
  "Use lowercase letters, digits and underscores, starting with a letter, 2-31 characters." \
  "The name becomes a database name, a role name and a container name, so no hyphens, dots or capitals."

case "$NAME" in
  postgres|template0|template1|central|realtime|storage|public)
    die "'$NAME' is reserved by PostgreSQL or by this platform." "Pick another name." ;;
esac

if [ -n "$DOMAIN" ]; then
  printf '%s' "$DOMAIN" | grep -qE '^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$' || die \
    "'$DOMAIN' is not a valid hostname." \
    "Lowercase letters, digits, hyphens and dots only." \
    "$(printf '%s' "$DOMAIN" | grep -q '_' && printf 'It contains an underscore, which is not legal in a hostname. The application name may have one (it becomes a database name); the domain may not. Try: %s' "$(printf '%s' "$DOMAIN" | tr '_' '-')" || printf 'Example: api.everytinroom.store')"
fi

# A DNS-safe form of the name. The name itself may contain underscores
# because it becomes a PostgreSQL database and role name, where `alpha_shop`
# is perfectly valid. An underscore is NOT valid in a hostname, and this value
# becomes a container name, a network alias, a Realtime tenant read out of a
# Host header, and part of a domain. Keeping the two separate removes a whole
# class of problem -- the staging run found it by failing hostname validation
# on an application called alpha_shop.
APP_DNS="$(printf '%s' "$NAME" | tr '_' '-')"
APP_DB="$NAME"
# No per-application owner role. Granting one to the provisioning user
# crashes the supabase/postgres image, and ownership was never the isolation
# boundary -- CONNECT grants are. See deploy/sql/10-create-app-db.sql.
APP_AUTHN="${NAME}_authenticator"
APP_RT_USER="${NAME}_realtime"
APP_ST_USER="${NAME}_storage"
APP_AUTH_USER="${NAME}_auth"
APP_DIR="$ROOT_DIR/apps/$NAME"
APP_ENV="$APP_DIR/.env"

info "name      : $NAME"
info "database  : $APP_DB"
info "dns label : $APP_DNS$( [ "$APP_DNS" != "$NAME" ] && printf '  (underscores become hyphens for hostnames)' )"
info "domain    : ${DOMAIN:-(none yet)}"
info "services  : rest$( [ "$WANT_RT" = 1 ] && printf ' realtime' )$( [ "$WANT_ST" = 1 ] && printf ' storage+imgproxy' )$( [ "$WANT_FN" = 1 ] && printf ' functions' )$( [ "$WANT_AUTH" = 1 ] && printf ' auth' )"

[ -s "$CENTRAL_ENV" ] || die \
  "$CENTRAL_ENV does not exist, so the server has not been bootstrapped." \
  "Run bootstrap.sh first."

if [ "$DRY" = "0" ]; then
  docker inspect -f '{{.State.Health.Status}}' central-postgres 2>/dev/null | grep -q healthy || die \
    "central-postgres is not healthy, so nothing can be provisioned." \
    "Check it:  docker ps --filter name=central-postgres" \
    "And why:   docker logs central-postgres --tail=40"

  psqlq -d postgres -c "select 1 from information_schema.tables where table_schema='central' and table_name='applications'" \
    | grep -q 1 || die \
    "The central.applications registry is missing." \
    "Re-run bootstrap.sh — step 9 creates it. Nothing here has been changed."

  run docker exec -i central-postgres psql -q -U postgres -d postgres -c \
    "INSERT INTO central.applications (name, database_name, db_role, domain, needs_realtime, needs_storage, needs_functions, needs_auth)
     VALUES ('$NAME','$APP_DB','$APP_AUTHN',$( [ -n "$DOMAIN" ] && printf "'%s'" "$DOMAIN" || printf 'NULL' ),$WANT_RT::boolean,$WANT_ST::boolean,$WANT_FN::boolean,$WANT_AUTH::boolean)
     ON CONFLICT (name) DO UPDATE SET domain = EXCLUDED.domain,
       needs_realtime = EXCLUDED.needs_realtime,
       needs_storage  = EXCLUDED.needs_storage,
       needs_functions= EXCLUDED.needs_functions,
       needs_auth     = EXCLUDED.needs_auth" >/dev/null \
    || die "Could not write to central.applications." "Run bootstrap.sh again to repair the registry."
  ok "registered in central.applications"
fi

# ---------------------------------------------------------------------------
step "Creating the isolated database"
# ---------------------------------------------------------------------------
if [ "$DRY" = "1" ]; then
  dim "would run sql/10-create-app-db.sql for $APP_DB"
else
  EXISTED=0
  psqlq -d postgres -c "select 1 from pg_database where datname='$APP_DB'" | grep -q 1 && EXISTED=1
  psqlc -d postgres -v app="$NAME" -v dbname="$APP_DB" -v authn="$APP_AUTHN" \
    < "$ROOT_DIR/sql/10-create-app-db.sql" >/dev/null \
    || die "Creating the database failed." \
           "Run it by hand to see the error:" \
           "  docker exec -i central-postgres psql -U postgres -d postgres -v app=$NAME -v dbname=$APP_DB -v authn=$APP_AUTHN < $ROOT_DIR/sql/10-create-app-db.sql"
  [ "$EXISTED" = "1" ] && ok "database $APP_DB already existed — left alone, roles confirmed" \
                       || ok "database $APP_DB created"
fi

# ---------------------------------------------------------------------------
step "Creating dedicated credentials"
# ---------------------------------------------------------------------------
# Generated once. On a re-run the existing values are kept, because the
# database already holds the matching password and a fresh one would leave
# PostgREST unable to log in.
run install -d -m 0700 "$APP_DIR"

if [ "$DRY" = "1" ]; then
  dim "would create $APP_ENV (0600) with this application's own password and keys"
else
  KEEP=0
  [ -s "$APP_ENV" ] && [ -n "$(get_env_var "$APP_ENV" APP_DB_PASSWORD 2>/dev/null || true)" ] && KEEP=1

  if [ "$KEEP" = "1" ]; then
    ok "existing credentials found — reused, not regenerated"
    APP_DB_PASSWORD="$(get_env_var "$APP_ENV" APP_DB_PASSWORD)"
    JWT_SECRET="$(get_env_var "$APP_ENV" JWT_SECRET)"
  else
    APP_DB_PASSWORD="$(gen_password)"
    # One JWT secret PER APPLICATION. A single server-wide secret would mean a
    # token minted for one business is accepted by another's API.
    JWT_SECRET="$(gen_secret 32)"
    set_env_var "$APP_ENV" APP_DB_PASSWORD "$APP_DB_PASSWORD"
    set_env_var "$APP_ENV" JWT_SECRET "$JWT_SECRET"
    ok "database password and JWT secret generated"
  fi

  set_env_var "$APP_ENV" APP_NAME "$NAME"
  set_env_var "$APP_ENV" APP_DNS "$APP_DNS"
  set_env_var "$APP_ENV" APP_DB "$APP_DB"
  set_env_var "$APP_ENV" APP_DB_USER "$APP_AUTHN"
  set_env_var "$APP_ENV" APP_DOMAIN "${DOMAIN:-localhost}"

  # require_extensions=on, explicitly: an application whose database lacks
  # pgcrypto cannot hash a staff PIN, and one without pg_net cannot run a
  # scheduled job. Those must stop provisioning, not warn.
  psqlc -d "$APP_DB" -v dbname="$APP_DB" -v authn="$APP_AUTHN" \
    -v require_extensions=on \
    -v authn_password="$APP_DB_PASSWORD" < "$ROOT_DIR/sql/20-app-grants.sql" >/dev/null \
    || die "Configuring the database internals failed." \
           "The database exists; only the grants step failed, and it is safe to re-run." \
           "To see the error, run sql/20-app-grants.sql by hand against $APP_DB."
  ok "roles, isolation and per-role limits applied"
fi

# ---------------------------------------------------------------------------
step "Configuring the PostgREST endpoint"
# ---------------------------------------------------------------------------
if [ "$DRY" = "1" ]; then
  dim "would mint the anon and service_role API keys"
else
  if [ -z "$(get_env_var "$APP_ENV" ANON_KEY 2>/dev/null || true)" ]; then
    # These are JWTs signed with this application's secret, not random
    # strings -- PostgREST verifies them and reads the role claim. See
    # scripts/mint-jwt.sh for why that matters.
    ANON_KEY="$(JWT_SECRET="$JWT_SECRET" "$ROOT_DIR/scripts/mint-jwt.sh" anon 10)"
    SERVICE_KEY="$(JWT_SECRET="$JWT_SECRET" "$ROOT_DIR/scripts/mint-jwt.sh" service_role 10)"
    set_env_var "$APP_ENV" ANON_KEY "$ANON_KEY"
    set_env_var "$APP_ENV" SERVICE_ROLE_KEY "$SERVICE_KEY"
    ok "anon and service_role keys minted (valid 10 years)"
  else
    ok "API keys already present — reused"
  fi
  set_env_var "$APP_ENV" PGRST_DB_SCHEMAS "public"
  set_env_var "$APP_ENV" PGRST_DB_POOL "10"
fi

# ---------------------------------------------------------------------------
step "Configuring Realtime"
# ---------------------------------------------------------------------------
PROFILES=""
if [ "$WANT_RT" = "0" ]; then
  dim "not requested — no Realtime container for this application"
else
  if [ "$DRY" = "1" ]; then
    dim "would create the $APP_RT_USER role and the _realtime schema"
  else
    RT_PW="$(get_env_var "$APP_ENV" APP_REALTIME_PASSWORD 2>/dev/null || true)"
    [ -n "$RT_PW" ] || RT_PW="$(gen_password)"
    psqlq -d postgres -c "select 1 from pg_roles where rolname='$APP_RT_USER'" | grep -q 1 \
      || psqlc -d postgres -c "CREATE ROLE \"$APP_RT_USER\" LOGIN REPLICATION" >/dev/null
    psqlc -d postgres -c "GRANT CONNECT ON DATABASE \"$APP_DB\" TO \"$APP_RT_USER\"" >/dev/null
    psqlc -d "$APP_DB" -v dbname="$APP_DB" \
      -v rt_user="$APP_RT_USER" -v rt_password="$RT_PW" \
      < "$ROOT_DIR/sql/21-realtime.sql" >/dev/null \
      || die "Preparing the database for Realtime failed." \
             "Everything before this step is done; re-running is safe."
    set_env_var "$APP_ENV" APP_REALTIME_USER "$APP_RT_USER"
    set_env_var "$APP_ENV" APP_REALTIME_PASSWORD "$RT_PW"
    # Realtime's own requirements: the encryption key is exactly 16 bytes and
    # SECRET_KEY_BASE must be at least 64 characters. Realtime refuses to boot
    # on anything else, with a message that does not say so.
    [ -n "$(get_env_var "$APP_ENV" REALTIME_ENC_KEY 2>/dev/null || true)" ] \
      || set_env_var "$APP_ENV" REALTIME_ENC_KEY "$(openssl rand -hex 8)"
    [ -n "$(get_env_var "$APP_ENV" REALTIME_SECRET_KEY_BASE 2>/dev/null || true)" ] \
      || set_env_var "$APP_ENV" REALTIME_SECRET_KEY_BASE "$(openssl rand -hex 32)"
    # Realtime calls fetch_env! on this one, so an absent value terminates the
    # release during boot rather than degrading.
    [ -n "$(get_env_var "$APP_ENV" REALTIME_METRICS_JWT_SECRET 2>/dev/null || true)" ] \
      || set_env_var "$APP_ENV" REALTIME_METRICS_JWT_SECRET "$(gen_secret 32)"
    ok "Realtime role, schema and keys ready (tenant: $NAME)"
  fi
  PROFILES="realtime"
fi

# ---------------------------------------------------------------------------
step "Configuring storage"
# ---------------------------------------------------------------------------
if [ "$WANT_ST" = "0" ]; then
  dim "not requested — no Storage or imgproxy container"
else
  if [ "$DRY" = "1" ]; then
    dim "would create the $APP_ST_USER role and ask for the R2 settings"
  else
    ST_PW="$(get_env_var "$APP_ENV" APP_STORAGE_PASSWORD 2>/dev/null || true)"
    [ -n "$ST_PW" ] || ST_PW="$(gen_password)"
    psqlq -d postgres -c "select 1 from pg_roles where rolname='$APP_ST_USER'" | grep -q 1 \
      || psqlc -d postgres -c "CREATE ROLE \"$APP_ST_USER\" LOGIN" >/dev/null
    psqlc -d postgres -c "GRANT CONNECT ON DATABASE \"$APP_DB\" TO \"$APP_ST_USER\"" >/dev/null
    psqlc -d "$APP_DB" -v dbname="$APP_DB" \
      -v st_user="$APP_ST_USER" -v st_password="$ST_PW" \
      < "$ROOT_DIR/sql/22-storage.sql" >/dev/null \
      || die "Preparing the database for Storage failed." "Re-running is safe."
    set_env_var "$APP_ENV" APP_STORAGE_USER "$APP_ST_USER"
    set_env_var "$APP_ENV" APP_STORAGE_PASSWORD "$ST_PW"

    # R2 credentials are NOT generated here -- they come from the Cloudflare
    # dashboard. Placeholders are written so the file is complete and compose
    # fails with a readable message instead of an opaque S3 error.
    for k in R2_BUCKET R2_ENDPOINT R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY; do
      [ -n "$(get_env_var "$APP_ENV" "$k" 2>/dev/null || true)" ] || set_env_var "$APP_ENV" "$k" "SET-ME"
    done
    if get_env_var "$APP_ENV" R2_BUCKET | grep -q '^SET-ME$'; then
      warn "R2 is not configured yet. Storage will start but every upload will fail."
      warn "Create a bucket and an API token in the Cloudflare dashboard, then set"
      warn "R2_BUCKET, R2_ENDPOINT, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY in:"
      warn "  $APP_ENV"
    fi
    ok "Storage role ready; R2 settings are in $APP_ENV"
  fi
  PROFILES="${PROFILES:+$PROFILES,}storage"
fi

# ---------------------------------------------------------------------------
step "Configuring Supabase Auth"
# ---------------------------------------------------------------------------
if [ "$WANT_AUTH" = "0" ]; then
  dim "not requested — no GoTrue container for this application"
  dim "that is correct for an app with its own sign-in; inspect-supabase.py"
  dim "counts rows in auth.users to decide"
else
  if [ "$DRY" = "1" ]; then
    dim "would create the $APP_AUTH_USER role and the auth schema"
  else
    AU_PW="$(get_env_var "$APP_ENV" APP_AUTH_PASSWORD 2>/dev/null || true)"
    [ -n "$AU_PW" ] || AU_PW="$(gen_password)"
    psqlq -d postgres -c "select 1 from pg_roles where rolname='$APP_AUTH_USER'" | grep -q 1 \
      || psqlc -d postgres -c "CREATE ROLE \"$APP_AUTH_USER\" LOGIN" >/dev/null
    psqlc -d postgres -c "GRANT CONNECT ON DATABASE \"$APP_DB\" TO \"$APP_AUTH_USER\"" >/dev/null
    psqlc -d "$APP_DB" -v dbname="$APP_DB" \
      -v auth_user="$APP_AUTH_USER" -v auth_password="$AU_PW" \
      < "$ROOT_DIR/sql/23-auth.sql" >/dev/null \
      || die "Preparing the database for Supabase Auth failed." "Re-running is safe."
    set_env_var "$APP_ENV" APP_AUTH_USER "$APP_AUTH_USER"
    set_env_var "$APP_ENV" APP_AUTH_PASSWORD "$AU_PW"
    [ -n "$(get_env_var "$APP_ENV" AUTH_DISABLE_SIGNUP 2>/dev/null || true)" ] \
      || set_env_var "$APP_ENV" AUTH_DISABLE_SIGNUP "true"
    ok "Auth role and schema ready (signup disabled by default)"
    warn "GoTrue has no SMTP configured, so AUTH_MAILER_AUTOCONFIRM defaults to true."
    warn "Set SMTP_* in $APP_ENV before relying on email confirmation."
  fi
  PROFILES="${PROFILES:+$PROFILES,}auth"
fi

# ---------------------------------------------------------------------------
step "Configuring application-specific services"
# ---------------------------------------------------------------------------
if [ "$WANT_FN" = "0" ]; then
  dim "no edge functions requested"
else
  run install -d -m 0750 "$APP_DIR/functions"
  if [ "$DRY" = "0" ]; then
    # The runtime is started with --main-service .../functions/main. That
    # router is NOT part of the image -- it is what receives each request,
    # works out which function the path names, and spawns a worker. Without
    # it the container starts and serves nothing. Vendored from upstream in
    # compose/functions-main; see its README.
    if [ -d "$ROOT_DIR/compose/functions-main" ]; then
      install -d -m 0750 "$APP_DIR/functions/main"
      cp -a "$ROOT_DIR/compose/functions-main/index.ts" \
            "$ROOT_DIR/compose/functions-main/memory-pressure.ts" \
            "$APP_DIR/functions/main/"
      ok "installed the edge-runtime main router"
    else
      warn "compose/functions-main is missing, so the functions runtime has no router."
      warn "Re-run bootstrap.sh to copy it into $ROOT_DIR/compose."
    fi
    # Secrets for the functions live in their own file so the compose env and
    # the payment credentials are not the same blast radius.
    if [ ! -e "$APP_DIR/functions.env" ]; then
      ( umask 177; : > "$APP_DIR/functions.env" )
      cat >> "$APP_DIR/functions.env" <<'EOT'
# Secrets for this application's edge functions. Mode 600, never committed.
# Set the ones the functions actually read; leave the rest out.
#
# Everytinroom's surviving functions and what they need:
#   charge-momo       NALOPAY_* MOOLRE_* PAYSTACK_SECRET_KEY NALO_SMS_* TASK_SECRET
#   paystack-webhook  PAYSTACK_SECRET_KEY
#   sms-reports       NALO_SMS_* TASK_SECRET
#   ussd-handler      (none)
#
# wa-agent and whatsapp-bot were removed, so OPENAI_API_KEY, WASENDER_API_KEY,
# WAWP_ACCESS_TOKEN, WAWP_INSTANCE_ID and OWNER_PHONE are no longer needed.
EOT
      chmod 600 "$APP_DIR/functions.env"
      ok "created $APP_DIR/functions.env (mode 600) with the required names listed"
    else
      ok "functions.env already exists — left alone"
    fi
    # "Empty" means no FUNCTIONS, not no files: main/ is the router.
    if [ -z "$(ls -A "$APP_DIR/functions" 2>/dev/null | grep -v '^main$')" ]; then
      warn "$APP_DIR/functions holds only the router, so there are no functions to serve."
      warn "Copy each function's directory there, each with its own index.ts."
      warn "Download them from the old project with:"
      warn "  supabase functions download <slug> --project-ref <ref>"
    fi
  fi
  PROFILES="${PROFILES:+$PROFILES,}functions"
fi

[ "$DRY" = "0" ] && set_env_var "$APP_ENV" COMPOSE_PROFILES "$PROFILES"
info "compose profiles: ${PROFILES:-none (PostgREST only)}"

# ---------------------------------------------------------------------------
step "Applying database migrations"
# ---------------------------------------------------------------------------
if [ -z "$MIGRATIONS" ]; then
  dim "no --migrations directory given"
  dim "for Everytinroom this is correct: production is moved with a DUMP, not by"
  dim "replaying migrations. The live database has drifted from the migration"
  dim "files (its cron jobs do not match 013), so a replay would not reproduce"
  dim "it. Use scripts/migrate-from-supabase.sh."
elif [ "$DRY" = "1" ]; then
  dim "would apply $(ls -1 "$MIGRATIONS"/*.sql 2>/dev/null | wc -l | tr -d ' ') files from $MIGRATIONS"
else
  [ -d "$MIGRATIONS" ] || die "--migrations '$MIGRATIONS' is not a directory."
  psqlc -d "$APP_DB" -c "CREATE TABLE IF NOT EXISTS public.schema_migrations (
      filename text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())" >/dev/null
  n=0; skipped=0
  for f in "$MIGRATIONS"/*.sql; do
    [ -e "$f" ] || continue
    b="$(basename "$f")"
    if psqlq -d "$APP_DB" -c "select 1 from public.schema_migrations where filename='$b'" | grep -q 1; then
      skipped=$((skipped+1)); continue
    fi
    printf '  applying %s ... ' "$b"
    if psqlc -d "$APP_DB" < "$f" >/dev/null 2>&1; then
      psqlc -d "$APP_DB" -c "INSERT INTO public.schema_migrations (filename) VALUES ('$b')" >/dev/null
      printf 'ok\n'; n=$((n+1))
    else
      printf 'FAILED\n'
      die "Migration $b failed. Migrations before it have been applied and recorded; this one has not." \
        "Read the error:" \
        "  docker exec -i central-postgres psql -U postgres -d $APP_DB < $f" \
        "Fix the file, then run this script again -- it resumes from where it stopped."
    fi
  done
  ok "$n applied, $skipped already recorded"
fi

# ---------------------------------------------------------------------------
step "Configuring the domain and HTTPS"
# ---------------------------------------------------------------------------
if [ -z "$DOMAIN" ]; then
  dim "no --domain given, so no site file was written and nothing is served"
elif [ "$DRY" = "1" ]; then
  dim "would write $ROOT_DIR/compose/caddy-sites/$NAME.caddy for $DOMAIN"
else
  SITE="$ROOT_DIR/compose/caddy-sites/$NAME.caddy"
  sed -e "s/__APP_DNS__/$APP_DNS/g" -e "s/__DOMAIN__/$DOMAIN/g" \
    "$ROOT_DIR/compose/caddy-site.template" > "$SITE"
  grep -q "__APP_DNS__\|__DOMAIN__" "$SITE" && die \
    "The Caddy site file still contains placeholders. This is a bug in provision-app.sh." \
    "Nothing was reloaded, so the proxy is unchanged."
  chmod 0644 "$SITE"
  ok "wrote $SITE"

  if docker exec central-caddy caddy validate --config /etc/caddy/Caddyfile >/dev/null 2>&1; then
    ok "Caddy configuration is valid"
    run docker restart central-caddy >/dev/null
    ok "Caddy reloaded"
  else
    ERR="$(docker exec central-caddy caddy validate --config /etc/caddy/Caddyfile 2>&1 | tail -5)"
    rm -f "$SITE"
    die "The new site file makes Caddy's configuration invalid, so it was removed again:
  $ERR" \
      "The proxy is still serving the previous configuration." \
      "Check the domain for stray characters: '$DOMAIN'"
  fi

  warn "DNS has NOT been changed. Until you create the record, nothing reaches this."
  warn "  $DOMAIN  ->  A  ->  this server's IP address"
  warn "Caddy gets a certificate on the first request AFTER the record resolves."
  warn "Through Cloudflare, set that record to DNS only (grey cloud) for the first"
  warn "request, or use the DNS-01 challenge; proxied records break HTTP-01."
fi

# ---------------------------------------------------------------------------
step "Configuring backups and health monitoring"
# ---------------------------------------------------------------------------
if [ "$DRY" = "1" ]; then
  dim "would install the nightly backup and capacity timers"
else
  CRON="/etc/cron.d/central-platform"
  if [ ! -e "$CRON" ]; then
    cat > "$CRON" <<EOT
# Central hosting platform. Installed by provision-app.sh.
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/sbin:/bin:/usr/sbin:/usr/bin
MAILTO=""

# Every application's database, nightly at 02:15 UTC (02:15 Ghana time).
15 2 * * * root $ROOT_DIR/scripts/backup.sh --all >> $ROOT_DIR/logs/backup.log 2>&1

# Capacity, hourly. Warnings go to the log; --quiet prints only problems.
7 * * * * root $ROOT_DIR/capacity.sh --quiet >> $ROOT_DIR/logs/capacity.log 2>&1
EOT
    chmod 0644 "$CRON"
    ok "installed $CRON (nightly backup 02:15, capacity hourly)"
  else
    ok "$CRON already present — left alone"
  fi

  # A per-application wrapper, so day-to-day work is not a long command line.
  cat > "$APP_DIR/compose.sh" <<EOT
#!/usr/bin/env bash
# Shortcut for this application's compose project.
#   ./compose.sh up -d        ./compose.sh logs -f rest        ./compose.sh ps
exec docker compose -p app_$NAME --env-file "$APP_ENV" \\
  -f "$ROOT_DIR/compose/app.compose.yml" "\$@"
EOT
  chmod 0750 "$APP_DIR/compose.sh"
  ok "wrote $APP_DIR/compose.sh"
  chmod 600 "$APP_ENV"; ok "$APP_ENV is mode 600"
  info "contains: $(sed -n 's/=.*//p' "$APP_ENV" | sort | tr '\n' ' ')"
fi

# --- start ----------------------------------------------------------------
if [ "$DRY" = "0" ] && [ "$DO_START" = "1" ]; then
  printf '\n'
  cd "$APP_DIR" || die "$APP_DIR vanished."
  if ! OUT="$(./compose.sh config -q 2>&1)"; then
    die "This application's compose configuration is not valid, so nothing was started:
  $OUT" \
      "A '\${VAR} is not set' message names a variable missing from $APP_ENV."
  fi
  ok "application compose configuration is valid"
  ./compose.sh up -d || die "Starting the application's containers failed." \
    "  cd $APP_DIR && ./compose.sh logs --tail=80"

  printf '\n  waiting for PostgREST\n'
  rest_ok() { [ "$(docker inspect -f '{{.State.Health.Status}}' "${APP_DNS}-rest" 2>/dev/null)" = "healthy" ]; }
  if retry 18 5 rest_ok; then ok "${APP_DNS}-rest is healthy"
  else
    warn "${APP_DNS}-rest did not report healthy within 90 seconds."
    warn "  docker logs ${APP_DNS}-rest --tail=40"
    warn "The usual cause is that the database has no tables yet, which is"
    warn "expected before the dump is restored."
  fi
fi

printf '\n%s%s %s is provisioned %s\n' "$C_GRN" "$C_BLD" "$NAME" "$C_RESET"
cat <<EOT

  Database      $APP_DB   (reachable only by $APP_AUTHN)
  Secrets       $APP_ENV  (mode 600)
  Manage        cd $APP_DIR && ./compose.sh ps

  The application's API base URL, once DNS points here:
    https://${DOMAIN:-<no domain set>}

  Put these in the frontend's build environment. The anon key is public by
  design -- it ships in the browser bundle and row-level security is what
  limits it:
    VITE_SUPABASE_URL=https://${DOMAIN:-<no domain set>}
    VITE_SUPABASE_ANON_KEY=<the ANON_KEY in $APP_ENV>

  Read it without putting it on screen:
    grep '^ANON_KEY=' $APP_ENV | cut -d= -f2

  Still to do, by hand and on purpose:
    - restore the production data  (scripts/migrate-from-supabase.sh)
    - set the R2 credentials       (if --storage was used)
    - create the DNS record        (nothing is served until then)

EOT
