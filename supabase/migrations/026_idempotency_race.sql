-- ============================================================================
-- EVERYTINROOM POS — 026: THE IDEMPOTENCY RACE
--
-- record_sale already refuses to record the same client reference twice: it
-- looks the reference up first and, finding it, hands back the original
-- receipt. Firing five replays of one sale against production produced exactly
-- one row and one stock deduction, which is the guarantee that matters.
--
-- But two of those five came back with no receipt at all. The lookup and the
-- insert are not atomic, so when replays arrive AT THE SAME MOMENT — a dropped
-- response the till retries while the offline queue flushes, or two tills
-- sharing a reference — both pass the lookup, both insert, and the loser hits
-- the unique index. The generic handler turned that into
-- "duplicate key value violates unique constraint", which the cashier reads as
-- a failed sale and rings up again.
--
-- The sale was fine. Only the reporting was wrong. Catching the violation and
-- returning the sale that won the race makes a concurrent replay behave the
-- same as a sequential one.
-- ============================================================================

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
  v_id TEXT; v_receipt TEXT;
  v_subtotal NUMERIC := 0; v_profit NUMERIC := 0;
  v_total NUMERIC; v_discount NUMERIC;
  v_item JSONB; v_qty INTEGER; v_bundle_item JSONB;
  v_cost NUMERIC; v_have INTEGER;
  v_short JSONB := '[]'::jsonb;
  v_existing RECORD;
BEGIN
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RETURN json_build_object('success', false, 'error', 'Cannot record an empty sale');
  END IF;

  -- The common case: the reference is already on file, so hand back what was
  -- recorded rather than ringing the customer up twice.
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
    v_profit := v_profit + (COALESCE((v_item->>'price')::NUMERIC, 0) - v_cost) * v_qty;
  END LOOP;

  v_discount := LEAST(GREATEST(COALESCE(p_discount, 0), 0), v_subtotal);
  v_total := v_subtotal - v_discount;
  v_profit := v_profit - v_discount;

  BEGIN
    INSERT INTO sales (id, receipt_no, date, items, subtotal, discount, total, profit,
      payment, split_cash, split_momo, customer, type, cashier, voided, terminal, client_ref)
    VALUES (v_id, v_receipt, now(), p_items, v_subtotal, v_discount, v_total, v_profit,
      p_payment, COALESCE(p_split_cash, 0), COALESCE(p_split_momo, 0),
      p_customer, p_type, p_cashier, false, COALESCE(p_terminal, ''), NULLIF(p_client_ref, ''));
  EXCEPTION WHEN unique_violation THEN
    -- Another copy of this same sale won the race between the lookup above and
    -- this insert. It is recorded; report ITS receipt and change no stock.
    SELECT id, receipt_no, total, discount INTO v_existing
      FROM sales WHERE client_ref = p_client_ref LIMIT 1;
    IF FOUND THEN
      RETURN json_build_object('success', true, 'duplicate', true,
        'receiptNo', v_existing.receipt_no, 'saleId', v_existing.id,
        'total', v_existing.total, 'discount', v_existing.discount,
        'oversold', '[]'::jsonb, 'date', now());
    END IF;
    -- A collision on something other than client_ref (a receipt number) is a
    -- real problem, so let it surface.
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
    'oversold', v_short, 'date', now());
EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions;
