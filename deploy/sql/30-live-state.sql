-- ===========================================================================
-- Live updates without Realtime: a three-row table and three triggers.
--
--   psql -d <app_db> -f 30-live-state.sql
--
-- WHY THIS EXISTS
--   The till needs to notice a sale rung up on another workstation, a product
--   whose price changed, and a new WhatsApp order. Supabase Realtime does
--   that by reading the write-ahead log. On this platform it has not
--   delivered, and the application cannot wait on that being solved.
--
--   What the application actually needs is narrow: to know THAT something
--   changed, so it can call the refresher it already has. It does not need
--   the changed row pushed to it -- App.jsx's handlers call
--   store.refreshSales(), refreshProducts() and refreshWAOrders() and re-read
--   from the API anyway.
--
--   So: one row per watched source, holding a revision number. A trigger
--   bumps it on insert, update or delete. The client polls three rows from a
--   three-row table -- a few hundred bytes, an index-only read -- and calls a
--   refresher only when a revision moves.
--
-- WHY NOT THE ALTERNATIVES
--   Polling the tables themselves would mean count(*) or max(id) over
--   growing tables every few seconds. Polling this costs the same whether the
--   shop has sold ten things or ten million.
--
--   A separate websocket or SSE service would be another container, another
--   thing to supervise, another thing to go wrong on a server in a shop with
--   no technical staff. This adds no service at all: it is the API the
--   application already talks to.
--
-- WHAT IT PRESERVES
--   Every table, every row, every policy. PIN authentication is untouched --
--   this is read through the same anon key and the same row-level security as
--   everything else. Tenant isolation is inherent: the table lives in the
--   application's own database, which no other application can open.
-- ===========================================================================

\set ON_ERROR_STOP on
SET client_min_messages = warning;

CREATE TABLE IF NOT EXISTS public.live_state (
  source      text PRIMARY KEY,
  rev         bigint      NOT NULL DEFAULT 0,
  changed_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.live_state IS
  'One row per table the till watches. A trigger bumps rev on any change; the '
  'client polls this instead of holding a websocket open. See 30-live-state.sql.';

-- The bump. One function for every watched table: TG_TABLE_NAME names the
-- source, so adding another table later needs only another trigger.
CREATE OR REPLACE FUNCTION public.bump_live_state()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.live_state (source, rev, changed_at)
  VALUES (TG_TABLE_NAME, 1, now())
  ON CONFLICT (source) DO UPDATE
    SET rev = public.live_state.rev + 1,
        changed_at = now();
  RETURN NULL;   -- AFTER trigger: the return value is ignored
END $$;

-- STATEMENT-level, not row-level. A sale with twenty lines bumps the revision
-- once, not twenty times, and a bulk price update bumps it once. The client
-- only needs to know that something changed.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['sales', 'products', 'whatsapp_orders'] LOOP
    IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
               WHERE n.nspname = 'public' AND c.relname = t AND c.relkind = 'r') THEN
      EXECUTE format('DROP TRIGGER IF EXISTS trg_live_state ON public.%I', t);
      EXECUTE format(
        'CREATE TRIGGER trg_live_state AFTER INSERT OR UPDATE OR DELETE ON public.%I '
        'FOR EACH STATEMENT EXECUTE FUNCTION public.bump_live_state()', t);
      -- A row so the client has something to read before the first change.
      INSERT INTO public.live_state (source) VALUES (t) ON CONFLICT DO NOTHING;
    ELSE
      RAISE WARNING 'public.% does not exist here; no live-state trigger was created for it', t;
    END IF;
  END LOOP;
END $$;

-- Readable by the browser-facing roles. Writable by none of them: only the
-- triggers write here, and they run as the function's owner.
GRANT SELECT ON public.live_state TO anon, authenticated, service_role;
REVOKE INSERT, UPDATE, DELETE ON public.live_state FROM anon, authenticated;

-- Row-level security on, with a read-only policy. Without this the table
-- would be the one object in the schema that ignores the pattern.
ALTER TABLE public.live_state ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS live_state_read ON public.live_state;
CREATE POLICY live_state_read ON public.live_state FOR SELECT USING (true);

\echo '  live_state ready: poll /rest/v1/live_state?select=source,rev'
