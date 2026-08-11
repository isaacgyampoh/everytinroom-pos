-- ============================================================
-- EVERYTINROOM — Phase 1: Staff Permissions
-- Adds granular permissions per staff member. Safe & additive —
-- existing staff keep working (Admins get everything, others get Sales).
-- Run once in Supabase → SQL Editor.
-- ============================================================

-- 1. Add a permissions column (JSON array of permission keys).
ALTER TABLE staff ADD COLUMN IF NOT EXISTS permissions jsonb DEFAULT '[]'::jsonb;

-- 2. Backfill existing staff so nothing breaks:
--    Admins -> all permissions; everyone else -> Sales.
UPDATE staff
SET permissions = '["sales","stock_taking","product_receiving","product_management","inventory_view","reports","admin"]'::jsonb
WHERE role = 'Admin' AND (permissions = '[]'::jsonb OR permissions IS NULL);

UPDATE staff
SET permissions = '["sales"]'::jsonb
WHERE role <> 'Admin' AND (permissions = '[]'::jsonb OR permissions IS NULL);

-- 3. Update verify_pin to return permissions too.
CREATE OR REPLACE FUNCTION verify_pin(p_pin text)
RETURNS jsonb AS $$
DECLARE
  staff_record record;
BEGIN
  SELECT id, name, role, active, permissions INTO staff_record
  FROM staff
  WHERE pin = p_pin AND active = true
  LIMIT 1;

  IF staff_record.id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', true,
      'id', staff_record.id,
      'name', staff_record.name,
      'role', staff_record.role,
      'permissions', COALESCE(staff_record.permissions, '[]'::jsonb)
    );
  END IF;

  RETURN jsonb_build_object('success', false);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Permission keys reference (for the app):
--   sales                -> create/process sales
--   stock_taking         -> print sheets, count, submit adjustments
--   product_receiving    -> receive supplier deliveries
--   product_management   -> add/edit products
--   inventory_view       -> view stock & inventory reports
--   reports              -> view permitted reports
--   admin                -> full access (implies all of the above)
