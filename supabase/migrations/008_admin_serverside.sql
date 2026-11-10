-- ============================================
-- SECURITY UPDATE: Admin PIN also server-side
-- Run in Supabase SQL Editor
-- ============================================

-- Make sure you have an Admin staff record.
-- The PIN that used to be written here in plain text ('1024') was published to
-- a public repo and must be considered compromised — see SECURITY.md. Set a new
-- one below before running, and never commit a real PIN again.
INSERT INTO staff (name, role, pin, active)
VALUES ('Admin', 'Admin', '__SET_A_NEW_PIN__', true)
ON CONFLICT DO NOTHING;

-- If Admin already exists, change the PIN from the Staff & Roles screen rather
-- than here, so it is never written into a file that gets committed.

-- The verify_pin function already checks the staff table,
-- so Admin will be verified server-side like all other staff.
-- No PIN is exposed in the browser anymore.
