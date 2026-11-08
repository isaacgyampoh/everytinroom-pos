#!/usr/bin/env bash
# ===========================================================================
# UBUNTU SERVER BOOTSTRAP — Docker, firewall, directories, shared stack.
#
# Run this once on a fresh Contabo (or any Ubuntu) server:
#
#   scp -r deploy root@SERVER:/root/
#   ssh root@SERVER
#   /root/deploy/bootstrap.sh --acme-email you@example.com
#
# It is safe to run again. Nothing it generates is regenerated: the database
# password and JWT secret are created once and then left alone, because
# changing them after the database exists locks the server out of its own data.
#
# Options
#   --acme-email ADDR   where Let's Encrypt sends certificate warnings
#   --dry-run           print every action, change nothing
#   --yes               do not ask before changing the firewall
#   --no-firewall       skip firewall configuration entirely
#   --skip-start        set everything up but do not start containers
# ===========================================================================

SCRIPT_NAME="bootstrap.sh"
HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/lib/common.sh"
. "$HERE/lib/tuning.sh"

STEP_TOTAL=10
ROOT_DIR="/srv/central"
DRY=0; ASSUME_YES=0; DO_FIREWALL=1; DO_START=1; ACME_EMAIL=""

while [ $# -gt 0 ]; do
  case "$1" in
    --acme-email) ACME_EMAIL="${2:-}"; shift 2 ;;
    --acme-email=*) ACME_EMAIL="${1#*=}"; shift ;;
    --dry-run) DRY=1; shift ;;
    --yes|-y) ASSUME_YES=1; shift ;;
    --no-firewall) DO_FIREWALL=0; shift ;;
    --skip-start) DO_START=0; shift ;;
    -h|--help) sed -n '2,25p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "Unknown option: $1" "Run $0 --help" ;;
  esac
done

run() { if [ "$DRY" = "1" ]; then printf '  %s[dry-run]%s %s\n' "$C_DIM" "$C_RESET" "$*"; else "$@"; fi; }

printf '\n%sCentral hosting bootstrap%s\n' "$C_BLD" "$C_RESET"
[ "$DRY" = "1" ] && warn "DRY RUN — nothing will be changed"

need_linux "installs Docker and configures an Ubuntu server"
[ "$DRY" = "1" ] || need_root "$@"

# ---------------------------------------------------------------------------
step "Checking the Ubuntu version"
# ---------------------------------------------------------------------------
[ -r /etc/os-release ] || die "/etc/os-release is missing, so this is not a distribution I can identify." \
  "This script supports Ubuntu LTS (22.04, 24.04, 26.04)."
# shellcheck disable=SC1091
. /etc/os-release

[ "${ID:-}" = "ubuntu" ] || die \
  "This is ${PRETTY_NAME:-an unknown system}, not Ubuntu." \
  "Reinstall the server with Ubuntu 24.04 LTS or 26.04 LTS." \
  "Contabo offers both in the control panel under Reinstall."

case "${VERSION_ID:-}" in
  22.04|24.04|26.04) ok "Ubuntu $VERSION_ID LTS ($VERSION_CODENAME)" ;;
  *)
    if [ "${VERSION_ID%%.*}" -ge 22 ] 2>/dev/null; then
      warn "Ubuntu $VERSION_ID is not an LTS release. It works, but it stops"
      warn "getting security updates far sooner than an LTS does."
      confirm "Continue on a non-LTS release?" || die "Stopped at your request." \
        "Reinstall with Ubuntu 24.04 LTS or 26.04 LTS."
    else
      die "Ubuntu ${VERSION_ID:-unknown} is too old: Docker's repository no longer builds for it." \
        "Reinstall the server with Ubuntu 24.04 LTS or 26.04 LTS."
    fi
    ;;
esac

