-- ============================================================================
-- EVERYTINROOM POS — 018: THE PERMISSION MODEL BECOMES REAL
--
-- Until now every "only an admin can do this" rule lived in the browser. The
-- nav hid the button; the RPC behind it accepted a call from anyone holding the
-- public anon key. A cashier with the browser console — or a stranger with the
-- key from the public repo — could approve their own stock deliveries, void
-- sales, refund cash and rewrite the count.
--
-- This migration moves those checks into the database. Each privileged function
-- now takes the session token issued by verify_pin (migration 015) and refuses
-- to act without the matching permission.
--
-- It also hashes the PINs. They were stored as plain 4-digit text, so any
-- database dump handed over every login.
--
-- RUN AFTER 015 AND 016.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- 1. Hash the PINs.
--    bcrypt via pgcrypto. verify_pin can no longer look a PIN up by equality,
--    so it walks the (small) staff list and compares hashes.
-- ---------------------------------------------------------------------------
ALTER TABLE staff ADD COLUMN IF NOT EXISTS pin_hash TEXT;

-- Backfill every existing PIN into its hash.
UPDATE staff SET pin_hash = crypt(pin, gen_salt('bf', 10))
WHERE pin_hash IS NULL AND pin IS NOT NULL AND pin <> '';

-- Only drop the plaintext column once every active staff member can still log
-- in. If anything is unhashed the column stays and a warning is raised, so a
-- half-finished migration can never lock the shop out of its own till.
DO $pins$
DECLARE unhashed INTEGER;
BEGIN
  SELECT COUNT(*) INTO unhashed FROM staff WHERE active = true AND (pin_hash IS NULL OR pin_hash = '');
  IF unhashed = 0 THEN
    ALTER TABLE staff DROP COLUMN IF EXISTS pin;
    RAISE NOTICE 'Plaintext PIN column dropped — all staff PINs are now hashed.';
  ELSE
    RAISE WARNING '% active staff have no pin_hash. Plaintext `pin` column KEPT. Fix those rows, then: ALTER TABLE staff DROP COLUMN pin;', unhashed;
  END IF;
END $pins$;

-- ---------------------------------------------------------------------------
-- 2. verify_pin against the hash.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION verify_pin(p_pin text)
RETURNS jsonb AS $$
DECLARE
  s          record;
  found_id   TEXT := NULL;
  recent_bad INTEGER;
  new_token  TEXT;
