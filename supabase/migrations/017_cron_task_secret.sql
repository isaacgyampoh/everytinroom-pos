-- ============================================================================
-- EVERYTINROOM POS — 017: AUTHENTICATE THE SCHEDULED JOBS
--
-- `?action=report` and `?action=remind` send SMS to the admin phones and to
-- customers. They were reachable by anyone on the internet with a single curl,
-- so a stranger could run up the shop's SMS bill and spam customers at will.
--
-- charge-momo now requires the header `x-task-secret` on those two endpoints,
-- but ONLY once the TASK_SECRET env var is set. Until then it logs a warning
-- and keeps working, so the order below is safe:
--
--   1. Pick a long random secret:   openssl rand -hex 32
--   2. Replace __TASK_SECRET__ everywhere in this file with it.
--   3. Run this migration.
--   4. supabase secrets set TASK_SECRET=<the same value>
--   5. Redeploy charge-momo.
--
-- Doing step 4 before step 3 breaks the daily reports until step 3 lands.
-- ============================================================================

DO $$
DECLARE
  task_secret TEXT := '__TASK_SECRET__';
  fn_url      TEXT := 'https://noiiuwkovoojkcwzupye.supabase.co/functions/v1/charge-momo';
  hdrs        JSONB;
BEGIN
  IF task_secret = '__TASK' || '_SECRET__' THEN
    RAISE EXCEPTION 'Replace __TASK_SECRET__ with a real secret before running this migration.';
  END IF;

  hdrs := jsonb_build_object('Content-Type', 'application/json', 'x-task-secret', task_secret);

  -- Rebuild each report job with the header attached. Names match the existing
  -- jobs so unschedule/schedule replaces them rather than duplicating.
  PERFORM cron.unschedule(jobname) FROM cron.job
   WHERE command LIKE '%charge-momo?action=report%'
      OR command LIKE '%charge-momo?action=remind%';

  PERFORM cron.schedule('etr-report-daily', '0 6 * * 1-6', format(
    $cmd$SELECT net.http_post(url := %L, headers := %L::jsonb) $cmd$,
    fn_url || '?action=report&type=daily', hdrs::text));

  PERFORM cron.schedule('etr-report-evening', '0 20 * * 1-6', format(
    $cmd$SELECT net.http_post(url := %L, headers := %L::jsonb) $cmd$,
    fn_url || '?action=report&type=evening', hdrs::text));

  PERFORM cron.schedule('etr-report-weekly', '0 7 * * 1', format(
    $cmd$SELECT net.http_post(url := %L, headers := %L::jsonb) $cmd$,
    fn_url || '?action=report&type=weekly', hdrs::text));

  PERFORM cron.schedule('etr-report-monthly', '0 7 1 * *', format(
    $cmd$SELECT net.http_post(url := %L, headers := %L::jsonb) $cmd$,
    fn_url || '?action=report&type=monthly', hdrs::text));

  PERFORM cron.schedule('etr-payment-reminders', '0 */4 * * *', format(
    $cmd$SELECT net.http_post(url := %L, headers := %L::jsonb) $cmd$,
    fn_url || '?action=remind', hdrs::text));
END $$;

-- Check what is scheduled now:
--   SELECT jobname, schedule, active FROM cron.job ORDER BY jobname;