# Docker publishes per-codename. A brand new Ubuntu release can appear before
# Docker's repository has it, and the apt error for that is unhelpful, so the
# check happens here while it can still be explained.
CODENAME="${VERSION_CODENAME:-}"
[ -n "$CODENAME" ] || die "VERSION_CODENAME is not set in /etc/os-release."
if command -v curl >/dev/null 2>&1; then
  if curl -fsI "https://download.docker.com/linux/ubuntu/dists/$CODENAME/Release" >/dev/null 2>&1; then
    ok "Docker's repository has a build for '$CODENAME'"
  else
    die "Docker has no package repository for Ubuntu '$CODENAME' yet." \
      "This happens for a few weeks after a new Ubuntu release." \
      "Reinstall the server with Ubuntu 24.04 LTS (noble), which is supported."
  fi
fi

ARCH="$(dpkg --print-architecture)"
RAM_MB=$(( $(awk '/^MemTotal:/{print $2}' /proc/meminfo) / 1024 ))
CPUS="$(nproc)"
DISK_GB="$(df -BG --output=size / 2>/dev/null | tail -1 | tr -dc '0-9')"
info "architecture : $ARCH"
info "memory       : ${RAM_MB} MB"
info "processors   : $CPUS"
info "disk on /    : ${DISK_GB:-?} GB"

# Read from the running configuration rather than assumed. Two steps need it:
# the firewall must not lock out the port you are connected on, and step 10
# has to know which public port is legitimately SSH.
SSH_PORT="$(awk '/^[[:space:]]*Port[[:space:]]+[0-9]+/{print $2; exit}' /etc/ssh/sshd_config 2>/dev/null || true)"
[ -n "$SSH_PORT" ] || SSH_PORT=22
info "ssh port     : $SSH_PORT"

[ "$RAM_MB" -ge 1900 ] || die \
  "This server has ${RAM_MB} MB of RAM, which is not enough for PostgreSQL plus the API services." \
  "Use a plan with at least 4 GB. The Contabo Cloud VPS 8 (24 GB) is the one this was sized for."

# ---------------------------------------------------------------------------
step "Installing Docker Engine"
# ---------------------------------------------------------------------------
# Verbatim from docs.docker.com/engine/install/ubuntu/ ("Install using the
# apt repository"). Deliberately NOT the get.docker.com convenience script,
# which Docker itself says is not for production.
if command -v docker >/dev/null 2>&1 && docker --version >/dev/null 2>&1; then
  ok "already installed: $(docker --version)"
else
  export DEBIAN_FRONTEND=noninteractive
  run apt-get update -qq
  run apt-get install -y -qq ca-certificates curl gnupg
  run install -m 0755 -d /etc/apt/keyrings
  if [ ! -s /etc/apt/keyrings/docker.asc ]; then
    run sh -c 'curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc'
    run chmod a+r /etc/apt/keyrings/docker.asc
  fi
  run sh -c "printf 'deb [arch=%s signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu %s stable\n' '$ARCH' '$CODENAME' > /etc/apt/sources.list.d/docker.list"
  run apt-get update -qq

  # Pinning: DOCKER_VERSION may name an exact apt version, e.g.
  #   DOCKER_VERSION=5:27.3.1-1~ubuntu.24.04~noble
  # Left unset it takes the current stable release from Docker's own
  # repository. An exact pin is NOT the default on purpose: apt versions are
  # withdrawn from that repository over time, so a pin recorded today becomes
  # an install that cannot be reproduced in a year. Reproducibility is pinned
  # where it holds -- the container image tags in compose, which are the
  # versions that decide how the stack behaves.
  if [ -n "${DOCKER_VERSION:-}" ]; then
    info "pinning docker-ce to $DOCKER_VERSION"
    run apt-get install -y -qq \
      "docker-ce=$DOCKER_VERSION" "docker-ce-cli=$DOCKER_VERSION" \
      containerd.io docker-buildx-plugin docker-compose-plugin \
      || die "Could not install docker-ce=$DOCKER_VERSION." \
             "That version is probably no longer in Docker's repository." \
             "Run 'apt-cache madison docker-ce' to list what is available," \
             "or unset DOCKER_VERSION to take the current stable release."
  else
    run apt-get install -y -qq docker-ce docker-ce-cli containerd.io \
      docker-buildx-plugin docker-compose-plugin \
      || die "Installing Docker Engine failed." \
             "Run 'apt-get update' and read the errors; a Contabo image with a" \
             "stale apt cache is the usual cause." \
             "Check the server can reach download.docker.com."
  fi
  run systemctl enable --now docker
  [ "$DRY" = "1" ] || ok "installed: $(docker --version)"
