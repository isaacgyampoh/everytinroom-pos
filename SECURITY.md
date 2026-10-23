# Security — read this before the next deploy

This repository is **public on GitHub**, and it has been carrying live
credentials in its source. Everything in "Rotate now" below has already been
readable by anyone who found the repo, and is still readable in the git history
even after the code changes in this commit. Removing a secret from a file does
not remove it from history — **the only fix is to rotate the credential.**

---

## Rotate now

| Credential | Where it leaked | What an attacker could do with it |
|---|---|---|
| **Every staff PIN, incl. Admin** | `staff` table was readable with the public anon key | Sign in to the POS as Admin |
| Admin PIN `1024` | written in plain text in `supabase/migrations/008_admin_serverside.sql` | Same, without even querying |
| NaloPay API key + Basic auth header | hardcoded in `supabase/functions/charge-momo/index.ts` | Collect payments through the shop's merchant account |
| Nalo SMS username + password | hardcoded in the same file | Send SMS billed to the shop, from the shop's sender ID |
| Supabase anon key | `src/lib/supabase.js` (public **by design**) | Nothing extra once RLS is correct — see below |

The anon key is *meant* to be public. It only became dangerous because the
row-level security policies let it read the PIN column and write every table.
Migration `015` fixes that; do not treat rotating the anon key as a substitute
for running it.

### Steps

1. **Make the GitHub repo private** (Settings → General → Danger Zone), or
   accept that everything above stays permanently visible in the history.
2. **Run every migration from `015` to `031`**, in numerical order, in the
   Supabase SQL editor. **`032` is deliberately not in that list** — it closes
   the `sales` table and must be run only after the frontend that reads through
   `list_sales` is deployed and verified. Its header says how to check. Running
   it early does not break the till loudly; it makes every report quietly
   wrong, which is worse. Order matters: `018` hashes the PINs using the session
   machinery `015` sets up, and `020` rebuilds a view `019` creates.
   **Do not stop at `020`** — `021` is the migration that closes the tables
   behind the approval functions, and without it the gated functions can simply
   be skipped. **Deploy the frontend only after they have all run** — the new
   code calls `save_staff`, `end_session`, `next_ussd_code` and
   `find_by_barcode`, which do not exist until then.

   The frontend tolerates a half-migrated database rather than dying on it:
   `src/lib/rpc.js` falls back to the pre-migration signature when a function
   is genuinely missing, and only then — a real "Not authorised" is never
   bypassed. That is a safety net for a deploy that gets ahead of the SQL, not
   a reason to leave migrations unrun.
3. **Change every staff PIN** from Staff & Roles. Do this *after* 015, so the
   new PINs are never exposed. Pick PINs that are not `1024`.
4. **Rotate the NaloPay keys** in the NaloPay dashboard, then:
   ```
   supabase secrets set NALOPAY_MERCHANT_ID=... NALOPAY_API_KEY=... NALOPAY_AUTH_HEADER=...
   ```
5. **Change the Nalo SMS password**, then:
   ```
   supabase secrets set NALO_SMS_USERNAME=... NALO_SMS_PASSWORD=... NALO_SMS_SENDER=EverytinRm
   ```
6. **Set the task secret** so the report/reminder endpoints stop being open:
   ```
   openssl rand -hex 32          # put this value in migration 017, then:
   supabase secrets set TASK_SECRET=<same value>
   ```
7. **Redeploy the edge functions:**
   ```
   supabase functions deploy charge-momo
   supabase functions deploy paystack-webhook
   ```
8. **Check the Paystack secret key is set** — webhook signature verification
   now depends on it, and without it every webhook is rejected:
   ```
   supabase secrets list | grep PAYSTACK
   ```
9. **Review recent activity** for anything the exposure may already have cost
   you: unexpected `Paid` orders with no matching money, sales you don't
   recognise, staff rows you didn't create.
   ```sql
   SELECT order_no, total, status, paid_at, paystack_ref
     FROM whatsapp_orders WHERE status = 'Paid' ORDER BY paid_at DESC LIMIT 50;
   SELECT id, name, role, active FROM staff;
   ```

---

## Rules going forward

