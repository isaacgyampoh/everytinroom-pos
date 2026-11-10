-- ============================================================================
-- EVERYTINROOM POS — 016: MONEY & STOCK INTEGRITY
--
-- Fixes, in order of how much money each one can lose:
--   1. Discounts larger than the basket wrote NEGATIVE totals into `sales`
--      while the screen showed GHS 0.00.
--   2. `process_refund` had no cap — the same receipt could be refunded over
--      and over, each time paying out cash and inflating stock.
--   3. Refund stock restore matched `lower(name) = ... OR id = ...`, which
--      updates EVERY variant sharing a name, inventing stock out of nowhere.
--   4. Receipt / refund / order numbers came from COUNT(*), so two tills
--      ringing up at the same moment generated the same number and one sale
--      died on the UNIQUE constraint.
--   5. USSD codes came from `max + 1` read on the client — two customers
--      could be handed the same pay code and one payment lands on the wrong
--      order.
--   6. `complete_wa_order` matched products by name, so a delivery could
--      deduct stock from the wrong variant.
--   7. Split payments were written by a second UPDATE after the sale; if that
--      call failed the cash half vanished. Now recorded in the same insert.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Atomic counters — replaces every COUNT(*)-based number generator.
--    INSERT .. ON CONFLICT DO UPDATE takes a row lock, so concurrent tills
--    queue instead of colliding.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS doc_counters (
  key   TEXT PRIMARY KEY,
  value INTEGER NOT NULL DEFAULT 0
);
ALTER TABLE doc_counters ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON doc_counters FROM anon, authenticated;

CREATE OR REPLACE FUNCTION next_counter(p_key TEXT) RETURNS INTEGER AS $$
DECLARE v INTEGER;
BEGIN
  INSERT INTO doc_counters (key, value) VALUES (p_key, 1)
  ON CONFLICT (key) DO UPDATE SET value = doc_counters.value + 1
  RETURNING value INTO v;
  RETURN v;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Seed a counter from whatever numbering already exists, so today's sequence
-- carries on instead of restarting at 001 and colliding with this morning.
CREATE OR REPLACE FUNCTION seed_counter(p_key TEXT, p_start INTEGER) RETURNS VOID AS $$
BEGIN
  INSERT INTO doc_counters (key, value) VALUES (p_key, COALESCE(p_start, 0))
  ON CONFLICT (key) DO NOTHING;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION generate_receipt_no() RETURNS TEXT AS $$
DECLARE prefix TEXT; k TEXT; hi INTEGER;
BEGIN
  prefix := 'RCP' || to_char(now(), 'YYYYMMDD');
  k := 'receipt:' || prefix;
  SELECT COALESCE(MAX(substring(receipt_no from '(\d+)$')::INTEGER), 0) INTO hi
    FROM sales WHERE receipt_no LIKE prefix || '-%';
  PERFORM seed_counter(k, hi);
  RETURN prefix || '-' || lpad(next_counter(k)::text, 3, '0');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION generate_refund_no() RETURNS TEXT AS $$
DECLARE prefix TEXT; k TEXT; hi INTEGER;
BEGIN
  prefix := 'RFD' || to_char(now(), 'YYYYMMDD');
  k := 'refund:' || prefix;
  SELECT COALESCE(MAX(substring(refund_no from '(\d+)$')::INTEGER), 0) INTO hi
    FROM refunds WHERE refund_no LIKE prefix || '-%';
  PERFORM seed_counter(k, hi);
  RETURN prefix || '-' || lpad(next_counter(k)::text, 3, '0');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION generate_wa_order_no() RETURNS TEXT AS $$
DECLARE prefix TEXT; k TEXT; hi INTEGER;
BEGIN
  prefix := 'WA' || to_char(now(), 'YYYYMMDD');
  k := 'waorder:' || prefix;
  SELECT COALESCE(MAX(substring(order_no from '(\d+)$')::INTEGER), 0) INTO hi
    FROM whatsapp_orders WHERE order_no LIKE prefix || '-%';
  PERFORM seed_counter(k, hi);
  RETURN prefix || '-' || lpad(next_counter(k)::text, 3, '0');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- USSD pay codes. The browser used to read `max(ussd_code) + 1` and insert it;