fi

# ---------------------------------------------------------------------------
step "Installing the Docker Compose plugin"
# ---------------------------------------------------------------------------
if [ "$DRY" = "1" ]; then
  dim "would confirm 'docker compose version'"
elif docker compose version >/dev/null 2>&1; then
  ok "$(docker compose version)"
else
  run apt-get install -y -qq docker-compose-plugin
  docker compose version >/dev/null 2>&1 || die \
    "The Docker Compose plugin is not working after installation." \
    "Check 'apt list --installed | grep docker-compose-plugin'." \
    "Note this needs 'docker compose' (the plugin), not the old 'docker-compose' script."
  ok "$(docker compose version)"
fi

# ---------------------------------------------------------------------------
step "Verifying the Docker installation"
# ---------------------------------------------------------------------------
if [ "$DRY" = "1" ]; then
  dim "would run the hello-world image and check the daemon"
else
  docker info >/dev/null 2>&1 || die \
    "The Docker daemon is installed but not responding." \
    "Start it:   systemctl start docker" \
    "Read why:   journalctl -u docker -n 50 --no-pager"
  if docker run --rm hello-world >/dev/null 2>&1; then
    ok "the daemon can pull an image and run a container"
    docker rmi hello-world >/dev/null 2>&1 || true
  else
    die "Docker cannot run a container." \
      "Usually this is no outbound network: test with 'curl -I https://registry-1.docker.io/v2/'." \
      "Read the daemon log: journalctl -u docker -n 50 --no-pager"
  fi
  # Log rotation at the daemon level as well as per-service in compose, so a
  # container started by hand cannot fill the disk either.
  if [ ! -s /etc/docker/daemon.json ]; then
    run install -d -m 0755 /etc/docker
    cat > /etc/docker/daemon.json <<'JSON'
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "3" },
  "live-restore": true
}
JSON
    run systemctl reload docker || run systemctl restart docker
    ok "daemon log rotation configured"
  else
    dim "/etc/docker/daemon.json already exists — left as it is"
  fi
fi

# ---------------------------------------------------------------------------
step "Configuring the firewall"
# ---------------------------------------------------------------------------
if [ "$DO_FIREWALL" = "0" ]; then
  warn "skipped at your request (--no-firewall)"
else
  info "SSH appears to be on port $SSH_PORT"

  if ! command -v ufw >/dev/null 2>&1; then
    run apt-get install -y -qq ufw
  fi
  if [ "$DRY" = "1" ]; then
    dim "would allow $SSH_PORT/tcp, 80/tcp, 443/tcp and deny everything else inbound"
  else
    run ufw --force reset >/dev/null
    run ufw default deny incoming
    run ufw default allow outgoing
    run ufw allow "$SSH_PORT/tcp" comment 'SSH'
    run ufw allow 80/tcp  comment 'HTTP (ACME challenge and redirect)'
    run ufw allow 443/tcp comment 'HTTPS'
    if ufw status | grep -q "Status: active"; then
      ok "firewall already active; rules updated"
    else
      confirm "Enable the firewall now? SSH on port $SSH_PORT stays open." \
        && { run ufw --force enable; ok "firewall enabled"; } \
        || warn "firewall configured but NOT enabled. Turn it on with: ufw enable"
    fi
  fi

  # The trap that catches people: a published Docker port is inserted into
  # iptables ahead of ufw's chain, so `ufw deny` does not block it. Step 10
  # checks what is actually listening rather than trusting these rules.
  dim "note: ufw does not filter published Docker ports — step 10 checks the real sockets"
fi

# ---------------------------------------------------------------------------
step "Creating the deployment directories"
# ---------------------------------------------------------------------------
for d in "$ROOT_DIR" "$ROOT_DIR/compose" "$ROOT_DIR/apps" \
         "$ROOT_DIR/backups" "$ROOT_DIR/logs" "$ROOT_DIR/compose/caddy-sites"; do
  run install -d -m 0750 -o root -g root "$d"
done
ok "$ROOT_DIR (0750, root only)"

