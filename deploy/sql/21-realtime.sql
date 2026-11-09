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

-- And the `realtime` schema, which is a DIFFERENT thing and was the reason
-- Realtime accepted subscriptions and delivered nothing for several runs.
--
-- `_realtime` holds Realtime's own tenants and extensions. `realtime` holds
-- what reads the write-ahead log: realtime.subscription, realtime.apply_rls
-- and realtime.list_changes, which is the function the WAL poller calls. With
-- it missing the symptom is precisely the one that looks like success -- the
-- client subscribes, the channel reports SUBSCRIBED, and no database change
-- ever arrives. The only sign is in Realtime's own log:
--
--   PoolingReplicationError ... schema "realtime" does not exist
--   query: SELECT ... FROM realtime.list_changes($1, $2, $3, $4)
--
-- Realtime builds the schema's CONTENTS with its own tenant migrations, run
-- through Ecto with `prefix: "realtime"`. Ecto creates the migration table in
-- that prefix; it does NOT create the schema. On Supabase's own servers the
-- schema is already there, because the supabase/postgres image puts it in the
-- `postgres` database -- but every application database here is created with
-- TEMPLATE template0 (see 10-create-app-db.sql), which carries none of the
-- image's schemas. That is the same reason this platform already creates
-- `extensions`, `storage`, `auth` and `_realtime` by hand.
--
-- So: the schema is created here, and its contents are left to Realtime.
CREATE SCHEMA IF NOT EXISTS realtime;

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

-- Realtime's migrations create everything in `realtime` as this role, so it
-- needs CREATE there as well as USAGE.
-- WITH GRANT OPTION, because one of Realtime's later migrations grants on
-- the realtime schema itself, and ALL privileges without the grant option
-- are not enough to re-grant them. Found by replaying the migrations past
-- the one that creates list_changes.
GRANT ALL ON SCHEMA realtime TO :"rt_user" WITH GRANT OPTION;
-- USAGE only for the three API roles, and deliberately no table grants. The
-- tables do not exist yet, and nothing is granted speculatively: if a
-- specific object turns out to need a grant, the run will name it and that
-- one grant gets added. Over-granting a schema that reads every change in
-- the database is not a mistake worth making for convenience.
GRANT USAGE ON SCHEMA realtime TO anon, authenticated, service_role;

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

-- ---------------------------------------------------------------------------
-- THE PERMISSION REALTIME'S OWN MIGRATIONS NEED, AND WHY
--
-- Realtime builds the `realtime` schema with ninety-one tenant migrations.
-- Number thirty creates realtime.list_changes(), which is the function its
-- write-ahead-log poller calls on every cycle, and the function is declared
--
--     create or replace function realtime.list_changes(...)
--       returns setof realtime.wal_rls
--       language sql
--       set log_min_messages to 'fatal'
--
-- log_min_messages is a superuser-only parameter, so a role that may not set
-- it may not create a function that carries that SET clause:
--
--     ERROR:  permission denied to set parameter "log_min_messages"
--
-- Ecto stops at the first failure, so migrations thirty onwards never run.
-- Realtime then starts anyway, accepts websocket subscriptions, reports
-- SUBSCRIBED to the client, and delivers nothing at all -- the poller fails
-- every cycle with "function realtime.list_changes(...) does not exist". That
-- is the failure that looks most like success, and it cost five staging runs.
--
-- On Supabase's own servers this never shows up, because Realtime connects
-- there as a superuser. Here it connects as a role scoped to one database.
--
-- PostgreSQL 15 added privileges on configuration parameters, which is
-- exactly the narrow grant needed. It permits this role to quiet its own
-- logging and nothing else: no data access, no other parameter, and nothing
-- outside this cluster's log verbosity.
--
-- deploy/scripts/test-realtime-migrations.py replays the migrations against a
-- throwaway database as a non-superuser and proves both halves of this:
-- without the grant it stops at migration thirty, with it it goes past.
DO $$
DECLARE u text := current_setting('provision.rt_user');
BEGIN
  EXECUTE format('GRANT SET ON PARAMETER log_min_messages TO %I', u);
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE WARNING 'Could not grant SET ON PARAMETER log_min_messages to % (%).', u, SQLERRM;
  WHEN OTHERS THEN
    RAISE WARNING 'Granting SET ON PARAMETER log_min_messages to % failed: % (%)', u, SQLERRM, SQLSTATE;
END $$;

-- And then CHECK it, rather than trusting that the statement above ran. A
-- GRANT by a role without the privilege raises; a GRANT on an object the role
-- does not own only WARNS and grants nothing. Neither is detectable from the
-- statement's own success, so the privilege itself is read back.
DO $$
DECLARE u text := current_setting('provision.rt_user');
BEGIN
  IF has_parameter_privilege(u, 'log_min_messages', 'SET') THEN
    RAISE NOTICE 'Realtime''s role may set log_min_messages, so its migrations can create list_changes().';
  ELSE
    RAISE WARNING E'% CANNOT set log_min_messages.\n'
      '  Realtime''s migration 20230328144023 will fail, realtime.list_changes() will not\n'
      '  exist, and Realtime will accept subscriptions and deliver NOTHING -- with no error\n'
      '  that a client can see. This is reported here rather than left to be discovered.\n'
      '  Provisioning continues, because a database can still be restored and the rest of\n'
      '  the application still works; but anything that depends on live updates will not.\n'
      '  To fix it, as a role that holds the privilege WITH GRANT OPTION (a superuser on a\n'
      '  stock server, supabase_admin on this image):\n'
      '    GRANT SET ON PARAMETER log_min_messages TO %I;', u, u;
  END IF;
END $$;

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