BEGIN
  SELECT COUNT(*) INTO recent_bad
  FROM pin_attempts
  WHERE succeeded = false AND at > now() - interval '5 minutes';

  IF recent_bad >= 8 AND EXISTS (
    SELECT 1 FROM pin_attempts
    WHERE succeeded = false AND at > now() - interval '60 seconds'
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Too many attempts. Wait a minute and try again.');
  END IF;

  -- bcrypt hashes carry their own salt, so there is nothing to look up by —
  -- compare against each active staff member. A shop has a handful of staff,
  -- so this stays cheap.
  FOR s IN SELECT id, name, role, permissions, pin_hash FROM staff WHERE active = true LOOP
    IF s.pin_hash IS NOT NULL AND s.pin_hash = crypt(p_pin, s.pin_hash) THEN
      found_id := s.id;
      EXIT;
    END IF;
  END LOOP;

  IF found_id IS NULL THEN
    INSERT INTO pin_attempts (succeeded) VALUES (false);
    RETURN jsonb_build_object('success', false);
  END IF;

  INSERT INTO pin_attempts (succeeded) VALUES (true);
  DELETE FROM pin_attempts WHERE at < now() - interval '1 day';

  new_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  DELETE FROM staff_sessions WHERE staff_id = found_id OR expires_at < now();
  INSERT INTO staff_sessions (token, staff_id, expires_at)
  VALUES (new_token, found_id, now() + interval '12 hours');

  RETURN jsonb_build_object(
    'success', true,
    'id', s.id,
    'name', s.name,
    'role', s.role,
    'permissions', COALESCE(s.permissions, '[]'::jsonb),
    'token', new_token
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- save_staff writes the hash, never the PIN itself.
CREATE OR REPLACE FUNCTION save_staff(
  p_token       TEXT,
  p_id          TEXT,
  p_name        TEXT,
  p_role        TEXT,
  p_pin         TEXT,
  p_active      BOOLEAN,
  p_permissions JSONB
) RETURNS jsonb AS $$
DECLARE new_id TEXT; perms JSONB; clash INTEGER := 0; r RECORD;
BEGIN
  IF NOT session_can(p_token, 'admin') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authorised');
  END IF;
  IF COALESCE(trim(p_name), '') = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Name is required');
  END IF;
  IF p_pin IS NOT NULL AND p_pin <> '' AND p_pin !~ '^\d{4,8}$' THEN
    RETURN jsonb_build_object('success', false, 'error', 'PIN must be 4-8 digits');
  END IF;

  IF p_pin IS NOT NULL AND p_pin <> '' THEN
    FOR r IN SELECT id, pin_hash FROM staff WHERE (p_id IS NULL OR p_id = '' OR id <> p_id) LOOP
      IF r.pin_hash IS NOT NULL AND r.pin_hash = crypt(p_pin, r.pin_hash) THEN clash := 1; EXIT; END IF;
    END LOOP;
    IF clash = 1 THEN
      RETURN jsonb_build_object('success', false, 'error', 'That PIN is already used by another staff member');
    END IF;
  END IF;

  perms := CASE WHEN p_role = 'Admin'
    THEN '["sales","refunds","stock_taking","product_receiving","product_management","inventory_view","reports","admin"]'::jsonb
    ELSE COALESCE(p_permissions, '[]'::jsonb) END;

  IF p_id IS NULL OR p_id = '' THEN
    IF p_pin IS NULL OR p_pin = '' THEN
      RETURN jsonb_build_object('success', false, 'error', 'A PIN is required for new staff');
    END IF;
    new_id := short_id();
    INSERT INTO staff (id, name, role, pin_hash, active, permissions)
    VALUES (new_id, trim(p_name), p_role, crypt(p_pin, gen_salt('bf', 10)), COALESCE(p_active, true), perms);
    RETURN jsonb_build_object('success', true, 'id', new_id);
  END IF;

  UPDATE staff SET
    name        = trim(p_name),
    role        = p_role,
    active      = COALESCE(p_active, true),
    permissions = perms,
    pin_hash    = CASE WHEN p_pin IS NULL OR p_pin = '' THEN pin_hash ELSE crypt(p_pin, gen_salt('bf', 10)) END
  WHERE id = p_id;

  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Staff not found'); END IF;
  RETURN jsonb_build_object('success', true, 'id', p_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ---------------------------------------------------------------------------
-- 3. Token-gated privileged operations.
--
--    CREATE OR REPLACE with a new argument list would create an OVERLOAD, not a
--    replacement — the old ungated signature would stay callable and the gate
--    would be decorative. Each old signature is dropped explicitly.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS process_refund(text, jsonb, text, text, text);
DROP FUNCTION IF EXISTS void_sale(text);
DROP FUNCTION IF EXISTS complete_wa_order(text, text);
DROP FUNCTION IF EXISTS approve_receiving(uuid, text);
DROP FUNCTION IF EXISTS approve_stock_take(uuid, text);

-- ---- refunds -------------------------------------------------------------
CREATE OR REPLACE FUNCTION process_refund(
  p_token TEXT,
  p_receipt_no TEXT,
  p_items JSONB,
  p_reason TEXT,
  p_customer TEXT
) RETURNS JSON AS $$
DECLARE
  me RECORD;
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
  IF NOT session_can(p_token, 'refunds') THEN
    RETURN json_build_object('success', false, 'error', 'You do not have permission to process refunds');
  END IF;
  -- Who processed it comes from the session, not from the caller. The old
  -- signature took p_processed_by as a plain string, so a refund could be
  -- filed under somebody else's name.
  me := session_staff(p_token);

  SELECT * INTO v_sale FROM sales WHERE receipt_no = p_receipt_no FOR UPDATE;
  IF NOT FOUND THEN RETURN json_build_object('success', false, 'error', 'Sale not found'); END IF;
  IF v_sale.voided THEN RETURN json_build_object('success', false, 'error', 'Sale already voided'); END IF;
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RETURN json_build_object('success', false, 'error', 'No items selected');
  END IF;

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

    IF v_pid IS NOT NULL THEN
      v_target := v_pid;
    ELSE
      SELECT id INTO v_target FROM products WHERE lower(name) = lower(v_name) LIMIT 1;
    END IF;
    IF v_target IS NOT NULL THEN
      UPDATE products SET quantity = quantity + v_qty WHERE id = v_target;
      INSERT INTO stock_ledger (product_id, product_name, previous_qty, change_qty, new_qty, reason, action_type, staff, reference)
      SELECT id, name, quantity - v_qty, v_qty, quantity, 'Refund ' || v_refund_no, 'return', me.name, p_receipt_no
      FROM products WHERE id = v_target;
    END IF;
  END LOOP;

  INSERT INTO refunds (id, refund_no, date, original_receipt_no, original_sale_id,
    items, refund_amount, reason, processed_by, customer, status)
  VALUES (v_refund_id, v_refund_no, now(), p_receipt_no, v_sale.id,
    p_items, v_amount, p_reason, me.name, p_customer, 'Completed');

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

-- ---- void ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION void_sale(p_token TEXT, p_sale_id TEXT) RETURNS JSON AS $$
DECLARE
  me RECORD;
  v_sale RECORD;
  v_item JSONB;
  v_bundle_item JSONB;
  v_qty INTEGER;
BEGIN
  IF NOT session_can(p_token, 'refunds') THEN
    RETURN json_build_object('success', false, 'error', 'You do not have permission to void sales');
  END IF;
  me := session_staff(p_token);

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
  INSERT INTO stock_ledger (product_name, reason, action_type, staff, reference)
  VALUES ('(sale voided)', 'Sale voided', 'manual', me.name, v_sale.receipt_no);
  RETURN json_build_object('success', true);
EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ---- packing a delivery order --------------------------------------------
CREATE OR REPLACE FUNCTION complete_wa_order(p_token TEXT, p_order_id TEXT)
RETURNS JSON AS $$
DECLARE
  me RECORD;
  v_order RECORD;
  v_item JSONB;
  v_prod RECORD;
  v_profit NUMERIC := 0;
  v_sale_id TEXT;
  v_receipt TEXT;
BEGIN
  IF NOT session_can(p_token, 'sales') THEN
    RETURN json_build_object('success', false, 'error', 'You do not have permission to process orders');
  END IF;
  me := session_staff(p_token);

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
    me.name, false);

  IF COALESCE(v_order.customer_phone, '') <> '' THEN
    INSERT INTO customers (phone, visit_count, total_spent, last_visit)
    VALUES (v_order.customer_phone, 1, v_order.total, now())
    ON CONFLICT (phone) DO UPDATE SET
      visit_count = customers.visit_count + 1,
      total_spent = customers.total_spent + v_order.total,
      last_visit = now();
  END IF;

  UPDATE whatsapp_orders SET
    status = 'Completed', processed_by = me.name, processed_at = now()
  WHERE id = p_order_id;

  RETURN json_build_object('success', true, 'receiptNo', v_receipt, 'saleId', v_sale_id);
EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ---- approving stock in --------------------------------------------------
CREATE OR REPLACE FUNCTION approve_receiving(p_token TEXT, p_id uuid)
RETURNS jsonb AS $$
DECLARE
  me RECORD; rec RECORD; item jsonb; prod RECORD; new_qty int; applied int := 0;
BEGIN
  IF NOT session_can(p_token, 'admin') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Only an admin can approve a delivery');
  END IF;
  me := session_staff(p_token);

  SELECT * INTO rec FROM receivings WHERE id = p_id FOR UPDATE;
  IF rec.id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'not found'); END IF;
  IF rec.status <> 'pending' THEN RETURN jsonb_build_object('success', false, 'error', 'already ' || rec.status); END IF;

  FOR item IN SELECT * FROM jsonb_array_elements(rec.items) LOOP
    -- Increment in the UPDATE itself. Reading the quantity and writing back a
    -- computed total lost one delivery whenever two approvals overlapped.
    UPDATE products
       SET quantity = quantity + COALESCE((item->>'received')::int, 0)
     WHERE id = (item->>'product_id')
    RETURNING id, name, quantity INTO prod;

    IF prod.id IS NOT NULL THEN
      new_qty := prod.quantity;
      BEGIN
        INSERT INTO stock_ledger (product_id, product_name, previous_qty, change_qty, new_qty, reason, action_type, staff, reference)
        VALUES (prod.id, prod.name, new_qty - COALESCE((item->>'received')::int, 0),
                COALESCE((item->>'received')::int, 0), new_qty,
                'Supplier receiving approved', 'receiving', me.name, rec.ref_no);
      EXCEPTION WHEN undefined_table THEN NULL; END;
      applied := applied + 1;
    END IF;
  END LOOP;

  UPDATE receivings SET status = 'approved', approved_by = me.name, approved_at = now() WHERE id = p_id;
  RETURN jsonb_build_object('success', true, 'applied', applied);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION approve_stock_take(p_token TEXT, p_id uuid)
RETURNS jsonb AS $$
DECLARE
  me RECORD; rec RECORD; item jsonb; prod RECORD; counted int; applied int := 0;
BEGIN
  IF NOT session_can(p_token, 'admin') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Only an admin can approve a stock take');
  END IF;
  me := session_staff(p_token);

  SELECT * INTO rec FROM stock_takes WHERE id = p_id FOR UPDATE;
  IF rec.id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'not found'); END IF;
  IF rec.status = 'approved' THEN RETURN jsonb_build_object('success', false, 'error', 'already approved'); END IF;

  FOR item IN SELECT * FROM jsonb_array_elements(rec.items) LOOP
    SELECT id, quantity, name INTO prod FROM products WHERE id = (item->>'productId') FOR UPDATE;
    IF prod.id IS NOT NULL THEN
      counted := COALESCE((item->>'countedQty')::int, prod.quantity);
      IF counted <> prod.quantity THEN
        INSERT INTO stock_ledger (product_id, product_name, previous_qty, change_qty, new_qty, reason, action_type, staff, reference)
        VALUES (prod.id, prod.name, prod.quantity, counted - prod.quantity, counted, 'Stock take approved', 'stock_take', me.name, 'ST-' || left(p_id::text, 8));
        UPDATE products SET quantity = counted WHERE id = prod.id;
        applied := applied + 1;
      END IF;
    END IF;
  END LOOP;

  UPDATE stock_takes SET status = 'approved', approved_by = me.name, approved_at = now() WHERE id = p_id;
  RETURN jsonb_build_object('success', true, 'applied', applied);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ---------------------------------------------------------------------------