# Copy the compose configuration into place. The repository stays the source
# of truth; the server gets a copy so a redeploy is `git pull` plus this
# script, not an edit on a live box.
if [ "$DRY" = "1" ]; then
  dim "would copy compose files into $ROOT_DIR/compose"
else
  cp -a "$HERE/compose/docker-compose.yml"   "$ROOT_DIR/compose/"
  cp -a "$HERE/compose/app.compose.yml"      "$ROOT_DIR/compose/"
  cp -a "$HERE/compose/Caddyfile"            "$ROOT_DIR/compose/"
  cp -a "$HERE/compose/caddy-site.template"  "$ROOT_DIR/compose/"
  install -d -m 0750 "$ROOT_DIR/compose/postgres"
  cp -a "$HERE/compose/postgres/90-central.conf.tmpl" "$ROOT_DIR/compose/postgres/"
  install -d -m 0750 "$ROOT_DIR/sql"
  cp -a "$HERE/sql/." "$ROOT_DIR/sql/"
  install -d -m 0750 "$ROOT_DIR/lib" "$ROOT_DIR/scripts"
  cp -a "$HERE/lib/." "$ROOT_DIR/lib/"
  cp -a "$HERE/scripts/." "$ROOT_DIR/scripts/"
  cp -a "$HERE/provision-app.sh" "$HERE/capacity.sh" "$ROOT_DIR/"
  ok "compose files, SQL and scripts copied to $ROOT_DIR"
fi

# Generate the PostgreSQL tuning file for THIS machine.
compute_tuning "$RAM_MB" "$CPUS" || die "Could not work out PostgreSQL settings for this machine."
info "postgres: max_connections=$TUNE_MAX_CONNECTIONS shared_buffers=${TUNE_SHARED_BUFFERS}MB work_mem=${TUNE_WORK_MEM}MB"
[ -n "$TUNE_NOTE" ] && warn "$TUNE_NOTE"
if [ "$DRY" = "1" ]; then
  dim "would write $ROOT_DIR/compose/postgres/90-central.conf"
else
  sed -e "s/__MAX_CONNECTIONS__/$TUNE_MAX_CONNECTIONS/" \
      -e "s/__SHARED_BUFFERS__/${TUNE_SHARED_BUFFERS}MB/" \
      -e "s/__EFFECTIVE_CACHE__/${TUNE_EFFECTIVE_CACHE}MB/" \
      -e "s/__MAINTENANCE_WORK_MEM__/${TUNE_MAINTENANCE_WORK_MEM}MB/" \
      -e "s/__WORK_MEM__/${TUNE_WORK_MEM}MB/" \
      -e "s/__MAX_WORKERS__/$TUNE_MAX_WORKERS/" \
      -e "s/__MAX_PARALLEL_GATHER__/$TUNE_MAX_PARALLEL_GATHER/" \
      "$ROOT_DIR/compose/postgres/90-central.conf.tmpl" \
      > "$ROOT_DIR/compose/postgres/90-central.conf"
  if grep -q "__[A-Z_]*__" "$ROOT_DIR/compose/postgres/90-central.conf"; then
    die "The PostgreSQL config still has unfilled placeholders: $(grep -o '__[A-Z_]*__' "$ROOT_DIR/compose/postgres/90-central.conf" | sort -u | tr '\n' ' ')" \
      "This is a bug in bootstrap.sh, not something you did." \
      "Postgres would refuse to start, so nothing was launched."
  fi
  chmod 0644 "$ROOT_DIR/compose/postgres/90-central.conf"
  ok "90-central.conf written for ${RAM_MB}MB / ${CPUS} CPUs"
fi

# ---------------------------------------------------------------------------
step "Writing the environment files"
# ---------------------------------------------------------------------------
ENV_FILE="$ROOT_DIR/.env"

# The one irreversible mistake this script could make: generating a new
# database password when the database already exists. The password lives
# inside the pgdata volume, and overwriting it here would leave a database
# nothing on the server can open.
if [ "$DRY" = "1" ]; then
  dim "would create $ENV_FILE (0600) with POSTGRES_PASSWORD and JWT_SECRET if absent"
