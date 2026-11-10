-- ============================================
-- SECURITY: Restrict PIN column access
-- Run this in Supabase SQL Editor
-- ============================================

-- Create a secure view for staff that excludes PINs
-- The frontend should use this view instead of the staff table directly
CREATE OR REPLACE VIEW staff_safe AS
SELECT id, name, role, active
FROM staff;

-- Grant access to the view
GRANT SELECT ON staff_safe TO anon, authenticated;

-- Create a secure function to update staff with optional PIN
-- This prevents the frontend from needing to read PINs
CREATE OR REPLACE FUNCTION update_staff_secure(
  p_id uuid,
  p_name text,
  p_role text,
  p_pin text DEFAULT NULL,
  p_active boolean DEFAULT true
)
RETURNS jsonb AS $$
BEGIN
  IF p_pin IS NOT NULL AND length(p_pin) = 4 THEN
    UPDATE staff SET name = p_name, role = p_role, pin = p_pin, active = p_active WHERE id = p_id;
  ELSE
    UPDATE staff SET name = p_name, role = p_role, active = p_active WHERE id = p_id;
  END IF;
  RETURN jsonb_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create a secure function to add new staff
CREATE OR REPLACE FUNCTION add_staff_secure(
  p_name text,
  p_role text,
  p_pin text,
  p_active boolean DEFAULT true
)
RETURNS jsonb AS $$
DECLARE
  new_id uuid;
BEGIN
  IF length(p_pin) != 4 THEN
    RETURN jsonb_build_object('success', false, 'error', 'PIN must be 4 digits');
  END IF;
  
  INSERT INTO staff (name, role, pin, active)
  VALUES (p_name, p_role, p_pin, p_active)
  RETURNING id INTO new_id;
  
  RETURN jsonb_build_object('success', true, 'id', new_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
