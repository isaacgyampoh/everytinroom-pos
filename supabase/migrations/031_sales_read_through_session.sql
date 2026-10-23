-- ============================================================================
-- EVERYTINROOM POS — 031: READING THE BOOKS NEEDS A SESSION
--
-- `sales_select` has been `FOR SELECT TO anon USING (true)` since migration
-- 004. The anon key it answers to is compiled into the browser bundle, so this
-- was never "a cashier can see too much" — it was the shop's entire sales
-- ledger, readable by anyone who opened devtools on the storefront and copied
-- the key: every transaction, every total, every customer name, for all time.
--
-- 019 and 021 took the margins out of reach (profit moved server-side,
-- costPrice stripped from historical receipt lines), which is why this is the
-- last of the first audit's findings rather than the first. It is still the
-- whole ledger.
--
-- The till cannot simply be given a scoped RLS policy: sign-in is a PIN that
-- issues a row in `staff_sessions`, not Supabase Auth, so Postgres sees the
-- `anon` role for every cashier and `auth.uid()` is meaningless. RLS cannot
-- tell one cashier from another here. Reads therefore go the same way every
-- other privileged operation already goes — a SECURITY DEFINER function that
-- takes the session token.
--
-- THIS MIGRATION IS ADDITIVE. It only adds functions; nothing is taken away
-- and nothing breaks if the frontend has not been deployed yet. Migration 032
-- is the one that closes the table, and it must not be run until the frontend
-- is deployed and these functions are answering.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- list_sales — the till's and the reports' read path.
--
-- No session, no rows: an expired or absent token returns nothing rather than
-- an error, so a till whose shift ended shows an empty list instead of a
-- failure a cashier cannot act on.
--
-- Profit and costPrice follow the same rule the frontend already applies in
-- canSeeCost(): admins and staff with `reports` or `inventory_view`. For
-- everyone else profit comes back 0 and costPrice is stripped from the items,
-- so the margin sheet is not reachable through the receipt lines.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION list_sales(p_token TEXT, p_limit INT DEFAULT 300)
RETURNS TABLE (
  id          TEXT,
  receipt_no  TEXT,
  date        TIMESTAMPTZ,
  items       JSONB,
  subtotal    NUMERIC,
  discount    NUMERIC,
  total       NUMERIC,
  profit      NUMERIC,
  payment     TEXT,
  split_cash  NUMERIC,
  split_momo  NUMERIC,
  customer    TEXT,
  type        TEXT,
  cashier     TEXT,
  voided      BOOLEAN
) AS $$
DECLARE
  me       staff;
  see_cost BOOLEAN;
BEGIN
  me := session_staff(p_token);
  IF me.id IS NULL THEN RETURN; END IF;

  see_cost := session_can(p_token, 'reports') OR session_can(p_token, 'inventory_view');

  RETURN QUERY
  SELECT
    s.id,
    s.receipt_no,
    s.date,
    CASE WHEN see_cost THEN s.items
         ELSE COALESCE((
           SELECT jsonb_agg(it - 'costPrice' ORDER BY ord)
             FROM jsonb_array_elements(s.items) WITH ORDINALITY AS t(it, ord)
         ), '[]'::jsonb)
    END,
    s.subtotal,
    s.discount,
    s.total,
    CASE WHEN see_cost THEN s.profit ELSE 0::numeric END,
    s.payment,
    s.split_cash,
    s.split_momo,
    s.customer,
    s.type,
    s.cashier,
    s.voided
  FROM sales s
  ORDER BY s.date DESC
  -- Bounded server-side: the limit is a client-supplied number and this is the
  -- shop's ledger, so a caller cannot ask for all of it in one go.
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 300), 1000));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION list_sales(text, int) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- find_sale_by_receipt — the refund desk looking up one receipt.
--
-- RefundsPage used to read the table directly to show the lines for selection.
-- It needs to reach a sale of any age, which is exactly what 032 closes, so it
-- gets its own gated lookup. Gated on `refunds`, the same permission
-- process_refund itself checks, so the lookup cannot be used as a way around
-- it to browse the ledger one receipt at a time.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION find_sale_by_receipt(p_token TEXT, p_receipt_no TEXT)
RETURNS JSONB AS $$
DECLARE
  s        sales;
  stripped JSONB;
BEGIN
  IF NOT session_can(p_token, 'refunds') THEN
    RETURN jsonb_build_object('success', false,
      'error', 'You do not have permission to process refunds');
  END IF;

  SELECT * INTO s FROM sales WHERE receipt_no = p_receipt_no;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Sale not found');
  END IF;

  -- A refund needs the lines and what was paid, never the cost. process_refund
  -- recomputes stock and profit server-side from the products table.
  stripped := COALESCE((
    SELECT jsonb_agg(it - 'costPrice' ORDER BY ord)
      FROM jsonb_array_elements(s.items) WITH ORDINALITY AS t(it, ord)
  ), '[]'::jsonb);

  RETURN jsonb_build_object('success', true, 'sale', jsonb_build_object(
    'id',         s.id,
    'receipt_no', s.receipt_no,
    'date',       s.date,
    'items',      stripped,
    'subtotal',   s.subtotal,
    'discount',   s.discount,
    'total',      s.total,
    'payment',    s.payment,
    'customer',   s.customer,
    'type',       s.type,
    'cashier',    s.cashier,
    'voided',     s.voided
  ));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION find_sale_by_receipt(text, text) TO anon, authenticated;