else
  VOLUME_EXISTS=0
  docker volume inspect central_pgdata >/dev/null 2>&1 && VOLUME_EXISTS=1
  if [ "$VOLUME_EXISTS" = "1" ] && [ ! -s "$ENV_FILE" ]; then
    die "The database volume 'central_pgdata' exists but $ENV_FILE is missing, so its password is unknown." \
      "Do NOT let this script generate a new one -- the password is stored inside the volume and a new one will not open it." \
      "If you have the old .env, restore it to $ENV_FILE and run this again." \
      "If it is genuinely lost, recover from a backup in $ROOT_DIR/backups, or reset the password from inside the container:" \
      "  docker exec -it central-postgres psql -U postgres -c \"ALTER USER postgres PASSWORD 'new'\"" \
      "and then write that same value into $ENV_FILE."
  fi

  if [ -s "$ENV_FILE" ] && get_env_var "$ENV_FILE" POSTGRES_PASSWORD >/dev/null 2>&1 \
     && [ -n "$(get_env_var "$ENV_FILE" POSTGRES_PASSWORD)" ]; then
    ok "POSTGRES_PASSWORD already set — left untouched"
  else
    set_env_var "$ENV_FILE" POSTGRES_PASSWORD "$(gen_password)"
    ok "POSTGRES_PASSWORD generated"
  fi

  # One JWT secret for the whole server would let any application's token be
  # accepted by any other, so each application gets its own in its own .env.
  # This one is only a fallback for scripts run before an app exists.
  if [ -n "$(get_env_var "$ENV_FILE" CENTRAL_JWT_SECRET 2>/dev/null || true)" ]; then
    ok "CENTRAL_JWT_SECRET already set — left untouched"
  else
    set_env_var "$ENV_FILE" CENTRAL_JWT_SECRET "$(gen_secret 32)"
    ok "CENTRAL_JWT_SECRET generated"
  fi

  if [ -n "$ACME_EMAIL" ]; then
    set_env_var "$ENV_FILE" ACME_EMAIL "$ACME_EMAIL"
    ok "ACME_EMAIL set to $ACME_EMAIL"
  elif [ -z "$(get_env_var "$ENV_FILE" ACME_EMAIL 2>/dev/null || true)" ]; then
    warn "No ACME_EMAIL. Let's Encrypt cannot warn you about a renewal failure."
    warn "Set it with: $0 --acme-email you@example.com"
    set_env_var "$ENV_FILE" ACME_EMAIL ""
  fi

  # Monitoring reads the database as its own role; capacity.sh needs it.
  if [ -z "$(get_env_var "$ENV_FILE" MONITOR_PASSWORD 2>/dev/null || true)" ]; then
    set_env_var "$ENV_FILE" MONITOR_PASSWORD "$(gen_password)"
    ok "MONITOR_PASSWORD generated"
  fi

  chmod 600 "$ENV_FILE"
  ok "$ENV_FILE is mode 600, root only"
  # Named, never printed. The values are not echoed anywhere in this script.
  info "contains: $(sed -n 's/=.*//p' "$ENV_FILE" | sort | tr '\n' ' ')"
fi

# ---------------------------------------------------------------------------
step "Starting the shared stack"
# ---------------------------------------------------------------------------
cd "$ROOT_DIR/compose" 2>/dev/null || die "$ROOT_DIR/compose is missing — step 6 did not complete."

if [ "$DRY" = "1" ]; then
  dim "would validate the compose file and start postgres and caddy"
elif [ "$DO_START" = "0" ]; then
  warn "skipped at your request (--skip-start)"
