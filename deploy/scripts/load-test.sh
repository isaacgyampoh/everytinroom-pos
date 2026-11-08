#!/usr/bin/env bash
# ===========================================================================
# Drive a provisioned application through its real request path, under load,
# and sample container resource use WHILE it is under that load.
#
#   deploy/scripts/load-test.sh --app alpha_shop --base-url http://alpha-shop.staging.test \
#       --key "$ANON" --clients 8 --seconds 60
#
# WHY THIS EXISTS
#   `docker stats --no-stream` on an idle machine measures an idle machine.
#   Sizing a server from that is sizing it for a shop with nobody in it. The
#   figures that matter are the ones taken while requests are actually being
#   served, so this generates the requests and samples during them.
#
# WHAT THE WORKLOAD IS
#   A till shape, not a synthetic one-table hammer: look a product up, open a
#   sale, add lines to it, read the running daily total. Four requests per
#   iteration, through Caddy and PostgREST, with the anon key, exactly as the
#   browser does it.
#
# WHAT IT IS NOT
#   It is not a prediction of a trading day. It is one application, with
#   generated rows, on whatever machine this runs on. Every number it prints
#   is a measurement of that, and the sizing script states the headroom
#   factors it then applies rather than folding them in silently.
# ===========================================================================
set -uo pipefail

APP=""; BASE=""; KEY=""; CLIENTS=8; SECONDS_TO_RUN=60; PG_CONTAINER="central-postgres"
while [ $# -gt 0 ]; do
  case "$1" in
    --app) APP="${2:-}"; shift 2 ;;
    --base-url) BASE="${2:-}"; shift 2 ;;
    --key) KEY="${2:-}"; shift 2 ;;
    --clients) CLIENTS="${2:-8}"; shift 2 ;;
    --seconds) SECONDS_TO_RUN="${2:-60}"; shift 2 ;;
    --pg-container) PG_CONTAINER="${2:-central-postgres}"; shift 2 ;;
    -h|--help) sed -n '2,26p' "$0"; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done
[ -n "$APP" ] && [ -n "$BASE" ] && [ -n "$KEY" ] || {
  echo "--app, --base-url and --key are all required. --help shows an example." >&2; exit 2; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
pg() { docker exec "$PG_CONTAINER" psql -tAqX -U postgres -d "$1" -c "$2"; }

# ---------------------------------------------------------------------------
# A till-shaped schema. Created if absent, so this is safe to re-run and safe
# to point at an application that already has one.
# ---------------------------------------------------------------------------
pg "$APP" "
create table if not exists public.load_products (
  id serial primary key, sku text unique, name text, price numeric(10,2), stock int);
create table if not exists public.load_sales (
  id serial primary key, ref text, total numeric(12,2) default 0, at timestamptz default now());
create table if not exists public.load_sale_items (
  id serial primary key, sale_id int, product_id int, qty int, line numeric(12,2));
insert into public.load_products (sku, name, price, stock)
  select 'SKU-'||g, 'item '||g, (10+random()*400)::numeric(10,2), 500
  from generate_series(1,400) g
  on conflict (sku) do nothing;
create index if not exists load_items_sale on public.load_sale_items(sale_id);
create index if not exists load_sales_at on public.load_sales(at);
create or replace view public.load_daily as
  select date_trunc('day', at) as day, count(*) as sales, coalesce(sum(total),0) as total
  from public.load_sales group by 1;
grant select, insert, update on public.load_products, public.load_sales, public.load_sale_items to anon, authenticated, service_role;
grant select on public.load_daily to anon, authenticated, service_role;
grant usage, select on all sequences in schema public to anon, authenticated, service_role;
" >/dev/null 2>&1 || { echo "could not prepare the load schema in $APP" >&2; exit 1; }

# PostgREST caches the database schema at boot and reloads it on a NOTIFY.
# Without this every request below is a 404 against a table PostgREST does not
# know about -- which is exactly what happened: 27,124 requests, 444 per
# second, every one of them non-2xx, and a throughput figure that measured the
# speed of producing errors.
pg "$APP" "notify pgrst, 'reload schema'" >/dev/null 2>&1

# And then WAIT for it to have taken effect, rather than sleeping and hoping.
probe_url="$BASE/rest/v1/load_products?select=id&limit=1"
ready=0
for _ in $(seq 1 20); do
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 \
    -H "apikey: $KEY" -H "Authorization: Bearer $KEY" "$probe_url" 2>/dev/null || echo 000)"
  [ "$code" = "200" ] && { ready=1; break; }
  sleep 2
