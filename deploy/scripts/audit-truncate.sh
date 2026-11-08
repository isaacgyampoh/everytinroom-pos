#!/usr/bin/env bash
# ===========================================================================
# Report — and only on request, fix — TRUNCATE granted to browser-facing roles.
#
#   export SUPABASE_ACCESS_TOKEN=...        # read -rs keeps it out of history
#   deploy/scripts/audit-truncate.sh                      # every project, report only
#   deploy/scripts/audit-truncate.sh --ref abc123         # one project, report only
#   deploy/scripts/audit-truncate.sh --ref abc123 --apply # revoke it, on that project
#
# REPORT ONLY BY DEFAULT. --apply changes one named project and nothing else;
# there is deliberately no "--apply to everything".
#
# WHY TRUNCATE IS THE ONE WORTH SWEEPING FOR
#   Row-level security does not apply to TRUNCATE at all. A policy of
#   USING (false) does not stop it; only the table privilege does. And the
#   `anon` key ships inside the browser bundle of every Supabase app, so it is
#   not a secret.
#
#   TRUNCATE empties a table instantly, with no row-by-row filtering and no
#   undo from inside the application.
#
# WHY REVOKING IT IS SAFE FOR ANY PostgREST APPLICATION
#   PostgREST has no TRUNCATE verb. There is no request supabase-js can send
#   that uses this privilege. It is not a feature anyone chose; it arrives with
#   a blanket GRANT ALL and sits there.
#
#   DELETE is a different matter -- real admin screens delete things -- so this
#   script never touches DELETE. It reports the count and leaves it, because
#   deciding which tables an application legitimately deletes from needs that
#   application's source.
# ===========================================================================
set -uo pipefail

API="https://api.supabase.com/v1"
REF=""; APPLY=0

while [ $# -gt 0 ]; do
  case "$1" in
    --ref) REF="${2:-}"; shift 2 ;;
    --ref=*) REF="${1#*=}"; shift ;;
    --apply) APPLY=1; shift ;;
    -h|--help) sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

TOKEN="${SUPABASE_ACCESS_TOKEN:-}"
[ -n "$TOKEN" ] || { echo "SUPABASE_ACCESS_TOKEN is not set." >&2; exit 2; }
[ "$APPLY" = "1" ] && [ -z "$REF" ] && {
  echo "--apply needs --ref. There is no apply-to-everything mode on purpose." >&2
  exit 2
}

sql() { # ref query
  curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d "$(printf '%s' "$2" | python3 -c 'import json,sys; print(json.dumps({"query": sys.stdin.read()}))')" \
    "$API/projects/$1/database/query"
}

COUNT_Q="select count(*)::text as n from pg_class c
  join pg_namespace n on n.oid=c.relnamespace
  cross join (values ('anon'),('authenticated'),('service_role')) r(rn)
  where n.nspname='public' and c.relkind in ('r','v','m','p')
    and has_table_privilege(r.rn, c.oid, 'TRUNCATE')"

LEDGER_Q="select coalesce(string_agg(distinct c.relname, ', '), '') as t
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relkind='r'
    and c.relname ~ '(sale|order|payment|invoice|ledger|transaction|receipt|refund)'
    and has_table_privilege('anon', c.oid, 'TRUNCATE')"

DELETE_Q="select count(*)::text as n from pg_class c
  join pg_namespace n on n.oid=c.relnamespace
  cross join (values ('anon'),('authenticated')) r(rn)
  where n.nspname='public' and c.relkind='r'
    and has_table_privilege(r.rn, c.oid, 'DELETE')"