-- 4. Give existing admins the new `refunds` permission so nothing they could
--    do yesterday stops working today.
-- ---------------------------------------------------------------------------
UPDATE staff
   SET permissions = COALESCE(permissions, '[]'::jsonb) || '["refunds"]'::jsonb
 WHERE (role = 'Admin' OR COALESCE(permissions, '[]'::jsonb) ? 'admin')
   AND NOT (COALESCE(permissions, '[]'::jsonb) ? 'refunds');

-- Cashiers who were already ringing up sales keep refunding until an admin
-- decides otherwise — revoking it silently mid-trading would strand customers.
UPDATE staff
   SET permissions = COALESCE(permissions, '[]'::jsonb) || '["refunds"]'::jsonb
 WHERE COALESCE(permissions, '[]'::jsonb) ? 'sales'
   AND NOT (COALESCE(permissions, '[]'::jsonb) ? 'refunds');

GRANT EXECUTE ON FUNCTION process_refund(text, text, jsonb, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION void_sale(text, text)                         TO anon, authenticated;
GRANT EXECUTE ON FUNCTION complete_wa_order(text, text)                 TO anon, authenticated;
GRANT EXECUTE ON FUNCTION approve_receiving(text, uuid)                 TO anon, authenticated;
GRANT EXECUTE ON FUNCTION approve_stock_take(text, uuid)                TO anon, authenticated;
