#!/usr/bin/env bash
# ===========================================================================
# Run every check that can run without a server.
#
#   deploy/scripts/validate-all.sh
#
# What it can and cannot prove is listed at the end, because a green run here
# is not the same as a tested deployment.
# ===========================================================================
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
DEPLOY="$(cd "$HERE/.." && pwd)"
FAIL=0
PY=/usr/bin/python3
[ -x "$PY" ] || PY=python3
hdr() { printf '\n\033[1m%s\033[0m\n' "$*"; }
ok()  { printf '  \033[32mok\033[0m   %s\n' "$*"; }
bad() { printf '  \033[31mFAIL\033[0m %s\n' "$*"; FAIL=$((FAIL+1)); }

hdr "Shell syntax"
while IFS= read -r f; do
  if bash -n "$f" 2>/dev/null; then ok "${f#$DEPLOY/}"; else bad "${f#$DEPLOY/} — $(bash -n "$f" 2>&1 | head -1)"; fi
done < <(find "$DEPLOY" -name '*.sh' -type f | sort)

hdr "No variable is read before it is assigned"
# Every script here runs with set -u, so this is a crash and not a warning,
# and `bash -n` cannot see it. Two staging runs were lost to exactly this.
if "$PY" "$HERE/check-unbound.py" "$DEPLOY"/*.sh "$DEPLOY"/lib/*.sh \
     "$DEPLOY"/scripts/*.sh "$DEPLOY"/mac/*.sh >/tmp/.ub.$$ 2>&1; then
  ok "$(tail -1 /tmp/.ub.$$ | sed 's/^ *//')"
else
  bad "a variable is read before assignment"; sed 's/^/     /' /tmp/.ub.$$ | head -12
fi
rm -f /tmp/.ub.$$

hdr "Compose files parse as YAML"
for f in "$DEPLOY"/compose/*.yml; do
  if "$PY" -c "import yaml,sys; yaml.safe_load(open(sys.argv[1]))" "$f" 2>/dev/null; then
    ok "$(basename "$f")"
  else
    bad "$(basename "$f") — $("$PY" -c "import yaml,sys; yaml.safe_load(open(sys.argv[1]))" "$f" 2>&1 | tail -1)"
  fi
done

hdr "Every compose variable is set or defaulted"
# `docker compose up` reports an unset variable only when it runs, and an
# EMPTY one does not error at all -- it interpolates to nothing and the
# container starts misconfigured. That is how the Caddy ACME address broke.
if "$PY" "$HERE/check-compose-vars.py" >/tmp/.cv.$$ 2>&1; then
  ok "$(tail -1 /tmp/.cv.$$ | sed 's/^ *//')"
else
  bad "a compose variable is neither defaulted nor written"; sed 's/^/     /' /tmp/.cv.$$ | tail -8
fi
rm -f /tmp/.cv.$$

hdr "Image tags exist on Docker Hub"
if command -v curl >/dev/null 2>&1; then
  grep -ho 'image: [^ ]*' "$DEPLOY"/compose/*.yml | sed 's/image: //' | sort -u | while read -r img; do
    repo="${img%:*}"; tag="${img##*:}"
    case "$repo" in */*) ;; *) repo="library/$repo" ;; esac
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 \
      "https://hub.docker.com/v2/repositories/$repo/tags/$tag" 2>/dev/null || echo 000)"
    if [ "$code" = "200" ]; then printf '  \033[32mok\033[0m   %s\n' "$img"
    elif [ "$code" = "000" ]; then printf '  \033[33m??\033[0m   %s (no network)\n' "$img"
    else printf '  \033[31mFAIL\033[0m %s — HTTP %s\n' "$img" "$code"; fi
  done
else
  printf '  skipped (no curl)\n'
fi

