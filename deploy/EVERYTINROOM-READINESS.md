# Everytinroom — migration readiness

Status of the first project to move. Updated 2026-11-08.

Everything here is either **verified** (a command was run and its result
recorded) or **not claimed**. Where something has only been written and not
executed, it says so.

Security items with live detail are tracked in local operator files outside
this repository, which is public. They are referred to here by name only.

---

## Verified

### The shop still works
- Both sites serve: `www.everytinroom.store` and `www.erbliving.shop`, HTTP 200
  after every change made today.
- The till's real data paths answer with the public key: `products`,
  `whatsapp_orders`, `sales` all HTTP 200.
- The payments function answers: `charge-momo` HTTP 200.
- `verify_pin` resolves and returns a result when probed with its real
  argument set.
- 167 of 167 application tests pass.

### Records preserved
Row counts for orders, sales, customers, USSD sessions and refunds were
taken before and after every production change and compared. All matched.
Nothing was deleted at any point. The figures are in the local operator
notes rather than here.

### The WhatsApp agent is gone
Three empty tables and one reader function dropped behind a guard that was
tested against four separate abort conditions before use. The deployed agent
was found under the slug `smart-function` — not `wa-agent`, which does not
exist as a deployment — identified by diffing the downloaded bundle against
the repository source. Its endpoint now returns 404 while `charge-momo` still
returns 200. Four of the five credentials named for revocation turned out
never to have been set; the one that existed was revoked after confirming no
surviving function reads it.

### Database privileges corrected
TRUNCATE removed from every application-facing role on all 26 objects, and
DELETE removed from the browser-facing roles on the eight tables the
application never deletes from. `postgres` keeps everything, so migrations are
unaffected. 84 grants removed, 0 added, and the rollback script contains
exactly 84 GRANT statements — it restores precisely what was taken. Verified
directly in PostgreSQL and by 13 workflow probes using filters that match no
rows, so nothing was written during testing.

### Schema reconciled
Production has 24 base tables, 41 functions, 40 policies across 24 RLS tables,
3 triggers, 57 indexes, 7 extensions, 6 cron jobs, 20 MB of data.

`PENDING-1-additive.sql` was checked against the live database rather than
assumed: all six functions it creates are absent today, the `channel` column
is absent from both tables, every helper it calls exists (`session_staff`,
`session_can`, `next_ussd_code`, `gen_random_uuid`), all 15 `sales` columns it
returns exist, all 14 `whatsapp_orders` columns it writes exist, and no
NOT NULL column without a default is left unset. It adds only; it changes no
data and revokes nothing.

### Storage inventoried
1,112 objects, 1 GB, across three prefixes — `_test/` (3), `enhanced/` (413,
504 MB), `products/` (696, 566 MB). 574 are referenced by a product row, 446
are not, and 32 product rows point at files that are not in the bucket. Those
32 have Cloudinary-style names, which independently confirms by a second route
that those images were lost when Cloudinary stopped serving them.

---

## Known hazards for the cutover

Each of these is a way the migration can appear to succeed and be wrong.

1. **Two cron jobs hardcode the old project URL inside the job body.** After
   cutover they keep calling the old backend and nothing errors — the reports
   simply come from the wrong place. The other four call SQL functions that
   contain no URL and migrate unchanged. (An earlier claim that all six
   carried the URL was wrong.)

2. **Live cron has drifted from the migration files.** The live job names
   (`sms-morning`, `etr-report-monthly`) do not match the files
   (`morning-report`), and there is **no `supabase_migrations` schema at all**.
   The live database is the only authoritative source: migrate from a dump,
   never by replaying migration files.

3. **The edge functions have a hardcoded fallback to the old project.**
   `charge-momo` reads `SUPABASE_URL` with the old project URL as its default.
   If that variable is not set on the new server, the function silently talks
   to the old backend.

4. **Their imports are fetched at runtime.** `deno.land/std@0.168.0` and
   `esm.sh/@supabase/supabase-js@2` — the latter unpinned within v2. A server
   without egress to those hosts will start the runtime and fail every
   request. The supabase-js import should be pinned to an exact version before
   cutover.

5. **The committed desktop bundle has the old URL baked in.**
   `desktop/app/assets/index-*.js` is a build artifact in the repository; the
   desktop app needs rebuilding, not just redeploying.

6. **Realtime's tenant comes from the Host header.** Get the proxy header
   wrong and subscriptions connect, authenticate, and silently deliver
   nothing — no error anywhere. The four published tables are `products`,
   `sales`, `store_settings` and `whatsapp_orders`.

---

## Blocked, and on what

| Needs | Why |
|---|---|
| `SUPABASE_DB_URL` | the database password, from Settings → Database. Required to dump the production database. Read from the environment, never stored. |
| Cloudflare R2 bucket + API token | until set, storage starts and every upload fails |
| Each function's own secrets | payment and SMS credentials cannot be read back out of the platform; they must be set by hand on the new server |
| a payment-provider credential | one is missing, which leaves a server-side verification step inactive. Named, explained and sequenced in the local operator notes, kept out of this repository. |
| A server | nothing has been bought, and that is the last step |

---

## Not proven

- **No dump of this database has been restored anywhere.** The platform's
  backup and restore is tested with generated data on a throwaway machine;
  that is the platform, not this shop's records.
- **The application has not been pointed at the platform.** No build has run
  against a self-hosted API.
- **Realtime has not been tested with these four tables.** It is tested with a
  table created for the purpose.
- **Image uploads have not been tested against R2.** They are tested against
  an S3-compatible stand-in, which proves our configuration and not
  Cloudflare's behaviour.
- **No VPS deployment has happened.** Every integration test runs on a
  disposable GitHub runner.

---

## The order to do it in

1. Apply `PENDING-1-additive.sql` (additive, reconciled, reversible by
   dropping six functions and one column).
2. Close the payment-verification path, in the order given in the local
   operator notes. The order matters: done the wrong way round it stops
   online payments being recorded at all.
3. Buy and bootstrap the server.
4. Provision `everytinroom` with realtime, storage and functions — not auth;
   it has no `auth.users` and signs staff in with a PIN.
5. Copy the database with `migrate-from-supabase.sh` and read the
   reconciliation.
6. Copy the images to R2 with `migrate-storage.py`, verified, source kept.
7. Translate the six cron jobs, fixing the two URLs.
8. Set every function secret, and pin the supabase-js import.
9. Point a staging build of the frontend at the new API and use the till.
10. Only then change DNS. The old backend keeps running, so the rollback is to
    put the old URL back and redeploy.
