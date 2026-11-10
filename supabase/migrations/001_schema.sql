-- ============================================================================
-- EVERYTINROOM POS — FULL SUPABASE SCHEMA
-- Run this ONCE in: Supabase Dashboard → SQL Editor → New Query → Run
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Helper: short IDs like the old system
CREATE OR REPLACE FUNCTION short_id() RETURNS TEXT AS $$
  SELECT substring(uuid_generate_v4()::text, 1, 8);
$$ LANGUAGE sql;

-- ======================== PRODUCTS ========================
CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY DEFAULT short_id(),
  name TEXT NOT NULL,
  category TEXT DEFAULT '',
  cost_price NUMERIC(10,2) DEFAULT 0,
  price NUMERIC(10,2) DEFAULT 0,
  wholesale_price NUMERIC(10,2) DEFAULT 0,
  quantity INTEGER DEFAULT 0,
  image TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);

-- ======================== BUNDLES ========================
CREATE TABLE IF NOT EXISTS bundles (
  id TEXT PRIMARY KEY DEFAULT short_id(),
  name TEXT NOT NULL,
  products JSONB DEFAULT '[]',
  bundle_price NUMERIC(10,2) DEFAULT 0,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ======================== SALES ========================
CREATE TABLE IF NOT EXISTS sales (
  id TEXT PRIMARY KEY DEFAULT short_id(),
  receipt_no TEXT NOT NULL UNIQUE,
  date TIMESTAMPTZ DEFAULT now(),
  items JSONB DEFAULT '[]',
  subtotal NUMERIC(10,2) DEFAULT 0,
  discount NUMERIC(10,2) DEFAULT 0,
  total NUMERIC(10,2) DEFAULT 0,
  profit NUMERIC(10,2) DEFAULT 0,
  payment TEXT DEFAULT 'Cash',
  split_cash NUMERIC(10,2) DEFAULT 0,
  split_momo NUMERIC(10,2) DEFAULT 0,
  customer TEXT DEFAULT 'Walk-in',
  type TEXT DEFAULT 'Retail',
  cashier TEXT DEFAULT '',
  voided BOOLEAN DEFAULT false
);
CREATE INDEX IF NOT EXISTS idx_sales_date ON sales(date);
CREATE INDEX IF NOT EXISTS idx_sales_receipt ON sales(receipt_no);
CREATE INDEX IF NOT EXISTS idx_sales_cashier ON sales(cashier);

-- ======================== CUSTOMERS ========================
CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY DEFAULT short_id(),
  phone TEXT NOT NULL UNIQUE,
  visit_count INTEGER DEFAULT 0,
  total_spent NUMERIC(10,2) DEFAULT 0,
  last_visit TIMESTAMPTZ DEFAULT now()
);

