-- ===========================================================================
-- Create one application's database and its own login role.
-- Runs in the 'postgres' database, as superuser. Idempotent.
--
--   psql -v app=everytinroom -v dbname=everytinroom \
--        -v owner=everytinroom_owner -v authn=everytinroom_authenticator \
--        -f 10-create-app-db.sql
--
-- Passwords are NOT set here. 20-app-grants.sql does that, with statement
-- logging turned off for the statement that carries them.
--
-- CREATE DATABASE cannot run inside a transaction, which is why this file is
-- separate from the grants and why it uses \gexec rather than a DO block.
-- ===========================================================================

\set ON_ERROR_STOP on
-- 'already exists' notices are expected on a re-run and drown out real ones.
SET client_min_messages = warning;

-- The owner role: owns the schema and runs migrations. No login — nothing
-- should ever connect AS the owner over the network. Migrations are applied
-- by the provisioning script, which is already superuser locally.
SELECT format('CREATE ROLE %I NOLOGIN', :'owner')
 WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'owner')
\gexec

-- The role PostgREST logs in as. NOINHERIT is required, not cosmetic: it must
-- hold no privileges of its own and gain them only by SET ROLE to the role
-- named in the request's JWT. With INHERIT, every anonymous web request would
-- carry the union of anon and service_role rights.
SELECT format('CREATE ROLE %I LOGIN NOINHERIT', :'authn')
 WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'authn')
\gexec

-- Membership in the owner role, BEFORE creating a database owned by it.
--
-- CREATE DATABASE ... OWNER <role> requires the executing role to be a
-- superuser or a member of <role>. On a managed PostgreSQL -- Supabase's
-- included -- `postgres` is NOT a superuser, so without this the create
-- fails with:
--
--   ERROR:  must be able to SET ROLE "<app>_owner"
--
-- A local test as a superuser does not reveal this, which is exactly how it
-- reached a staging run. The creator of a role holds ADMIN OPTION on it, so
-- this grant is available to the same role that just created it.
SELECT set_config('provision.owner', :'owner', false);

DO $$
DECLARE o text := current_setting('provision.owner');
BEGIN
  -- The test is 'SET', not 'MEMBER'.
  --
  -- When a non-superuser with CREATEROLE creates a role, PostgreSQL 16+ gives
  -- the creator admin_option = true but set_option = FALSE. So
  -- pg_has_role(..., 'MEMBER') already returns true while SET ROLE is still
  -- refused -- and CREATE DATABASE ... OWNER needs SET. Testing MEMBER made
  -- this grant skip itself and the create failed anyway.
  IF NOT pg_has_role(current_user, o, 'SET') THEN
    IF current_setting('server_version_num')::int >= 160000 THEN
      EXECUTE format('GRANT %I TO CURRENT_USER WITH SET TRUE', o);
    ELSE
      -- Before 16 there was no SET option; plain membership allowed SET ROLE.
      EXECUTE format('GRANT %I TO CURRENT_USER', o);
    END IF;
    RAISE NOTICE 'granted SET on % to %', o, current_user;
  END IF;
END $$;

SELECT format('CREATE DATABASE %I OWNER %I ENCODING ''UTF8'' LC_COLLATE ''C'' LC_CTYPE ''C'' TEMPLATE template0', :'dbname', :'owner')
 WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'dbname')
\gexec

-- ---------------------------------------------------------------------------
-- ISOLATION. This is the part that keeps one business out of another's books.
--
-- anon, authenticated and service_role are CLUSTER-WIDE in the supabase
-- image: every application's database sees the same role names. Their
-- PRIVILEGES are per-database, so app A's grants never apply in app B — but
-- the right to CONNECT is per-database too, and by default PUBLIC has it.
-- Revoking it from PUBLIC and granting it to this application's own
-- authenticator alone is what makes the separation real: app B's PostgREST
-- holds app B's credentials, and those credentials cannot open app A's
-- database at all.
-- ---------------------------------------------------------------------------
SELECT format('REVOKE ALL ON DATABASE %I FROM PUBLIC', :'dbname') \gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO %I', :'dbname', :'authn') \gexec
SELECT format('GRANT ALL    ON DATABASE %I TO %I', :'dbname', :'owner') \gexec

-- The monitor may ask this database its size and connection count. pg_monitor
-- gives it statistics only; with no grants in the schema it reads no rows.
SELECT format('GRANT CONNECT ON DATABASE %I TO central_monitor', :'dbname')
 WHERE EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'central_monitor')
\gexec

\echo '  created/confirmed database and roles'
