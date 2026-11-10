-- ============================================================================
-- EVERYTINROOM POS — 027: PROFIT STOPS CLAIMING TO BE ACCURATE
--
-- 445 of 665 products carry no cost price. A product with cost 0 records its
-- whole selling price as profit, so over the last 90 days 56% of takings —
-- GHS 226,964 of GHS 401,814 — contributed pure revenue dressed as margin. The
-- dashboard already warns about this, but the figure itself was still a number
-- somebody could write down and act on.
--
-- Each sale now records whether every line behind it had a real cost. Reports
-- can then separate what is measured from what is merely assumed, without
-- anybody re-deriving it by joining old receipts back to the product table.
--
-- This changes NO selling behaviour. A product with no cost still sells.
-- ============================================================================

ALTER TABLE sales ADD COLUMN IF NOT EXISTS profit_complete BOOLEAN;
COMMENT ON COLUMN sales.profit_complete IS
  'True when every line had a real cost price, so `profit` is trustworthy. '
  'False when at least one line had none and its whole price counted as profit. '
  'Null for sales recorded before this column existed.';

CREATE INDEX IF NOT EXISTS idx_sales_profit_complete
  ON sales (date DESC) WHERE NOT voided AND profit_complete;

-- Backfill history by asking the product table what it knows now. A sale whose
-- products have since been given costs still recorded the old zero, so this is
-- a statement about the DATA BEHIND the sale, not a recalculation of it.
-- Eleven website sales arrived double-encoded: a JSON string containing the
-- array. Server code uses jsonb_array_elements, so a refund against one would
-- have errored and stock_insights silently skipped its lines. Decode first.
UPDATE sales
   SET items = (items #>> '{}')::jsonb
 WHERE jsonb_typeof(items) = 'string'
   AND jsonb_typeof((items #>> '{}')::jsonb) = 'array';

UPDATE sales s
   SET profit_complete = NOT EXISTS (
     SELECT 1
       FROM jsonb_array_elements(s.items) i
       LEFT JOIN products p ON p.id = NULLIF(i->>'productId', '')
      WHERE p.id IS NULL OR COALESCE(p.cost_price, 0) <= 0
   )
 WHERE s.profit_complete IS NULL AND jsonb_typeof(s.items) = 'array';

-- ---------------------------------------------------------------------------
-- record_sale stamps it going forward.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION record_sale(
  p_items JSONB, p_customer TEXT, p_payment TEXT, p_discount NUMERIC,
  p_type TEXT, p_cashier TEXT,
  p_split_cash NUMERIC DEFAULT 0, p_split_momo NUMERIC DEFAULT 0,
  p_terminal TEXT DEFAULT '', p_client_ref TEXT DEFAULT NULL
) RETURNS JSON AS $$
DECLARE
  v_id TEXT; v_receipt TEXT;
  v_subtotal NUMERIC := 0; v_profit NUMERIC := 0;
  v_total NUMERIC; v_discount NUMERIC;
  v_item JSONB; v_qty INTEGER; v_bundle_item JSONB;
  v_cost NUMERIC; v_have INTEGER;
  v_short JSONB := '[]'::jsonb;
  v_complete BOOLEAN := true;
  v_existing RECORD;
BEGIN
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RETURN json_build_object('success', false, 'error', 'Cannot record an empty sale');
  END IF;

  IF p_client_ref IS NOT NULL AND p_client_ref <> '' THEN
    SELECT id, receipt_no, total, discount INTO v_existing
      FROM sales WHERE client_ref = p_client_ref LIMIT 1;
    IF FOUND THEN
      RETURN json_build_object('success', true, 'duplicate', true,
        'receiptNo', v_existing.receipt_no, 'saleId', v_existing.id,
        'total', v_existing.total, 'discount', v_existing.discount,
        'oversold', '[]'::jsonb, 'date', now());
    END IF;
  END IF;

  v_id := short_id();
  v_receipt := generate_receipt_no();

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_subtotal := v_subtotal + COALESCE((v_item->>'lineTotal')::NUMERIC, 0);
    v_qty := COALESCE((v_item->>'qty')::INTEGER, 0);
    v_cost := 0;
    IF (v_item->>'isBundle')::BOOLEAN IS TRUE AND v_item->'bundleItems' IS NOT NULL THEN
      SELECT COALESCE(SUM(p.cost_price * COALESCE((bi->>'qty')::INTEGER, 0)), 0) INTO v_cost
        FROM jsonb_array_elements(v_item->'bundleItems') bi
        JOIN products p ON p.id = bi->>'productId';
    ELSIF NULLIF(v_item->>'productId', '') IS NOT NULL THEN
      SELECT COALESCE(cost_price, 0) INTO v_cost FROM products WHERE id = v_item->>'productId';
      v_cost := COALESCE(v_cost, 0);
    END IF;
    -- A line with no cost makes the whole sale's profit an overstatement.
    IF v_cost <= 0 THEN v_complete := false; END IF;
    v_profit := v_profit + (COALESCE((v_item->>'price')::NUMERIC, 0) - v_cost) * v_qty;
  END LOOP;

  v_discount := LEAST(GREATEST(COALESCE(p_discount, 0), 0), v_subtotal);
  v_total := v_subtotal - v_discount;
  v_profit := v_profit - v_discount;

  BEGIN
    INSERT INTO sales (id, receipt_no, date, items, subtotal, discount, total, profit,
      payment, split_cash, split_momo, customer, type, cashier, voided, terminal,
      client_ref, profit_complete)
    VALUES (v_id, v_receipt, now(), p_items, v_subtotal, v_discount, v_total, v_profit,
      p_payment, COALESCE(p_split_cash, 0), COALESCE(p_split_momo, 0),
      p_customer, p_type, p_cashier, false, COALESCE(p_terminal, ''),
      NULLIF(p_client_ref, ''), v_complete);
  EXCEPTION WHEN unique_violation THEN
    SELECT id, receipt_no, total, discount INTO v_existing
      FROM sales WHERE client_ref = p_client_ref LIMIT 1;
    IF FOUND THEN
      RETURN json_build_object('success', true, 'duplicate', true,
        'receiptNo', v_existing.receipt_no, 'saleId', v_existing.id,
        'total', v_existing.total, 'discount', v_existing.discount,
        'oversold', '[]'::jsonb, 'date', now());
    END IF;
    RAISE;
  END;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    IF (v_item->>'isBundle')::BOOLEAN IS TRUE AND v_item->'bundleItems' IS NOT NULL THEN
      FOR v_bundle_item IN SELECT * FROM jsonb_array_elements(v_item->'bundleItems') LOOP
        v_qty := COALESCE((v_bundle_item->>'qty')::INTEGER, 0) * COALESCE((v_item->>'qty')::INTEGER, 1);
        UPDATE products SET quantity = GREATEST(0, quantity - v_qty)
        WHERE id = v_bundle_item->>'productId';
      END LOOP;
    ELSIF v_item->>'productId' IS NOT NULL THEN
      v_qty := COALESCE((v_item->>'qty')::INTEGER, 0);
      SELECT quantity INTO v_have FROM products WHERE id = v_item->>'productId' FOR UPDATE;
      IF FOUND AND v_have < v_qty THEN
        v_short := v_short || jsonb_build_object('name', v_item->>'name', 'wanted', v_qty, 'had', v_have);
      END IF;
      UPDATE products SET quantity = GREATEST(0, quantity - v_qty)
      WHERE id = v_item->>'productId';
    END IF;
  END LOOP;

  IF p_customer IS NOT NULL AND p_customer <> 'Walk-in' AND p_customer <> '' THEN
    INSERT INTO customers (phone, visit_count, total_spent, last_visit)
    VALUES (p_customer, 1, v_total, now())
    ON CONFLICT (phone) DO UPDATE SET
      visit_count = customers.visit_count + 1,
      total_spent = customers.total_spent + v_total,
      last_visit = now();
  END IF;

  RETURN json_build_object(
    'success', true, 'duplicate', false,
    'receiptNo', v_receipt, 'saleId', v_id,
    'subtotal', v_subtotal, 'discount', v_discount, 'total', v_total,
    'profitComplete', v_complete, 'oversold', v_short, 'date', now());
EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- One honest answer for any period: what was taken, and how much of the profit
-- figure is actually backed by cost data.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION profit_report(p_from DATE, p_to DATE)
RETURNS JSON AS $$
  SELECT json_build_object(
    'revenue',          COALESCE(SUM(total), 0),
    'sales',            COUNT(*),
    'measuredRevenue',  COALESCE(SUM(total)  FILTER (WHERE profit_complete), 0),
    'measuredProfit',   COALESCE(SUM(profit) FILTER (WHERE profit_complete), 0),
    'unbackedRevenue',  COALESCE(SUM(total)  FILTER (WHERE profit_complete IS NOT TRUE), 0),
    'coverage',         CASE WHEN COALESCE(SUM(total), 0) = 0 THEN 0
                          ELSE ROUND(100.0 * COALESCE(SUM(total) FILTER (WHERE profit_complete), 0)
                                     / SUM(total), 1) END
  )
  FROM sales
  WHERE NOT voided AND date >= p_from AND date < (p_to + 1);
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, extensions;

GRANT EXECUTE ON FUNCTION profit_report(date, date) TO anon, authenticated;
