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

hdr "No SQL takes ownership of an object for another role"
# CREATE ... AUTHORIZATION <role> and ALTER ... OWNER TO <role> both require
# the executing role to be able to SET ROLE to that role. A non-superuser
# cannot, and the membership grant that would allow it CRASHES the
# supabase/postgres server. This pattern broke provisioning in three separate
# files, so it is banned: grant rights on the object instead of transferring
# ownership of it.
# Four forms of "act as another role" have now broken provisioning, each in a
# different file. ALTER DEFAULT PRIVILEGES FOR ROLE is the fourth.
# sql/migrate/ is scanned too. It was not, and a file there that transfers
# ownership passed unnoticed -- a guard with a blind spot is worse than no
# guard, because it is trusted.
#
# One file is exempt, and says so in itself: sql/migrate/realtime-migration-40.sql
# is Realtime's own migration, run deliberately as the image's superuser
# because the application's role may not. Exempt files are LISTED, so the
# exemption cannot hide.
EXEMPT_RE='^-- GUARD-EXEMPT: '
for f in "$DEPLOY"/sql/*.sql "$DEPLOY"/sql/migrate/*.sql; do
  [ -f "$f" ] || continue
  grep -q "$EXEMPT_RE" "$f" && printf '       exempt (says so in the file): %s\n' "$(basename "$f")"
done
BADO=$(grep -rniE "(create +(schema|table|database)[^;]* authorization |alter +(schema|table|database|sequence|type|function)[^;]* owner +to |alter +default +privileges +for +role )" \
  $(for f in "$DEPLOY"/sql/*.sql "$DEPLOY"/sql/migrate/*.sql; do
      [ -f "$f" ] || continue
      grep -q "$EXEMPT_RE" "$f" || printf '%s ' "$f"
    done) 2>/dev/null \
  | awk '{ line=$0; sub(/^[^:]*:[0-9]+:/, "", line);
           if (line ~ /^[[:space:]]*--/) next;
           if (tolower(line) ~ /raise +(exception|warning|notice)/) next;
           print }' || true)
if [ -z "$BADO" ]; then
  ok "no file transfers ownership, uses AUTHORIZATION, or sets default privileges for another role"
else
  bad "a file acts as another role (ownership, AUTHORIZATION or DEFAULT PRIVILEGES FOR ROLE)"
  printf '%s\n' "$BADO" | sed 's/^/     /'
fi

hdr "Templates have no leftover placeholders in committed form"
for f in "$DEPLOY"/compose/caddy-site.template "$DEPLOY"/compose/Caddyfile.tmpl "$DEPLOY"/compose/postgres/90-central.conf.tmpl; do
  n="$(grep -c '__[A-Z_]*__' "$f" 2>/dev/null || echo 0)"
  [ "$n" -gt 0 ] && ok "$(basename "$f") has $n placeholder(s), as a template should" \
                 || bad "$(basename "$f") has none — the substitution step would be a no-op"
done

hdr "HTTP-making scheduled jobs are registered where pg_net can serve them"
# pg_net's background worker reads net.http_request_queue in exactly ONE
# database -- pg_net.database_name, which is 'postgres' here. A net.http_post()
# from any other database queues a row, returns an id, and is never processed:
# no error, no response, no request. Run 17 failed on precisely that, with an
# empty net._http_response and no explanation.
#
# So nothing may wrap a net.http_* call in cron.schedule_in_database(), which
# is how the migration script used to rewrite EVERY job.
if grep -q "^pg_net.database_name = 'postgres'$" "$DEPLOY/compose/postgres/90-central.conf.tmpl"; then
  ok "pg_net.database_name is pinned to postgres in the config template"
else
  bad "pg_net.database_name is not pinned in 90-central.conf.tmpl — HTTP jobs would depend on a default"
fi
# This file is excluded from its own scan: the failure message below contains
# both "schedule_in_database" and "net.http_*", so a clean tree failed the
# check on the wording of the check. Same trap as the Caddyfile guard that
# matched the comment explaining the bug it was looking for.
BADNET="$(grep -rn "schedule_in_database" "$DEPLOY"/scripts/*.sh "$DEPLOY"/sql/*.sql "$DEPLOY"/sql/migrate/*.sql 2>/dev/null \
  | grep -v "/validate-all\.sh:" \
  | grep -i "net\.http" | grep -v '^[^:]*:[0-9]*: *#' | grep -v '^[^:]*:[0-9]*: *--' || true)"
if [ -z "$BADNET" ]; then
  ok "no net.http_* call is scheduled into an application database"
else
  bad "a net.http_* call is wrapped in schedule_in_database() — it would never run"
  printf '%s\n' "$BADNET" | sed 's/^/     /'
fi
if grep -q "cron.schedule(" "$DEPLOY/sql/migrate/classify-cron-jobs.sql" 2>/dev/null; then
  ok "the migration classifier can emit cron.schedule() for HTTP jobs"
else
  bad "deploy/sql/migrate/classify-cron-jobs.sql does not emit cron.schedule() at all"
fi

hdr "No secret-looking value is committed"
# A JWT, a private key or a long hex string in a file git actually CARRIES.
#
# It used to scan the whole directory, which meant it flagged
# deploy/.r2.env -- a gitignored, untracked, mode-600 file that is SUPPOSED to
# contain a secret. The check is called "no secret-looking value is
# committed", so the set it looks at is the set git tracks. Scanning
# everything made the one file designed to hold a credential into a failure,
# which would have taught whoever hit it to ignore this check.
#
# The ignore rules are verified separately, by name, under "No operator-only
# material is tracked" -- so an untracked secret file is not unexamined here,
# it is examined by the check that can actually say something useful about it.
REPO_ROOT="$(cd "$DEPLOY/.." && pwd)"
TRACKED="$(cd "$REPO_ROOT" && git ls-files -z -- deploy 2>/dev/null | tr '\0' '\n' | grep -v VERSIONS.md || true)"
HITS=""
if [ -n "$TRACKED" ]; then
  HITS="$(cd "$REPO_ROOT" && printf '%s\n' "$TRACKED" | while IFS= read -r f; do
    [ -f "$f" ] || continue
    grep -IlE 'eyJ[A-Za-z0-9_-]{20,}\.|BEGIN [A-Z ]*PRIVATE KEY|(PASSWORD|SECRET|ACCESS_KEY)=[A-Za-z0-9+/]{16,}' "$f" 2>/dev/null
  done || true)"
fi
if [ -z "$HITS" ]; then
  ok "nothing that looks like a live credential in any tracked file ($(printf '%s\n' "$TRACKED" | grep -c . ) checked)"
else
  bad "possible secrets in tracked file(s): $HITS"
fi

hdr "Every file the scripts reach for actually exists"
# A path like "$ROOT_DIR/scripts/post-start.sh" or "$DEPLOY/sql/24-storage-grants.sql"
# resolves on the server only because bootstrap.sh copied that file there. A
# missing one fails at the moment it is needed, on the server, rather than
# here. Both roots map onto this directory, so it can be checked here instead.
XREF="$(DEPLOY="$DEPLOY" python3 "$DEPLOY/scripts/check-paths.py" 2>&1 || true)"
if printf '%s' "$XREF" | grep -q '^MISSING '; then
  bad "a script reaches for a file that does not exist"
  printf '%s\n' "$XREF" | grep '^MISSING ' | sed 's/^MISSING /     /'
else
  ok "every \$ROOT_DIR/ and \$DEPLOY/ path resolves ($(printf '%s' "$XREF" | sed -n 's/^CHECKED //p') reference(s))"
fi

hdr "No bash -c string carries a nested command substitution"
# `bash -n` cannot catch a quoting error inside a string that is only parsed
# at run time, and `detail bash -c "... $(...) ..."` nests a command
# substitution inside a double-quoted string inside bash -c inside docker
# exec. One of those got four levels deep, bash answered
#   syntax error near unexpected token `('
# at run time, the command never ran, and the empty result looked like a
# finding about the platform rather than about the quoting.
#
# Where a value is needed, assign it first and pass the variable. This is a
# narrow check for a specific trap, not a general shell linter -- there is no
# shellcheck on this machine, and a guard that exists beats one that would be
# better if it were installed.
# This file is excluded from its own scan: the explanation above and the
# implementation below both contain the pattern, so a clean tree failed on the
# wording of the check. Third time that has happened; the exclusion is the
# habit now.
BADNEST="$(grep -rn 'bash -c "' "$DEPLOY"/scripts/*.sh "$DEPLOY"/*.sh 2>/dev/null \
  | grep -v '/validate-all\.sh:' \
  | grep '\$(' | grep -v '# allow-nested-substitution' || true)"
if [ -z "$BADNEST" ]; then
  ok "no bash -c string nests a command substitution"
else
  bad "a bash -c string nests a command substitution; it will fail at run time"
  printf '%s\n' "$BADNEST" | sed 's/^/     /' | head -6
fi

hdr "No command substitution can kill a script that runs under set -e"
# lib/common.sh sets -euo pipefail, so every script that sources it dies if an
# assignment from a command substitution fails. health.sh had one `docker
# inspect` without a fallback: it printed the shared checks and one
# application, then stopped mid-loop, never reached its own summary, and the
# staging run reported that as "health.sh reported problems" -- a guess about
# a script that had crashed.
#
# Every other inspect in that file already had `|| echo ...`. One did not, and
# nothing noticed, because this only shows up when a container is absent at
# the wrong moment. So it is checked statically instead.
SUBOUT="$(python3 "$DEPLOY/scripts/check-set-e-subs.py" --deploy "$DEPLOY" 2>&1 || true)"
if printf '%s' "$SUBOUT" | grep -q '^MISSING '; then
  bad "a command substitution without a fallback will kill its script under set -e"
  printf '%s\n' "$SUBOUT" | grep '^MISSING ' | sed 's/^MISSING /     /' | head -10
else
  ok "$(printf '%s' "$SUBOUT" | sed -n 's/^CHECKED //p')"
fi

hdr "No operator-only material is tracked"
# This repository is public. A `git add -A` once committed five files of local
# operator material to it: two privilege snapshots of the live database, the
# SQL that corrected them, its rollback, and a table-drop script. They carried
# no credential, but a published map of which role may write to which table in
# a running system is not something to publish, and .gitignore does not stop
# `git add -f`. So it is checked rather than trusted.
ROOT="$(cd "$DEPLOY/.." && pwd)"
OPS="$(cd "$ROOT" && git ls-files 2>/dev/null \
  | grep -E '(AWAITING-APPROVAL/|grants-(before|after)-[0-9]+\.json|/revoke-.*\.sql$|PAYMENT-CREDENTIAL|\.r2\.env$)' || true)"
if [ -z "$OPS" ]; then
  ok "no operator-only file is tracked by git"
else
  bad "operator-only material is tracked in a public repository"
  printf '%s\n' "$OPS" | sed 's/^/     /'
fi
# And the ignore rule that is meant to prevent it must still be in place.
if (cd "$ROOT" && git check-ignore -q supabase/AWAITING-APPROVAL/probe.sql 2>/dev/null); then
  ok "supabase/AWAITING-APPROVAL/ is ignored, so a stray file there is not staged"
else
  bad "supabase/AWAITING-APPROVAL/ is NOT ignored — operator files there would be committed"
fi
# The R2 credentials file, specifically. It holds a live secret for a bucket
# that serves a shop's images, so "probably ignored" is not good enough.
if (cd "$ROOT" && git check-ignore -q deploy/.r2.env 2>/dev/null); then
  ok "deploy/.r2.env is ignored, so the R2 credentials cannot be committed"
else
  bad "deploy/.r2.env is NOT ignored — the R2 credentials could be committed"
fi

hdr "Unit tests"
for t in test-tuning.sh test-capacity.sh test-bootstrap-local.sh; do
  if "$HERE/$t" >/tmp/.vt.$$ 2>&1; then ok "$t ($(grep -c 'ok\x1b\[0m' /tmp/.vt.$$ || true) checks)"
  else bad "$t"; sed 's/^/      /' /tmp/.vt.$$ | tail -12; fi
  rm -f /tmp/.vt.$$
done

hdr "The extracted Realtime migrations still match their source"
# deploy/sql/migrate/realtime-migrations-84-91.sql holds statements copied out
# of Realtime's own migration files, because those eight do work an
# application's role cannot and Realtime stops the tenant when any of them
# fails. A hand-held copy of someone else's migrations drifts, so it is
# re-extracted and compared.
TAILOUT="$(python3 "$DEPLOY/scripts/check-realtime-tail-sql.py" \
             --migrations "${REALTIME_MIGRATIONS:-/tmp/realtime-src/lib/realtime/tenants/repo/migrations}" 2>&1 || true)"
case "$TAILOUT" in
  *MISSING*) bad "the extracted migrations have drifted from Realtime's own files"
             printf '%s\n' "$TAILOUT" | grep MISSING | sed 's/^/     /' | head -6 ;;
  SKIP*)     printf '  skipped: %s\n' "$(printf '%s' "$TAILOUT" | sed -n 's/^SKIP //p')" ;;
  *)         ok "$(printf '%s' "$TAILOUT" | sed -n 's/^CHECKED //p') match their source" ;;
esac

hdr "Realtime's own tenant migrations, replayed as a non-superuser"
# The failure this covers is the one that looked most like success: Realtime
# accepted subscriptions and delivered nothing for five runs, because its
# migration 20230328144023 could not create realtime.list_changes().
#
# Needs Realtime's migration sources. They are not vendored here -- they
# belong to Realtime and would drift -- so this runs when they are present
# and says plainly when they are not. The staging workflow fetches them.
RT_MIG="${REALTIME_MIGRATIONS:-}"
if [ -z "$RT_MIG" ]; then
  for c in "$DEPLOY/../.realtime-src/lib/realtime/tenants/repo/migrations" \
           "/tmp/realtime-src/lib/realtime/tenants/repo/migrations"; do
    [ -d "$c" ] && { RT_MIG="$c"; break; }
  done
fi
if [ -z "$RT_MIG" ] || [ ! -d "$RT_MIG" ]; then
  printf '  skipped: no Realtime migration sources.\n'
  printf '           deploy/scripts/fetch-realtime-migrations.sh puts them in place,\n'
  printf '           or set REALTIME_MIGRATIONS to a checkout.\n'
elif ! command -v psql >/dev/null 2>&1; then
  printf '  skipped: psql is not on PATH\n'
elif ! psql -tAqX -c 'select 1' >/dev/null 2>&1; then
  printf '  skipped: no reachable PostgreSQL\n'
else
  if python3 "$DEPLOY/scripts/test-realtime-migrations.py" --migrations "$RT_MIG" \
       > /tmp/rtmig.log 2>&1; then
    ok "every migration up to and including the one creating list_changes replays cleanly"
    grep -E 'PASS|applied' /tmp/rtmig.log | sed 's/^/     /' | head -8
  else
    bad "Realtime's tenant migrations do not replay under this platform's privileges"
    grep -E 'FAIL|ERROR|first failure' /tmp/rtmig.log | sed 's/^/     /' | head -8
  fi
fi

hdr "Every scheduled job is re-registered where it can actually run"
# pg_net serves one database. An HTTP-calling job registered against an
# application's own database queues a request and is never served: no error,
# no response, no request. migrate-from-supabase.sh used to do exactly that
# to every job, so each one is checked rather than sampled.
INV="${INVENTORY:-/tmp/inventory.json}"
if [ ! -f "$INV" ]; then
  printf '  skipped: no project inventory at %s\n' "$INV"
  printf '           inspect-supabase.py --json writes one; set INVENTORY to point here.\n'
elif ! psql -tAqX -c 'select 1' >/dev/null 2>&1; then
  printf '  skipped: no reachable PostgreSQL\n'
else
  if python3 "$DEPLOY/scripts/test-cron-placement.py" --inventory "$INV" \
       > /tmp/cronplace.log 2>&1; then
    ok "$(grep -c 'PASS' /tmp/cronplace.log) check(s): every job placed, schedules and commands preserved"
    grep -E 'HTTP-calling job|SQL-only job' /tmp/cronplace.log | sed 's/^ *PASS */     /' | head -4
  else
    bad "at least one scheduled job would be registered where it cannot run"
    grep -E 'FAIL' /tmp/cronplace.log | sed 's/^/     /' | head -8
  fi
fi

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
