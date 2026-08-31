-- ============================================================================
-- EVERYTINROOM POS — 020: RUNNING ON REAL POS HARDWARE
--
-- The app was built for a phone or laptop. On an actual till — a touchscreen
-- terminal with a thermal printer, a barcode scanner and a cash drawer — one
-- thing was missing outright: products had no barcode. A scanner is a keyboard
-- that types digits very fast and presses Enter, so scanning a tin of milk
-- typed "6009510800274" into the search box and matched nothing.
--
-- This adds the barcode, and a per-terminal registry so each till in the shop
-- can be told apart in the sales log.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Barcodes.
--    TEXT, not a number: EAN-13 codes overflow int, and leading zeros matter.
-- ---------------------------------------------------------------------------
ALTER TABLE products ADD COLUMN IF NOT EXISTS barcode TEXT DEFAULT '';

-- One product per barcode. A partial index so the many blank ones don't clash.
CREATE UNIQUE INDEX IF NOT EXISTS idx_products_barcode_unique
  ON products (barcode) WHERE barcode IS NOT NULL AND barcode <> '';

-- Scanning must be an index hit, not a table scan, or the till lags at the
-- counter with a few thousand products.
CREATE INDEX IF NOT EXISTS idx_products_barcode ON products (barcode);

-- Rebuild the no-cost view so tills can scan without seeing margins (019).
DROP VIEW IF EXISTS products_sale;
CREATE VIEW products_sale AS
  SELECT id, name, category, price, wholesale_price, wholesale_min_qty,
         quantity, image, group_tag, barcode
  FROM products;
GRANT SELECT ON products_sale TO anon, authenticated;

-- Look a barcode up directly. Scanning should not depend on the whole product
-- list already being in the browser — a till that has just started, or one with
-- a big catalogue, still needs the beep to be instant.
CREATE OR REPLACE FUNCTION find_by_barcode(p_code TEXT)
RETURNS JSON AS $$
DECLARE p RECORD;
BEGIN
  SELECT id, name, category, price, wholesale_price, wholesale_min_qty,
         quantity, image, group_tag, barcode
    INTO p
    FROM products
   WHERE barcode = trim(p_code)
   LIMIT 1;
  IF NOT FOUND THEN RETURN json_build_object('found', false); END IF;
  RETURN json_build_object('found', true, 'product', row_to_json(p));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION find_by_barcode(text) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Terminals.
--    A shop with two tills needs to know which one rang a sale up, and which
--    drawer a cash figure belongs to. `cashier` alone doesn't answer that —
--    staff move between tills.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS terminals (
  id          TEXT PRIMARY KEY DEFAULT short_id(),
  name        TEXT NOT NULL,
  location    TEXT DEFAULT '',
  active      BOOLEAN DEFAULT true,
  last_seen   TIMESTAMPTZ,
  created_at  TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE terminals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "terminals_read" ON terminals;
CREATE POLICY "terminals_read" ON terminals FOR SELECT TO anon, authenticated USING (true);

ALTER TABLE sales ADD COLUMN IF NOT EXISTS terminal TEXT DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_sales_terminal ON sales(terminal);

-- Idempotency key. The offline queue and every network retry resend the same
-- sale; this is what lets the server recognise it and refuse to ring it twice.
ALTER TABLE sales ADD COLUMN IF NOT EXISTS client_ref TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_client_ref
  ON sales (client_ref) WHERE client_ref IS NOT NULL;

-- record_sale gains an optional terminal name. Defaulted, so an older client
-- that doesn't send one keeps working through the changeover.
CREATE OR REPLACE FUNCTION record_sale(
  p_items JSONB,
  p_customer TEXT,
  p_payment TEXT,
  p_discount NUMERIC,
  p_type TEXT,
  p_cashier TEXT,
  p_split_cash NUMERIC DEFAULT 0,
  p_split_momo NUMERIC DEFAULT 0,
  p_terminal TEXT DEFAULT '',
  p_client_ref TEXT DEFAULT NULL
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
  v_existing RECORD;
BEGIN
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RETURN json_build_object('success', false, 'error', 'Cannot record an empty sale');
  END IF;

  -- Offline queue replay and flaky-network retries both resend the same sale.
  -- The client stamps each one with a reference it generated once; if we have
  -- already seen it, hand back the original receipt instead of ringing the
  -- customer up twice.
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
    payment, split_cash, split_momo, customer, type, cashier, voided, terminal, client_ref)
  VALUES (v_id, v_receipt, now(), p_items, v_subtotal, v_discount, v_total, v_profit,
    p_payment, COALESCE(p_split_cash, 0), COALESCE(p_split_momo, 0),
    p_customer, p_type, p_cashier, false, COALESCE(p_terminal, ''), NULLIF(p_client_ref, ''));

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
    'success', true, 'duplicate', false,
    'receiptNo', v_receipt, 'saleId', v_id,
    'subtotal', v_subtotal, 'discount', v_discount, 'total', v_total,
    'oversold', v_short, 'date', now()
  );
EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ---------------------------------------------------------------------------
-- 3. Cash drawer sessions — open float, closing count, and the variance that
--    tells you whether the drawer balances at the end of a shift.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS drawer_sessions (
  id            TEXT PRIMARY KEY DEFAULT short_id(),
  terminal      TEXT DEFAULT '',
  opened_by     TEXT DEFAULT '',
  opened_at     TIMESTAMPTZ DEFAULT now(),
  opening_float NUMERIC(10,2) DEFAULT 0,
  closed_by     TEXT DEFAULT '',
  closed_at     TIMESTAMPTZ,
  counted_cash  NUMERIC(10,2),
  expected_cash NUMERIC(10,2),
  variance      NUMERIC(10,2),
  note          TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_drawer_open ON drawer_sessions(terminal, closed_at);
ALTER TABLE drawer_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "drawer_all" ON drawer_sessions;
CREATE POLICY "drawer_all" ON drawer_sessions FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- Close a drawer: expected cash is the opening float plus every cash and
-- split-cash sale rung on this terminal since it opened.
CREATE OR REPLACE FUNCTION close_drawer(
  p_token TEXT, p_session_id TEXT, p_counted NUMERIC, p_note TEXT DEFAULT ''
) RETURNS JSON AS $$
DECLARE me RECORD; s RECORD; taken NUMERIC := 0; expected NUMERIC;
BEGIN
  IF NOT session_can(p_token, 'sales') THEN
    RETURN json_build_object('success', false, 'error', 'Not authorised');
  END IF;
  me := session_staff(p_token);

  SELECT * INTO s FROM drawer_sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN RETURN json_build_object('success', false, 'error', 'Drawer session not found'); END IF;
  IF s.closed_at IS NOT NULL THEN RETURN json_build_object('success', false, 'error', 'Drawer already closed'); END IF;

  SELECT COALESCE(SUM(
           CASE WHEN payment = 'Cash'  THEN total
                WHEN payment = 'Split' THEN split_cash
                ELSE 0 END), 0)
    INTO taken
    FROM sales
   WHERE NOT voided
     AND date >= s.opened_at
     AND (s.terminal = '' OR terminal = s.terminal);

  expected := COALESCE(s.opening_float, 0) + taken;

  UPDATE drawer_sessions SET
    closed_by = me.name, closed_at = now(),
    counted_cash = p_counted, expected_cash = expected,
    variance = p_counted - expected, note = p_note
  WHERE id = p_session_id;

  RETURN json_build_object('success', true, 'expected', expected,
    'counted', p_counted, 'variance', p_counted - expected, 'cashSales', taken);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION close_drawer(text, text, numeric, text) TO anon, authenticated;
