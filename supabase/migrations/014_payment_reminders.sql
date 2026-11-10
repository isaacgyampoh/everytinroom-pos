-- Payment Reminder — runs every hour, sends SMS to customers with unpaid orders
-- Requires pg_cron and pg_net extensions enabled

-- Schedule: every hour at minute 15
SELECT cron.schedule(
  'payment-reminder',
  '15 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://noiiuwkovoojkcwzupye.supabase.co/functions/v1/charge-momo?action=remind',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5vaWl1d2tvdm9vamtjd3p1cHllIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzExOTQyMTcsImV4cCI6MjA4Njc3MDIxN30.Wpduc4qYawgVSWqMqKPaDWUXm0dp8A_z9IxOrVfqN7w'
    ),
    body := '{}'::jsonb
  );
  $$
);

-- To check if it's working:
-- SELECT * FROM cron.job;

-- To remove the schedule:
-- SELECT cron.unschedule('payment-reminder');
