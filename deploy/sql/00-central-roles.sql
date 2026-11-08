-- ===========================================================================
-- Runs ONCE, the first time the postgres volume is initialised.
--
-- The supabase/postgres image already creates the roles PostgREST, Realtime
-- and Storage expect (anon, authenticated, service_role, authenticator,
-- supabase_admin, supabase_storage_admin). This file adds only what the
-- CENTRAL, multi-application arrangement needs on top.
--
-- Nothing application-specific belongs here. Everything per-app lives in
-- deploy/sql/provision-app.sql, which runs per application and can be re-run.
-- ===========================================================================

-- pg_cron's scheduler lives in this database (cron.database_name = 'postgres'
-- in postgresql.conf). The extension must therefore exist HERE, and every
-- application registers its jobs from here with cron.schedule_in_database().
--
-- Handled the same way as the per-application extensions: required ones
-- abort with an explanation, the monitoring one only warns, and "not
-- available in this installation" is reported differently from "not
-- permitted" because the answers differ. require_extensions=off downgrades a
-- missing one to a warning, which is how this file can be tested on a laptop
-- that has no pg_cron.
\if :{?require_extensions}
\else
  \set require_extensions on
\endif
SELECT set_config('central.require_ext', :'require_extensions', false);

DO $$
DECLARE
  ext         text;
  unavail     text := '';
  denied      text := '';
  strict_mode boolean := current_setting('central.require_ext') <> 'off';
BEGIN
  FOREACH ext IN ARRAY ARRAY['pg_cron', 'pg_net'] LOOP
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = ext) THEN CONTINUE; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = ext) THEN
      unavail := unavail || ' ' || ext; CONTINUE;
    END IF;
    BEGIN
      EXECUTE format('CREATE EXTENSION IF NOT EXISTS %I', ext);
    EXCEPTION WHEN OTHERS THEN
      denied := denied || ' ' || ext || ' (' || SQLERRM || ')';
    END;
  END LOOP;

  IF denied <> '' THEN
    RAISE EXCEPTION 'Could not create:%. pg_cron runs every application''s scheduled jobs and pg_net is how they make HTTP calls, so both are required in this database.', denied;
  END IF;
  IF unavail <> '' THEN
    IF strict_mode THEN
      RAISE EXCEPTION 'Not available in this PostgreSQL installation:%. The supabase/postgres image ships them; a plain postgres image does not. Check the image tag in docker-compose.yml.', unavail;
    ELSE
      RAISE WARNING 'Not available here and NOT created:% (require_extensions=off)', unavail;
    END IF;
  END IF;

  -- Monitoring only. Nothing depends on it.
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_stat_statements') THEN
    BEGIN
      CREATE EXTENSION pg_stat_statements;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'pg_stat_statements not created (%). Query statistics will be missing from the capacity report.', SQLERRM;
    END;
  END IF;
END $$;

-- ADMIN OPTION on the three roles PostgREST switches into.
--
-- Provisioning has to run `GRANT anon TO <app>_authenticator`, which needs
-- admin on anon. On the supabase/postgres image the `postgres` role created
-- these and already has it; this makes that explicit so provisioning does not
-- fail later with an error that does not explain itself. Best effort: if the
-- current role cannot grant admin on them, provisioning will say what to run.
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      BEGIN
        EXECUTE format('GRANT %I TO CURRENT_USER WITH ADMIN OPTION', r);
      EXCEPTION
        -- Catch EVERYTHING. This is an optimisation: it saves provisioning
        -- from failing later with an error that does not explain itself. It
        -- is not worth failing central setup over, and narrowing the handler
        -- to the exceptions I expected is what made it fatal on the first
        -- server it met. If it cannot be done, provisioning says what to run.
        WHEN OTHERS THEN
          RAISE WARNING 'Could not take ADMIN OPTION on % (%). If provisioning later cannot grant it, run this once as a superuser: GRANT % TO <provisioning role> WITH ADMIN OPTION;', r, SQLERRM, r;
      END;
    END IF;
  END LOOP;
END $$;

-- A read-only role for the capacity monitor (deploy/capacity.sh). It can see
-- sizes, connection counts and statement statistics, and no application data.
-- pg_monitor is a built-in role that grants exactly that.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'central_monitor') THEN
    CREATE ROLE central_monitor LOGIN;
  END IF;
END $$;
GRANT pg_monitor TO central_monitor;

-- The monitor must never read a row of anybody's data. It has no rights in
-- any application database, and this makes that explicit for the one database
-- it does connect to.
REVOKE ALL ON SCHEMA public FROM central_monitor;

-- A registry of the applications on this server, so provisioning, backups and
-- the capacity report all work from one list rather than from whatever
-- directories happen to exist.
CREATE SCHEMA IF NOT EXISTS central;

CREATE TABLE IF NOT EXISTS central.applications (
  name            text PRIMARY KEY
                  CHECK (name ~ '^[a-z][a-z0-9_]{1,30}$'),
  database_name   text NOT NULL,
  db_role         text NOT NULL,
  domain          text,
  needs_realtime  boolean NOT NULL DEFAULT false,
  needs_storage   boolean NOT NULL DEFAULT false,
  needs_functions boolean NOT NULL DEFAULT false,
  needs_auth      boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  notes           text
);

-- Added after the registry already existed on some servers.
ALTER TABLE central.applications ADD COLUMN IF NOT EXISTS needs_auth boolean NOT NULL DEFAULT false;

COMMENT ON TABLE central.applications IS
  'One row per application hosted on this server. Written by provision-app.sh. Holds no credentials -- those live in /srv/central/apps/<name>/.env, mode 600.';

GRANT USAGE ON SCHEMA central TO central_monitor;
GRANT SELECT ON central.applications TO central_monitor;
