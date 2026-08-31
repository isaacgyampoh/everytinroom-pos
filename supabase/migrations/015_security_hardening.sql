-- ============================================================================
-- EVERYTINROOM POS — 015: SECURITY HARDENING
--
-- Fixes the critical hole where ANY holder of the public anon key could read
-- every staff PIN (including Admin) straight off the REST API, and could
-- create/modify/delete staff rows at will.
--
-- After this migration:
--   * the `staff` table is unreachable from the anon/authenticated roles
--   * the app reads staff from the `staff_safe` view (no PIN column)
--   * PIN login issues a short-lived server-side session token
--   * staff management goes through token-gated SECURITY DEFINER functions
--
-- RUN THIS TOGETHER WITH 016. The frontend in this commit expects both.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Session tokens — server-side proof of "who is logged in".
--    Until now every permission check lived in the browser, so anyone holding
--    the public anon key could call any RPC as if they were an admin.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS staff_sessions (
  token       TEXT PRIMARY KEY,
  staff_id    TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL,
  last_seen   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_staff_sessions_expiry ON staff_sessions(expires_at);

ALTER TABLE staff_sessions ENABLE ROW LEVEL SECURITY;
-- No policies: the table is reachable only through SECURITY DEFINER functions.
REVOKE ALL ON staff_sessions FROM anon, authenticated;

-- Failed-PIN log, so a 4-digit PIN on a public endpoint isn't free to brute force.
CREATE TABLE IF NOT EXISTS pin_attempts (
  id          BIGSERIAL PRIMARY KEY,
  at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  succeeded   BOOLEAN NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pin_attempts_at ON pin_attempts(at);
ALTER TABLE pin_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON pin_attempts FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Resolve a session token -> staff row. Used by every privileged function.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION session_staff(p_token TEXT)
RETURNS staff AS $$
DECLARE s staff;
BEGIN
  IF p_token IS NULL OR p_token = '' THEN RETURN NULL; END IF;
  SELECT st.* INTO s
  FROM staff_sessions ss
  JOIN staff st ON st.id = ss.staff_id
  WHERE ss.token = p_token
    AND ss.expires_at > now()
    AND st.active = true;
  IF FOUND THEN
    UPDATE staff_sessions SET last_seen = now() WHERE token = p_token;
  END IF;
  RETURN s;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Does the token's owner hold a permission? Admin role / 'admin' perm implies all.
CREATE OR REPLACE FUNCTION session_can(p_token TEXT, p_perm TEXT)
RETURNS BOOLEAN AS $$
DECLARE s staff; perms JSONB;
BEGIN
  s := session_staff(p_token);
  IF s.id IS NULL THEN RETURN false; END IF;
  IF s.role = 'Admin' THEN RETURN true; END IF;
  perms := COALESCE(s.permissions, '[]'::jsonb);
  RETURN perms ? 'admin' OR perms ? p_perm;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ---------------------------------------------------------------------------
-- 3. verify_pin — now issues a session token and throttles brute force.
--    Returns the same fields as before plus `token`, so older clients still work.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION verify_pin(p_pin text)
RETURNS jsonb AS $$
DECLARE
  s          record;
  recent_bad INTEGER;
  new_token  TEXT;
BEGIN
  -- Throttle: 8 failures inside 5 minutes freezes PIN login for 60 seconds.
  -- Staff almost never trip this; a scripted 10,000-PIN sweep always does.
  SELECT COUNT(*) INTO recent_bad
  FROM pin_attempts
  WHERE succeeded = false AND at > now() - interval '5 minutes';

  IF recent_bad >= 8 AND EXISTS (
    SELECT 1 FROM pin_attempts
    WHERE succeeded = false AND at > now() - interval '60 seconds'
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Too many attempts. Wait a minute and try again.');
  END IF;

  SELECT id, name, role, active, permissions INTO s
  FROM staff
  WHERE pin = p_pin AND active = true
  LIMIT 1;

  IF s.id IS NULL THEN
    INSERT INTO pin_attempts (succeeded) VALUES (false);
    RETURN jsonb_build_object('success', false);
  END IF;

  INSERT INTO pin_attempts (succeeded) VALUES (true);
  DELETE FROM pin_attempts WHERE at < now() - interval '1 day';

  -- Fresh session, 12 hours (one trading day). Old sessions for this staff
  -- member are cleared so a stolen token dies when they log in again.
  new_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  DELETE FROM staff_sessions WHERE staff_id = s.id OR expires_at < now();
  INSERT INTO staff_sessions (token, staff_id, expires_at)
  VALUES (new_token, s.id, now() + interval '12 hours');

  RETURN jsonb_build_object(
    'success', true,
    'id', s.id,
    'name', s.name,
    'role', s.role,
    'permissions', COALESCE(s.permissions, '[]'::jsonb),
    'token', new_token
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION end_session(p_token TEXT)
RETURNS jsonb AS $$
BEGIN
  DELETE FROM staff_sessions WHERE token = p_token;
  RETURN jsonb_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ---------------------------------------------------------------------------
-- 4. staff_safe — what the app is allowed to see. No PIN column, ever.
-- ---------------------------------------------------------------------------
DROP VIEW IF EXISTS staff_safe;
CREATE VIEW staff_safe AS
  SELECT id, name, role, active, COALESCE(permissions, '[]'::jsonb) AS permissions
  FROM staff;

-- ---------------------------------------------------------------------------
-- 5. Token-gated staff management. Only a session holding `admin` may touch
--    staff — this is what stops an anon-key holder from minting themselves
--    an Admin account.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION save_staff(
  p_token       TEXT,
  p_id          TEXT,
  p_name        TEXT,
  p_role        TEXT,
  p_pin         TEXT,
  p_active      BOOLEAN,
  p_permissions JSONB
) RETURNS jsonb AS $$
DECLARE new_id TEXT; perms JSONB;
BEGIN
  IF NOT session_can(p_token, 'admin') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authorised');
  END IF;
  IF COALESCE(trim(p_name), '') = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Name is required');
  END IF;
  IF p_pin IS NOT NULL AND p_pin <> '' AND p_pin !~ '^\d{4,8}$' THEN
    RETURN jsonb_build_object('success', false, 'error', 'PIN must be 4-8 digits');
  END IF;

  -- PIN uniqueness enforced HERE, where the PINs actually are. The old
  -- browser-side check compared against a column the client can no longer read,
  -- so it silently never fired and two staff could share a PIN.
  IF p_pin IS NOT NULL AND p_pin <> '' AND EXISTS (
    SELECT 1 FROM staff WHERE pin = p_pin AND (p_id IS NULL OR p_id = '' OR id <> p_id)
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'That PIN is already used by another staff member');
  END IF;

  perms := CASE WHEN p_role = 'Admin'
    THEN '["sales","stock_taking","product_receiving","product_management","inventory_view","reports","admin"]'::jsonb
    ELSE COALESCE(p_permissions, '[]'::jsonb) END;

  IF p_id IS NULL OR p_id = '' THEN
    IF p_pin IS NULL OR p_pin = '' THEN
      RETURN jsonb_build_object('success', false, 'error', 'A PIN is required for new staff');
    END IF;
    new_id := short_id();
    INSERT INTO staff (id, name, role, pin, active, permissions)
    VALUES (new_id, trim(p_name), p_role, p_pin, COALESCE(p_active, true), perms);
    RETURN jsonb_build_object('success', true, 'id', new_id);
  END IF;

  UPDATE staff SET
    name        = trim(p_name),
    role        = p_role,
    active      = COALESCE(p_active, true),
    permissions = perms,
    pin         = CASE WHEN p_pin IS NULL OR p_pin = '' THEN pin ELSE p_pin END
  WHERE id = p_id;

  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Staff not found'); END IF;
  RETURN jsonb_build_object('success', true, 'id', p_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION delete_staff(p_token TEXT, p_id TEXT)
RETURNS jsonb AS $$
DECLARE me staff; remaining INTEGER;
BEGIN
  IF NOT session_can(p_token, 'admin') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authorised');
  END IF;
  me := session_staff(p_token);
  IF me.id = p_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'You cannot delete your own account');
  END IF;

  -- Never let the shop lock itself out of its own POS.
  SELECT COUNT(*) INTO remaining FROM staff
  WHERE active = true AND id <> p_id AND (role = 'Admin' OR COALESCE(permissions, '[]'::jsonb) ? 'admin');
  IF remaining = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'This is the last admin — deleting it would lock everyone out');
  END IF;

  DELETE FROM staff_sessions WHERE staff_id = p_id;
  DELETE FROM staff WHERE id = p_id;
  RETURN jsonb_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ---------------------------------------------------------------------------
-- 6. Slam the door on the `staff` table itself.
--    Everything above is SECURITY DEFINER, so the app keeps working while the
--    anon role loses all direct access to the PIN column.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "staff_select" ON staff;
DROP POLICY IF EXISTS "staff_insert" ON staff;
DROP POLICY IF EXISTS "staff_update" ON staff;
DROP POLICY IF EXISTS "staff_delete" ON staff;
DROP POLICY IF EXISTS "anon_full_staff" ON staff;

ALTER TABLE staff ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON staff FROM anon, authenticated;

GRANT SELECT ON staff_safe TO anon, authenticated;

GRANT EXECUTE ON FUNCTION verify_pin(text)                                              TO anon, authenticated;
GRANT EXECUTE ON FUNCTION end_session(text)                                             TO anon, authenticated;
GRANT EXECUTE ON FUNCTION save_staff(text, text, text, text, text, boolean, jsonb)      TO anon, authenticated;
GRANT EXECUTE ON FUNCTION delete_staff(text, text)                                      TO anon, authenticated;

-- session_staff/session_can return internal rows — keep them server-side only.
REVOKE EXECUTE ON FUNCTION session_staff(text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION session_can(text, text) FROM anon, authenticated;

-- The old broken helpers took p_id as uuid while staff.id is TEXT, so they
-- could never actually run. Remove them rather than leave loaded footguns.
DROP FUNCTION IF EXISTS update_staff_secure(uuid, text, text, text, boolean);
DROP FUNCTION IF EXISTS add_staff_secure(text, text, text, boolean);

-- ============================================================================
-- AFTER RUNNING THIS: every PIN in the staff table has been publicly readable.
-- Change all of them from Staff & Roles before trusting the system again.
-- ============================================================================
