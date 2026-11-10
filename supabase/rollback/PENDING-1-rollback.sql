-- ===========================================================================
-- ROLLBACK for PENDING-1-additive.sql
--
-- PENDING-1 only CREATES. It adds six functions and one defaulted column to
-- two tables, and changes no existing row. So a complete rollback is a list
-- of DROP statements -- there is no data to restore and nothing to undo
-- beyond removing what was added.
--
-- Signatures are exact. A DROP FUNCTION with the wrong argument list does not
-- warn, it fails, so each one was taken from the CREATE in PENDING-1 and the
-- pair was tested in both directions against a scratch database before the
-- migration was applied.
--
-- Dropping the column also drops its CHECK constraint, so the constraints are
-- not named separately.
--
-- WHAT THIS DOES NOT DO
--   It does not restore data, because none was altered. If the application
--   has already written channel values, those are lost with the column -- the
--   column's default is 'both', which is what every existing row got, so
--   nothing distinguishing is lost unless somebody has edited a promo since.
-- ===========================================================================

BEGIN;

DROP FUNCTION IF EXISTS public.place_web_order(jsonb, text, text, text, text, numeric);
DROP FUNCTION IF EXISTS public.web_deals();
DROP FUNCTION IF EXISTS public.web_price(text);
DROP FUNCTION IF EXISTS public.promo_price(text, text);
DROP FUNCTION IF EXISTS public.find_sale_by_receipt(text, text);
DROP FUNCTION IF EXISTS public.list_sales(text, integer);

ALTER TABLE public.promos  DROP COLUMN IF EXISTS channel;
ALTER TABLE public.bundles DROP COLUMN IF EXISTS channel;

-- Confirm, in the same transaction, that nothing is left behind.
DO $$
DECLARE leftover text;
BEGIN
  SELECT string_agg(p.proname, ', ') INTO leftover
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname IN ('list_sales','find_sale_by_receipt','promo_price',
                       'web_price','web_deals','place_web_order');
  IF leftover IS NOT NULL THEN
    RAISE EXCEPTION 'These functions survived the rollback: %. The signatures do not match.', leftover;
  END IF;

  SELECT string_agg(table_name || '.channel', ', ') INTO leftover
    FROM information_schema.columns
   WHERE table_schema = 'public' AND column_name = 'channel'
     AND table_name IN ('promos','bundles');
  IF leftover IS NOT NULL THEN
    RAISE EXCEPTION 'These columns survived the rollback: %', leftover;
  END IF;

  RAISE NOTICE 'Rollback verified: all six functions and both columns are gone.';
END $$;

COMMIT;
