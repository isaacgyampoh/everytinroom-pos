-- ===========================================================================
-- Schema that existed only in hand-run setup scripts.
--
-- WHAT WENT WRONG
--   Eleven .sql files sit at the root of this repository. They were written to
--   be pasted into the Supabase SQL editor once, by hand, and several of them
--   add schema the application depends on. None of it was ever written into
--   supabase/migrations/, so the migration set is not a complete description
--   of the database the till talks to.
--
--   That stayed invisible because production already has these objects: they
--   were applied by hand when each feature shipped. It surfaced the first time
--   anything built the schema from the migrations alone, which the staging
--   acceptance suite does. The result was HTTP 400 from verify_pin:
--
--     {"code":"42703","message":"column \"permissions\" does not exist"}
--
--   verify_pin reads staff.permissions, PostgREST turns 42703 into a 400, and
--   the login screen simply refused every PIN. Nobody could sign in to a
--   database built from this repository's own migrations.
--
-- WHAT THIS DOES NOT CHANGE
--   The migration path for the VPS move restores a pg_dump of the live
--   database, so the new server gets production's schema including all of
--   this. This file is not what makes that migration work; it makes the
--   migration set honest, so that rebuilding from it -- a recovery with no
--   dump to hand, a second shop, a development copy -- produces a database
--   somebody can actually log in to.
--
-- WHAT IS DELIBERATELY NOT HERE
--   AI_AGENT_SETUP.sql creates wa_agent_settings and wa_messages. The
--   WhatsApp agent was removed on purpose and those tables were dropped behind
--   a tested guard. Recreating them here would undo that, so they are left
--   out. The two whatsapp_orders columns from order_source.sql ARE included:
--   they belong to order handling, not to the agent.
--
--   Every definition below is copied from the script that created it rather
--   than rewritten from memory, because the point is to match what production
--   already has.
-- ===========================================================================

SET client_min_messages = warning;

-- WHICH OF THESE TABLES ALREADY EXIST, RECORDED BEFORE ANYTHING IS CREATED.
--
-- The setup scripts create their policies as USING (true) and the tables are
-- granted to the browser-facing roles. On production those were tightened
-- afterwards -- DELETE and TRUNCATE were taken away from the public key, and
-- later migrations replaced open policies. Dropping and recreating a policy
-- here, or re-granting, would quietly put the old, looser arrangement back
-- on a live shop.
--
-- So policies and grants are applied ONLY to a table this migration itself
-- creates. Where the table already exists this file adds missing columns and
-- touches nothing else about it.
CREATE TEMP TABLE _m035_preexisting ON COMMIT PRESERVE ROWS AS
SELECT c.relname AS t
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relkind = 'r'
   AND c.relname IN ('store_settings', 'suppliers', 'receivings', 'stock_ledger');

-- ---------------------------------------------------------------------------
-- staff.permissions  (PERMISSIONS_SETUP.sql)
--
-- The one that broke the login. verify_pin and every other staff RPC read it.
-- ---------------------------------------------------------------------------
ALTER TABLE public.staff ADD COLUMN IF NOT EXISTS permissions jsonb DEFAULT '[]'::jsonb;

-- Admins get everything, everyone else keeps what they have. Matches the
-- backfill in PERMISSIONS_SETUP.sql, and only touches rows that are NULL so
-- re-running it cannot overwrite a deliberate setting.
UPDATE public.staff
   SET permissions = '[]'::jsonb
 WHERE permissions IS NULL;

-- ---------------------------------------------------------------------------
-- products.group_tag  (products_group_tag.sql)
-- ---------------------------------------------------------------------------
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS group_tag text;

-- ---------------------------------------------------------------------------
-- whatsapp_orders: source and details_filled  (order_source.sql)
-- stock_deducted  (stock_at_payment.sql)
-- ---------------------------------------------------------------------------
ALTER TABLE public.whatsapp_orders ADD COLUMN IF NOT EXISTS source text;
ALTER TABLE public.whatsapp_orders ADD COLUMN IF NOT EXISTS details_filled boolean DEFAULT false;
ALTER TABLE public.whatsapp_orders ADD COLUMN IF NOT EXISTS stock_deducted boolean DEFAULT false;