-- ======================== STAFF ========================
CREATE TABLE IF NOT EXISTS staff (
  id TEXT PRIMARY KEY DEFAULT short_id(),
  name TEXT NOT NULL,
  role TEXT DEFAULT 'Cashier',
  pin TEXT NOT NULL,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ======================== EXPENSES ========================
CREATE TABLE IF NOT EXISTS expenses (
  id TEXT PRIMARY KEY DEFAULT short_id(),
  date TIMESTAMPTZ DEFAULT now(),
  category TEXT DEFAULT '',
  description TEXT DEFAULT '',
  amount NUMERIC(10,2) DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(date);

-- ======================== STOCK TAKES ========================
CREATE TABLE IF NOT EXISTS stock_takes (
  id TEXT PRIMARY KEY DEFAULT short_id(),
  date TIMESTAMPTZ DEFAULT now(),
  items JSONB DEFAULT '[]',
  notes TEXT DEFAULT '',
  conducted_by TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ======================== STOCK ADJUSTMENTS ========================
CREATE TABLE IF NOT EXISTS stock_adjustments (
  id TEXT PRIMARY KEY DEFAULT short_id(),
  date TIMESTAMPTZ DEFAULT now(),
  product_id TEXT DEFAULT '',
  product_name TEXT DEFAULT '',
  qty INTEGER DEFAULT 0,
  reason TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  adjusted_by TEXT DEFAULT ''
);

-- ======================== PROMOS ========================
CREATE TABLE IF NOT EXISTS promos (
  id TEXT PRIMARY KEY DEFAULT short_id(),
  name TEXT NOT NULL,
  start_date DATE,
  end_date DATE,
  items JSONB DEFAULT '[]',
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ======================== INVOICES ========================
CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY DEFAULT short_id(),
  invoice_id TEXT DEFAULT '',
  date TIMESTAMPTZ DEFAULT now(),
  supplier TEXT DEFAULT '',
  amount NUMERIC(10,2) DEFAULT 0,
  notes TEXT DEFAULT '',
  image TEXT DEFAULT '',
  photo_index INTEGER DEFAULT 1,
  total_photos INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_invoices_invoice_id ON invoices(invoice_id);

-- ======================== WHATSAPP ORDERS ========================
CREATE TABLE IF NOT EXISTS whatsapp_orders (
  id TEXT PRIMARY KEY DEFAULT short_id(),
  order_no TEXT NOT NULL,
  date TIMESTAMPTZ DEFAULT now(),
  customer_name TEXT DEFAULT '',
  customer_phone TEXT DEFAULT '',
  items JSONB DEFAULT '[]',
  subtotal NUMERIC(10,2) DEFAULT 0,
  delivery_fee NUMERIC(10,2) DEFAULT 0,
  total NUMERIC(10,2) DEFAULT 0,
  address TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  status TEXT DEFAULT 'Pending',
  paystack_ref TEXT DEFAULT '',
  paid_at TIMESTAMPTZ,
  processed_by TEXT DEFAULT '',
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_wa_status ON whatsapp_orders(status);
CREATE INDEX IF NOT EXISTS idx_wa_date ON whatsapp_orders(date);

-- ======================== REFUNDS ========================
CREATE TABLE IF NOT EXISTS refunds (
  id TEXT PRIMARY KEY DEFAULT short_id(),
  refund_no TEXT NOT NULL,
  date TIMESTAMPTZ DEFAULT now(),
  original_receipt_no TEXT DEFAULT '',
  original_sale_id TEXT DEFAULT '',
  items JSONB DEFAULT '[]',
  refund_amount NUMERIC(10,2) DEFAULT 0,
  reason TEXT DEFAULT '',
  processed_by TEXT DEFAULT '',
  customer TEXT DEFAULT '',
  status TEXT DEFAULT 'Completed',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ======================== ROW LEVEL SECURITY ========================
-- POS is internal (PIN-protected), so allow full anon access.
-- Tighten later if you add Supabase Auth.

DO $$ 
DECLARE t TEXT;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'products','bundles','sales','customers','staff','expenses',
    'stock_takes','stock_adjustments','promos','invoices',
    'whatsapp_orders','refunds'
  ]) LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY "anon_full_%s" ON %I FOR ALL TO anon, authenticated USING (true) WITH CHECK (true)', t, t
    );
  END LOOP;
END $$;

-- ======================== SEQUENCE GENERATORS ========================

CREATE OR REPLACE FUNCTION generate_receipt_no() RETURNS TEXT AS $$
DECLARE prefix TEXT; cnt INTEGER;
BEGIN
  prefix := 'RCP' || to_char(now(), 'YYYYMMDD');
  SELECT COUNT(*) INTO cnt FROM sales WHERE receipt_no LIKE prefix || '%';
  RETURN prefix || '-' || lpad((cnt + 1)::text, 3, '0');
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION generate_wa_order_no() RETURNS TEXT AS $$
DECLARE prefix TEXT; cnt INTEGER;
BEGIN
  prefix := 'WA' || to_char(now(), 'YYYYMMDD');
  SELECT COUNT(*) INTO cnt FROM whatsapp_orders WHERE order_no LIKE prefix || '%';
  RETURN prefix || '-' || lpad((cnt + 1)::text, 3, '0');
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION generate_refund_no() RETURNS TEXT AS $$
DECLARE prefix TEXT; cnt INTEGER;
BEGIN
  prefix := 'RFD' || to_char(now(), 'YYYYMMDD');
  SELECT COUNT(*) INTO cnt FROM refunds WHERE refund_no LIKE prefix || '%';
  RETURN prefix || '-' || lpad((cnt + 1)::text, 3, '0');
END;
$$ LANGUAGE plpgsql;

-- ======================== RPC: RECORD SALE (atomic) ========================
-- Does everything in one transaction: insert sale, deduct stock, update customer

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
  v_item JSONB;
  v_prod RECORD;
  v_qty INTEGER;
  v_bundle_item JSONB;
BEGIN
  v_id := short_id();
  v_receipt := generate_receipt_no();

  -- Calculate totals
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_subtotal := v_subtotal + COALESCE((v_item->>'lineTotal')::NUMERIC, 0);
    v_profit := v_profit + (
      COALESCE((v_item->>'price')::NUMERIC, 0) - COALESCE((v_item->>'costPrice')::NUMERIC, 0)
    ) * COALESCE((v_item->>'qty')::INTEGER, 0);
  END LOOP;

  v_total := v_subtotal - p_discount;

  -- Insert sale
  INSERT INTO sales (id, receipt_no, date, items, subtotal, discount, total, profit,
    payment, split_cash, split_momo, customer, type, cashier, voided)
  VALUES (v_id, v_receipt, now(), p_items, v_subtotal, p_discount, v_total, v_profit,
    p_payment, p_split_cash, p_split_momo, p_customer, p_type, p_cashier, false);

  -- Deduct stock
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    IF (v_item->>'isBundle')::BOOLEAN IS TRUE AND v_item->'bundleItems' IS NOT NULL THEN
      -- Bundle: deduct each bundle component
      FOR v_bundle_item IN SELECT * FROM jsonb_array_elements(v_item->'bundleItems') LOOP
        v_qty := COALESCE((v_bundle_item->>'qty')::INTEGER, 0) * COALESCE((v_item->>'qty')::INTEGER, 1);
        UPDATE products SET quantity = GREATEST(0, quantity - v_qty)
        WHERE id = v_bundle_item->>'productId';
      END LOOP;
    ELSIF v_item->>'productId' IS NOT NULL THEN
      UPDATE products SET quantity = GREATEST(0, quantity - COALESCE((v_item->>'qty')::INTEGER, 0))
      WHERE id = v_item->>'productId';
    END IF;
  END LOOP;

  -- Upsert customer
  IF p_customer IS NOT NULL AND p_customer != 'Walk-in' AND p_customer != '' THEN
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
    'discount', p_discount,
    'total', v_total,
    'date', now()
  );
EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql;

-- ======================== RPC: VOID SALE ========================

CREATE OR REPLACE FUNCTION void_sale(p_sale_id TEXT) RETURNS JSON AS $$
DECLARE
  v_sale RECORD;
  v_item JSONB;
  v_bundle_item JSONB;
  v_qty INTEGER;
BEGIN
  SELECT * INTO v_sale FROM sales WHERE id = p_sale_id;
  IF NOT FOUND THEN RETURN json_build_object('success', false, 'error', 'Sale not found'); END IF;
  IF v_sale.voided THEN RETURN json_build_object('success', false, 'error', 'Already voided'); END IF;

  -- Restore stock
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
$$ LANGUAGE plpgsql;

-- ======================== RPC: COMPLETE WA ORDER ========================

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
  SELECT * INTO v_order FROM whatsapp_orders WHERE id = p_order_id;
  IF NOT FOUND THEN RETURN json_build_object('success', false, 'error', 'Order not found'); END IF;
  IF v_order.status = 'Completed' THEN RETURN json_build_object('success', false, 'error', 'Already completed'); END IF;

  -- Deduct stock + calculate profit
  FOR v_item IN SELECT * FROM jsonb_array_elements(v_order.items) LOOP
    SELECT * INTO v_prod FROM products WHERE lower(name) = lower(v_item->>'name') LIMIT 1;
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

  -- Upsert customer
  IF v_order.customer_phone != '' THEN
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
$$ LANGUAGE plpgsql;

-- ======================== RPC: PROCESS REFUND ========================

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
  v_orig_items JSONB;
  v_is_full BOOLEAN := false;
BEGIN
  SELECT * INTO v_sale FROM sales WHERE receipt_no = p_receipt_no;
  IF NOT FOUND THEN RETURN json_build_object('success', false, 'error', 'Sale not found'); END IF;
  IF v_sale.voided THEN RETURN json_build_object('success', false, 'error', 'Sale already voided'); END IF;

  v_refund_id := short_id();
  v_refund_no := generate_refund_no();

  -- Calculate refund amount + restore stock
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_amount := v_amount + COALESCE((v_item->>'price')::NUMERIC, 0) * COALESCE((v_item->>'qty')::INTEGER, 0);
    -- Restore stock
    UPDATE products SET quantity = quantity + COALESCE((v_item->>'qty')::INTEGER, 0)
    WHERE lower(name) = lower(v_item->>'name') OR id = COALESCE(v_item->>'productId', '');
  END LOOP;

  INSERT INTO refunds (id, refund_no, date, original_receipt_no, original_sale_id,
    items, refund_amount, reason, processed_by, customer, status)
  VALUES (v_refund_id, v_refund_no, now(), p_receipt_no, v_sale.id,
    p_items, v_amount, p_reason, p_processed_by, p_customer, 'Completed');

  -- Check if full refund → void original sale
  IF jsonb_array_length(p_items) = jsonb_array_length(v_sale.items) THEN
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
$$ LANGUAGE plpgsql;

-- ======================== RPC: DASHBOARD ========================

CREATE OR REPLACE FUNCTION get_dashboard() RETURNS JSON AS $$
DECLARE today_start TIMESTAMPTZ; result JSON;
BEGIN
  today_start := date_trunc('day', now());
  SELECT json_build_object(
    'todaySales', COALESCE((SELECT SUM(total) FROM sales WHERE date >= today_start AND NOT voided), 0),
    'todayProfit', COALESCE((SELECT SUM(profit) FROM sales WHERE date >= today_start AND NOT voided), 0),
    'todayCount', COALESCE((SELECT COUNT(*) FROM sales WHERE date >= today_start AND NOT voided), 0),
    'pendingOrders', COALESCE((SELECT COUNT(*) FROM whatsapp_orders WHERE status = 'Pending'), 0),
    'paystackOrders', COALESCE((SELECT COUNT(*) FROM whatsapp_orders WHERE paystack_ref != '' AND status != 'Cancelled'), 0)
  ) INTO result;
  RETURN result;
END;
$$ LANGUAGE plpgsql;

-- ======================== REALTIME ========================
-- Live updates for key tables
ALTER PUBLICATION supabase_realtime ADD TABLE whatsapp_orders;
ALTER PUBLICATION supabase_realtime ADD TABLE sales;
ALTER PUBLICATION supabase_realtime ADD TABLE products;

-- ============================================================================
-- DONE! Now paste your SUPABASE_URL and SUPABASE_ANON_KEY into the frontend.
-- ============================================================================
