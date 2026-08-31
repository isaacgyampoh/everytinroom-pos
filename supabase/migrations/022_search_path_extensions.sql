-- ============================================================================
-- EVERYTINROOM POS — 022: SECURITY DEFINER FUNCTIONS MUST SEE `extensions`
--
-- Migrations 015-021 pin every function to `SET search_path = public`. That is
-- the right instinct — an unpinned search_path on a SECURITY DEFINER function
-- is a privilege-escalation vector — but on Supabase it is incomplete.
--
-- Supabase installs pgcrypto and uuid-ossp into the `extensions` schema, NOT
-- into public. So a function pinned to public alone cannot see:
--
--     crypt() / gen_salt()   -> verify_pin, save_staff
--     uuid_generate_v4()     -> short_id(), and therefore record_sale,
--                               process_refund, void_sale, complete_wa_order,
--                               save_staff — every function that mints an id
--
-- Applying 015-021 as written takes the till down twice: nobody can sign in
-- (crypt missing, and 018 has already dropped the plaintext column), and no
-- sale can be recorded (uuid_generate_v4 missing). Both were hit and fixed on
-- the live database; this migration is what was actually run, so a rebuild
-- from these files lands in the same state.
-- ============================================================================

-- 1. Repoint every function this project pinned to public.
DO $fix$
DECLARE r record; n int := 0;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace ns ON ns.oid = p.pronamespace
    WHERE ns.nspname = 'public'
      AND p.proconfig::text LIKE '%search_path=public%'
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path = public, extensions', r.sig);
    n := n + 1;
  END LOOP;
  RAISE NOTICE 'search_path repointed on % functions', n;
END $fix$;

-- 2. Remove the dependency rather than just routing around it. gen_random_uuid()
--    has been in core PostgreSQL since 13, so short_id() no longer needs
--    uuid-ossp at all — one less extension that has to be on the search path
--    for a sale to be recordable.
CREATE OR REPLACE FUNCTION short_id() RETURNS TEXT AS $$
  SELECT substring(replace(gen_random_uuid()::text, '-', ''), 1, 8);
$$ LANGUAGE sql;

-- 3. History carries 55 USSD pay codes reused by the race that 016 fixed, all
--    on Cancelled or Completed orders, so the unqualified unique index in 016
--    cannot be built. The invariant that actually matters is narrower: a code a
--    customer dials must reach exactly one order that is still awaiting money.
CREATE UNIQUE INDEX IF NOT EXISTS idx_wa_ussd_code_live
  ON whatsapp_orders (ussd_code)
  WHERE ussd_code IS NOT NULL AND status IN ('Pending', 'Paid');

-- Verify: this must return zero rows.
--   SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public' AND p.proconfig::text LIKE '%search_path=public"%';
