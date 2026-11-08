# shellcheck shell=bash
# ===========================================================================
# Shared helpers for the deploy scripts.
#
# Sourced, never executed. Deliberately written so macOS's bash 3.2 can PARSE
# it (no associative arrays, no ${x^^}), because that is the only way `bash -n`
# can check these files on the laptop they are written on. They RUN on Ubuntu
# bash 5.
# ===========================================================================

# Fail on error, on unset variable, and on any failure in a pipeline. Without
# the last one, `pg_dump | gzip` reports success when pg_dump dies.
set -euo pipefail

# --- output ---------------------------------------------------------------
# Colour only when stdout is a terminal, so logs piped to a file or read by
# another script stay clean.
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  C_RESET=$'\033[0m'; C_DIM=$'\033[2m';  C_RED=$'\033[31m'
  C_GRN=$'\033[32m';  C_YEL=$'\033[33m'; C_BLU=$'\033[34m'; C_BLD=$'\033[1m'
else
  C_RESET=''; C_DIM=''; C_RED=''; C_GRN=''; C_YEL=''; C_BLU=''; C_BLD=''
fi

STEP_N=0
step()  { STEP_N=$((STEP_N + 1)); printf '\n%s[%d/%s] %s%s\n' "$C_BLU$C_BLD" "$STEP_N" "${STEP_TOTAL:-?}" "$*" "$C_RESET"; }
info()  { printf '  %s\n' "$*"; }
dim()   { printf '  %s%s%s\n' "$C_DIM" "$*" "$C_RESET"; }
ok()    { printf '  %s✓%s %s\n' "$C_GRN" "$C_RESET" "$*"; }
warn()  { printf '  %s!%s %s\n' "$C_YEL" "$C_RESET" "$*" >&2; }

# die: the whole point of Part B step 10 — "report deployment failures
# clearly". An error says what failed, and then what to DO about it. A stack
# trace the owner of a furniture shop cannot act on is not a report.
die() {
  printf '\n%s%s FAILED %s %s\n' "$C_RED" "$C_BLD" "$C_RESET" "${SCRIPT_NAME:-script}" >&2
  printf '  %s\n' "$1" >&2
  if [ $# -gt 1 ]; then
    shift
    printf '\n  %sWhat to do:%s\n' "$C_BLD" "$C_RESET" >&2
    for line in "$@"; do printf '    - %s\n' "$line" >&2; done
  fi
  printf '\n' >&2
  exit 1
}

# --- guards ---------------------------------------------------------------
need_root() {
  [ "$(id -u)" = "0" ] || die \
    "This must run as root." \
    "Run it with sudo: sudo $0 $*" \
    "Do not run the whole thing as a logged-in root shell if you can avoid it."
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || die \
    "Required command not found: $1" \
    "${2:-Install it and run this again.}"
}

# need_linux [what the script does, for the error message]
need_linux() {
  [ "$(uname -s)" = "Linux" ] || die \
    "This script ${1:-runs on the Ubuntu server} and cannot work on $(uname -s)." \
    "Copy the deploy/ directory to the server and run it there." \
    "On a Mac, use deploy/mac/docker-setup-mac.sh for a LOCAL test environment instead."
}

# A yes/no question that defaults to no and does not hang a cron job or a
# piped run: no terminal means take the default.
confirm() {
  local prompt="$1" reply=""
  if [ "${ASSUME_YES:-0}" = "1" ]; then return 0; fi
  if [ ! -t 0 ]; then
    warn "Not a terminal and ASSUME_YES is not set — assuming NO for: $prompt"
    return 1
  fi
  printf '  %s%s%s [y/N] ' "$C_BLD" "$prompt" "$C_RESET"
  read -r reply || true
  case "$reply" in [yY]|[yY][eE][sS]) return 0 ;; *) return 1 ;; esac
}

# --- secrets --------------------------------------------------------------
# Generates a secret and NEVER prints it. Everything here writes to files with
# mode 600; the caller reports the NAME of what it set, not the value.
gen_secret() { openssl rand -hex "${1:-32}"; }

# A password that is safe inside a libpq connection URI: hex only, so there is
# nothing to percent-encode and nothing a shell will reinterpret.
gen_password() { openssl rand -hex 24; }

# Write KEY=VALUE into an env file without ever echoing the value, creating
# the file 600 if it does not exist and replacing the key if it does.
set_env_var() {
  local file="$1" key="$2" value="$3"
  if [ ! -e "$file" ]; then
    ( umask 177; : > "$file" )
  fi
  chmod 600 "$file"
  local tmp
  tmp="$(mktemp "${file}.XXXXXX")"
  chmod 600 "$tmp"
  if [ -s "$file" ]; then grep -v "^${key}=" "$file" > "$tmp" || true; fi
  printf '%s=%s\n' "$key" "$value" >> "$tmp"
  mv "$tmp" "$file"
  chmod 600 "$file"
}

# Read a value back without printing it.
get_env_var() {
  local file="$1" key="$2"
  [ -r "$file" ] || return 1
  sed -n "s/^${key}=//p" "$file" | tail -1
}

# --- misc -----------------------------------------------------------------
# Compare dotted versions: version_ge 24.04 24.04 -> true
version_ge() {
  [ "$1" = "$2" ] && return 0
  [ "$(printf '%s\n%s\n' "$1" "$2" | sort -V | head -1)" = "$2" ]
}

# Retry a command with a pause between attempts. Used for "is the container
# healthy yet" rather than a flat sleep that is either too short or too slow.
retry() {
  local tries="$1" pause="$2"; shift 2
  local n=1
  while true; do
    if "$@"; then return 0; fi
    if [ "$n" -ge "$tries" ]; then return 1; fi
    n=$((n + 1))
    sleep "$pause"
  done
}
