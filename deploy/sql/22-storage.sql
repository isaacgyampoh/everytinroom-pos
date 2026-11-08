-- ===========================================================================
-- Prepare one application's database for Storage. Runs INSIDE that database.
--
--   psql -d everytinroom -v dbname=everytinroom -v owner=everytinroom_owner \
--        -v st_user=everytinroom_storage -v st_password="$PW" -f 22-storage.sql
--
-- WHY A PER-APPLICATION ROLE AND NOT supabase_storage_admin
--   The supabase/postgres image ships a cluster-wide supabase_storage_admin,
--   and the stock self-hosted compose connects storage-api as that role using
--   the central Postgres password. On a server holding one application that
--   is fine. On a server holding several it is not: every storage container
--   would hold one password for a role that exists in every database, so a
--   flaw in one business's storage service would reach another's. storage-api
--   takes DATABASE_URL and DB_SUPER_USER as configuration, so each
--   application gets its own role, with CONNECT on its own database only.
-- ===========================================================================

\set ON_ERROR_STOP on
SET client_min_messages = warning;

-- psql does NOT interpolate :variables inside a dollar-quoted string, so the
-- DO blocks below read them from session settings instead.
SELECT set_config('provision.st_user', :'st_user', false);

DO $$
DECLARE u text := current_setting('provision.st_user');
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = u) THEN
    RAISE EXCEPTION 'Role % does not exist. provision-app.sh creates it before running this file.', u;
  END IF;
END $$;

-- storage-api runs its own migrations on first boot and needs to create the
-- 'storage' schema and its tables.
GRANT CREATE ON DATABASE :"dbname" TO :"st_user";
GRANT USAGE  ON SCHEMA public TO :"st_user";
-- No owner-role membership: see 10-create-app-db.sql.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO :"st_user";
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO :"st_user";

-- If a dump has already brought the storage schema across, hand it over
-- rather than leaving it owned by a role this server does not use.
DO $$
DECLARE u text := current_setting('provision.st_user');
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'storage') THEN
    EXECUTE format('ALTER SCHEMA storage OWNER TO %I', u);
    EXECUTE format('GRANT ALL ON SCHEMA storage TO %I', u);
    RAISE WARNING 'An existing "storage" schema was found and reassigned to %. Check its object owners with: \dn+ storage', u;
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
ALTER ROLE :"st_user" PASSWORD :'st_password';
DO $$
BEGIN
  RESET log_statement;
  RESET log_min_duration_statement;
EXCEPTION WHEN insufficient_privilege THEN NULL;
END $$;

\echo '  storage role ready'
