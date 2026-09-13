-- ============================================================================
-- EVERYTINROOM POS — 028: A SALE TOTAL IS NOT CLIENT-WRITABLE
--
-- `sales_update` was still FOR UPDATE TO anon USING (true) from migration 004.
-- With nothing but the public key — which ships in every client — a PATCH on
-- /rest/v1/sales returned 204. Anyone could rewrite the total, the profit or
-- the cashier on any sale in the books.
--
-- Nothing in the application updates a sale. Voiding goes through void_sale and
-- refunding through process_refund, both of which check a session token. So
-- this takes the capability away without touching a single working path.
-- ============================================================================

DROP POLICY IF EXISTS "sales_update" ON sales;
REVOKE UPDATE ON sales FROM anon, authenticated;

-- Verify: PATCH /rest/v1/sales must return 401 for the anon role.
