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

-- storage-api does SET ROLE to the role named in the request's JWT, exactly
-- as PostgREST does, so it must be a member of the three. Without this every
-- call fails with:
--   permission denied to set role "service_role"
-- which arrives as an opaque HTTP 400 carrying a 403 inside it.
GRANT anon, authenticated, service_role TO :"st_user";

-- The storage schema, pre-created with rights for the roles storage-api
-- switches INTO.
--
-- Granting the three roles above only fixes half of it: storage-api then runs
-- AS service_role, and that role had no rights in the storage schema, so
-- every call failed one step later with
--   permission denied for schema storage
-- Creating the schema here rather than leaving it to storage-api's own
-- migrations means the grants can be attached before anything needs them, and
-- the default privileges cover the tables those migrations go on to create.
CREATE SCHEMA IF NOT EXISTS storage;
GRANT ALL ON SCHEMA storage TO :"st_user";
GRANT USAGE ON SCHEMA storage TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA storage TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA storage TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA storage GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA storage GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
-- NOT done here: ALTER DEFAULT PRIVILEGES FOR ROLE <storage role>.
--
-- That is a fourth form of "act as another role" and fails the same way:
--   ERROR:  permission denied to change default privileges
-- A role may change its OWN default privileges; another role may not do it
-- for it without membership, and membership crashes this image.
--
-- It is not needed. storage-api's own migrations grant on the tables they
-- create -- that is what DB_INSTALL_ROLES is for, and it is set to true in
-- app.compose.yml so those grants run. The roles themselves already exist,
-- and storage-api's migration is idempotent about that.
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
    -- Granted, not reassigned: ALTER SCHEMA ... OWNER TO needs SET ROLE on
    -- the target, which a non-superuser cannot do here.
    EXECUTE format('GRANT ALL ON SCHEMA storage TO %I', u);
    EXECUTE format('GRANT ALL ON ALL TABLES IN SCHEMA storage TO %I', u);
    EXECUTE format('GRANT ALL ON ALL SEQUENCES IN SCHEMA storage TO %I', u);
    RAISE WARNING 'An existing "storage" schema was found; % was granted full rights on it rather than taking ownership.', u;
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
