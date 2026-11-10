-- ============================================================================
-- EVERYTINROOM POS — 032: CLOSE THE LEDGER
--
-- ⚠️  RUN THIS ONLY AFTER:
--       1. migration 031 has run, AND
--       2. the frontend that calls list_sales / find_sale_by_receipt is
--          deployed and you have confirmed sales still appear on the Reports
--          and Receipts pages.
--
--     The frontend falls back to reading the sales table directly when
--     list_sales is missing. That fallback is what makes 031 safe to run
--     early — but if you run 032 while a till is still on the fallback, it
--     will quietly read one day of sales instead of failing, and every report
--     will look wrong rather than broken. Wrong is worse than broken here.
--
-- This replaces migration 004's `sales_select ... USING (true)`, which made the
-- shop's whole sales history readable with the public anon key.
--
-- WHY A WINDOW RATHER THAN NO ACCESS AT ALL
--
-- `sales` is in the supabase_realtime publication (001), and the till
-- subscribes to INSERTs to pop the sale confirmation, play the till sound and
-- send the thank-you to the customer display. Realtime applies RLS as the
-- subscribing role, so revoking SELECT from anon outright does not merely
-- close the ledger — it silently stops those events and the counter loses its
-- sale confirmation.
--
-- So anon keeps the narrowest read that keeps realtime working: today and
-- yesterday. The exposure goes from "every sale the shop has ever made" to
-- "the current day's takings", and everything older is reachable only through
-- the session-gated functions. Closing the remaining window means moving the
-- sale notification onto Realtime Broadcast from a trigger, which is a
-- separate piece of work and not a security fix on its own.
-- ============================================================================

DROP POLICY IF EXISTS "sales_select" ON sales;

-- Two days, not one: a sale rung up at 23:58 must still be readable by the
-- till that is reconciling at 00:05, and `date` is a timestamptz compared in
-- UTC while the shop trades in Accra.
CREATE POLICY "sales_select_recent" ON sales
  FOR SELECT TO anon, authenticated
  USING (date >= current_date - interval '1 day');

-- Reads of anything older go through list_sales / find_sale_by_receipt, which
-- check the staff session. Writes were already closed: INSERT is through
-- record_sale (019/027), UPDATE was revoked in 028 and DELETE in 021.

-- ---------------------------------------------------------------------------
-- Verification — run these after applying, as the anon role.
--
--   -- should return only the last two days
--   SELECT count(*), min(date) FROM sales;
--
--   -- should return the full recent history for a valid admin token
--   SELECT count(*) FROM list_sales('<a-valid-token>', 300);
--
--   -- should return nothing at all
--   SELECT count(*) FROM list_sales('not-a-real-token', 300);
-- ---------------------------------------------------------------------------
