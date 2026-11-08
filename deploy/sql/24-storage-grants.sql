-- ===========================================================================
-- Grant the roles storage-api switches into their rights on the tables
-- storage-api's OWN migrations created.
--
--   psql -d <app_db> -U <app>_storage -f 24-storage-grants.sql
--
-- RUN AS THE STORAGE ROLE, not as the provisioning role. storage-api's
-- migrations create these tables and functions, so the storage role owns them,
-- and in PostgreSQL only an object's owner may grant on it. Run as postgres
-- this emitted "no privileges were granted for ..." per object and granted
-- nothing -- as warnings, not errors, so it looked close to working.
--
-- WHY THIS RUNS AFTER THE SERVICE STARTS, AND NOT WITH THE REST
--
-- storage-api owns its schema's shape. Its migrations create storage.buckets,
-- storage.objects, storage.prefixes and the rest, as the role it connects
-- with. Three ways of handing those tables to anon/authenticated/service_role
-- were tried on a real server, and two of them cannot work here:
--
--   DB_INSTALL_ROLES=true -- let storage-api grant them itself. Its
--     'storage-schema' migration modifies the reserved `authenticator` role,
--     supautils refuses, the migration rolls back and the server never
--     starts.
--
--   ALTER DEFAULT PRIVILEGES FOR ROLE <storage role> -- have the grants apply
--     automatically to whatever it creates. A role may change its own default
--     privileges; another role may not do it for it without membership, and
--     membership in these roles crashes this PostgreSQL image.
--
--   This file, run once the tables exist. Plain GRANTs on objects that are
--     really there, by a role that may grant on them. It is idempotent, so a
--     re-run or a later storage-api upgrade that adds a table is handled by
--     running it again.
--
-- It grants on what it finds. It creates nothing and drops nothing, so it is
-- safe against a database restored from production that already has these
-- tables with their own grants.
-- ===========================================================================

\set ON_ERROR_STOP on
SET client_min_messages = warning;

DO $$
DECLARE n_tab int; n_seq int; n_fun int;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'storage') THEN
    RAISE EXCEPTION 'There is no "storage" schema in this database. Either storage is not provisioned for this application, or storage-api has not run its migrations yet -- start it and wait for it to become healthy first.';
  END IF;

  SELECT count(*) INTO n_tab FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'storage' AND c.relkind IN ('r','p','v','m','f');
  IF n_tab = 0 THEN
    RAISE EXCEPTION 'The "storage" schema exists but is empty, so storage-api has not created its tables yet. Nothing was granted. Wait for the service to become healthy and run this again.';
  END IF;

  SELECT count(*) INTO n_seq FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'storage' AND c.relkind = 'S';
  SELECT count(*) INTO n_fun FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'storage';

  RAISE NOTICE 'storage schema: % table(s)/view(s), % sequence(s), % function(s)', n_tab, n_seq, n_fun;
END $$;

-- Deliberately NOT here: GRANT USAGE ON SCHEMA storage. The schema is created
-- and owned by the provisioning role in 22-storage.sql, which grants USAGE
-- there, as its owner. This file runs as the STORAGE role -- the owner of the
-- tables and functions, which is the only role that may grant on them -- and a
-- non-owner granting on a schema produces
--   WARNING:  no privileges were granted for "storage"
-- not an error. A warning that is expected teaches you to ignore warnings, so
-- the line that causes it is gone and any warning from this file is real.
GRANT ALL ON ALL TABLES    IN SCHEMA storage TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA storage TO anon, authenticated, service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA storage TO anon, authenticated, service_role;

-- Row-level security is what actually limits the browser-facing key here, not
-- the absence of a table grant: storage-api runs its own policies on
-- storage.objects, and SELECT without a policy returns nothing. These grants
-- are what let the service switch roles at all.

\echo '  storage grants applied to the tables storage-api created'
