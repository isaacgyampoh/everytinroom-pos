#!/usr/bin/env bash
# ===========================================================================
# Docker on this Mac, without installing anything by hand.
#
#   deploy/mac/docker-setup-mac.sh
#
# This is for TESTING the stack locally before it goes near the server. The
# server is set up by deploy/bootstrap.sh, which runs on Ubuntu.
#
# WHY COLIMA AND NOT DOCKER DESKTOP
#   Colima is Apache-2.0 and free for anyone, for any use. Docker Desktop is
#   free for personal use and small businesses but its licence requires a paid
#   subscription above a size threshold, and the standing instruction on this
#   project is not to take on a new recurring bill. Colima removes the
#   question entirely and gives the same `docker` and `docker compose`
#   commands. Pass --desktop if you would rather have Docker Desktop.
#
# Options
#   --cpus N     processors for the Linux VM (default: half of this Mac's)
#   --memory N   gigabytes for the VM (default 8, minimum 4)
#   --disk N     gigabytes of VM disk (default 60)
#   --desktop    install Docker Desktop instead of Colima
#   --dry-run    print what would happen
# ===========================================================================

SCRIPT_NAME="docker-setup-mac.sh"
HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/../lib/common.sh"

[ "$(uname -s)" = "Darwin" ] || die \
  "This script is for macOS; this is $(uname -s)." \
  "On the Ubuntu server use deploy/bootstrap.sh instead."

VM_CPUS=""; VM_MEM=8; VM_DISK=60; DESKTOP=0; DRY=0
while [ $# -gt 0 ]; do
  case "$1" in
    --cpus) VM_CPUS="${2:-}"; shift 2 ;;
    --memory) VM_MEM="${2:-8}"; shift 2 ;;
    --disk) VM_DISK="${2:-60}"; shift 2 ;;
    --desktop) DESKTOP=1; shift ;;
    --dry-run) DRY=1; shift ;;
    -h|--help) sed -n '2,25p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "Unknown option: $1" "Run $0 --help" ;;
  esac
done

run() { if [ "$DRY" = "1" ]; then printf '  %s[dry-run]%s %s\n' "$C_DIM" "$C_RESET" "$*"; else "$@"; fi; }

MAC_CPUS="$(sysctl -n hw.ncpu 2>/dev/null || echo 4)"
MAC_MEM_GB=$(( $(sysctl -n hw.memsize 2>/dev/null || echo 8589934592) / 1024 / 1024 / 1024 ))
[ -n "$VM_CPUS" ] || VM_CPUS=$(( MAC_CPUS / 2 ))
[ "$VM_CPUS" -lt 2 ] && VM_CPUS=2

printf '\n%sDocker for local testing%s\n\n' "$C_BLD" "$C_RESET"
info "this Mac       : $MAC_CPUS processors, ${MAC_MEM_GB} GB"
info "VM to create   : $VM_CPUS processors, ${VM_MEM} GB, ${VM_DISK} GB disk"

[ "$VM_MEM" -ge 4 ] || die \
  "${VM_MEM} GB is not enough to run PostgreSQL and the API services." \
  "Use --memory 8 or more."
if [ "$VM_MEM" -ge "$MAC_MEM_GB" ]; then
  die "Asking for ${VM_MEM} GB on a Mac with ${MAC_MEM_GB} GB would leave macOS nothing." \
    "Try --memory $(( MAC_MEM_GB / 2 ))"
fi

# --- Homebrew -------------------------------------------------------------
if ! command -v brew >/dev/null 2>&1; then
  warn "Homebrew is not installed, and it is how the rest of this is installed."
  warn "It is a large install that changes directory permissions, so it is not"
  warn "done silently here. Install it with the command from https://brew.sh:"
  printf '\n    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"\n\n'
  die "Homebrew is required." "Install it with the command above, then run this script again."
fi
ok "homebrew: $(brew --version | head -1)"

if [ "$DESKTOP" = "1" ]; then
  # --- Docker Desktop ------------------------------------------------------
  if [ -d "/Applications/Docker.app" ]; then
    ok "Docker Desktop is already installed"
  else
    warn "Docker Desktop's licence requires a paid subscription for businesses"
    warn "above Docker's size threshold. Check it applies to you before relying on it."
    confirm "Install Docker Desktop?" || die "Stopped at your request." "Leave off --desktop to use Colima, which is free for any use."
    run brew install --cask docker
  fi
  run open -a Docker
  info "waiting for Docker Desktop to start"
  if [ "$DRY" = "0" ]; then
    retry 30 2 docker info >/dev/null 2>&1 || die \
      "Docker Desktop did not start within a minute." \
      "Open it from Applications and finish any first-run prompts, then run this again."
  fi