- **No credential ever goes in a source file.** Edge functions read from
  `Deno.env.get(...)` with no hardcoded fallback. A missing secret now logs
  `MISSING SECRET:` at startup rather than silently using a committed key.
- **The anon key can do only what RLS lets it do.** Assume every table policy
  is being read by a stranger, because it is. Anything sensitive belongs behind
  a `SECURITY DEFINER` function that checks a session token.
- **Permission checks in the browser are a convenience, not a control.** The
  nav hiding a button stops an honest cashier, not someone with the anon key
  and a terminal. Anything that must be enforced is enforced in SQL.
- **Webhooks are verified before they are believed.** Both Paystack handlers
  now check the HMAC-SHA512 signature over the raw body. An unverified webhook
  that marks an order `Paid` is a way to take goods for free.

---

## Closed since the first audit

- **Privileged RPCs now check a session, not a string.** `process_refund`,
  `void_sale`, `complete_wa_order`, `approve_receiving` and `approve_stock_take`
  take the token issued by `verify_pin` and refuse to act without the matching
  permission. The "who did it" field comes from the session too, so a refund can
  no longer be filed under someone else's name.
- **PINs are hashed** (bcrypt via pgcrypto) and the plaintext column is dropped
  once every active staff member has a hash. A database dump no longer hands
  over the logins.
- **Cost prices and profit stay on the server.** `record_sale` reads cost from
  the products table, so a till never needs them — cashiers now load from a
  `products_sale` view that has no cost column, and `costPrice` is stripped from
  the line items before a sale is filed. This also closed a spoofing hole: a
  cart posted with `costPrice = price` used to record a sale at zero profit.
- **Refunds have their own permission** (`refunds`), enforced in the page guard,
  the nav, and the RPC itself. Existing staff who could already sell keep it, so
  nothing stops working mid-trading — revoke it deliberately from Staff & Roles.

- **The tables behind the gated functions are no longer writable.** `018`
  gated the approval *functions*, but the tables were still `FOR ALL USING
  (true)`, so the anon key could skip the function and `UPDATE receivings SET
  status='approved'` or forge rows in `stock_ledger` — an audit ledger anyone
  can write to is not an audit ledger. `021` revokes INSERT/UPDATE/DELETE on
  `stock_ledger`, `receivings`, `suppliers` and `stock_adjustments`, leaves
  `receivings` insertable only with `status = 'pending'`, and adds
  `reject_receiving` so rejecting a delivery is attributed instead of being a
  direct table write. `028` revoked UPDATE on `sales`, which `004` had left
  open — sale totals were editable with the public key.
- **Historical cost prices are out of the receipt lines.** `021` §7 runs the
  `UPDATE` that strips `costPrice` from every pre-`019` row in `sales.items`.
  It is no longer an optional step you have to remember; it fires with the
  migration.

## Known gaps still open

- **The `sales` table is readable with the anon key until you run `032`.**
  `sales_select` has been `FOR SELECT TO anon USING (true)` since `004`. The
  anon key ships in the browser bundle, so this is not "a cashier sees too
  much" — it is the whole ledger, readable by anyone who copies the key out of
  devtools. Margins are already out of reach (`019`, `021`); the transactions
  are not.

  `031` adds the fix and `032` applies it: reads go through `list_sales` and
  `find_sale_by_receipt`, which require a staff session, and the table keeps
  only a two-day window for the anon role. **The window is not laziness** —
  `sales` is in the `supabase_realtime` publication and the till subscribes to
  INSERTs for the sale confirmation, the till sound and the customer display;
  Realtime applies RLS as the subscribing role, so revoking SELECT outright
  stops those events silently. Closing the last two days means moving the sale
  notification to Realtime Broadcast from a trigger — a separate job, and not a
  security fix by itself.

  Why a function and not a per-cashier RLS policy: sign-in is a PIN that issues
  a row in `staff_sessions`, not Supabase Auth, so Postgres sees `anon` for
  every cashier and `auth.uid()` is meaningless. RLS cannot tell cashiers apart
  here.

Everything else from the first audit is closed; see the section above. Two
items once listed here as open had in fact been closed by migration `021` — if
you are working from an older copy of this file, check the migrations before
redoing the work.
