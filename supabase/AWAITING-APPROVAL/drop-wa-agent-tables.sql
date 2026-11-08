-- ===========================================================================
-- DROP THE WHATSAPP AGENT TABLES
--
-- NOT RUN. NOT A NUMBERED MIGRATION. Needs the owner's explicit go-ahead.
--
-- It sits here rather than in supabase/migrations/ on purpose: everything in
-- that folder reads as "run me", and `npm run migrate:pending` builds its
-- paste-into-the-editor file from an allowlist of prefixes that deliberately
-- does not include this. Nothing will run this by accident.
--
-- If approved: move it to supabase/migrations/034_drop_wa_agent_tables.sql
-- and run it there, so the schema history records the drop.
--
-- WHAT THIS DOES NOT TOUCH
--   whatsapp_orders  -- 906 rows, the shop's MAIN order table. 716 of those
--                       are source='web' and still arriving today. The name is
--                       historical; it is not a WhatsApp feature.
--   ussd_sessions    -- 468 rows, read by the charge-momo function. PAYMENTS.
--   Any sale, receipt, customer or order, of any age or source.
--
-- WHY THESE THREE ARE SAFE TO DROP (measured 2026-11-08)
--   wa_conversations    0 rows
--   wa_messages         0 rows
--   wa_agent_settings   2 rows, both holding {"value": "false"}
--                       -- the agent was never switched on
--   The only code that read them was src/pages/WhatsAppChats.jsx and
--   src/pages/WhatsAppSettings.jsx, both removed, and the wa-agent edge
--   function, also removed. Nothing else in the repo references them.
--
-- The guard below is the point of this file. If somebody switched the agent
-- back on between the audit and the approval, this ABORTS instead of deleting
-- their conversations.
-- ===========================================================================

BEGIN;

DO $$
DECLARE
  convos  bigint := 0;
  msgs    bigint := 0;
  enabled bigint := 0;
BEGIN
  IF to_regclass('public.wa_conversations') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.wa_conversations' INTO convos;
  END IF;
  IF to_regclass('public.wa_messages') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.wa_messages' INTO msgs;
  END IF;
  IF to_regclass('public.wa_agent_settings') IS NOT NULL THEN
    -- Any value that is not false means somebody turned the agent on.
    EXECUTE $q$ SELECT count(*) FROM public.wa_agent_settings
                 WHERE coalesce(value::text, '') NOT IN ('false', '"false"',
                       '{"value": "false"}', '{"value":"false"}') $q$ INTO enabled;
  END IF;

  IF convos > 0 OR msgs > 0 OR enabled > 0 THEN
    RAISE EXCEPTION
      'ABORTED: the WhatsApp agent is not idle any more (% conversations, % messages, % enabled settings). Re-audit before dropping anything.',
      convos, msgs, enabled;
  END IF;
END $$;

DROP TABLE IF EXISTS public.wa_messages;        -- child first
DROP TABLE IF EXISTS public.wa_conversations;
DROP TABLE IF EXISTS public.wa_agent_settings;

COMMIT;

-- Afterwards, revoke the secrets these were the only consumers of:
--   supabase secrets unset OPENAI_API_KEY WASENDER_API_KEY \
--                          WAWP_ACCESS_TOKEN WAWP_INSTANCE_ID OWNER_PHONE
-- and delete the deployed functions, which removing the source does NOT do:
--   supabase functions delete wa-agent
--   supabase functions delete whatsapp-bot
