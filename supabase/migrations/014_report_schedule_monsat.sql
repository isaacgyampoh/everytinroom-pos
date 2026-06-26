-- ============================================================
-- Updated report schedule (run in Supabase SQL Editor)
-- Shop works Mon–Sat. Sunday: send the weekly summary in the morning.
--
-- Cron day-of-week: 0 or 7 = Sunday, 1 = Monday ... 6 = Saturday.
-- Times are GMT (Ghana = GMT, so these are local times).
-- ============================================================

-- Remove the old jobs first so we don't double-send.
SELECT cron.unschedule('morning-report');
SELECT cron.unschedule('afternoon-report');
SELECT cron.unschedule('evening-report');
SELECT cron.unschedule('weekly-report');
-- (monthly-report stays as-is)

-- ---- DAILY reports: Monday–Saturday only (day-of-week 1–6) ----

-- Afternoon "today so far" at 1:00 PM, Mon–Sat
SELECT cron.schedule(
  'afternoon-report',
  '0 13 * * 1-6',
  $$SELECT net.http_post(
    url := 'https://noiiuwkovoojkcwzupye.supabase.co/functions/v1/charge-momo?action=report&type=today',
    body := '{}',
    headers := '{"Content-Type": "application/json"}'::jsonb
  )$$
);

-- Evening end-of-day (money summary) at 8:00 PM, Mon–Sat
SELECT cron.schedule(
  'evening-report',
  '0 20 * * 1-6',
  $$SELECT net.http_post(
    url := 'https://noiiuwkovoojkcwzupye.supabase.co/functions/v1/charge-momo?action=report&type=evening',
    body := '{}',
    headers := '{"Content-Type": "application/json"}'::jsonb
  )$$
);

-- ---- WEEKLY summary: Sunday morning at 8:00 AM (day-of-week 0) ----
-- Covers the Mon–Sat that just ended, with best-sellers.
SELECT cron.schedule(
  'weekly-report',
  '0 8 * * 0',
  $$SELECT net.http_post(
    url := 'https://noiiuwkovoojkcwzupye.supabase.co/functions/v1/charge-momo?action=report&type=weekly',
    body := '{}',
    headers := '{"Content-Type": "application/json"}'::jsonb
  )$$
);

-- ---- Verify what's scheduled now ----
SELECT jobname, schedule FROM cron.job ORDER BY jobname;