-- two cashiers a second apart both read the same max.
CREATE OR REPLACE FUNCTION next_ussd_code() RETURNS INTEGER AS $$
DECLARE hi INTEGER;
BEGIN
  SELECT COALESCE(MAX(ussd_code), 0) INTO hi FROM whatsapp_orders;
  PERFORM seed_counter('ussd', hi);
  RETURN next_counter('ussd');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION next_ussd_code() TO anon, authenticated;

-- Two live orders must never share a pay code. If the old race already
-- produced duplicates this index cannot be built — say so and carry on rather
-- than aborting the whole migration, then clean the duplicates up by hand:
--   SELECT ussd_code, count(*), array_agg(order_no)
--     FROM whatsapp_orders WHERE ussd_code IS NOT NULL
--    GROUP BY ussd_code HAVING count(*) > 1;
DO $ussd$
BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS idx_wa_ussd_code_unique
    ON whatsapp_orders (ussd_code) WHERE ussd_code IS NOT NULL;
EXCEPTION WHEN unique_violation THEN
  RAISE WARNING 'Duplicate ussd_code values already exist — unique index NOT created. Clean them up, then re-run this statement.';
END $ussd$;

-- ---------------------------------------------------------------------------
-- 2. record_sale — discount clamped, split written atomically, oversell
--    reported back to the till instead of silently flooring stock at zero.
-- ---------------------------------------------------------------------------
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
    v_profit := v_profit + (
      COALESCE((v_item->>'price')::NUMERIC, 0) - COALESCE((v_item->>'costPrice')::NUMERIC, 0)
    ) * COALESCE((v_item->>'qty')::INTEGER, 0);
  END LOOP;

  -- A discount can reduce a basket to zero. It can never turn it into a
  -- negative sale, which is what used to land in the table and in the reports.
  v_discount := LEAST(GREATEST(COALESCE(p_discount, 0), 0), v_subtotal);
  v_total := v_subtotal - v_discount;
  v_profit := v_profit - v_discount;

  INSERT INTO sales (id, receipt_no, date, items, subtotal, discount, total, profit,
    payment, split_cash, split_momo, customer, type, cashier, voided)
  VALUES (v_id, v_receipt, now(), p_items, v_subtotal, v_discount, v_total, v_profit,
    p_payment, COALESCE(p_split_cash, 0), COALESCE(p_split_momo, 0),
    p_customer, p_type, p_cashier, false);

  -- Deduct stock. Selling is never blocked at the counter (the shelf is the
  -- source of truth, not the count), but anything that went negative comes
  -- back so the cashier can be told the book stock is wrong.
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    IF (v_item->>'isBundle')::BOOLEAN IS TRUE AND v_item->'bundleItems' IS NOT NULL THEN
      FOR v_bundle_item IN SELECT * FROM jsonb_array_elements(v_item->'bundleItems') LOOP
        v_qty := COALESCE((v_bundle_item->>'qty')::INTEGER, 0) * COALESCE((v_item->>'qty')::INTEGER, 1);
        UPDATE products SET quantity = GREATEST(0, quantity - v_qty)
        WHERE id = v_bundle_item->>'productId'
        RETURNING quantity INTO v_have;
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
-- 3. process_refund — cannot refund more than was sold, and restores stock to
--    exactly one product row.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_refunds_original_receipt ON refunds(original_receipt_no);

CREATE OR REPLACE FUNCTION process_refund(
  p_receipt_no TEXT,
  p_items JSONB,
  p_reason TEXT,
  p_processed_by TEXT,
  p_customer TEXT
) RETURNS JSON AS $$
DECLARE
  v_sale RECORD;
  v_refund_id TEXT;
  v_refund_no TEXT;
  v_amount NUMERIC := 0;
  v_item JSONB;
  v_name TEXT;
  v_pid TEXT;
  v_qty INTEGER;
  v_sold INTEGER;
  v_already INTEGER;
  v_target TEXT;
  v_total_units INTEGER := 0;
  v_sold_units INTEGER := 0;
  v_is_full BOOLEAN := false;
