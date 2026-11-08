-- ===========================================================================
-- Read the source project's scheduled jobs and emit the SQL that re-registers
-- them on the central server, each in the database where it can actually run.
--
--   :app_db   the application's database on this server
--
-- WHERE EACH JOB GOES depends on what it DOES, not on who owns it.
--
-- pg_net's background worker reads net.http_request_queue in exactly one
-- database -- pg_net.database_name, which is 'postgres' on the central server
-- -- and running it on several databases in one cluster is not supported. A
-- net.http_post() called from the application's own database inserts a queue
-- row, returns an id, and is never processed: no error, no response row, no
-- request. A job that looks fine and does nothing.
--
--   calls net.http_*  ->  cron.schedule()             , stays in postgres
--   SQL only          ->  cron.schedule_in_database() , the application's own
--
-- A job that reads application data AND THEN calls out cannot do either way
-- round: pg_net only works in postgres, and postgres cannot see the
-- application's tables. Those are flagged for splitting, not rewritten.
--
-- This file is run with -f against the SOURCE database and its output is SQL
-- for a human to read before applying. It changes nothing.
-- ===========================================================================
-- Run with psql -tAqX: `\pset format unaligned` prints "Output format is
-- unaligned." onto stdout, which lands in the generated file as a line that is
-- neither SQL nor a comment and breaks it when applied.

SELECT format(
  '-- %s (%s)%s%s%s',
  jobname,
  CASE WHEN active THEN 'active' ELSE 'INACTIVE' END,
  CASE
    -- A SQL `from`, not the word inside a URL. The first version matched
    -- `?from=2024` in a query string and flagged a pure-HTTP job as needing
    -- to be split. Requiring whitespace or an opening paren before it, and
    -- whitespace after, keeps that out.
    WHEN command ~* 'net\.http_' AND command ~* '(\s|\()from\s'
      THEN chr(10) || '--   NEEDS SPLITTING: this job reads data AND makes an HTTP call.'
        || chr(10) || '--   Move the query into a PostgREST RPC in ' || :'app_db' || ' and have'
        || chr(10) || '--   this job call that URL. See deploy/README.md, Scheduled jobs.'
    ELSE ''
  END,
  chr(10),
  CASE WHEN command ~* 'net\.http_'
    THEN format('SELECT cron.schedule(%L, %L, $job$%s$job$);  -- HTTP: stays in postgres, where pg_net''s worker is',
                jobname, schedule, command)
    ELSE format('SELECT cron.schedule_in_database(%L, %L, $job$%s$job$, %L);  -- SQL only',
                jobname, schedule, command, :'app_db')
  END)
FROM cron.job
ORDER BY jobname;
