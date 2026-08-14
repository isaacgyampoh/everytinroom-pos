-- ============================================================
-- EVERYTINROOM — Phase 3 (stock-take approval) + Phase 4 (audit ledger)
-- Run once in Supabase → SQL Editor.
-- ============================================================

-- ---------- Phase 4: the stock ledger (every change, ever) ----------
CREATE TABLE IF NOT EXISTS stock_ledger (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id   text,
  product_name text DEFAULT '',
  previous_qty int,
  change_qty   int,
  new_qty      int,
  reason       text DEFAULT '',
  action_type  text DEFAULT '',   -- sale | receiving | stock_take | adjustment | manual | return | damaged
  staff        text DEFAULT '',
  reference    text DEFAULT '',
  created_at   timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ledger_product ON stock_ledger(product_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ledger_type ON stock_ledger(action_type);
ALTER TABLE stock_ledger ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "staff ledger" ON stock_ledger;
CREATE POLICY "staff ledger" ON stock_ledger FOR ALL USING (true) WITH CHECK (true);

-- ---------- Phase 3: stock-take approval ----------
-- Add approval fields to stock_takes (safe/additive).
ALTER TABLE stock_takes ADD COLUMN IF NOT EXISTS status text DEFAULT 'approved';
ALTER TABLE stock_takes ADD COLUMN IF NOT EXISTS approved_by text DEFAULT '';
ALTER TABLE stock_takes ADD COLUMN IF NOT EXISTS approved_at timestamptz;
ALTER TABLE stock_takes ADD COLUMN IF NOT EXISTS reject_reason text DEFAULT '';
-- Existing rows are historical/applied -> mark them approved so nothing looks pending.
UPDATE stock_takes SET status = 'approved' WHERE status IS NULL;

-- Approve a stock-take: set each counted product to its PHYSICAL count, log the
-- variance to the ledger, mark approved. Idempotent.
CREATE OR REPLACE FUNCTION approve_stock_take(p_id uuid, p_approver text)
RETURNS jsonb AS $$
DECLARE
  rec record;
  item jsonb;
  prod record;
  counted int;
  applied int := 0;
BEGIN
  SELECT * INTO rec FROM stock_takes WHERE id = p_id;
  IF rec.id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'not found'); END IF;
  IF rec.status = 'approved' THEN RETURN jsonb_build_object('success', false, 'error', 'already approved'); END IF;

  FOR item IN SELECT * FROM jsonb_array_elements(rec.items) LOOP
    SELECT id, quantity, name INTO prod FROM products WHERE id = (item->>'productId');
    IF prod.id IS NOT NULL THEN
      counted := COALESCE((item->>'countedQty')::int, prod.quantity);
      IF counted <> prod.quantity THEN
        INSERT INTO stock_ledger (product_id, product_name, previous_qty, change_qty, new_qty, reason, action_type, staff, reference)
        VALUES (prod.id, prod.name, prod.quantity, counted - prod.quantity, counted, 'Stock take approved', 'stock_take', p_approver, 'ST-' || left(p_id::text, 8));
        UPDATE products SET quantity = counted WHERE id = prod.id;
        applied := applied + 1;
      END IF;
    END IF;
  END LOOP;

  UPDATE stock_takes SET status = 'approved', approved_by = p_approver, approved_at = now() WHERE id = p_id;
  RETURN jsonb_build_object('success', true, 'applied', applied);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
