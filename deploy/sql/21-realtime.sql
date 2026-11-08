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

ALTER SCHEMA _realtime OWNER TO :"rt_user";
GRANT ALL ON SCHEMA _realtime TO :"rt_user";

-- It must be able to read the tables it replicates, and to create the
-- publication it manages.
GRANT USAGE ON SCHEMA public TO :"rt_user";
GRANT :"owner" TO :"rt_user";

SET log_min_duration_statement = -1;
SET log_statement = 'none';
ALTER ROLE :"rt_user" PASSWORD :'rt_password';
RESET log_statement;
RESET log_min_duration_statement;

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
