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
2. **Run the migrations** `015` → `016` → `017` → `018` → `019` → `020`, in
   that order, in the Supabase SQL editor. Order matters: `018` hashes the PINs
   using the session machinery `015` sets up, and `020` rebuilds a view `019`
   creates. **Deploy the frontend only after they have all run** — the new code
   calls `save_staff`, `end_session`, `next_ussd_code` and `find_by_barcode`,
   which do not exist until then.
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

## Known gaps still open

- **`sales.items` on historical rows still contains cost prices.** Migration
  `019` ends with a one-line `UPDATE` to strip them, left commented out because
  it rewrites history. Run it when you are ready.
- **`stock_ledger`, `receivings` and `suppliers` still carry `USING (true)`
  policies**, so the anon key can read and write those tables directly even
  though the approval *functions* are now gated. Tighten them the same way
  `staff` was tightened in `015`.
- **The `sales` table is readable by every till.** A cashier can still read the
  shop's whole sales history, just not its margins.