BEGIN
  SELECT * INTO v_sale FROM sales WHERE receipt_no = p_receipt_no FOR UPDATE;
  IF NOT FOUND THEN RETURN json_build_object('success', false, 'error', 'Sale not found'); END IF;
  IF v_sale.voided THEN RETURN json_build_object('success', false, 'error', 'Sale already voided'); END IF;
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RETURN json_build_object('success', false, 'error', 'No items selected');
  END IF;

  -- Guard every line against what was sold MINUS what has already been
  -- refunded on this receipt. Without this the same receipt could be refunded
  -- repeatedly, paying out real cash each time.
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_name := v_item->>'name';
    v_pid  := NULLIF(v_item->>'productId', '');
    v_qty  := GREATEST(COALESCE((v_item->>'qty')::INTEGER, 0), 0);
    IF v_qty = 0 THEN CONTINUE; END IF;

    SELECT COALESCE(SUM((s->>'qty')::INTEGER), 0) INTO v_sold
    FROM jsonb_array_elements(v_sale.items) s
    WHERE (v_pid IS NOT NULL AND s->>'productId' = v_pid)
       OR (v_pid IS NULL AND lower(s->>'name') = lower(v_name));

    SELECT COALESCE(SUM((r->>'qty')::INTEGER), 0) INTO v_already
    FROM refunds f, jsonb_array_elements(f.items) r
    WHERE f.original_receipt_no = p_receipt_no
      AND f.status = 'Completed'
      AND ((v_pid IS NOT NULL AND r->>'productId' = v_pid)
        OR (v_pid IS NULL AND lower(r->>'name') = lower(v_name)));

    IF v_qty > v_sold - v_already THEN
      RETURN json_build_object('success', false, 'error',
        format('%s: only %s left to refund on this receipt', v_name, GREATEST(v_sold - v_already, 0)));
    END IF;
  END LOOP;

  v_refund_id := short_id();
  v_refund_no := generate_refund_no();

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_name := v_item->>'name';
    v_pid  := NULLIF(v_item->>'productId', '');
    v_qty  := GREATEST(COALESCE((v_item->>'qty')::INTEGER, 0), 0);
    IF v_qty = 0 THEN CONTINUE; END IF;
    v_amount := v_amount + COALESCE((v_item->>'price')::NUMERIC, 0) * v_qty;

    -- Exactly one row: id when we have it, otherwise a single name match.
    -- The old `id = ... OR lower(name) = ...` restocked every variant at once.
    IF v_pid IS NOT NULL THEN
      v_target := v_pid;
    ELSE
      SELECT id INTO v_target FROM products WHERE lower(name) = lower(v_name) LIMIT 1;
    END IF;
    IF v_target IS NOT NULL THEN
      UPDATE products SET quantity = quantity + v_qty WHERE id = v_target;
    END IF;
  END LOOP;

  INSERT INTO refunds (id, refund_no, date, original_receipt_no, original_sale_id,
    items, refund_amount, reason, processed_by, customer, status)
  VALUES (v_refund_id, v_refund_no, now(), p_receipt_no, v_sale.id,
    p_items, v_amount, p_reason, p_processed_by, p_customer, 'Completed');

  -- "Full refund" means every unit is back, not merely the same number of
  -- lines — a partial-quantity refund of all lines used to void the sale.
  SELECT COALESCE(SUM((s->>'qty')::INTEGER), 0) INTO v_sold_units
  FROM jsonb_array_elements(v_sale.items) s;
  SELECT COALESCE(SUM((r->>'qty')::INTEGER), 0) INTO v_total_units
  FROM refunds f, jsonb_array_elements(f.items) r
  WHERE f.original_receipt_no = p_receipt_no AND f.status = 'Completed';

  IF v_total_units >= v_sold_units AND v_sold_units > 0 THEN
    UPDATE sales SET voided = true WHERE id = v_sale.id;
    v_is_full := true;
  END IF;

  RETURN json_build_object(
    'success', true, 'refundNo', v_refund_no,
    'refundAmount', v_amount, 'isFullRefund', v_is_full
  );
EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ---------------------------------------------------------------------------
-- 4. void_sale — refuse to void a sale that has already been refunded, or the
--    stock comes back twice.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION void_sale(p_sale_id TEXT) RETURNS JSON AS $$
DECLARE
  v_sale RECORD;
  v_item JSONB;
  v_bundle_item JSONB;
  v_qty INTEGER;