else
  # Validate BEFORE starting. `config -q` resolves every variable and reports
  # a missing one by name, which is a far better error than a container that
  # exits immediately for a reason buried in its log.
  if ! OUT="$(docker compose --env-file "$ENV_FILE" -f docker-compose.yml config -q 2>&1)"; then
    die "The compose configuration is not valid, so nothing was started:
  $OUT" \
      "A '\${VAR} is not set' message names the variable that is missing from $ENV_FILE." \
      "Fix that and run this script again; it will not undo anything already done."
  fi
  ok "compose configuration is valid"

  # The import glob must match something. A .caddy file holding only comments
  # is valid configuration and removes any doubt about an empty glob.
  if [ -z "$(ls -A "$ROOT_DIR/compose/caddy-sites"/*.caddy 2>/dev/null)" ]; then
    printf '# Placeholder so "import /etc/caddy/sites/*.caddy" always matches.\n# provision-app.sh writes the real site files beside this one.\n' \
      > "$ROOT_DIR/compose/caddy-sites/00-placeholder.caddy"
    dim "wrote a placeholder site file so the import glob matches"
  fi

  # Validate the Caddyfile BEFORE starting anything.
  #
  # Learned the hard way: the first staging run used `trusted_proxies
  # cloudflare`, which needs a module the official image does not ship. Caddy
  # exited, the container restarted forever, and the only symptom this script
  # reported was "central-caddy is 'restarting'" -- true, but it did not say
  # why, and the reason was only in the container's own log. Validating here
  # puts Caddy's actual complaint in front of whoever ran the script.
  CADDY_IMG="$(awk '/image: caddy:/{print $2; exit}' docker-compose.yml)"
  if [ -n "$CADDY_IMG" ]; then
    if ! VOUT="$(docker run --rm \
          -e ACME_EMAIL="$(get_env_var "$ENV_FILE" ACME_EMAIL 2>/dev/null || echo '')" \
          -v "$ROOT_DIR/compose/Caddyfile:/etc/caddy/Caddyfile:ro" \
          -v "$ROOT_DIR/compose/caddy-sites:/etc/caddy/sites:ro" \
          "$CADDY_IMG" caddy validate --config /etc/caddy/Caddyfile 2>&1)"; then
      die "The Caddy configuration is not valid, so nothing was started.

Caddy said:
$(printf '%s' "$VOUT" | sed 's/^/  /' | tail -20)" \
        "Fix $ROOT_DIR/compose/Caddyfile and run this again." \
        "A message naming an unrecognized directive or module usually means the" \
        "config uses something that needs a plugin the official image does not" \
        "carry. Only directives in the standard build can be used here."
    fi
    ok "Caddy configuration is valid"
  fi

  run docker compose --env-file "$ENV_FILE" -f docker-compose.yml up -d \
    || die "Starting the shared stack failed." \
           "See what happened:  docker compose -f $ROOT_DIR/compose/docker-compose.yml logs --tail=80" \
           "Then run this script again once the cause is fixed."
  ok "postgres and caddy started"
fi

# ---------------------------------------------------------------------------
step "Checking container health"
# ---------------------------------------------------------------------------
if [ "$DRY" = "1" ] || [ "$DO_START" = "0" ]; then
  dim "nothing started, so nothing to check"
else
  healthy() { [ "$(docker inspect -f '{{.State.Health.Status}}' central-postgres 2>/dev/null)" = "healthy" ]; }
  info "waiting for PostgreSQL to accept connections (up to 120s)"
  if retry 24 5 healthy; then
    ok "central-postgres is healthy"
  else
    die "PostgreSQL did not become healthy within 120 seconds." \
      "Read its log, which will usually name a bad setting on the last line:" \
      "  docker logs central-postgres --tail=60" \
      "A line like 'unrecognized configuration parameter' points at" \
      "  $ROOT_DIR/compose/postgres/90-central.conf"
  fi

  for c in central-caddy; do
    st="$(docker inspect -f '{{.State.Status}}' "$c" 2>/dev/null || echo missing)"
    if [ "$st" = "running" ]; then ok "$c is running"
    else
      # Include the container's own log in the failure. Without it the report
      # says only "restarting", and the reason is one `docker logs` away that
      # nobody thinks to run -- which is how the first staging run produced
      # twenty-three downstream failures and no stated cause.
      die "$c is '$st' rather than running.

