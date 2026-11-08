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
SELECT set_config('provision.authn', :'authn', false);

-- ---------------------------------------------------------------------------
-- Extensions
--
-- Separated into what the application CANNOT RUN WITHOUT and what is merely
-- useful, because they are not equally important and provisioning should not
-- die on the useful ones.
--
-- Creating an extension generally needs superuser. On a managed PostgreSQL
-- the provisioning role is not one -- Supabase's `postgres` is not -- and its
-- supautils extension permits a whitelist instead. So each is attempted and
-- the outcome is reported: a REQUIRED one that cannot be created aborts with
-- an explanation, an OPTIONAL one only warns.
--
-- pg_cron is deliberately absent: its scheduler runs in the 'postgres'
-- database and jobs are registered with cron.schedule_in_database().
-- ---------------------------------------------------------------------------
-- A caller may set this to 'off' to downgrade a MISSING extension from an
-- error to a warning. It exists for one case: a developer laptop where
-- pg_net is not installed at all. It is 'on' everywhere that matters, and the
-- test that sets it says out loud which extensions it therefore did not
-- exercise.
\if :{?require_extensions}
\else
  \set require_extensions on
\endif
SELECT set_config('provision.require_ext', :'require_extensions', false);

DO $$
DECLARE
  ext      text;
  ok_list  text := '';
  missing  text := '';
  unavail  text := '';
  strict_mode boolean := current_setting('provision.require_ext') <> 'off';
BEGIN
  -- Required. pgcrypto hashes staff PINs (migration 018); uuid-ossp and
  -- pg_net are called by the schema and by the scheduled jobs.
  FOREACH ext IN ARRAY ARRAY['pgcrypto', 'uuid-ossp', 'pg_net'] LOOP
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = ext) THEN
      ok_list := ok_list || ' ' || ext || '(already)';
      CONTINUE;
    END IF;
    -- Distinguish "this installation does not have it" from "I am not
    -- allowed to create it". They need different answers.
    IF NOT EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = ext) THEN
      unavail := unavail || ' ' || ext;
      CONTINUE;
    END IF;
    BEGIN
      EXECUTE format('CREATE EXTENSION IF NOT EXISTS %I', ext);
      ok_list := ok_list || ' ' || ext;
    EXCEPTION WHEN insufficient_privilege OR feature_not_supported THEN
      missing := missing || ' ' || ext;
    END;
  END LOOP;

  IF missing <> '' THEN
    RAISE EXCEPTION
      'Not permitted to create required extension(s):%. The application needs them -- pgcrypto hashes staff PINs, pg_net is how the scheduled jobs make HTTP calls. Create them once as a superuser and run this again: CREATE EXTENSION IF NOT EXISTS <name>;', missing;
  END IF;

  IF unavail <> '' THEN
    IF strict_mode THEN
      RAISE EXCEPTION
        'Required extension(s) are not available in this PostgreSQL installation:%. The supabase/postgres image ships them; a plain postgres image does not. Check the image tag in docker-compose.yml.', unavail;
    ELSE
      RAISE WARNING
        'Extension(s) not available here and NOT exercised:%  (require_extensions=off)', unavail;
    END IF;
  END IF;

  -- Optional: statement statistics, for the capacity report. Useful, and
  -- nothing in the application calls it.
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_stat_statements') THEN
    BEGIN
      CREATE EXTENSION pg_stat_statements;
      ok_list := ok_list || ' pg_stat_statements';
    EXCEPTION WHEN insufficient_privilege OR feature_not_supported THEN
      RAISE WARNING 'pg_stat_statements could not be created (needs superuser). Query statistics will be missing from the capacity report; nothing in the application depends on it.';
    END;
  END IF;

  RAISE NOTICE 'extensions ready:%', ok_list;
END $$;

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
-- Granting these needs ADMIN OPTION on them. On the supabase/postgres image
-- the `postgres` role created them and therefore has it. A provisioning role
-- that did not create them does not, and the error PostgreSQL gives
-- ("Only roles with the ADMIN option ... may grant this role") does not say
-- what to do about it, so this does.
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    BEGIN
      EXECUTE format('GRANT %I TO %I', r, current_setting('provision.authn'));
    EXCEPTION WHEN insufficient_privilege THEN
      -- Deliberately does NOT tell anyone to GRANT ... WITH ADMIN OPTION on
      -- these roles. That statement crashes the supabase/postgres server --
      -- the backend dies rather than erroring -- so recommending it would
      -- turn a provisioning failure into an outage.
      RAISE EXCEPTION
        'Cannot grant % to %. PostgREST becomes that role by SET ROLE, so without this every API request is rejected. On the supabase/postgres image the role running this already has what it needs, so if you are seeing this the image or the role is not what was expected: check that this is supabase/postgres (not a plain postgres image) and that you are connected as its postgres role. Do NOT work around it by granting ADMIN OPTION on %I -- that crashes this server.',
        r, current_setting('provision.authn'), r;
    END;
  END LOOP;
END $$;

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
-- Best effort: these need superuser on some servers, and provisioning must
-- not die over a logging preference. The point is to keep the password that
-- follows out of the server log; where that is not permitted, the statement
-- is fast enough that log_min_duration_statement will not catch it anyway.
DO $$
BEGIN
  SET log_min_duration_statement = -1;
  SET log_statement = 'none';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE WARNING 'Could not silence statement logging (needs superuser). The password statement below may appear in the server log if slow-statement logging is aggressive.';
END $$;
ALTER ROLE :"authn" PASSWORD :'authn_password';
DO $$
BEGIN
  RESET log_statement;
  RESET log_min_duration_statement;
EXCEPTION WHEN insufficient_privilege THEN NULL;
END $$;

\echo '  database internals configured (no table grants added, by design)'