done
if [ "$ready" != "1" ]; then
  echo "the load tables are not reachable through $BASE (last HTTP ${code:-000})." >&2
  echo "PostgREST may not have reloaded its schema cache, or the key is wrong." >&2
  echo "Nothing was measured; a run of failed requests is not a load test." >&2
  exit 1
fi

NPROD="$(pg "$APP" "select count(*) from public.load_products" | tr -d ' ')"
# An empty count would make `RANDOM % NPROD` a division by zero inside every
# client, which fails one request at a time rather than once, visibly.
case "$NPROD" in ''|*[!0-9]*) echo "could not count load_products in $APP (got '${NPROD}')" >&2; exit 1 ;; esac
[ "$NPROD" -gt 0 ] || { echo "the load catalogue is empty; nothing to look up" >&2; exit 1; }
printf '\nLoad test\n'
printf '  application : %s\n' "$APP"
printf '  through     : %s\n' "$BASE"
printf '  workload    : %s concurrent client(s) for %ss, 4 requests per iteration\n' "$CLIENTS" "$SECONDS_TO_RUN"
printf '  catalogue   : %s products\n\n' "$NPROD"

H_KEY="apikey: $KEY"
H_AUTH="Authorization: Bearer $KEY"
H_JSON="Content-Type: application/json"

# ---------------------------------------------------------------------------
# One client: a loop of till iterations until the deadline. Each request's
# status and total time go to this client's own file, so there is no shared
# writer and no lock.
# ---------------------------------------------------------------------------
client() {
  local id="$1" deadline="$2" out="$WORK/c$1.txt" n=0 sku ref body sale_id
  while [ "$(date +%s)" -lt "$deadline" ]; do
    n=$((n+1))
    sku="SKU-$(( (RANDOM % NPROD) + 1 ))"
    ref="L${id}-${n}-$$"

    # 1. look the product up, as the till does when a barcode is scanned
    curl -s -o "$WORK/p$id.json" -w "lookup %{http_code} %{time_total}\n" \
      -H "$H_KEY" -H "$H_AUTH" \
      "$BASE/rest/v1/load_products?sku=eq.$sku&select=id,price,stock" >> "$out"

    # 2. open the sale
    body="$(printf '{"ref":"%s","total":0}' "$ref")"
    curl -s -o "$WORK/s$id.json" -w "open-sale %{http_code} %{time_total}\n" \
      -X POST -H "$H_KEY" -H "$H_AUTH" -H "$H_JSON" -H "Prefer: return=representation" \
      -d "$body" "$BASE/rest/v1/load_sales" >> "$out"
    sale_id="$(sed -n 's/.*"id":\([0-9]*\).*/\1/p' "$WORK/s$id.json" | head -1)"

    # 3. add two lines to it
    if [ -n "$sale_id" ]; then
      body="$(printf '[{"sale_id":%s,"product_id":1,"qty":2,"line":40.00},{"sale_id":%s,"product_id":2,"qty":1,"line":15.50}]' "$sale_id" "$sale_id")"
      curl -s -o /dev/null -w "add-items %{http_code} %{time_total}\n" \
        -X POST -H "$H_KEY" -H "$H_AUTH" -H "$H_JSON" \
        -d "$body" "$BASE/rest/v1/load_sale_items" >> "$out"
    else
      printf 'add-items 000 0\n' >> "$out"
    fi

    # 4. read the running total, which is the aggregate a shop screen shows
    curl -s -o /dev/null -w "daily-total %{http_code} %{time_total}\n" \
      -H "$H_KEY" -H "$H_AUTH" "$BASE/rest/v1/load_daily?select=day,sales,total" >> "$out"
  done
}

# ---------------------------------------------------------------------------
# Sample container stats every 3s DURING the load, and keep the peak per
# container. `docker stats --no-stream` is a point sample; one taken before
# the load starts is the number this whole script exists to avoid.
# ---------------------------------------------------------------------------
sampler() {
  local deadline="$1"
  while [ "$(date +%s)" -lt "$deadline" ]; do
    docker stats --no-stream --format '{{.Name}}|{{.MemUsage}}|{{.CPUPerc}}' 2>/dev/null \
      >> "$WORK/stats.raw"
    sleep 3
  done
}

