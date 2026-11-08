#!/usr/bin/env bash
# ===========================================================================
# Is everything actually serving?
#
#   health.sh                 every registered application
#   health.sh --app NAME      one
#
# Different from capacity.sh: that one asks whether the server has room, this
# one asks whether the services answer. A container can be "running" and still
# refuse every request, so this makes real requests through the proxy.
#
# Exit code: 0 all healthy, 1 something is not.
# ===========================================================================

SCRIPT_NAME="health.sh"
HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/../lib/common.sh"

ROOT_DIR="/srv/central"
ONE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --app) ONE="${2:-}"; shift 2 ;;
    --app=*) ONE="${1#*=}"; shift ;;
    -h|--help) sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "Unknown option: $1" ;;
  esac
done

need_linux "checks the services on an Ubuntu server"
BAD=0
pgq() { docker exec central-postgres psql -tAqX -U postgres -d postgres -c "$1" 2>/dev/null; }

printf '\n%sService health%s\n\n' "$C_BLD" "$C_RESET"

# --- shared ---------------------------------------------------------------
for c in central-postgres central-caddy; do
  st="$(docker inspect -f '{{.State.Status}}' "$c" 2>/dev/null || echo missing)"
  if [ "$st" = "running" ]; then ok "$c running"
  else printf '  %sFAIL%s %s is %s\n' "$C_RED" "$C_RESET" "$c" "$st"; BAD=$((BAD+1)); fi
done

if [ "$(pgq 'select 1')" = "1" ]; then ok "postgres answers queries"
else printf '  %sFAIL%s postgres does not answer\n' "$C_RED" "$C_RESET"; BAD=$((BAD+1)); fi

# --- per application ------------------------------------------------------
if [ -n "$ONE" ]; then
  ROWS="$(pgq "select name || ' ' || coalesce(domain,'-') from central.applications where name='$ONE'")"
  [ -n "$ROWS" ] || die "No application named '$ONE' is registered."
else
  ROWS="$(pgq "select name || ' ' || coalesce(domain,'-') from central.applications order by name")"
fi
[ -n "$ROWS" ] || warn "no applications registered yet"

while read -r name domain; do
  [ -z "$name" ] && continue
  printf '\n  %s%s%s  (%s)\n' "$C_BLD" "$name" "$C_RESET" "$domain"

  # Container names use the hyphenated form of the application name, because
  # an underscore is not valid in a hostname and these are DNS labels. The
  # database keeps the underscore. provision-app.sh derives it the same way.
  dns="$(printf '%s' "$name" | tr '_' '-')"

  # PostgREST, from inside the network, so this works before DNS exists.
  code="$(docker run --rm --network central_edge curlimages/curl:8.11.1 \
    -s -o /dev/null -w '%{http_code}' --max-time 5 "http://${dns}-rest:3000/" 2>/dev/null || echo 000)"
  # 200 means it answered; 404 also means it answered (OpenAPI is disabled on
  # purpose, so the root has nothing to show). Either proves it is serving.
  case "$code" in
    200|404) ok "  PostgREST answers (HTTP $code)" ;;
    000) printf '  %sFAIL%s   PostgREST unreachable\n' "$C_RED" "$C_RESET"; BAD=$((BAD+1)) ;;
    *) printf '  %sFAIL%s   PostgREST returned HTTP %s\n' "$C_RED" "$C_RESET" "$code"; BAD=$((BAD+1)) ;;
  esac

  # auth was missing from this list. beta_shop in the staging run has auth and
  # nothing else, so its only real service was never checked and a broken
  # GoTrue would have been reported healthy. An application that uses auth has
  # auth as the thing that matters most: without it nobody can sign in.
  for svc in realtime storage functions imgproxy auth; do
    cn="${dns}-${svc}"; [ "$svc" = "realtime" ] && cn="${dns}.realtime"
    st="$(docker inspect -f '{{.State.Status}}' "$cn" 2>/dev/null || echo absent)"
    [ "$st" = "absent" ] && continue
    h="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$cn" 2>/dev/null)"
    if [ "$st" = "running" ] && { [ "$h" = "healthy" ] || [ "$h" = "none" ]; }; then
      ok "  $svc running${h:+ ($h)}"
    else
      printf '  %sFAIL%s   %s is %s/%s — docker logs %s --tail=40\n' "$C_RED" "$C_RESET" "$svc" "$st" "$h" "$cn"
      BAD=$((BAD+1))
    fi
  done

  # Through the proxy over the real hostname, which is the only check that
  # covers TLS, the certificate and the routing together.
  if [ "$domain" != "-" ]; then
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 "https://$domain/rest/v1/" 2>/dev/null || echo 000)"
    case "$code" in
      200|401|404) ok "  https://$domain reachable (HTTP $code)" ;;
      000) warn "  https://$domain did not respond — DNS may not point here yet, which is expected before cutover" ;;
      *) warn "  https://$domain returned HTTP $code" ;;
    esac
  else
    dim "  no domain set, so nothing is served publicly"
  fi
done <<EOF
$ROWS
EOF

printf '\n'
[ "$BAD" = "0" ] && { ok "everything healthy"; exit 0; }
printf '  %s%d problem(s).%s\n\n' "$C_RED" "$BAD" "$C_RESET"
exit 1
