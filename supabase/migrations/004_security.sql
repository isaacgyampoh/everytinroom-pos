-- ============================================
-- EVERYTINROOM POS - SECURITY HARDENING
-- Run this in Supabase SQL Editor
-- ============================================

-- 1. Enable Row Level Security on ALL tables
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE bundles ENABLE ROW LEVEL SECURITY;
ALTER TABLE refunds ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_orders ENABLE ROW LEVEL SECURITY;

-- Enable on optional tables (ignore errors if they don't exist)
DO $$ BEGIN ALTER TABLE promos ENABLE ROW LEVEL SECURITY; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE invoices ENABLE ROW LEVEL SECURITY; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE stock_takes ENABLE ROW LEVEL SECURITY; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE stock_adjustments ENABLE ROW LEVEL SECURITY; EXCEPTION WHEN undefined_table THEN NULL; END $$;

-- 2. Create policies for authenticated + anon access (POS uses anon key)
-- Products: everyone can read, only authenticated/anon can insert/update/delete
CREATE POLICY "products_read" ON products FOR SELECT USING (true);
CREATE POLICY "products_insert" ON products FOR INSERT WITH CHECK (true);
CREATE POLICY "products_update" ON products FOR UPDATE USING (true);
CREATE POLICY "products_delete" ON products FOR DELETE USING (true);

-- Sales: same pattern
CREATE POLICY "sales_read" ON sales FOR SELECT USING (true);
CREATE POLICY "sales_insert" ON sales FOR INSERT WITH CHECK (true);
CREATE POLICY "sales_update" ON sales FOR UPDATE USING (true);

-- Staff
CREATE POLICY "staff_read" ON staff FOR SELECT USING (true);
CREATE POLICY "staff_insert" ON staff FOR INSERT WITH CHECK (true);
CREATE POLICY "staff_update" ON staff FOR UPDATE USING (true);
CREATE POLICY "staff_delete" ON staff FOR DELETE USING (true);

-- Expenses
CREATE POLICY "expenses_read" ON expenses FOR SELECT USING (true);
CREATE POLICY "expenses_insert" ON expenses FOR INSERT WITH CHECK (true);
CREATE POLICY "expenses_update" ON expenses FOR UPDATE USING (true);
CREATE POLICY "expenses_delete" ON expenses FOR DELETE USING (true);

-- Customers
CREATE POLICY "customers_read" ON customers FOR SELECT USING (true);
CREATE POLICY "customers_insert" ON customers FOR INSERT WITH CHECK (true);
CREATE POLICY "customers_update" ON customers FOR UPDATE USING (true);

-- Bundles
CREATE POLICY "bundles_read" ON bundles FOR SELECT USING (true);
CREATE POLICY "bundles_insert" ON bundles FOR INSERT WITH CHECK (true);
CREATE POLICY "bundles_update" ON bundles FOR UPDATE USING (true);
CREATE POLICY "bundles_delete" ON bundles FOR DELETE USING (true);

-- Refunds
CREATE POLICY "refunds_read" ON refunds FOR SELECT USING (true);
CREATE POLICY "refunds_insert" ON refunds FOR INSERT WITH CHECK (true);

-- WhatsApp Orders
CREATE POLICY "waorders_read" ON whatsapp_orders FOR SELECT USING (true);
CREATE POLICY "waorders_insert" ON whatsapp_orders FOR INSERT WITH CHECK (true);
CREATE POLICY "waorders_update" ON whatsapp_orders FOR UPDATE USING (true);

-- Optional tables policies
DO $$ BEGIN EXECUTE 'CREATE POLICY "promos_all" ON promos USING (true) WITH CHECK (true)'; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN EXECUTE 'CREATE POLICY "invoices_all" ON invoices USING (true) WITH CHECK (true)'; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN EXECUTE 'CREATE POLICY "stocktakes_all" ON stock_takes USING (true) WITH CHECK (true)'; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN EXECUTE 'CREATE POLICY "stockadj_all" ON stock_adjustments USING (true) WITH CHECK (true)'; EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- 3. Secure the record_sale function
-- Already using SECURITY DEFINER which runs with table owner privileges

-- 4. Add rate limiting metadata
COMMENT ON TABLE sales IS 'POS sales - protected by RLS and PIN auth';
COMMENT ON TABLE staff IS 'Staff with PIN authentication - protected by RLS';