-- ---------------------------------------------------------------------------
-- store_settings  (store_settings.sql, store_settings_fix.sql)
--
-- The shop's open/closed switch, read by the storefront with the public key.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.store_settings (
  id             int PRIMARY KEY DEFAULT 1,
  shop_open      boolean NOT NULL DEFAULT true,
  closed_message text NOT NULL DEFAULT 'We are currently closed. Please check back soon.',
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT store_settings_singleton CHECK (id = 1)
);
-- store_settings_fix.sql exists because an earlier run of the above created
-- the table without this column.
ALTER TABLE public.store_settings
  ADD COLUMN IF NOT EXISTS closed_message text NOT NULL
  DEFAULT 'We are currently closed. Please check back soon.';

INSERT INTO public.store_settings (id, shop_open) VALUES (1, true)
  ON CONFLICT (id) DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM _m035_preexisting WHERE t = 'store_settings') THEN
    ALTER TABLE public.store_settings ENABLE ROW LEVEL SECURITY;
    CREATE POLICY "store_settings read" ON public.store_settings FOR SELECT USING (true);
    CREATE POLICY "store_settings update" ON public.store_settings FOR UPDATE
      USING (true) WITH CHECK (true);
    GRANT SELECT, INSERT, UPDATE ON public.store_settings TO anon, authenticated, service_role;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- suppliers and receivings  (RECEIVING_SETUP.sql)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.suppliers (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  phone      text DEFAULT '',
  notes      text DEFAULT '',
  active     boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.receivings (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ref_no         text UNIQUE NOT NULL,
  supplier_name  text DEFAULT '',
  supplier_id    uuid REFERENCES public.suppliers(id),
  status         text DEFAULT 'pending',
  items          jsonb DEFAULT '[]',
  total_expected int DEFAULT 0,
  total_received int DEFAULT 0,
  note           text DEFAULT '',
  created_by     text DEFAULT '',
  created_at     timestamptz DEFAULT now(),
  approved_by    text DEFAULT '',
  approved_at    timestamptz,
  reject_reason  text DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_receivings_status  ON public.receivings(status);
CREATE INDEX IF NOT EXISTS idx_receivings_created ON public.receivings(created_at);

-- ---------------------------------------------------------------------------
-- stock_ledger and the stock-take approval columns
-- (STOCKTAKE_AUDIT_SETUP.sql)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.stock_ledger (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id   text,
  product_name text DEFAULT '',
  previous_qty int,
  change_qty   int,
  new_qty      int,
  reason       text DEFAULT '',
  action_type  text DEFAULT '',
  staff        text DEFAULT '',
  reference    text DEFAULT '',
  created_at   timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ledger_product ON public.stock_ledger(product_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ledger_type    ON public.stock_ledger(action_type);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM _m035_preexisting WHERE t = 'stock_ledger') THEN
    ALTER TABLE public.stock_ledger ENABLE ROW LEVEL SECURITY;
    CREATE POLICY "staff ledger" ON public.stock_ledger FOR ALL USING (true) WITH CHECK (true);
    GRANT SELECT, INSERT ON public.stock_ledger TO anon, authenticated, service_role;
  END IF;
END $$;

-- stock_takes is created by an earlier migration; these are the approval
-- fields that only ever existed in the hand-run script.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname = 'public' AND c.relname = 'stock_takes') THEN
    ALTER TABLE public.stock_takes ADD COLUMN IF NOT EXISTS status        text DEFAULT 'approved';
    ALTER TABLE public.stock_takes ADD COLUMN IF NOT EXISTS approved_by   text DEFAULT '';
    ALTER TABLE public.stock_takes ADD COLUMN IF NOT EXISTS approved_at   timestamptz;
    ALTER TABLE public.stock_takes ADD COLUMN IF NOT EXISTS reject_reason text DEFAULT '';
  ELSE
    RAISE WARNING 'public.stock_takes does not exist here, so its approval columns were not added';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Grants for the two remaining tables, again only where this file made them.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM _m035_preexisting WHERE t = 'suppliers') THEN
    GRANT SELECT, INSERT, UPDATE ON public.suppliers TO anon, authenticated, service_role;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM _m035_preexisting WHERE t = 'receivings') THEN
    GRANT SELECT, INSERT, UPDATE ON public.receivings TO anon, authenticated, service_role;
  END IF;
END $$;

DROP TABLE IF EXISTS _m035_preexisting;
