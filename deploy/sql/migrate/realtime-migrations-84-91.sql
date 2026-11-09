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
-- 20260914120000_delegate_messages_grants_to_postgres.ex  (4 statement(s))
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
-- 20260916120000_allow_postgres_to_delegate_realtime_schema_usage.ex  (2 statement(s))
-- --------------------------------------------------------------------------
GRANT USAGE ON SCHEMA realtime TO postgres WITH GRANT OPTION;
REVOKE GRANT OPTION FOR USAGE ON SCHEMA realtime FROM postgres CASCADE;
INSERT INTO realtime.schema_migrations (version, inserted_at)
VALUES (20260916120000, now()) ON CONFLICT (version) DO NOTHING;

-- --------------------------------------------------------------------------
-- 20260922120000_revoke_realtime_schema_grant_option_from_realtime_admin.ex  (2 statement(s))
-- --------------------------------------------------------------------------
REVOKE GRANT OPTION FOR ALL ON SCHEMA realtime FROM supabase_realtime_admin CASCADE;
GRANT ALL ON SCHEMA realtime TO supabase_realtime_admin WITH GRANT OPTION;
INSERT INTO realtime.schema_migrations (version, inserted_at)
VALUES (20260922120000, now()) ON CONFLICT (version) DO NOTHING;

-- --------------------------------------------------------------------------
-- 20260925120000_restore_messages_base_grants.ex  (3 statement(s))
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
-- 20260928120000_add_list_changes_sync.ex  (4 statement(s))
-- --------------------------------------------------------------------------
-- A drop-in replacement for pg_logical_slot_get_changes, taking and forwarding the same
    -- plugin options, that holds back a change whose transaction has not settled yet. It works
    -- the cut out for itself, so it takes no upto_lsn.
    CREATE OR REPLACE FUNCTION realtime.settled_changes(
      slot_name name, max_changes int, VARIADIC opts text[])
    RETURNS TABLE(lsn pg_lsn, xid xid, data text)
    LANGUAGE plpgsql
    VOLATILE
    AS $$
    declare
      upto pg_lsn;
      total bigint;
      xids xid[];
      starts bigint[];
      snapshot pg_snapshot;
      running_xids xid[];
      xmax_age int;
      cut bigint;
    begin
      -- Each statement in a volatile function takes its own snapshot, which is what lets the
      -- check below see a writer that was still in flight when the peek ran. Under REPEATABLE
      -- READ the snapshot never advances, so a deferred change would never be released.
      if current_setting('transaction_isolation') <> 'read committed' then
        raise exception 'realtime.settled_changes requires READ COMMITTED';
      end if;

      -- The peek and the read below cover the same WAL, so the read cannot reach a commit the
      -- check never saw.
      upto := pg_current_wal_flush_lsn();

      -- One entry per transaction, in commit order: its xid and the position of its first
      -- change. The peek uses the caller's own options, so max_changes counts exactly what the
      -- read counts. A non-transactional logical message is emitted as soon as it is decoded,
      -- tagged with the xid of whatever transaction wrote it, so it does not mark where that
      -- transaction starts.
      select coalesce(sum(g.n), 0),
             array_agg(g.x order by g.first) filter (where g.first is not null),
             array_agg(g.first order by g.first) filter (where g.first is not null)
        into total, xids, starts
        from (
          select p.xid as x, count(*) as n,
                 min(p.ord) filter (where not case
                   when starts_with(p.data, '{"action":"M"') then (p.data::jsonb->>'transactional')::boolean is false
                   else false
                 end) as first
          from pg_logical_slot_peek_changes(slot_name, upto, max_changes, variadic opts)
               with ordinality as p(lsn, xid, data, ord)
          group by p.xid
        ) g;

      -- Nothing for the caller, but the slot still has to move past what the peek covered.
      if total = 0 then
        perform pg_replication_slot_advance(slot_name, upto);
        return;
      end if;

      if xids is not null then
        -- Taken after the peek is materialized, so a writer that was still in flight during
        -- decoding is guaranteed to show up here.
        snapshot := pg_current_snapshot();

        -- A commit record reaches the WAL before the writer leaves the proc array, so a change
        -- can be decoded while its row is invisible. apply_rls would resolve a policy against a
        -- row it cannot see and authorize it for nobody, while the read consumed it regardless.
        --
        -- xip lists transactions running when the snapshot was taken. It does not cover a writer
        -- whose xid sits at or beyond xmax, which never appears there, so the horizon is checked
        -- too. age() counts backwards from the current xid and so compares correctly across
        -- wraparound.
        select coalesce(array_agg(running.x::xid), array[]::xid[])
          into running_xids
          from pg_snapshot_xip(snapshot) running(x);
        xmax_age := age(pg_snapshot_xmax(snapshot)::xid);

        select min(u.s) into cut
          from unnest(xids, starts) as u(x, s)
          where u.x = any(running_xids) or age(u.x) <= xmax_age;
      end if;

      -- The read stops right after the commit that brings its count to upto_nchanges, so the
      -- count of changes in front of the first unsettled transaction stops it just before that
      -- transaction.
      if cut is null then
        return query
          select p.* from pg_logical_slot_get_changes(slot_name, upto, max_changes, variadic opts) p;
      elsif cut > 1 then
        return query
          select p.* from pg_logical_slot_get_changes(slot_name, upto, (cut - 1)::int, variadic opts) p;
      end if;
    end;
    $$;
