-- ============================================================================
-- EVERYTINROOM POS — 019: PROFIT IS CALCULATED ON THE SERVER
--
-- Two problems, one cause. record_sale trusted the `costPrice` the browser sent
-- with each cart line:
--
--   1. Every till had to be given cost prices to work, so `loadAll()` shipped
--      the whole margin sheet to every cashier's browser. Anyone who opened
--      devtools could read what the shop pays for everything.
--   2. That figure was also spoofable. A cart posted with costPrice = price
--      records a sale at zero profit; the reports and the SMS summaries would
--      never show it.
--
-- Cost now comes from the products table inside the transaction. The browser no
-- longer sends it, and no longer needs to receive it.
-- ============================================================================

CREATE OR REPLACE FUNCTION record_sale(
  p_items JSONB,
  p_customer TEXT,
  p_payment TEXT,
  p_discount NUMERIC,
  p_type TEXT,
  p_cashier TEXT,
  p_split_cash NUMERIC DEFAULT 0,
  p_split_momo NUMERIC DEFAULT 0
) RETURNS JSON AS $$
DECLARE
  v_id TEXT;
  v_receipt TEXT;
  v_subtotal NUMERIC := 0;
  v_profit NUMERIC := 0;
  v_total NUMERIC;
  v_discount NUMERIC;
  v_item JSONB;
  v_qty INTEGER;
  v_bundle_item JSONB;
  v_cost NUMERIC;
  v_have INTEGER;
  v_short JSONB := '[]'::jsonb;
BEGIN
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RETURN json_build_object('success', false, 'error', 'Cannot record an empty sale');
  END IF;

  v_id := short_id();
  v_receipt := generate_receipt_no();

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_subtotal := v_subtotal + COALESCE((v_item->>'lineTotal')::NUMERIC, 0);
    v_qty := COALESCE((v_item->>'qty')::INTEGER, 0);
    v_cost := 0;

    IF (v_item->>'isBundle')::BOOLEAN IS TRUE AND v_item->'bundleItems' IS NOT NULL THEN
      -- A bundle costs the sum of what its components cost.
      SELECT COALESCE(SUM(p.cost_price * COALESCE((bi->>'qty')::INTEGER, 0)), 0)
        INTO v_cost
        FROM jsonb_array_elements(v_item->'bundleItems') bi
        JOIN products p ON p.id = bi->>'productId';
    ELSIF NULLIF(v_item->>'productId', '') IS NOT NULL THEN
      SELECT COALESCE(cost_price, 0) INTO v_cost FROM products WHERE id = v_item->>'productId';
      v_cost := COALESCE(v_cost, 0);
    END IF;

    v_profit := v_profit + (COALESCE((v_item->>'price')::NUMERIC, 0) - v_cost) * v_qty;
  END LOOP;

  v_discount := LEAST(GREATEST(COALESCE(p_discount, 0), 0), v_subtotal);
  v_total := v_subtotal - v_discount;
  v_profit := v_profit - v_discount;

  INSERT INTO sales (id, receipt_no, date, items, subtotal, discount, total, profit,
    payment, split_cash, split_momo, customer, type, cashier, voided)
  VALUES (v_id, v_receipt, now(), p_items, v_subtotal, v_discount, v_total, v_profit,
    p_payment, COALESCE(p_split_cash, 0), COALESCE(p_split_momo, 0),
    p_customer, p_type, p_cashier, false);

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
        v_short := v_short || jsonb_build_object(
          'name', v_item->>'name', 'wanted', v_qty, 'had', v_have);
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
    'success', true,
    'receiptNo', v_receipt,
    'saleId', v_id,
    'subtotal', v_subtotal,
    'discount', v_discount,
    'total', v_total,
    'oversold', v_short,
    'date', now()
  );
EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ---------------------------------------------------------------------------
-- A products view without the cost column, for tills that have no business
-- seeing it. The app selects from here unless the user holds `inventory_view`,
-- `reports` or admin.
-- ---------------------------------------------------------------------------
DROP VIEW IF EXISTS products_sale;
CREATE VIEW products_sale AS
  SELECT id, name, category, price, wholesale_price, wholesale_min_qty,
         quantity, image, group_tag
  FROM products;

GRANT SELECT ON products_sale TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- OPTIONAL — historical clean-up.
--
-- Sales recorded before this migration carry `costPrice` inside their items
-- JSON, and `sales` is readable by every till. Until this is run, a cashier can
-- still read the shop's old cost prices out of the receipt lines.
--
-- It rewrites historical rows, so it is left for you to run deliberately rather
-- than firing on deploy. Nothing reads the field — profit is stored in its own
-- column on the sale.
--
--   UPDATE sales
--      SET items = (
--            SELECT jsonb_agg(item - 'costPrice')
--              FROM jsonb_array_elements(items) item
--          )
--    WHERE items::text LIKE '%costPrice%';
-- ---------------------------------------------------------------------------
