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
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

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
  created_at      timestamptz NOT NULL DEFAULT now(),
  notes           text
);

COMMENT ON TABLE central.applications IS
  'One row per application hosted on this server. Written by provision-app.sh. Holds no credentials -- those live in /srv/central/apps/<name>/.env, mode 600.';

GRANT USAGE ON SCHEMA central TO central_monitor;
GRANT SELECT ON central.applications TO central_monitor;