hdr "SQL has no psql variables inside dollar-quoted blocks"
# psql does not interpolate :vars inside $$...$$, so one there is a syntax
# error at run time. This caught a real bug in 21-realtime.sql.
for f in "$DEPLOY"/sql/*.sql; do
  if "$PY" - "$f" <<'EOF'
import sys, re
src = open(sys.argv[1]).read()
bad = []
for m in re.finditer(r'\$(\w*)\$(.*?)\$\1\$', src, re.S):
    body = m.group(2)
    # `::int` is a cast and `:=` is an assignment. Neither is a psql variable
    # reference, and both appear legitimately inside plpgsql. Blank them out
    # before looking, or the check reports valid SQL as broken -- which it did.
    body = body.replace('::', '  ').replace(':=', '  ')
    for v in re.findall(r"(?<![:\w]):'?\"?(\w+)'?\"?", body):
        bad.append(v)
sys.exit(1 if bad else 0)
EOF
  then ok "$(basename "$f")"
  else bad "$(basename "$f") — a :variable appears inside a dollar-quoted block; psql will not interpolate it"
  fi
done

hdr "No SQL grants ADMIN OPTION on a Supabase reserved role"
# GRANT anon|authenticated|service_role ... WITH ADMIN OPTION crashes the
# supabase/postgres server outright -- the backend dies rather than erroring.
# It cost several staging runs to find, so it is banned rather than remembered.
# Only EXECUTABLE statements: a line whose code begins with GRANT, or an
# EXECUTE format('GRANT ...'). A comment describing the mistake, or a message
# string telling an operator something, is not the mistake itself -- and a
# guard that cannot tell those apart gets switched off.
# No -o: it returns only the matched text, which strips the `--` that marks a
# comment and made the guard report its own documentation as the defect.
# The WHOLE line is kept, then comments and message strings are filtered out.
BADG=$(grep -rniE "grant +[^;]*(anon|authenticated|service_role)[^;]*with +admin +option" \
  "$DEPLOY"/sql/*.sql "$DEPLOY"/*.sh "$DEPLOY"/scripts/*.sh 2>/dev/null \
  | awk '{ line=$0; sub(/^[^:]*:[0-9]+:/, "", line);
           if (line ~ /^[[:space:]]*--/) next;        # a SQL comment
           if (line ~ /^[[:space:]]*#/)  next;        # a shell comment
           if (tolower(line) ~ /raise +(exception|warning|notice)/) next;
           print }' || true)
if [ -z "$BADG" ]; then
  ok "no file grants ADMIN OPTION on a reserved role"
else
  bad "a file grants ADMIN OPTION on a reserved role — this crashes supabase/postgres"
  printf '%s\n' "$BADG" | sed 's/^/     /'
fi

hdr "Templates have no leftover placeholders in committed form"
for f in "$DEPLOY"/compose/caddy-site.template "$DEPLOY"/compose/Caddyfile.tmpl "$DEPLOY"/compose/postgres/90-central.conf.tmpl; do
  n="$(grep -c '__[A-Z_]*__' "$f" 2>/dev/null || echo 0)"
  [ "$n" -gt 0 ] && ok "$(basename "$f") has $n placeholder(s), as a template should" \
                 || bad "$(basename "$f") has none — the substitution step would be a no-op"
done

hdr "No secret-looking value is committed"
# A JWT, a private key or a long hex string in a tracked file.
HITS="$(grep -rIlE 'eyJ[A-Za-z0-9_-]{20,}\.|BEGIN [A-Z ]*PRIVATE KEY|(PASSWORD|SECRET|ACCESS_KEY)=[A-Za-z0-9+/]{16,}' \
  "$DEPLOY" 2>/dev/null | grep -v VERSIONS.md || true)"
[ -z "$HITS" ] && ok "nothing that looks like a live credential" \
               || bad "possible secrets in: $HITS"

hdr "Unit tests"
for t in test-tuning.sh test-capacity.sh test-bootstrap-local.sh; do
  if "$HERE/$t" >/tmp/.vt.$$ 2>&1; then ok "$t ($(grep -c 'ok\x1b\[0m' /tmp/.vt.$$ || true) checks)"
  else bad "$t"; sed 's/^/      /' /tmp/.vt.$$ | tail -12; fi
  rm -f /tmp/.vt.$$
done

hdr "Provisioning against a real PostgreSQL"
if command -v psql >/dev/null 2>&1 && psql -tAqX -c 'select 1' >/dev/null 2>&1; then
  if "$HERE/test-provision-sql.sh" >/tmp/.vp.$$ 2>&1; then
    ok "isolation test ($(grep -c 'PASS' /tmp/.vp.$$ || true) checks passed)"
  else
    bad "isolation test"; sed 's/^/      /' /tmp/.vp.$$ | tail -20
  fi
  rm -f /tmp/.vp.$$
else
  printf '  \033[33mskipped\033[0m — no reachable PostgreSQL. This is the test that proves\n'
  printf '           one application cannot open another application\x27s database.\n'
fi

hdr "JWT minting"
if command -v openssl >/dev/null 2>&1; then
  T="$(JWT_SECRET="$(openssl rand -hex 32)" "$HERE/mint-jwt.sh" anon 2>/dev/null)"
  [ "$(printf '%s' "$T" | awk -F. '{print NF}')" = "3" ] \
    && ok "produces a three-part token" || bad "token is malformed"
  printf '%s' "$T" | grep -q '[+/=]' && bad "token contains characters that are not URL-safe" \
                                     || ok "token is URL-safe"
else
  printf '  skipped (no openssl)\n'
fi

printf '\n'
if [ "$FAIL" = "0" ]; then printf '\033[32mAll checks passed.\033[0m\n'
else printf '\033[31m%d check(s) failed.\033[0m\n' "$FAIL"; fi

cat <<'EOT'

What a green run here does NOT prove:

  - that the containers start. No Docker on this machine, so nothing was run.
  - that Realtime delivers events. Its tenant is read from the Host header,
    which only a real request through Caddy exercises.
  - that uploads reach R2. That needs Cloudflare credentials.
  - that the restored database behaves. That needs the production dump.

Those four need a staging server. Everything above is what can honestly be
checked without one.
EOT
[ "$FAIL" = "0" ] || exit 1
