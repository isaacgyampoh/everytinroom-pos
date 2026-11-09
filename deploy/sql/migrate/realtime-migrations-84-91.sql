-- ===========================================================================
-- Realtime's tenant migrations 84 to 91, run by a role that is allowed to.
--
--   psql -U supabase_admin -d <app_db> -f realtime-migrations-84-91.sql
--
-- WHY THESE ARE NOT OPTIONAL
--
-- Each of these does work an application's own role cannot: statements like
--
--     ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA realtime ...
--
-- which is the "act as another role" this platform bans in its own SQL -- a
-- role may change its own default privileges, not another's.
--
-- I first documented them as irrelevant platform delegation that could be
-- skipped. The staging run disproved that. Realtime's migration runner stops
-- the tenant when ANY migration fails:
--
--     error_code=MigrationsFailedToRun ... code: :insufficient_privilege,
--     routine: "ExecAlterDefaultPrivilegesStmt"
--
-- so with 83 of 91 applied the websocket still accepted subscriptions and the
-- change-data-capture extension never started. Live updates need all of them,
-- regardless of whether this application uses the features they configure.
-- One of them, 20260928120000, also adds realtime.list_changes_sync().
--
-- On Supabase's own platform Realtime connects as a superuser and these
-- simply run. Here they are run by the image's superuser instead, with the
-- SAME statements, extracted verbatim from Realtime's own migration files at
-- the version this platform pins. deploy/scripts/check-realtime-tail-sql.py
-- re-extracts them and fails if this file has drifted.
--
-- GUARD-EXEMPT: run as the image's superuser, not by the provisioning role.
-- validate-all.sh bans ownership transfers and FOR ROLE default privileges in
-- this directory because a non-superuser cannot make them. This file is the
-- exception and is applied only by post-start.sh through
-- `psql -U supabase_admin`.
-- ===========================================================================

\set ON_ERROR_STOP on
SET client_min_messages = warning;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'realtime') THEN
    RAISE EXCEPTION 'There is no "realtime" schema in this database, so these migrations are not the next step.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM realtime.schema_migrations WHERE version = 20240401105812) THEN
    RAISE EXCEPTION 'Migration 20240401105812 has not been applied, so Realtime has not reached this point. Applying these now would create a state Realtime never produced.';
  END IF;
END $$;


-- --------------------------------------------------------------------------
-- 20260914120000_delegate_messages_grants_to_postgres.ex
-- --------------------------------------------------------------------------
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin
      IN SCHEMA realtime
      GRANT SELECT, INSERT ON TABLES TO postgres WITH GRANT OPTION;
GRANT SELECT, INSERT ON realtime.messages TO postgres WITH GRANT OPTION;
REVOKE GRANT OPTION FOR SELECT, INSERT ON realtime.messages FROM postgres CASCADE;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin
      IN SCHEMA realtime
      REVOKE GRANT OPTION FOR SELECT, INSERT ON TABLES FROM postgres;
INSERT INTO realtime.schema_migrations (version, inserted_at)
VALUES (20260914120000, now()) ON CONFLICT (version) DO NOTHING;

-- --------------------------------------------------------------------------
-- 20260916120000_allow_postgres_to_delegate_realtime_schema_usage.ex
-- --------------------------------------------------------------------------
GRANT USAGE ON SCHEMA realtime TO postgres WITH GRANT OPTION;
REVOKE GRANT OPTION FOR USAGE ON SCHEMA realtime FROM postgres CASCADE;
INSERT INTO realtime.schema_migrations (version, inserted_at)
VALUES (20260916120000, now()) ON CONFLICT (version) DO NOTHING;

-- --------------------------------------------------------------------------
-- 20260922120000_revoke_realtime_schema_grant_option_from_realtime_admin.ex
-- --------------------------------------------------------------------------
REVOKE GRANT OPTION FOR ALL ON SCHEMA realtime FROM supabase_realtime_admin CASCADE;
GRANT ALL ON SCHEMA realtime TO supabase_realtime_admin WITH GRANT OPTION;
INSERT INTO realtime.schema_migrations (version, inserted_at)
VALUES (20260922120000, now()) ON CONFLICT (version) DO NOTHING;

-- --------------------------------------------------------------------------
-- 20260925120000_restore_messages_base_grants.ex
-- --------------------------------------------------------------------------
DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        GRANT SELECT, INSERT, UPDATE ON realtime.messages TO anon;
      END IF;
    END $$;
DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        GRANT SELECT, INSERT, UPDATE ON realtime.messages TO authenticated;
      END IF;
    END $$;
DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
        GRANT SELECT, INSERT, UPDATE ON realtime.messages TO service_role;
      END IF;
    END $$;
INSERT INTO realtime.schema_migrations (version, inserted_at)
VALUES (20260925120000, now()) ON CONFLICT (version) DO NOTHING;

-- --------------------------------------------------------------------------
-- 20260928120000_add_list_changes_sync.ex
-- --------------------------------------------------------------------------
ALTER FUNCTION realtime.settled_changes(name, integer, text[]) OWNER TO supabase_realtime_admin;
ALTER FUNCTION realtime.list_changes_sync(name, name, integer, integer) OWNER TO supabase_realtime_admin;
INSERT INTO realtime.schema_migrations (version, inserted_at)
VALUES (20260928120000, now()) ON CONFLICT (version) DO NOTHING;

-- --------------------------------------------------------------------------
-- 20261002120000_add_authorize_function.ex
-- --------------------------------------------------------------------------
ALTER FUNCTION realtime.authorize(text, text, text, text, text, text[], text[]) OWNER TO supabase_realtime_admin;
DROP FUNCTION IF EXISTS realtime.authorize(text, text, text, text, text, text[], text[]);
INSERT INTO realtime.schema_migrations (version, inserted_at)
VALUES (20261002120000, now()) ON CONFLICT (version) DO NOTHING;

-- --------------------------------------------------------------------------
-- 20261008120000_authorize_read_probes_single_partition.ex
-- --------------------------------------------------------------------------
ALTER FUNCTION realtime.authorize(text, text, text, text, text, text[], text[]) OWNER TO supabase_realtime_admin;
INSERT INTO realtime.schema_migrations (version, inserted_at)
VALUES (20261008120000, now()) ON CONFLICT (version) DO NOTHING;

-- --------------------------------------------------------------------------
-- 20261009120000_messages_clock_timestamp_defaults.ex
-- --------------------------------------------------------------------------
ALTER TABLE realtime.messages ALTER COLUMN inserted_at SET DEFAULT timezone('utc', clock_timestamp());
ALTER TABLE realtime.messages ALTER COLUMN updated_at SET DEFAULT timezone('utc', clock_timestamp());
ALTER TABLE realtime.messages ALTER COLUMN inserted_at SET DEFAULT now();
ALTER TABLE realtime.messages ALTER COLUMN updated_at SET DEFAULT now();
INSERT INTO realtime.schema_migrations (version, inserted_at)
VALUES (20261009120000, now()) ON CONFLICT (version) DO NOTHING;

\echo '  migrations 84-91 applied and recorded'
