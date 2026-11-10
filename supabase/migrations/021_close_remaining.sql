-- ============================================================================
-- EVERYTINROOM POS — 021: THE LAST OPEN DOORS
--
-- 018 gated the approval FUNCTIONS, but the tables behind them were still
-- `FOR ALL USING (true)`. Anyone with the public anon key could skip the
-- function entirely:
--
--   * UPDATE receivings SET status='approved'  — then approve_receiving is moot
--   * INSERT INTO stock_ledger ...             — forge the audit trail that is
--                                                supposed to catch exactly that
--   * UPDATE stock_takes SET status='approved' — same trick, different table
--
-- An audit ledger anyone can write to is not an audit ledger. These tables
-- become read-only to the app; every change goes through the gated functions.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Stock ledger — append-only, and only from inside a SECURITY DEFINER
--    function. The app may read it; nothing in the browser may write it.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "staff ledger" ON stock_ledger;
ALTER TABLE stock_ledger ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ledger_read" ON stock_ledger FOR SELECT TO anon, authenticated USING (true);
REVOKE INSERT, UPDATE, DELETE ON stock_ledger FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Receivings — staff may raise a delivery and read the list. Only the
--    approval function may move it out of 'pending'.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "staff receivings" ON receivings;
ALTER TABLE receivings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "receivings_read"   ON receivings FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "receivings_create" ON receivings FOR INSERT TO anon, authenticated WITH CHECK (status = 'pending');
REVOKE UPDATE, DELETE ON receivings FROM anon, authenticated;

-- Rejecting a delivery changes no stock, but it should still be an admin act
-- and it should still be attributed. ReceivingPage used to UPDATE the row directly.
CREATE OR REPLACE FUNCTION reject_receiving(p_token TEXT, p_id uuid, p_reason TEXT)
RETURNS jsonb AS $$
DECLARE me RECORD; rec RECORD;
BEGIN
  IF NOT session_can(p_token, 'admin') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Only an admin can reject a delivery');
  END IF;
  me := session_staff(p_token);
  SELECT * INTO rec FROM receivings WHERE id = p_id FOR UPDATE;
  IF rec.id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'not found'); END IF;
  IF rec.status <> 'pending' THEN RETURN jsonb_build_object('success', false, 'error', 'already ' || rec.status); END IF;

  UPDATE receivings SET status = 'rejected', reject_reason = COALESCE(p_reason, ''),
         approved_by = me.name, approved_at = now()
   WHERE id = p_id;
  RETURN jsonb_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION reject_receiving(text, uuid, text) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Stock takes — same shape. A count may be submitted; only the approval
--    function may apply it to stock.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "stocktakes_all" ON stock_takes;
DROP POLICY IF EXISTS "anon_full_stock_takes" ON stock_takes;
ALTER TABLE stock_takes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "stocktakes_read"   ON stock_takes FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "stocktakes_create" ON stock_takes FOR INSERT TO anon, authenticated WITH CHECK (status <> 'approved');
REVOKE UPDATE, DELETE ON stock_takes FROM anon, authenticated;

CREATE OR REPLACE FUNCTION reject_stock_take(p_token TEXT, p_id uuid, p_reason TEXT)
RETURNS jsonb AS $$
DECLARE me RECORD; rec RECORD;
BEGIN
  IF NOT session_can(p_token, 'admin') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Only an admin can reject a stock take');
  END IF;
  me := session_staff(p_token);
  SELECT * INTO rec FROM stock_takes WHERE id = p_id FOR UPDATE;
  IF rec.id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'not found'); END IF;
  IF rec.status = 'approved' THEN RETURN jsonb_build_object('success', false, 'error', 'already approved'); END IF;

  UPDATE stock_takes SET status = 'rejected', reject_reason = COALESCE(p_reason, ''),
         approved_by = me.name, approved_at = now()
   WHERE id = p_id;
  RETURN jsonb_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION reject_stock_take(text, uuid, text) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Suppliers — read for everyone, changes for admins.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "staff suppliers" ON suppliers;
ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "suppliers_read" ON suppliers FOR SELECT TO anon, authenticated USING (true);
REVOKE INSERT, UPDATE, DELETE ON suppliers FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Stock adjustments — a cashier writing straight to this table can hide a
--    shortage. Submissions are allowed (that is the point) but they cannot be
--    edited or deleted afterwards.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "stockadj_all" ON stock_adjustments;
DROP POLICY IF EXISTS "anon_full_stock_adjustments" ON stock_adjustments;
ALTER TABLE stock_adjustments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "stockadj_read"   ON stock_adjustments FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "stockadj_create" ON stock_adjustments FOR INSERT TO anon, authenticated WITH CHECK (true);
REVOKE UPDATE, DELETE ON stock_adjustments FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. Sales and refunds are the books. They are already insert-through-RPC and
--    never deleted; make that explicit rather than implied.
-- ---------------------------------------------------------------------------
REVOKE DELETE ON sales FROM anon, authenticated;
REVOKE DELETE, UPDATE ON refunds FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. Strip cost prices out of historical receipt lines.
--
--    `sales` is readable by every till, and rows written before migration 019
--    carry `costPrice` inside their items JSON — so the margin sheet was still
--    reachable through the sales history. Nothing reads the field: profit has
--    its own column, and 019 made record_sale compute it server-side.
-- ---------------------------------------------------------------------------
UPDATE sales
   SET items = COALESCE((
         SELECT jsonb_agg(item - 'costPrice' ORDER BY ord)
           FROM jsonb_array_elements(items) WITH ORDINALITY AS t(item, ord)
       ), '[]'::jsonb)
 WHERE items::text LIKE '%costPrice%';