else
  # --- Colima --------------------------------------------------------------
  for f in colima docker docker-compose; do
    if brew list "$f" >/dev/null 2>&1; then ok "$f already installed"
    else run brew install "$f"; fi
  done

  # The compose plugin has to be where the docker CLI looks for it, or
  # `docker compose` reports "not a docker command" while `docker-compose`
  # works -- confusing, and the compose files here need the plugin.
  if [ "$DRY" = "0" ]; then
    install -d "$HOME/.docker/cli-plugins"
    CPATH="$(brew --prefix)/bin/docker-compose"
    if [ -x "$CPATH" ] && [ ! -e "$HOME/.docker/cli-plugins/docker-compose" ]; then
      ln -sf "$CPATH" "$HOME/.docker/cli-plugins/docker-compose"
      ok "linked the compose plugin into ~/.docker/cli-plugins"
    fi
  fi

  if colima status >/dev/null 2>&1; then
    ok "colima is already running"
    info "to change its size: colima stop && colima delete && re-run this"
  else
    run colima start --cpu "$VM_CPUS" --memory "$VM_MEM" --disk "$VM_DISK" \
      || die "Colima failed to start." \
             "See why:      colima status; colima logs | tail -40" \
             "Start fresh:  colima delete && $0"
    ok "colima started"
  fi
fi

# --- verify ---------------------------------------------------------------
if [ "$DRY" = "1" ]; then
  dim "would verify with 'docker run --rm hello-world'"
else
  docker info >/dev/null 2>&1 || die \
    "The docker command cannot reach a daemon." \
    "With Colima:         colima status" \
    "With Docker Desktop: open -a Docker and wait for the whale icon"
  ok "$(docker --version)"
  docker compose version >/dev/null 2>&1 \
    && ok "$(docker compose version)" \
    || die "'docker compose' is not available (the plugin is missing)." \
           "Link it:  ln -sf \$(brew --prefix)/bin/docker-compose ~/.docker/cli-plugins/docker-compose"
  docker run --rm hello-world >/dev/null 2>&1 \
    && { ok "a container runs"; docker rmi hello-world >/dev/null 2>&1 || true; } \
    || die "Docker cannot run a container." "Check outbound network access, then: docker run --rm hello-world"
fi

cat <<'EOT'

  Ready. To bring up a local copy of the stack for testing:

    cd deploy/compose

    # The config is a template that bootstrap.sh fills in from the server's
    # RAM. On the laptop, fill it in with small values by hand. Do this FIRST:
    # compose bind-mounts this exact path, and if the file is missing Docker
    # silently creates a DIRECTORY there and PostgreSQL fails to start with a
    # message that does not explain why.
    sed -e 's/__MAX_CONNECTIONS__/50/'       -e 's/__SHARED_BUFFERS__/256MB/' \
        -e 's/__EFFECTIVE_CACHE__/1GB/'      -e 's/__MAINTENANCE_WORK_MEM__/64MB/' \
        -e 's/__WORK_MEM__/8MB/'             -e 's/__MAX_WORKERS__/2/' \
        -e 's/__MAX_PARALLEL_GATHER__/2/' \
        postgres/90-central.conf.tmpl > postgres/90-central.conf

    printf 'POSTGRES_PASSWORD=%s\nACME_EMAIL=\n' "$(openssl rand -hex 24)" > .env.local
    chmod 600 .env.local

    docker compose --env-file .env.local -f docker-compose.yml up -d
    docker compose -f docker-compose.yml ps

  That starts PostgreSQL and Caddy only. Caddy will not get a certificate on
  a laptop, which is expected -- there is no public hostname pointing here.

  With it running, the isolation test exercises the real provisioning SQL:

    PGHOST=127.0.0.1 PGUSER=postgres PGPASSWORD=$(grep -h '^POSTGRES_PASSWORD=' \
      deploy/compose/.env.local | cut -d= -f2) deploy/scripts/test-provision-sql.sh

  This is a test environment. It shares nothing with the server and holds no
  production data.

EOT
