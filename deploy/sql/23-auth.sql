-- ===========================================================================
-- Prepare one application's database for Supabase Auth (GoTrue).
-- Runs INSIDE that database, as superuser. Idempotent.
--
--   psql -d appdb -v dbname=appdb -v owner=appdb_owner \
--        -v auth_user=appdb_auth -v auth_password="$PW" -f 23-auth.sql
--
-- ONLY FOR APPLICATIONS THAT USE IT. Everytinroom does not: it checks a PIN
-- against its own staff_sessions table. Two other projects on this account do
-- have rows in auth.users, which is why this file exists -- the decision is
-- made per application by inspecting it, not by installing everything.
--
-- WHY A PER-APPLICATION ROLE
--   The stock self-hosted compose connects GoTrue as the cluster-wide
--   supabase_auth_admin using the central Postgres password. On a server
--   holding several businesses that would give every auth container one
--   password for a role that exists in every database. GoTrue takes its
--   connection string as configuration, so each application gets its own
--   role with CONNECT on its own database only.
-- ===========================================================================

\set ON_ERROR_STOP on
SET client_min_messages = warning;

SELECT set_config('provision.auth_user', :'auth_user', false);

DO $$
DECLARE u text := current_setting('provision.auth_user');
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = u) THEN
    RAISE EXCEPTION 'Role % does not exist. provision-app.sh creates it before running this file.', u;
  END IF;
END $$;

-- GoTrue runs its own migrations and needs to create the auth schema and its
-- tables on first boot.
CREATE SCHEMA IF NOT EXISTS auth AUTHORIZATION :"auth_user";
GRANT ALL ON SCHEMA auth TO :"auth_user";
GRANT CREATE ON DATABASE :"dbname" TO :"auth_user";

-- PostgREST needs to read auth.uid() and auth.role() from a JWT for RLS
-- policies that use them. Those helpers live in the auth schema.
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;

-- If a restored dump already brought the auth schema across, hand it over
-- rather than leaving it owned by a role this server does not have.
DO $$
DECLARE u text := current_setting('provision.auth_user');
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'auth') THEN
    EXECUTE format('ALTER SCHEMA auth OWNER TO %I', u);
    EXECUTE format('GRANT ALL ON ALL TABLES IN SCHEMA auth TO %I', u);
    EXECUTE format('GRANT ALL ON ALL SEQUENCES IN SCHEMA auth TO %I', u);
  END IF;
END $$;

SET log_min_duration_statement = -1;
SET log_statement = 'none';
ALTER ROLE :"auth_user" PASSWORD :'auth_password';
RESET log_statement;
RESET log_min_duration_statement;

ALTER ROLE :"auth_user" IN DATABASE :"dbname" SET search_path = auth, public;

\echo '  auth schema and role ready'
