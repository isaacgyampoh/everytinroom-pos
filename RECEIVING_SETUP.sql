-- ============================================================
-- EVERYTINROOM — Phase 2: Supplier Receiving (with approval)
-- Warehouse staff record deliveries; stock only changes AFTER an
-- admin approves. Full variance + audit trail.
-- Run once in Supabase → SQL Editor.
-- ============================================================

-- Suppliers (optional master list; receiving can also use a free-text name).
CREATE TABLE IF NOT EXISTS suppliers (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  phone      text DEFAULT '',
  notes      text DEFAULT '',
  active     boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- A receiving record = one delivery from a supplier.
CREATE TABLE IF NOT EXISTS receivings (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ref_no        text UNIQUE NOT NULL,
  supplier_name text DEFAULT '',
  supplier_id   uuid REFERENCES suppliers(id),
  status        text DEFAULT 'pending',   -- pending | approved | rejected
  items         jsonb DEFAULT '[]',       -- [{product_id,name,expected,received,variance,cost_price}]
  total_expected int DEFAULT 0,
  total_received int DEFAULT 0,
  note          text DEFAULT '',
  created_by    text DEFAULT '',
  created_at    timestamptz DEFAULT now(),
  approved_by   text DEFAULT '',
  approved_at   timestamptz,
  reject_reason text DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_receivings_status ON receivings(status);
CREATE INDEX IF NOT EXISTS idx_receivings_created ON receivings(created_at);

-- Approve a receiving: apply the RECEIVED quantities to stock, log each change
-- in the audit trail (see Phase 4), and mark approved. Idempotent — a receiving
-- can only be approved once.
CREATE OR REPLACE FUNCTION approve_receiving(p_id uuid, p_approver text)
RETURNS jsonb AS $$
DECLARE
  rec record;
  item jsonb;
  prod record;
  new_qty int;
  applied int := 0;
BEGIN
  SELECT * INTO rec FROM receivings WHERE id = p_id;
  IF rec.id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'not found'); END IF;
  IF rec.status <> 'pending' THEN RETURN jsonb_build_object('success', false, 'error', 'already ' || rec.status); END IF;

  FOR item IN SELECT * FROM jsonb_array_elements(rec.items) LOOP
    SELECT id, quantity, name INTO prod FROM products WHERE id = (item->>'product_id');
    IF prod.id IS NOT NULL THEN
      new_qty := prod.quantity + COALESCE((item->>'received')::int, 0);
      UPDATE products SET quantity = new_qty WHERE id = prod.id;
      -- Audit log (Phase 4 table; created there). Safe if table exists.
      BEGIN
        INSERT INTO stock_ledger (product_id, product_name, previous_qty, change_qty, new_qty, reason, action_type, staff, reference)
        VALUES (prod.id, prod.name, prod.quantity, COALESCE((item->>'received')::int,0), new_qty,
                'Supplier receiving approved', 'receiving', p_approver, rec.ref_no);
      EXCEPTION WHEN undefined_table THEN NULL; END;
      applied := applied + 1;
    END IF;
  END LOOP;

  UPDATE receivings SET status = 'approved', approved_by = p_approver, approved_at = now() WHERE id = p_id;
  RETURN jsonb_build_object('success', true, 'applied', applied);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- RLS
ALTER TABLE suppliers  ENABLE ROW LEVEL SECURITY;
ALTER TABLE receivings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "staff suppliers" ON suppliers;
CREATE POLICY "staff suppliers" ON suppliers FOR ALL USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "staff receivings" ON receivings;
CREATE POLICY "staff receivings" ON receivings FOR ALL USING (true) WITH CHECK (true);
