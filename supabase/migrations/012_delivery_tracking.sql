-- Add delivery tracking columns to whatsapp_orders
ALTER TABLE whatsapp_orders ADD COLUMN IF NOT EXISTS tracking_no TEXT DEFAULT '';
ALTER TABLE whatsapp_orders ADD COLUMN IF NOT EXISTS delivery_status TEXT DEFAULT '';
ALTER TABLE whatsapp_orders ADD COLUMN IF NOT EXISTS delivery_guy TEXT DEFAULT '';
ALTER TABLE whatsapp_orders ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ;
ALTER TABLE whatsapp_orders ADD COLUMN IF NOT EXISTS delivery_photo TEXT DEFAULT '';
ALTER TABLE whatsapp_orders ADD COLUMN IF NOT EXISTS delivery_notes TEXT DEFAULT '';

-- Generate tracking number function
CREATE OR REPLACE FUNCTION generate_tracking_no()
RETURNS TEXT AS $$
DECLARE
  track TEXT;
BEGIN
  track := 'ETR-' || TO_CHAR(NOW(), 'YYMMDD') || '-' || LPAD(FLOOR(RANDOM() * 10000)::TEXT, 4, '0');
  RETURN track;
END;
$$ LANGUAGE plpgsql;

-- Auto-assign tracking number when order moves to Paid
CREATE OR REPLACE FUNCTION auto_tracking_no()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'Paid' AND (OLD.status IS NULL OR OLD.status != 'Paid') AND (NEW.tracking_no IS NULL OR NEW.tracking_no = '') THEN
    NEW.tracking_no := 'ETR-' || TO_CHAR(NOW(), 'YYMMDD') || '-' || LPAD(FLOOR(RANDOM() * 10000)::TEXT, 4, '0');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_auto_tracking ON whatsapp_orders;
CREATE TRIGGER trg_auto_tracking
  BEFORE UPDATE ON whatsapp_orders
  FOR EACH ROW
  EXECUTE FUNCTION auto_tracking_no();

-- Also assign tracking on insert if status is Paid
CREATE OR REPLACE FUNCTION auto_tracking_no_insert()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'Paid' AND (NEW.tracking_no IS NULL OR NEW.tracking_no = '') THEN
    NEW.tracking_no := 'ETR-' || TO_CHAR(NOW(), 'YYMMDD') || '-' || LPAD(FLOOR(RANDOM() * 10000)::TEXT, 4, '0');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_auto_tracking_insert ON whatsapp_orders;
CREATE TRIGGER trg_auto_tracking_insert
  BEFORE INSERT ON whatsapp_orders
  FOR EACH ROW
  EXECUTE FUNCTION auto_tracking_no_insert();
