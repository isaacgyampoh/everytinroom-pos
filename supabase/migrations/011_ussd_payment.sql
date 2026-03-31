-- ============================================
-- 011: USSD Payment - Add ussd_code to whatsapp_orders
-- Run this in Supabase SQL Editor
-- ============================================

-- Add ussd_code column (numeric, for USSD dialing)
ALTER TABLE whatsapp_orders ADD COLUMN IF NOT EXISTS ussd_code INTEGER;

-- Create a sequence starting at 50001
CREATE SEQUENCE IF NOT EXISTS ussd_code_seq START 50001;

-- Auto-assign ussd_code when a new order is created without one
CREATE OR REPLACE FUNCTION assign_ussd_code()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.ussd_code IS NULL THEN
    NEW.ussd_code := nextval('ussd_code_seq');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop trigger if exists, then create
DROP TRIGGER IF EXISTS trg_assign_ussd_code ON whatsapp_orders;
CREATE TRIGGER trg_assign_ussd_code
  BEFORE INSERT ON whatsapp_orders
  FOR EACH ROW
  EXECUTE FUNCTION assign_ussd_code();

-- Index for fast lookup by ussd_code
CREATE INDEX IF NOT EXISTS idx_wa_ussd_code ON whatsapp_orders(ussd_code);

-- Backfill existing orders that don't have a ussd_code
UPDATE whatsapp_orders SET ussd_code = nextval('ussd_code_seq') WHERE ussd_code IS NULL;

-- Verify
SELECT id, order_no, ussd_code, total, status FROM whatsapp_orders ORDER BY date DESC LIMIT 5;
