-- ===========================================================================
-- Realtime's tenant migration 20240401105812, run by a role that is allowed to.
--
--   psql -U supabase_admin -d <app_db> -f realtime-migration-40.sql
--
-- WHY THIS FILE EXISTS
--
-- Migration 40 of Realtime's 91 tenant migrations creates the role
-- supabase_realtime_admin and moves ownership of Realtime's channels,
-- broadcasts and presences tables to it. An application's realtime role
-- cannot do that: the role is one of supautils' reserved roles on this image,
-- and the migration also grants it on to `postgres`, which needs admin rights
-- over a reserved role.
--
-- Nothing after a failed migration runs, and migration 69 -- which replaces
-- realtime.list_changes() with the version Realtime v2.148 actually calls --
-- is on the far side of it. So stopping at 40 breaks live database updates,
-- not just the broadcast and presence features the role is named after. The
-- symptom is a client that reports SUBSCRIBED while the poller fails every
-- cycle with `column "slot_changes_count" does not exist`.
--
-- On Supabase's own platform Realtime connects as a superuser and this
-- migration simply runs. Here it is run by the image's superuser instead,
-- with the SAME statements, copied from
--   lib/realtime/tenants/repo/migrations/20240401105812_create_realtime_admin_and_move_ownership.ex
-- and then the version is recorded so Realtime continues from 41 rather than
-- attempting it again.
--
-- THIS IS A LAST RESORT. provision-app.sh grants the application's realtime
-- role membership in supabase_realtime_admin precisely so Realtime can run
-- this itself, which keeps the schema entirely Realtime's own business. This
-- file is applied only when that is refused, and post-start.sh checks the
-- preconditions before using it: the three tables must already exist, so the
-- migrations before this one have genuinely run.
-- ===========================================================================

-- GUARD-EXEMPT: run as the image's superuser, not by the provisioning role.
-- validate-all.sh bans ownership transfers in this directory because a
-- non-superuser cannot make them. This file is the exception and is applied
-- only by post-start.sh through `psql -U supabase_admin`. The ban exists so
-- that nothing in the normal provisioning path does this; it is not a claim
-- that the statements are wrong.

\set ON_ERROR_STOP on
SET client_min_messages = warning;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'realtime') THEN
    RAISE EXCEPTION 'There is no "realtime" schema in this database. Realtime has not run its own migrations, so this one is not the next step.';
  END IF;
  IF EXISTS (SELECT 1 FROM realtime.schema_migrations WHERE version = 20240401105812) THEN
    RAISE EXCEPTION 'Migration 20240401105812 is already recorded. Nothing to do; applying it twice is not safe.';
  END IF;
  -- The tables this migration hands over must exist, which means migrations
  -- 36 to 39 ran. Without that check this would be creating a state Realtime
  -- never produced.
  IF NOT (EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                   WHERE n.nspname = 'realtime' AND c.relname = 'channels')
      AND EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                   WHERE n.nspname = 'realtime' AND c.relname = 'broadcasts')
      AND EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                   WHERE n.nspname = 'realtime' AND c.relname = 'presences')) THEN
    RAISE EXCEPTION 'realtime.channels, realtime.broadcasts and realtime.presences are not all present, so Realtime has not reached migration 40 yet. Applying it now would create a state Realtime never produced.';
  END IF;
END $$;

-- --------------------------------------------------------------------------
-- From here down: migration 20240401105812's own statements, unchanged.
-- --------------------------------------------------------------------------
DO
$do$
BEGIN
   IF EXISTS (
      SELECT FROM pg_catalog.pg_roles
      WHERE  rolname = 'supabase_realtime_admin') THEN

      RAISE NOTICE 'Role "supabase_realtime_admin" already exists. Skipping.';
   ELSE
      CREATE ROLE supabase_realtime_admin WITH NOINHERIT NOLOGIN NOREPLICATION;
   END IF;
END
$do$;

GRANT ALL PRIVILEGES ON SCHEMA realtime TO supabase_realtime_admin;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA realtime TO supabase_realtime_admin;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA realtime TO supabase_realtime_admin;
GRANT ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA realtime TO supabase_realtime_admin;

ALTER table realtime.channels OWNER to supabase_realtime_admin;
ALTER table realtime.broadcasts OWNER to supabase_realtime_admin;
ALTER table realtime.presences OWNER TO supabase_realtime_admin;
ALTER function realtime.channel_name() owner to supabase_realtime_admin;

GRANT supabase_realtime_admin TO postgres;

-- --------------------------------------------------------------------------
-- Record it, so Realtime continues from 41 instead of trying this again.
-- Ecto's own table, its own column names.
-- --------------------------------------------------------------------------
INSERT INTO realtime.schema_migrations (version, inserted_at)
VALUES (20240401105812, now())
ON CONFLICT (version) DO NOTHING;

\echo '  migration 20240401105812 applied and recorded'