BEGIN
  SELECT * INTO v_sale FROM sales WHERE id = p_sale_id FOR UPDATE;
  IF NOT FOUND THEN RETURN json_build_object('success', false, 'error', 'Sale not found'); END IF;
  IF v_sale.voided THEN RETURN json_build_object('success', false, 'error', 'Already voided'); END IF;
  IF EXISTS (SELECT 1 FROM refunds WHERE original_receipt_no = v_sale.receipt_no AND status = 'Completed') THEN
    RETURN json_build_object('success', false, 'error', 'This receipt has refunds — void would double-restore stock');
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(v_sale.items) LOOP
    IF (v_item->>'isBundle')::BOOLEAN IS TRUE AND v_item->'bundleItems' IS NOT NULL THEN
      FOR v_bundle_item IN SELECT * FROM jsonb_array_elements(v_item->'bundleItems') LOOP
        v_qty := COALESCE((v_bundle_item->>'qty')::INTEGER, 0) * COALESCE((v_item->>'qty')::INTEGER, 1);
        UPDATE products SET quantity = quantity + v_qty WHERE id = v_bundle_item->>'productId';
      END LOOP;
    ELSIF v_item->>'productId' IS NOT NULL THEN
      UPDATE products SET quantity = quantity + COALESCE((v_item->>'qty')::INTEGER, 0)
      WHERE id = v_item->>'productId';
    END IF;
  END LOOP;

  UPDATE sales SET voided = true WHERE id = p_sale_id;
  RETURN json_build_object('success', true);
EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ---------------------------------------------------------------------------
-- 5. complete_wa_order — match on productId first (name only as a fallback),
--    and make double-packing impossible.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION complete_wa_order(p_order_id TEXT, p_processed_by TEXT)
RETURNS JSON AS $$
DECLARE
  v_order RECORD;
  v_item JSONB;
  v_prod RECORD;
  v_profit NUMERIC := 0;
  v_sale_id TEXT;
  v_receipt TEXT;
BEGIN
  SELECT * INTO v_order FROM whatsapp_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RETURN json_build_object('success', false, 'error', 'Order not found'); END IF;
  IF v_order.status = 'Completed' THEN RETURN json_build_object('success', false, 'error', 'Already completed'); END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(v_order.items) LOOP
    IF NULLIF(v_item->>'productId', '') IS NOT NULL THEN
      SELECT * INTO v_prod FROM products WHERE id = v_item->>'productId';
    ELSE
      SELECT * INTO v_prod FROM products WHERE lower(name) = lower(v_item->>'name') LIMIT 1;
    END IF;
    IF FOUND THEN
      UPDATE products SET quantity = GREATEST(0, quantity - COALESCE((v_item->>'qty')::INTEGER, 0))
      WHERE id = v_prod.id;
      v_profit := v_profit + (
        COALESCE((v_item->>'price')::NUMERIC, 0) - v_prod.cost_price
      ) * COALESCE((v_item->>'qty')::INTEGER, 0);
    END IF;
  END LOOP;

  v_sale_id := short_id();
  v_receipt := generate_receipt_no();

  INSERT INTO sales (id, receipt_no, date, items, subtotal, discount, total, profit,
    payment, customer, type, cashier, voided)
  VALUES (v_sale_id, v_receipt, now(), v_order.items, v_order.subtotal, 0,
    v_order.total, v_profit, 'Paystack', v_order.customer_phone, 'WhatsApp',
    p_processed_by, false);

  IF COALESCE(v_order.customer_phone, '') <> '' THEN
    INSERT INTO customers (phone, visit_count, total_spent, last_visit)
    VALUES (v_order.customer_phone, 1, v_order.total, now())
    ON CONFLICT (phone) DO UPDATE SET
      visit_count = customers.visit_count + 1,
      total_spent = customers.total_spent + v_order.total,
      last_visit = now();
  END IF;

  UPDATE whatsapp_orders SET
    status = 'Completed', processed_by = p_processed_by, processed_at = now()
  WHERE id = p_order_id;

  RETURN json_build_object('success', true, 'receiptNo', v_receipt, 'saleId', v_sale_id);
EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ---------------------------------------------------------------------------
-- 6. Sales must never be deletable from the client, and the reporting queries
--    need indexes they never had.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "anon_full_sales" ON sales;
CREATE INDEX IF NOT EXISTS idx_sales_date_voided ON sales(date DESC) WHERE NOT voided;
CREATE INDEX IF NOT EXISTS idx_wa_paystack_ref ON whatsapp_orders(paystack_ref);
CREATE INDEX IF NOT EXISTS idx_products_name_lower ON products (lower(name));
