-- ============================================================================
-- EVERYTINROOM POS — 024: WHAT SUPABASE'S OWN ADVISORS FLAGGED
--
-- Running the project's security and performance advisors turned up one class
-- of real problem and a handful of false alarms worth documenting so nobody
-- "fixes" them later and breaks the lockdown.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. SECURITY DEFINER functions with a mutable search_path.
--
--    Nine functions run as their owner but resolve object names against
--    whatever search_path the CALLER supplies. Anyone able to create an object
--    in a schema earlier on that path can put their own `products` or `sales`
--    in front of the real one and have a privileged function operate on it.
--    These predate this work — the SMS reporters, the WhatsApp stock hooks —
--    and all of them touch money or send messages.
--
--    Pinning the path costs nothing and closes the whole class.
-- ---------------------------------------------------------------------------
DO $fix$
DECLARE r record; n int := 0;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
      FROM pg_proc p
      JOIN pg_namespace ns ON ns.oid = p.pronamespace
     WHERE ns.nspname = 'public'
       AND p.prokind = 'f'
       AND COALESCE(p.proconfig::text, '') NOT LIKE '%search_path%'
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path = public, extensions', r.sig);
    n := n + 1;
  END LOOP;
  RAISE NOTICE 'search_path pinned on % functions', n;
END $fix$;

-- ---------------------------------------------------------------------------
-- 2. products_sale does not need to be SECURITY DEFINER.
--
--    A definer view bypasses RLS on what it reads. staff_safe genuinely needs
--    that — the staff table is revoked from anon and the view is the only way
--    in. products_sale reads `products`, which anon may already select, so it
--    can run as the caller and lose the extra privilege. One fewer definer
--    object is one fewer thing to reason about.
-- ---------------------------------------------------------------------------
ALTER VIEW products_sale SET (security_invoker = on);

-- staff_safe stays SECURITY DEFINER ON PURPOSE. The advisor flags it as an
-- error; it is the mechanism that lets the app read names and roles while the
-- PIN column stays unreachable. Making it security_invoker would return zero
-- rows to every till.

-- ---------------------------------------------------------------------------
-- 3. Tables with RLS enabled and no policy are also deliberate.
--
--    doc_counters, pin_attempts, staff_sessions and staff are reachable only
--    through SECURITY DEFINER functions. "No policy" is the point: nothing
--    holding the anon key can read a counter, a login attempt, a session token
--    or a PIN hash directly. Adding a permissive policy to satisfy the advisor
--    would undo migrations 015 and 016.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 4. Housekeeping the advisors caught.
-- ---------------------------------------------------------------------------

-- The photo rollback table has no primary key. It is a snapshot, but it is the
-- only route back to the original images, so give it one rather than delete it.
ALTER TABLE image_rollback_20260831
  ADD CONSTRAINT image_rollback_20260831_pkey PRIMARY KEY (id);

-- 016 created idx_sales_date_voided and 023 created idx_sales_date_live over
-- the same predicate. Two identical indexes cost write time on every sale.
DROP INDEX IF EXISTS idx_sales_date_live;

-- The USSD code index from 016 never applied (history holds duplicates) and was
-- replaced by the partial one in 022; drop the dead attempt if it exists.
DROP INDEX IF EXISTS idx_wa_ussd_code_unique;

-- Verify: this should return no rows.
--   SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname='public' AND p.prokind='f'
--      AND COALESCE(p.proconfig::text,'') NOT LIKE '%search_path%';

-- Two SELECT policies on `products` both said USING (true): products_select
-- covers anon and authenticated, public_read_products covered anon only. The
-- second grants nothing the first does not, and Postgres evaluates every
-- permissive policy on every read.
DROP POLICY IF EXISTS "public_read_products" ON products;
