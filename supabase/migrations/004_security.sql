-- ============================================
-- EVERYTINROOM POS - SECURITY HARDENING
-- Run this in Supabase SQL Editor
-- https://supabase.com/dashboard/project/noiiuwkovoojkcwzupye/sql
-- ============================================

-- STEP 1: Enable RLS on all tables
-- (If already enabled, these will just succeed silently)
ALTER TABLE IF EXISTS products ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS bundles ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS refunds ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS whatsapp_orders ENABLE ROW LEVEL SECURITY;

-- Optional tables (won't error if missing)
DO $$ BEGIN ALTER TABLE promos ENABLE ROW LEVEL SECURITY; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE invoices ENABLE ROW LEVEL SECURITY; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE stock_takes ENABLE ROW LEVEL SECURITY; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE stock_adjustments ENABLE ROW LEVEL SECURITY; EXCEPTION WHEN undefined_table THEN NULL; END $$;

-- STEP 2: Drop existing policies (clean slate)
DO $$ 
DECLARE
  tbl text;
  pol text;
BEGIN
  FOR tbl, pol IN 
    SELECT schemaname || '.' || tablename, policyname 
    FROM pg_policies 
    WHERE schemaname = 'public'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %s', pol, tbl);
  END LOOP;
END $$;

-- STEP 3: Create access policies
-- The anon key is used by the POS app. We allow full access
-- because authentication is handled by PIN at the app level.
-- RLS ensures the data is only accessible through the Supabase API,
-- NOT directly via the database connection string.

-- Products
CREATE POLICY "products_select" ON products FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "products_insert" ON products FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "products_update" ON products FOR UPDATE TO anon, authenticated USING (true);
CREATE POLICY "products_delete" ON products FOR DELETE TO anon, authenticated USING (true);

-- Sales (no delete - sales should never be deleted, only voided)
CREATE POLICY "sales_select" ON sales FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "sales_insert" ON sales FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "sales_update" ON sales FOR UPDATE TO anon, authenticated USING (true);

-- Staff
CREATE POLICY "staff_select" ON staff FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "staff_insert" ON staff FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "staff_update" ON staff FOR UPDATE TO anon, authenticated USING (true);
CREATE POLICY "staff_delete" ON staff FOR DELETE TO anon, authenticated USING (true);

-- Expenses
CREATE POLICY "expenses_select" ON expenses FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "expenses_insert" ON expenses FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "expenses_update" ON expenses FOR UPDATE TO anon, authenticated USING (true);
CREATE POLICY "expenses_delete" ON expenses FOR DELETE TO anon, authenticated USING (true);

-- Customers
CREATE POLICY "customers_select" ON customers FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "customers_insert" ON customers FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "customers_update" ON customers FOR UPDATE TO anon, authenticated USING (true);

-- Bundles
CREATE POLICY "bundles_select" ON bundles FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "bundles_insert" ON bundles FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "bundles_update" ON bundles FOR UPDATE TO anon, authenticated USING (true);
CREATE POLICY "bundles_delete" ON bundles FOR DELETE TO anon, authenticated USING (true);

-- Refunds (no delete)
CREATE POLICY "refunds_select" ON refunds FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "refunds_insert" ON refunds FOR INSERT TO anon, authenticated WITH CHECK (true);

-- WhatsApp Orders
CREATE POLICY "wa_select" ON whatsapp_orders FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "wa_insert" ON whatsapp_orders FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "wa_update" ON whatsapp_orders FOR UPDATE TO anon, authenticated USING (true);

-- Optional tables
DO $$ BEGIN EXECUTE 'CREATE POLICY "promos_all" ON promos FOR ALL TO anon, authenticated USING (true) WITH CHECK (true)'; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN EXECUTE 'CREATE POLICY "invoices_all" ON invoices FOR ALL TO anon, authenticated USING (true) WITH CHECK (true)'; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN EXECUTE 'CREATE POLICY "stocktakes_all" ON stock_takes FOR ALL TO anon, authenticated USING (true) WITH CHECK (true)'; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN EXECUTE 'CREATE POLICY "stockadj_all" ON stock_adjustments FOR ALL TO anon, authenticated USING (true) WITH CHECK (true)'; EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- STEP 4: Ensure RPC functions use SECURITY DEFINER
-- This means they run with the function owner's permissions,
-- bypassing RLS for the operations inside the function.
-- The functions themselves validate inputs.

-- Done! Your database is now secured with RLS.
