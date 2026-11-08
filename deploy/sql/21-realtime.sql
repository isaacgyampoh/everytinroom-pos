-- ===========================================================================
-- Prepare one application's database for Realtime. Runs INSIDE that database.
--
--   psql -d everytinroom -v dbname=everytinroom -v owner=everytinroom_owner \
--        -v rt_user=everytinroom_realtime -v rt_password="$PW" -f 21-realtime.sql
--
-- Realtime reads the write-ahead log, which is how the till learns about a
-- sale the moment it is recorded rather than by polling. That means its role
-- is necessarily privileged WITHIN THIS DATABASE -- logical replication hands
-- over every change to every replicated table, so there is no such thing as a
-- partially-trusted replication user. What it cannot do is reach any other
-- application: it has CONNECT on this database alone.
-- ===========================================================================

\set ON_ERROR_STOP on
SET client_min_messages = warning;

-- Realtime keeps its own tables (tenants, extensions, migration history) in
-- this schema, and connects with search_path set to it.
-- Created WITHOUT an AUTHORIZATION clause, and not reassigned afterwards.
-- `CREATE SCHEMA ... AUTHORIZATION <role>` and `ALTER SCHEMA ... OWNER TO
-- <role>` both require the executing role to be able to SET ROLE to that
-- role, which a non-superuser cannot without a membership grant -- and
-- granting membership crashes this image. Realtime does not need to OWN the
-- schema; it needs to CREATE IN it, which the grant below provides.
CREATE SCHEMA IF NOT EXISTS _realtime;

-- psql does NOT interpolate :variables inside a dollar-quoted string, so a
-- DO block cannot see them directly. They are handed over as session settings
-- instead, which is why the next line exists.
SELECT set_config('provision.rt_user', :'rt_user', false);

DO $$
DECLARE u text := current_setting('provision.rt_user');
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = u) THEN
    RAISE EXCEPTION 'Role % does not exist. provision-app.sh creates it before running this file.', u;
  END IF;
END $$;

GRANT ALL ON SCHEMA _realtime TO :"rt_user";
ALTER DEFAULT PRIVILEGES IN SCHEMA _realtime GRANT ALL ON TABLES TO :"rt_user";
ALTER DEFAULT PRIVILEGES IN SCHEMA _realtime GRANT ALL ON SEQUENCES TO :"rt_user";

-- It must be able to read the tables it replicates, and to create the
-- publication it manages.
--
-- Granted EXPLICITLY rather than through membership in a per-application
-- owner role. That role is gone: granting it to anything crashed the
-- supabase/postgres image (see 10-create-app-db.sql), and explicit grants are
-- easier to audit than privileges inherited through a role.
--
-- Broad read inside THIS database is inherent to logical replication -- it
-- hands over every change to every replicated table, so there is no such
-- thing as a partially-trusted replication user. What this role cannot do is
-- reach any other application: it has CONNECT on this database alone.
GRANT USAGE ON SCHEMA public TO :"rt_user";
GRANT SELECT ON ALL TABLES IN SCHEMA public TO :"rt_user";
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO :"rt_user";
-- CONNECT and CREATE on this database, and nothing on any other. This used
-- to be done by provision-app.sh in shell, which meant the SQL test harness
-- never saw it: it created the role, ran this file, and the role then could
-- not open the database at all. A grant this file depends on belongs in this
-- file, where it is tested with the rest of it.
GRANT CONNECT ON DATABASE :"dbname" TO :"rt_user";
GRANT CREATE  ON DATABASE :"dbname" TO :"rt_user";

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
ALTER ROLE :"rt_user" PASSWORD :'rt_password';
DO $$
BEGIN
  RESET log_statement;
  RESET log_min_duration_statement;
EXCEPTION WHEN insufficient_privilege THEN NULL;
END $$;

ALTER ROLE :"rt_user" IN DATABASE :"dbname" SET search_path = _realtime, public;

-- NOTE ON THE PUBLICATION
--   Everytinroom's production database publishes products, sales and
--   whatsapp_orders through the 'supabase_realtime' publication. A full
--   pg_dump carries CREATE PUBLICATION statements, so a restore normally
--   brings it along -- but Realtime also manages that publication itself, and
--   a restore that lands AFTER Realtime has started can leave two versions of
--   the truth. Restore first, start Realtime second. verify-migration.sh
--   checks the publication's table list either way.

\echo '  realtime schema and role ready'
