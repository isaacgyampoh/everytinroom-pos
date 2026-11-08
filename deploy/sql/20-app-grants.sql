-- ===========================================================================
-- Set up one application's database internals. Runs INSIDE that database,
-- as superuser. Idempotent.
--
--   psql -d everytinroom -v owner=... -v authn=... \
--        -v authn_password="$PW" -f 20-app-grants.sql
--
-- WHAT THIS FILE DOES NOT DO
--   It grants nothing on any table, view, sequence or function.
--
--   That is deliberate. The application's own migrations and its restored
--   dump carry their own grants and row-level security policies -- 77 grants
--   and 45 policies for Everytinroom -- and they are the result of real
--   security work (migrations 015, 019, 021, 028 among others). A convenient
--   "GRANT SELECT ON ALL TABLES TO anon" here would quietly undo all of it
--   and hand the public key the cost prices and the whole sales ledger.
--
--   This file sets up the plumbing only: who may connect, who may become
--   whom, and what the search path is.
-- ===========================================================================

\set ON_ERROR_STOP on
-- 'already exists' notices are expected on a re-run and drown out real ones.
SET client_min_messages = warning;

-- Extensions Everytinroom's schema depends on, as captured from production.
-- pg_cron is deliberately NOT here: its scheduler runs in the 'postgres'
-- database and jobs are registered with cron.schedule_in_database().
CREATE EXTENSION IF NOT EXISTS pgcrypto;      -- PIN hashing (migration 018)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pg_net;        -- cron jobs call edge functions
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

-- ---------------------------------------------------------------------------
-- The public schema
--
-- Postgres 15 and later already revoke CREATE on public from PUBLIC. This
-- also removes USAGE, so nothing reaches the schema except the roles named
-- below -- and then puts the application's own roles back.
-- ---------------------------------------------------------------------------
REVOKE ALL ON SCHEMA public FROM PUBLIC;
ALTER SCHEMA public OWNER TO :"owner";

GRANT USAGE  ON SCHEMA public TO anon, authenticated, service_role;
GRANT CREATE, USAGE ON SCHEMA public TO :"owner";

-- ---------------------------------------------------------------------------
-- SET ROLE: how PostgREST becomes the role named in the request's JWT.
--
-- The authenticator logs in holding nothing and switches to anon for an
-- anonymous request or service_role for a trusted one. It is NOINHERIT, so
-- the switch is the only way it gains anything.
-- ---------------------------------------------------------------------------
GRANT anon, authenticated, service_role TO :"authn";

-- A belt-and-braces check on the roles PostgREST switches into: if any of
-- them could log in, the anon key would be a database password.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT rolname FROM pg_roles
            WHERE rolname IN ('anon','authenticated','service_role') AND rolcanlogin
  LOOP
    RAISE EXCEPTION
      'Role % can log in. It must be NOLOGIN -- it is reached only by SET ROLE. Fix with: ALTER ROLE %I NOLOGIN;', r.rolname, r.rolname;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- Per-role limits.
--
-- A till query that takes more than fifteen seconds is a bug or an attack,
-- not a report; without a cap one of them can hold a connection all day. The
-- owner is exempt because restoring a dump and building indexes legitimately
-- takes much longer.
-- ---------------------------------------------------------------------------
ALTER ROLE anon           IN DATABASE :"dbname" SET statement_timeout = '15s';
ALTER ROLE authenticated  IN DATABASE :"dbname" SET statement_timeout = '30s';
ALTER ROLE service_role   IN DATABASE :"dbname" SET statement_timeout = '120s';
ALTER ROLE anon           IN DATABASE :"dbname" SET idle_in_transaction_session_timeout = '30s';

-- PostgREST looks for tables on this search_path.
ALTER ROLE :"authn" IN DATABASE :"dbname" SET search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- The login password.
--
-- Statement logging is turned off FOR THIS SESSION first. Without it a slow
-- ALTER ROLE could be written into the server log in clear text by
-- log_min_duration_statement, and the log is not a secret store.
-- ---------------------------------------------------------------------------
SET log_min_duration_statement = -1;
SET log_statement = 'none';
ALTER ROLE :"authn" PASSWORD :'authn_password';
RESET log_statement;
RESET log_min_duration_statement;

\echo '  database internals configured (no table grants added, by design)'
