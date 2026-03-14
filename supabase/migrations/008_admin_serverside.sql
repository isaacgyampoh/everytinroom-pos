-- ============================================
-- SECURITY UPDATE: Admin PIN also server-side
-- Run in Supabase SQL Editor
-- ============================================

-- Make sure you have an Admin staff record with PIN 1024
-- (or whatever PIN you want for admin)
INSERT INTO staff (name, role, pin, active)
VALUES ('Admin', 'Admin', '1024', true)
ON CONFLICT DO NOTHING;

-- If Admin already exists, update the PIN:
-- UPDATE staff SET pin = '1024' WHERE name = 'Admin' AND role = 'Admin';

-- The verify_pin function already checks the staff table,
-- so Admin will be verified server-side like all other staff.
-- No PIN is exposed in the browser anymore.