# The revocation. A loop rather than a list, so a table added later cannot be
# missed, and postgres (the owner) is untouched -- an owner holds TRUNCATE
# implicitly regardless of grants, so migrations keep working.
REVOKE_SQL=$(cat <<'SQL'
BEGIN;
DO $$
DECLARE r record; n integer := 0;
BEGIN
  FOR r IN
    SELECT DISTINCT c.relname FROM pg_class c
      JOIN pg_namespace ns ON ns.oid = c.relnamespace
     WHERE ns.nspname = 'public' AND c.relkind IN ('r','v','m','p')
       AND (has_table_privilege('anon', c.oid, 'TRUNCATE')
         OR has_table_privilege('authenticated', c.oid, 'TRUNCATE')
         OR has_table_privilege('service_role', c.oid, 'TRUNCATE'))
  LOOP
    EXECUTE format('REVOKE TRUNCATE ON public.%I FROM anon, authenticated, service_role, PUBLIC', r.relname);
    n := n + 1;
  END LOOP;
  RAISE NOTICE 'TRUNCATE revoked on % object(s)', n;
END $$;
DO $$
DECLARE leftover text;
BEGIN
  SELECT string_agg(c.relname, ', ') INTO leftover
    FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
    CROSS JOIN (VALUES ('anon'),('authenticated'),('service_role')) AS r(rn)
   WHERE ns.nspname='public' AND c.relkind IN ('r','v','m','p')
     AND has_table_privilege(r.rn, c.oid, 'TRUNCATE');
  IF leftover IS NOT NULL THEN
    RAISE EXCEPTION 'Still reachable: %', leftover;
  END IF;
  RAISE NOTICE 'Verified: no application role can TRUNCATE anything in public.';
END $$;
COMMIT;
SQL
)

if [ -n "$REF" ]; then
  REFS="$REF"
else
  REFS=$(curl -s -H "Authorization: Bearer $TOKEN" "$API/projects" \
    | python3 -c 'import json,sys; [print(p["id"], p["name"]) for p in json.load(sys.stdin)]' \
    | awk '{print $1}')
fi

printf '\n%-24s %-10s %-8s %s\n' "PROJECT REF" "TRUNCATE" "DELETE" "LEDGER TABLES AT RISK"
printf '%s\n' "--------------------------------------------------------------------------------"
TOTAL_AT_RISK=0
for r in $REFS; do
  n=$(sql "$r" "$COUNT_Q" | python3 -c 'import json,sys
try:
    d=json.load(sys.stdin); print(d[0]["n"] if isinstance(d,list) and d else "-")
except Exception: print("-")')
  d=$(sql "$r" "$DELETE_Q" | python3 -c 'import json,sys
try:
    x=json.load(sys.stdin); print(x[0]["n"] if isinstance(x,list) and x else "-")
except Exception: print("-")')
  l=$(sql "$r" "$LEDGER_Q" | python3 -c 'import json,sys
try:
    x=json.load(sys.stdin); print((x[0]["t"] or "none") if isinstance(x,list) and x else "-")
except Exception: print("-")')
  printf '%-24s %-10s %-8s %s\n' "$r" "$n" "$d" "$l"
  case "$n" in ''|'-'|0) ;; *) TOTAL_AT_RISK=$((TOTAL_AT_RISK + 1)) ;; esac
done

printf '\n'
if [ "$APPLY" = "1" ]; then
  echo "Revoking TRUNCATE on $REF ..."
  OUT=$(sql "$REF" "$REVOKE_SQL")
  echo "  response: $(printf '%s' "$OUT" | head -c 300)"
  AFTER=$(sql "$REF" "$COUNT_Q" | python3 -c 'import json,sys
try:
    d=json.load(sys.stdin); print(d[0]["n"] if isinstance(d,list) and d else "?")
except Exception: print("?")')
  echo "  TRUNCATE combinations now: $AFTER  (must be 0)"
  echo
  echo "  Rollback, if ever needed:"
  echo "    GRANT TRUNCATE ON <table> TO anon;   -- restores one table"
  echo "  Nothing was deleted, so a mistake here is reversible."
else
  cat <<EOT
Report only. Nothing was changed.

  $TOTAL_AT_RISK project(s) still grant TRUNCATE to a browser-facing role.

  DELETE counts are reported and NOT touched: deciding which tables an
  application legitimately deletes from needs that application's source, and
  revoking the wrong one breaks an admin screen.

  To fix one project:
    $0 --ref <project-ref> --apply
EOT
fi