CREATE FUNCTION realtime.list_changes_sync(publication name, slot_name name, max_changes int, max_record_bytes int)
    RETURNS TABLE(
      wal jsonb,
      is_rls_enabled boolean,
      subscription_ids uuid[],
      errors text[],
      slot_changes_count bigint
    )
    LANGUAGE sql
    SET log_min_messages TO 'fatal'
    AS $$
      WITH pub AS (
        SELECT
          concat_ws(
            ',',
            CASE WHEN bool_or(pubinsert) THEN 'insert' ELSE NULL END,
            CASE WHEN bool_or(pubupdate) THEN 'update' ELSE NULL END,
            CASE WHEN bool_or(pubdelete) THEN 'delete' ELSE NULL END
          ) AS w2j_actions,
          coalesce(
            string_agg(
              realtime.quote_wal2json(format('%I.%I', schemaname, tablename)::regclass),
              ','
            ) filter (WHERE ppt.tablename IS NOT NULL),
            ''
          ) AS w2j_add_tables
        FROM pg_publication pp
        LEFT JOIN pg_publication_tables ppt ON pp.pubname = ppt.pubname
        WHERE pp.pubname = publication
        GROUP BY pp.pubname
        LIMIT 1
      ),
      -- MATERIALIZED ensures the slot is read exactly once.
      consumed AS MATERIALIZED (
        SELECT x.*, pub.w2j_add_tables
        FROM pub,
             realtime.settled_changes(
               slot_name, max_changes,
               'include-pk', 'true',
               'include-transaction', 'false',
               'include-timestamp', 'true',
               'include-type-oids', 'true',
               'format-version', '2',
               'actions', pub.w2j_actions,
               'add-tables', pub.w2j_add_tables
             ) x
      ),
      slot_count AS (
        SELECT count(*)::bigint AS cnt
        FROM consumed
        WHERE consumed.w2j_add_tables <> ''
      ),
      rls_filtered AS (
        SELECT xyz.wal, xyz.is_rls_enabled, xyz.subscription_ids, xyz.errors
        FROM consumed,
             realtime.apply_rls(
               wal := consumed.data::jsonb,
               max_record_bytes := max_record_bytes
             ) xyz(wal, is_rls_enabled, subscription_ids, errors)
        WHERE consumed.w2j_add_tables <> ''
          AND xyz.subscription_ids[1] IS NOT NULL
      )
      SELECT rf.wal, rf.is_rls_enabled, rf.subscription_ids, rf.errors, sc.cnt
      FROM rls_filtered rf, slot_count sc

      UNION ALL

      SELECT null, null, null, null, sc.cnt
      FROM slot_count sc
      WHERE NOT EXISTS (SELECT 1 FROM rls_filtered)
    $$;
ALTER FUNCTION realtime.settled_changes(name, integer, text[]) OWNER TO supabase_realtime_admin;
ALTER FUNCTION realtime.list_changes_sync(name, name, integer, integer) OWNER TO supabase_realtime_admin;
INSERT INTO realtime.schema_migrations (version, inserted_at)
VALUES (20260928120000, now()) ON CONFLICT (version) DO NOTHING;

-- --------------------------------------------------------------------------
-- 20261002120000_add_authorize_function.ex  (3 statement(s))
-- --------------------------------------------------------------------------
-- Each read extension gets a probe row inserted as the calling role, and is readable if the
    -- user can SELECT it back. Each write extension is writable if the user can INSERT a row for
    -- it. read_allowed and write_allowed line up with read_extensions and write_extensions.
    CREATE FUNCTION realtime.authorize(
      role_name text,
      topic_name text,
      claims text,
      sub text,
      headers text,
      read_extensions text[],
      write_extensions text[],
      OUT read_allowed boolean[],
      OUT write_allowed boolean[])
    LANGUAGE plpgsql
    VOLATILE
    AS $$
    declare
      probe_ids uuid[];
      ext text;
      allowed boolean;
    begin
      -- The probe inserts are rolled back, but they still give the transaction an xid, so it ends
      -- in a commit. Nothing durable was written, so skip waiting on the WAL flush and sync standbys.
      -- Set outside the block below, whose rollback would undo it.
      perform set_config('synchronous_commit', 'off', true);

      -- The RAISE at the end of this block rolls back everything in it.
      begin
        probe_ids := array(select gen_random_uuid() from unnest(read_extensions));

        insert into realtime.messages (id, topic, extension, inserted_at, updated_at)
        select p.id, topic_name, p.extension, now() at time zone 'utc', now() at time zone 'utc'
        from unnest(probe_ids, read_extensions) as p(id, extension);

        perform set_config('role', role_name, true),
                set_config('realtime.topic', topic_name, true),
                set_config('request.jwt.claims', claims, true),
                set_config('request.jwt.claim.sub', sub, true),
                set_config('request.jwt.claim.role', role_name, true),
                set_config('request.headers', headers, true);

        read_allowed := array(
          select exists(select 1 from realtime.messages m where m.id = p.id)
          from unnest(probe_ids) with ordinality as p(id, n)
          order by p.n);

        write_allowed := '{}';

        foreach ext in array write_extensions loop
          begin
            insert into realtime.messages (topic, extension, inserted_at, updated_at)
            values (topic_name, ext, now() at time zone 'utc', now() at time zone 'utc');

            allowed := true;
          exception when insufficient_privilege then
            allowed := false;
          end;

          write_allowed := write_allowed || allowed;
        end loop;

        raise sqlstate 'RTA01';
      exception when sqlstate 'RTA01' then
        null;
      end;
    end;
    $$;
