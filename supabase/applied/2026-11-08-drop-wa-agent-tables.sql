-- ===========================================================================
-- DROP THE WHATSAPP AGENT TABLES AND ITS READER FUNCTION
--
-- Approved by the owner on 2026-11-08.
--
-- WHAT THIS DOES NOT TOUCH
--   whatsapp_orders  -- the shop's MAIN order table, most of it
--                       source='web' and still arriving. Not a chat feature.
--   ussd_sessions    -- read by the payments function. Not a chat feature.
--   Any sale, receipt, customer or order, of any age or source.
--
--   MEASURED BEFORE RUNNING (2026-11-08)
--   wa_conversations    0 rows
--   wa_messages         0 rows
--   wa_agent_settings   2 rows: agent_master_enabled=false,
--                               business_hours_only=false
--                       -- the agent was wired up and never switched on
--
-- DEPENDENCIES FOUND, AND WHY THEY ARE SAFE
--   public.wa_recent_messages(text, int) reads wa_messages and nothing else.
--   It is called by no other database function and by no frontend code. It is
--   also SECURITY DEFINER with EXECUTE granted to PUBLIC and anon, so it is
--   reachable from any browser holding the public key -- harmless only while
--   the table it reads is empty. It is dropped here, with the tables.
--
--   Dropping a table does NOT fail because a function's body mentions it:
--   PostgreSQL does not track dependencies inside function bodies. So without
--   the check below, this script would succeed and leave a function that
--   errors the first time anybody calls it.
--
-- THE GUARDS. This ABORTS, changing nothing, if:
--   - any of the three tables has acquired real data
--   - any wa_agent_settings row is set to something other than false
--   - a foreign key outside the three points at them
--   - a view or trigger depends on them
--   - any function other than wa_recent_messages references them
-- ===========================================================================

BEGIN;

DO $$
DECLARE
  convos   bigint := 0;
  msgs     bigint := 0;
  enabled  bigint := 0;
  fks      bigint := 0;
  views_n  bigint := 0;
  trigs    bigint := 0;
  funcs    text;
BEGIN
  IF to_regclass('public.wa_conversations') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.wa_conversations' INTO convos;
  END IF;
  IF to_regclass('public.wa_messages') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.wa_messages' INTO msgs;
  END IF;

  -- Any value that is not false means somebody turned the agent on.
  IF to_regclass('public.wa_agent_settings') IS NOT NULL THEN
    EXECUTE $q$ SELECT count(*) FROM public.wa_agent_settings
                 WHERE lower(trim(both '"' from value::text)) <> 'false' $q$ INTO enabled;
  END IF;

  IF convos > 0 OR msgs > 0 OR enabled > 0 THEN
    RAISE EXCEPTION
      'ABORTED: the WhatsApp agent is not idle (% conversations, % messages, % enabled settings). Re-audit before dropping anything.',
      convos, msgs, enabled;
  END IF;

  SELECT count(*) INTO fks
    FROM information_schema.table_constraints tc
    JOIN information_schema.constraint_column_usage ccu
      ON ccu.constraint_name = tc.constraint_name
   WHERE tc.constraint_type = 'FOREIGN KEY'
     AND ccu.table_name IN ('wa_conversations','wa_messages','wa_agent_settings')
     AND tc.table_name NOT IN ('wa_conversations','wa_messages','wa_agent_settings');
  IF fks > 0 THEN
    RAISE EXCEPTION 'ABORTED: % foreign key(s) from other tables now point at the agent tables.', fks;
  END IF;

  SELECT count(*) INTO views_n
    FROM information_schema.views
   WHERE table_schema = 'public'
     AND (view_definition LIKE '%wa_conversations%'
       OR view_definition LIKE '%wa_messages%'
       OR view_definition LIKE '%wa_agent_settings%');
  IF views_n > 0 THEN
    RAISE EXCEPTION 'ABORTED: % view(s) now depend on the agent tables.', views_n;
  END IF;

  SELECT count(*) INTO trigs
    FROM information_schema.triggers
   WHERE event_object_table IN ('wa_conversations','wa_messages','wa_agent_settings');
  IF trigs > 0 THEN
    RAISE EXCEPTION 'ABORTED: % trigger(s) now exist on the agent tables.', trigs;
  END IF;

  -- wa_recent_messages is expected and is dropped below. Anything else is not.
  SELECT string_agg(p.proname, ', ') INTO funcs
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname <> 'wa_recent_messages'
     AND (p.prosrc LIKE '%wa_conversations%'
       OR p.prosrc LIKE '%wa_messages%'
       OR p.prosrc LIKE '%wa_agent_settings%');
  IF funcs IS NOT NULL THEN
    RAISE EXCEPTION 'ABORTED: these functions reference the agent tables and were not expected: %. Review them before dropping anything.', funcs;
  END IF;

  RAISE NOTICE 'Guards passed: tables idle, no foreign keys, views or triggers, no unexpected functions.';
END $$;

-- The reader function first: it is the thing that would otherwise be left
-- pointing at a table that no longer exists.
DROP FUNCTION IF EXISTS public.wa_recent_messages(text, integer);

DROP TABLE IF EXISTS public.wa_messages;        -- child before parent
DROP TABLE IF EXISTS public.wa_conversations;
DROP TABLE IF EXISTS public.wa_agent_settings;

COMMIT;
