-- ============================================
-- Add wholesale minimum quantity to products
-- Run in Supabase SQL Editor
-- ============================================

-- Add the column (default 0 means no wholesale minimum set)
ALTER TABLE products ADD COLUMN IF NOT EXISTS wholesale_min_qty integer DEFAULT 0;

-- Example: If a product has wholesale_price = 15 and wholesale_min_qty = 6,
-- when a customer adds 6+ of that product to cart, the price auto-switches
-- from retail price to wholesale price.