START="$(date +%s)"
DEADLINE=$(( START + SECONDS_TO_RUN ))
sampler "$DEADLINE" & SAMPLER_PID=$!
i=1
while [ "$i" -le "$CLIENTS" ]; do client "$i" "$DEADLINE" & i=$((i+1)); done
wait $SAMPLER_PID 2>/dev/null
wait
ELAPSED=$(( $(date +%s) - START ))
[ "$ELAPSED" -gt 0 ] || ELAPSED=1

cat "$WORK"/c*.txt > "$WORK/all.txt" 2>/dev/null
TOTAL="$(wc -l < "$WORK/all.txt" | tr -d ' ')"
[ "${TOTAL:-0}" -gt 0 ] || { echo "no request was completed; the base URL may be wrong" >&2; exit 1; }
GOOD="$(awk '$2 ~ /^2/ {n++} END {print n+0}' "$WORK/all.txt")"
BAD=$(( TOTAL - GOOD ))

printf '  %-14s %8s %8s %9s %9s %9s\n' "REQUEST" "COUNT" "OK" "p50 ms" "p95 ms" "max ms"
for kind in lookup open-sale add-items daily-total; do
  awk -v k="$kind" '$1==k {print $3}' "$WORK/all.txt" | sort -n > "$WORK/t.txt"
  c="$(wc -l < "$WORK/t.txt" | tr -d ' ')"
  [ "${c:-0}" = "0" ] && continue
  okc="$(awk -v k="$kind" '$1==k && $2 ~ /^2/ {n++} END {print n+0}' "$WORK/all.txt")"
  p50="$(awk -v n="$c" 'NR==int((n*0.50)+0.5){printf "%.0f", $1*1000}' "$WORK/t.txt")"
  p95="$(awk -v n="$c" 'NR==int((n*0.95)+0.5){printf "%.0f", $1*1000}' "$WORK/t.txt")"
  mx="$(tail -1 "$WORK/t.txt" | awk '{printf "%.0f", $1*1000}')"
  printf '  %-14s %8s %8s %9s %9s %9s\n' "$kind" "$c" "$okc" "${p50:-0}" "${p95:-0}" "${mx:-0}"
done
printf '\n  %s requests in %ss = %s requests/second, %s non-2xx\n' \
  "$TOTAL" "$ELAPSED" "$(( TOTAL / ELAPSED ))" "$BAD"
if [ "$GOOD" = "0" ]; then
  printf '\n  NOTHING SUCCEEDED. The figures above are the speed of producing\n'
  printf '  errors and measure nothing about this platform. Treat the whole run\n'
  printf '  as failed rather than reading the latency columns.\n'
fi
SALES="$(pg "$APP" "select count(*) from public.load_sales" | tr -d ' ')"
ITEMS="$(pg "$APP" "select count(*) from public.load_sale_items" | tr -d ' ')"
printf '  rows written: %s sales, %s sale lines\n' "$SALES" "$ITEMS"

# Peak per container across every sample taken during the load.
printf '\n  PEAK container usage DURING the load (not at rest)\n'
printf '  %-28s %10s %9s\n' "CONTAINER" "PEAK MEM" "PEAK CPU"
awk -F'|' '
  { name=$1
    mem=$2; sub(/ *\/.*/, "", mem)
    v=mem+0
    if (mem ~ /GiB/) v*=1024; else if (mem ~ /KiB/) v/=1024
    cpu=$3; sub(/%/, "", cpu)
    if (v > m[name]) m[name]=v
    if (cpu+0 > c[name]) c[name]=cpu+0 }
  END { for (n in m) printf "  %-28s %7.1fMiB %8.1f%%\n", n, m[n], c[n] }
' "$WORK/stats.raw" | sort -k2 -hr

NSAMP="$(grep -c . "$WORK/stats.raw" 2>/dev/null || echo 0)"
printf '\n  %s stat sample(s) taken while requests were in flight.\n' "$NSAMP"
printf '  One application, generated rows, on this machine. Not a trading day.\n\n'
[ "$BAD" = "0" ] || exit 1
