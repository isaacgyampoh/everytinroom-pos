-- Enable pg_cron extension (may already be enabled)
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Grant usage
GRANT USAGE ON SCHEMA cron TO postgres;

-- Morning report at 6:00 AM GMT (Ghana time)
SELECT cron.schedule(
  'morning-report',
  '0 6 * * *',
  $$SELECT net.http_post(
    url := 'https://noiiuwkovoojkcwzupye.supabase.co/functions/v1/charge-momo?action=report&type=daily',
    body := '{}',
    headers := '{"Content-Type": "application/json"}'::jsonb
  )$$
);

-- Afternoon report at 1:00 PM GMT
SELECT cron.schedule(
  'afternoon-report',
  '0 13 * * *',
  $$SELECT net.http_post(
    url := 'https://noiiuwkovoojkcwzupye.supabase.co/functions/v1/charge-momo?action=report&type=today',
    body := '{}',
    headers := '{"Content-Type": "application/json"}'::jsonb
  )$$
);

-- Evening report at 8:00 PM GMT
SELECT cron.schedule(
  'evening-report',
  '0 20 * * *',
  $$SELECT net.http_post(
    url := 'https://noiiuwkovoojkcwzupye.supabase.co/functions/v1/charge-momo?action=report&type=evening',
    body := '{}',
    headers := '{"Content-Type": "application/json"}'::jsonb
  )$$
);

-- Weekly report every Monday at 6:00 AM GMT
SELECT cron.schedule(
  'weekly-report',
  '0 6 * * 1',
  $$SELECT net.http_post(
    url := 'https://noiiuwkovoojkcwzupye.supabase.co/functions/v1/charge-momo?action=report&type=weekly',
    body := '{}',
    headers := '{"Content-Type": "application/json"}'::jsonb
  )$$
);

-- Monthly report on 1st of every month at 6:00 AM GMT
SELECT cron.schedule(
  'monthly-report',
  '0 6 1 * *',
  $$SELECT net.http_post(
    url := 'https://noiiuwkovoojkcwzupye.supabase.co/functions/v1/charge-momo?action=report&type=monthly',
    body := '{}',
    headers := '{"Content-Type": "application/json"}'::jsonb
  )$$
);