Its last log lines:
$(docker logs "$c" --tail=25 2>&1 | sed 's/^/  /')" \
        "Caddy almost always fails on its configuration file." \
        "Validate it:  docker run --rm -v $ROOT_DIR/compose/Caddyfile:/etc/caddy/Caddyfile:ro caddy:2.11.9-alpine caddy validate --config /etc/caddy/Caddyfile"
    fi
  done

  # Apply the central roles and the application registry. Done here with psql
  # rather than as a docker-entrypoint init script, because init scripts run
  # only when the volume is first created -- so on an existing server they
  # would never run at all.
  info "applying central roles and the application registry"
  MON_PW="$(get_env_var "$ENV_FILE" MONITOR_PASSWORD)"
  if docker exec -i central-postgres psql -v ON_ERROR_STOP=1 -U postgres -d postgres \
       < "$ROOT_DIR/sql/00-central-roles.sql" >/dev/null 2>&1; then
    # Set the monitor password separately, with logging off for that statement.
    docker exec -i central-postgres psql -q -U postgres -d postgres >/dev/null 2>&1 <<EOSQL
SET log_min_duration_statement = -1;
SET log_statement = 'none';
ALTER ROLE central_monitor PASSWORD '${MON_PW}';
EOSQL
    ok "central schema ready (central.applications, central_monitor)"
  else
    die "Could not apply $ROOT_DIR/sql/00-central-roles.sql." \
      "See the error:  docker exec -i central-postgres psql -U postgres -d postgres < $ROOT_DIR/sql/00-central-roles.sql" \
      "The containers are running; only this step failed, and it is safe to re-run."
  fi
fi

# ---------------------------------------------------------------------------
step "Checking what is reachable from the internet"
# ---------------------------------------------------------------------------
# This is the step that enforces "no Docker management interface is public".
# It inspects real listening sockets, because a published container port is
# inserted into iptables ahead of ufw's rules and is NOT blocked by `ufw deny`.
if [ "$DRY" = "1" ]; then
  dim "would list every socket listening on a public address"
else
  if command -v ss >/dev/null 2>&1; then
    EXPOSED="$(ss -H -tlnp 2>/dev/null | awk '{print $4}' \
      | grep -vE '^(127\.0\.0\.1|\[::1\])' \
      | sed 's/.*://' | sort -un | tr '\n' ' ')"
    info "listening on a public address: ${EXPOSED:-none}"

    UNEXPECTED=""
    for p in $EXPOSED; do
      case "$p" in
        22|80|443|"$SSH_PORT") ;;
        *) UNEXPECTED="$UNEXPECTED $p" ;;
      esac
    done
    if [ -n "$UNEXPECTED" ]; then
      warn "Unexpected public ports:$UNEXPECTED"
      warn "Identify them with: ss -tlnp | grep -E '$(echo "$UNEXPECTED" | tr ' ' '|' | sed 's/^|//;s/|$//')'"
      warn "If one belongs to a container, remove its 'ports:' entry or bind it to 127.0.0.1."
    else
      ok "only SSH, HTTP and HTTPS are public"
    fi

    # The database specifically. Its compose entry binds 127.0.0.1, and this
    # confirms that is what actually happened.
    if ss -H -tln 2>/dev/null | awk '{print $4}' | grep -qE '^(0\.0\.0\.0|\[::\]|\*):5432$'; then
      die "PostgreSQL is listening on every interface, so the database is exposed to the internet." \
        "Check the 'ports:' entry for postgres in $ROOT_DIR/compose/docker-compose.yml." \
        "It must read \"127.0.0.1:5432:5432\" and not \"5432:5432\"." \
        "Until that is fixed, treat the database password as compromised."
    fi
    ok "PostgreSQL is bound to 127.0.0.1 only"
  else
    warn "'ss' is not available, so public ports could not be verified."
    warn "Install it with: apt-get install -y iproute2"
  fi
fi

printf '\n%s%s Bootstrap complete %s\n' "$C_GRN" "$C_BLD" "$C_RESET"
cat <<EOT

  Shared stack   postgres + caddy, from $ROOT_DIR/compose
  Secrets        $ROOT_DIR/.env (mode 600)
  Next           provision an application:

                   $ROOT_DIR/provision-app.sh \\
                     --name everytinroom \\
                     --domain api.everytinroom.store \\
                     --realtime --storage --functions

  Capacity       $ROOT_DIR/capacity.sh

  Nothing is serving traffic yet: no application exists and no DNS points
  here. Provisioning an application does not change DNS either.

EOT