ALTER FUNCTION realtime.authorize(text, text, text, text, text, text[], text[]) OWNER TO supabase_realtime_admin;
DROP FUNCTION IF EXISTS realtime.authorize(text, text, text, text, text, text[], text[]);
INSERT INTO realtime.schema_migrations (version, inserted_at)
VALUES (20261002120000, now()) ON CONFLICT (version) DO NOTHING;

-- --------------------------------------------------------------------------
-- 20261008120000_authorize_read_probes_single_partition.ex  (2 statement(s))
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION realtime.authorize(
      role_name text,
      topic_name text,
      claims text,
      sub text,
      headers text,
      read_extensions text[],
      write_extensions text[],
      OUT read_allowed boolean[],
      OUT write_allowed boolean[])
    LANGUAGE plpgsql
    VOLATILE
    AS $$
    declare
      probe_ids uuid[];
      probe_inserted_at timestamp := now() at time zone 'utc';
      visible_ids uuid[];
      ext text;
      allowed boolean;
    begin
      -- The probe inserts are rolled back, but they still give the transaction an xid, so it ends
      -- in a commit. Nothing durable was written, so skip waiting on the WAL flush and sync standbys.
      -- Set outside the block below, whose rollback would undo it.
      perform set_config('synchronous_commit', 'off', true);

      -- The RAISE at the end of this block rolls back everything in it.
      begin
        probe_ids := array(select gen_random_uuid() from unnest(read_extensions));

        insert into realtime.messages (id, topic, extension, inserted_at, updated_at)
        select p.id, topic_name, p.extension, probe_inserted_at, probe_inserted_at
        from unnest(probe_ids, read_extensions) as p(id, extension);

        perform set_config('role', role_name, true),
                set_config('realtime.topic', topic_name, true),
                set_config('request.jwt.claims', claims, true),
                set_config('request.jwt.claim.sub', sub, true),
                set_config('request.jwt.claim.role', role_name, true),
                set_config('request.headers', headers, true);

        -- One lookup for every probe, by the full primary key.
        visible_ids := array(
          select m.id
          from realtime.messages m
          where m.inserted_at = probe_inserted_at
            and m.id = any(probe_ids));

        read_allowed := array(
          select p.id = any(visible_ids)
          from unnest(probe_ids) with ordinality as p(id, n)
          order by p.n);

        write_allowed := '{}';

        foreach ext in array write_extensions loop
          begin
            insert into realtime.messages (topic, extension, inserted_at, updated_at)
            values (topic_name, ext, now() at time zone 'utc', now() at time zone 'utc');

            allowed := true;
          exception when insufficient_privilege then
            allowed := false;
          end;

          write_allowed := write_allowed || allowed;
        end loop;

        raise sqlstate 'RTA01';
      exception when sqlstate 'RTA01' then
        null;
      end;
    end;
    $$;
ALTER FUNCTION realtime.authorize(text, text, text, text, text, text[], text[]) OWNER TO supabase_realtime_admin;
INSERT INTO realtime.schema_migrations (version, inserted_at)
VALUES (20261008120000, now()) ON CONFLICT (version) DO NOTHING;

-- --------------------------------------------------------------------------
-- 20261009120000_messages_clock_timestamp_defaults.ex  (4 statement(s))
-- --------------------------------------------------------------------------
ALTER TABLE realtime.messages ALTER COLUMN inserted_at SET DEFAULT timezone('utc', clock_timestamp());
ALTER TABLE realtime.messages ALTER COLUMN updated_at SET DEFAULT timezone('utc', clock_timestamp());
ALTER TABLE realtime.messages ALTER COLUMN inserted_at SET DEFAULT now();
ALTER TABLE realtime.messages ALTER COLUMN updated_at SET DEFAULT now();
INSERT INTO realtime.schema_migrations (version, inserted_at)
VALUES (20261009120000, now()) ON CONFLICT (version) DO NOTHING;

\echo '  migrations 84-91 applied and recorded'
