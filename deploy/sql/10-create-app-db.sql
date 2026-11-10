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

-- NO PER-APPLICATION OWNER ROLE, and no GRANT to the provisioning role.
--
-- This used to create an <app>_owner role, make the database owned by it, and
-- grant that role to the provisioning user so CREATE DATABASE ... OWNER would
-- be permitted. On the supabase/postgres image that GRANT CRASHES THE SERVER:
--
--   server closed the connection unexpectedly
--
-- supautils guards reserved roles and reserved memberships on that image, and
-- granting a role to the provisioning user trips it. The same shape of
-- statement killed central setup earlier with WITH ADMIN OPTION.
--
-- It was not load-bearing. ISOLATION DOES NOT COME FROM OWNERSHIP -- it comes
-- from the CONNECT grants below, which is what the isolation test actually
-- verifies: one application's credentials are refused by another's database.
-- Ownership by the provisioning role is normal on a managed platform, and
-- removes three statements that can crash:
--
--   GRANT <owner> TO CURRENT_USER WITH SET TRUE   (crashed here)
--   ALTER SCHEMA public OWNER TO <owner>          (needs that membership)
--   GRANT <owner> TO <app>_realtime / _storage    (membership again)
--
-- The services that need broad read now get explicit grants instead of
-- inheriting them through a role, which is also easier to audit.

-- The role PostgREST logs in as. NOINHERIT is required, not cosmetic: it must
-- hold no privileges of its own and gain them only by SET ROLE to the role
-- named in the request's JWT. With INHERIT, every anonymous web request would
-- carry the union of anon and service_role rights.
SELECT format('CREATE ROLE %I LOGIN NOINHERIT', :'authn')
 WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'authn')
\gexec

SELECT format('CREATE DATABASE %I ENCODING ''UTF8'' LC_COLLATE ''C'' LC_CTYPE ''C'' TEMPLATE template0', :'dbname')
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

-- The monitor may ask this database its size and connection count. pg_monitor
-- gives it statistics only; with no grants in the schema it reads no rows.
SELECT format('GRANT CONNECT ON DATABASE %I TO central_monitor', :'dbname')
 WHERE EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'central_monitor')
\gexec

\echo '  created/confirmed database and roles'
