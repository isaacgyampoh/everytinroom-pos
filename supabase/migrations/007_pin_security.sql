-- ============================================
-- SECURITY: Server-side PIN verification
-- Run this in Supabase SQL Editor
-- PINs will no longer be sent to the browser
-- ============================================

CREATE OR REPLACE FUNCTION verify_pin(p_pin text)
RETURNS jsonb AS $$
DECLARE
  staff_record record;
BEGIN
  -- Check staff table
  SELECT id, name, role, active INTO staff_record
  FROM staff
  WHERE pin = p_pin AND active = true
  LIMIT 1;

  IF staff_record.id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', true,
      'id', staff_record.id,
      'name', staff_record.name,
      'role', staff_record.role
    );
  END IF;

  -- Not found
  RETURN jsonb_build_object('success', false);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
