# Staging validation

- Machine: Ubuntu 24.04.5 LTS, 4 processors, 15983 MB RAM
- Docker: Docker version 29.9.3
- Scope: full run
- Result: **120 passed, 0 failed, 0 skipped**
- Known defects in optional components: 2 (not counted above; listed where they occur)

No production credential was used. Every secret here was generated on
this machine and dies with it.

## 1. The machine
      Ubuntu 24.04.5 LTS  (noble)
      4 processors, 15983 MB RAM, 86 GB free on /
- PASS running on Ubuntu, which is what bootstrap.sh supports
      Docker is pre-installed; removing it so the install path is genuinely tested
- PASS starting from a machine with no Docker

## 2. bootstrap.sh installs Docker and the Compose plugin
- PASS bootstrap.sh completed
- PASS Docker Engine installed and responding: Docker version 29.9.3
- PASS Compose plugin installed: 5.7.0
- PASS installed from Docker's official apt repository (docker-ce)
- PASS bootstrap verified nothing unexpected is publicly exposed

## 3. The shared stack
- PASS central-postgres is running
- PASS central-caddy is running
- PASS central-postgres reports healthy
- PASS PostgreSQL answers queries
      version: PostgreSQL 17.6 on x86_64-pc-linux-gnu, compi
- PASS postgres config generated for this machine, no placeholders left
      max_connections=150  shared_buffers=3955MB  work_mem=9MB
- PASS wal_level is logical, which Realtime requires
- PASS the image's preloaded libraries survived the config override
- PASS pg_cron is preloaded
- PASS the central.applications registry exists
- PASS PostgreSQL is bound to 127.0.0.1 only
- PASS the stack is up, so the remaining checks can mean something

## 4. Startup, health, restart recovery and resource usage
      restarting central-postgres to check it recovers unattended
- PASS central-postgres returned to healthy after a restart
- PASS it answers queries again after the restart
- PASS restart policy is unless-stopped, so it survives a reboot

## 5. Two independent applications, and isolation between them
- PASS provisioned alpha_shop (realtime + storage, no auth)
- PASS provisioned beta_shop (auth, no realtime or storage)
- PASS alpha_shop's profiles are 'realtime,storage' — no auth, as measured
- PASS beta_shop's profiles are 'auth' — auth only
- PASS alpha_shop's compose configuration is valid, so every service it uses can start
- PASS beta_shop's compose configuration is valid, so every service it uses can start
- PASS beta_shop's database has an auth schema
- PASS alpha_shop's database has NO auth schema — nothing provisioned that it does not use
- PASS alpha_shop's credentials open alpha_shop's own database
- PASS beta_shop's credentials open beta_shop's own database
- PASS beta_shop's credentials are REFUSED by alpha_shop's database
- PASS beta_shop cannot read alpha_shop's data
- PASS the two applications have different JWT secrets
- PASS alpha_shop/.env is mode 600
- PASS beta_shop/.env is mode 600

## 6. Realtime, end to end
- PASS alpha_shop_realtime may set log_min_messages, so migration 20230328144023 can create list_changes()
      provisioning role: postgres, superuser=false
      parameter ACL: supabase_admin=sA/supabase_admin | alpha_shop_realtime=s/supabase_admin
      current_user may grant it: false
      ----- what provisioning reported for realtime -----
        services  : rest realtime storage+imgproxy
      [5/11] Configuring Realtime
      WARNING:  Could not grant SET ON PARAMETER log_min_messages to alpha_shop_realtime (permission denied for parameter log_min_messages).
      WARNING:  alpha_shop_realtime CANNOT set log_min_messages.
        Realtime's migration 20230328144023 will fail, realtime.list_changes() will not
        exist, and Realtime will accept subscriptions and deliver NOTHING -- with no error
          GRANT SET ON PARAMETER log_min_messages TO alpha_shop_realtimeI;
        ✓ granted SET ON PARAMETER log_min_messages as supabase_admin
        ✓ Realtime's role may set log_min_messages, so list_changes() can be created
        ✓ created the supabase_realtime_admin role
        ✓ Realtime's role is a member of supabase_realtime_admin, so its migrations can complete
        ✓ Realtime role, schema and keys ready (tenant: alpha_shop)
        compose profiles: realtime,storage
        contains: ANON_KEY APP_DB APP_DB_PASSWORD APP_DB_USER APP_DNS APP_DOMAIN APP_NAME APP_REALTIME_PASSWORD APP_REALTIME_USER APP_STORAGE_PASSWORD APP_STORAGE_USER COMPOSE_PROFILES JWT_SECRET PGRST_DB_POOL PGRST_DB_SCHEMAS R2_ACCESS_KEY_ID R2_BUCKET R2_ENDPOINT R2_SECRET_ACCESS_KEY REALTIME_ENC_KEY REALTIME_METRICS_JWT_SECRET REALTIME_SECRET_KEY_BASE REALTIME_SLOT_SUFFIX SERVICE_ROLE_KEY 
- PASS Realtime's own tenant migrations replay cleanly here, and list_changes() is created
        PASS stops at 20230328144023, as expected, after 29 migration(s)
        PASS and the reason is log_min_messages, which is what the grant addresses
        PASS 30 migration(s) replayed with no failure
        PASS realtime.list_changes() exists
        PASS realtime.apply_rls() exists
        PASS realtime.subscription_check_filters() exists
        PASS realtime.cast() exists
        PASS realtime.check_equality_op() exists
        PASS realtime.quote_wal2json() exists
      ----- the whole set, best effort (expected to stop at the reserved-role migration) -----
      ERROR:  role "zzrtmigtest_realtime" already exists
      00-placeholder.caddy switched to http:// (no ACME in staging)
      alpha_shop.caddy switched to http:// (no ACME in staging)
      beta_shop.caddy switched to http:// (no ACME in staging)
- PASS alpha-shop-rest became healthy
- PASS alpha-shop.realtime is running
- PASS PostgREST answers through the proxy at /rest/v1/ (HTTP 200)
- PASS public.tick is in the supabase_realtime publication
      restarting Realtime so it picks up the newly published table
      Realtime did not answer its health endpoint; the subscription below will show whether it works
      node v22.23.4, and the client version is recorded below —
      a client two years older than the server is the kind of thing that should be visible
      the application's lockfile pins supabase-js 2.97.0 — that version is tested too
      client 2.47.10 installed
      client 2.118.0 installed
      client 2.97.0 installed
      └── (empty)
      
- PASS post-start completed Realtime's setup for alpha_shop
      Post-start steps for alpha_shop
        database : alpha_shop
        profiles : realtime,storage
        realtime
        ✓ the realtime schema exists with 5 table(s)
        ✓ realtime.list_changes() exists, so the WAL reader has what it needs
            realtime.schema_migrations: 39 of 91 row(s)
        ! Realtime is stuck at migration 20240401105812, which needs a reserved role.
        ! Applying that one migration as the image's superuser instead.
        ✓ applied migration 20240401105812; restarting Realtime so it continues from 41
            realtime.schema_migrations: 83 of 91 row(s) after the restart
        ! Realtime stopped again at a migration needing a reserved role.
        ! Applying the remaining ones as the image's superuser.
        ✓ applied migrations 84-91; restarting Realtime
            realtime.schema_migrations: 91 of 91 row(s)
        ✓ every tenant migration applied
      RESULT storage=0 realtime=0
        Post-start steps completed.
      alpha-shop.realtime is ready (status running, health healthy)
- PASS Realtime is ready after its migrations completed
- PASS Realtime migration 20230328144023 is applied
- PASS Realtime migration 20240401105812 is applied
- PASS Realtime migration 20260326120000 is applied
      realtime.list_changes returns: TABLE(wal jsonb, is_rls_enabled boolean, subscription_ids uuid[], errors text[], slot_changes_count bigint)
- PASS realtime.list_changes() returns slot_changes_count, which is the definition migration 20260326120000 installs
- PASS Realtime's own role may execute realtime.list_changes()
      --- client 2.47.10 (released 2024-12-19) ---
      CLIENT_VERSION 2.47.10
      SUBSCRIBED
      INSERTED
      STAGES socket_frames=5 join_replies=1 postgres_changes_frames=3 callback_fired=0 errors=0
      LATENCY insert_ms=37 deliver_ms=-1
      NO_EVENT
      client 2.47.10 -> NO_EVENT
        STAGES socket_frames=5 join_replies=1 postgres_changes_frames=3 callback_fired=0 errors=0
      --- client 2.118.0 (released 2026-10-15) ---
      client 2.118.0 -> EVENT_RECEIVED
        STAGES socket_frames=5 join_replies=1 postgres_changes_frames=3 callback_fired=1 errors=0
      --- socket frames, redacted, from the newer client ---
      WS| push realtime:probe-0yxlka27synd phx_join (6, 6) {"config":{"broadcast":{"ack":false,"self":false},"presence":{"key":"","enabled":false},"postgres_changes":[{"event":"INSERT","schema":"public","table":"tick"}],"private":false}}
      WS| transport connected to ws://alpha-shop.staging.test/realtime/v1/websocket?apikey=<redacted> 
      WS| receive ok realtime:probe-0yxlka27synd phx_reply (6) {"status":"ok","response":{"postgres_changes":[{"id":123597225,"event":"INSERT","schema":"public","table":"tick"}]}}
      WS| receive ok realtime:probe-0yxlka27synd system {"message":"Subscribed to PostgreSQL","status":"ok","extension":"postgres_changes","channel":"probe-0yxlka27synd"}
      WS| receive realtime:probe-0yxlka27synd postgres_changes {"data":{"table":"tick","type":"INSERT","record":{"at":"2026-11-10T02:22:34.724762+00:00","id":2,"label":"ab-new"},"columns":[{"name":"id","type":"int4"},{"name":"label","type":"text"},{"name":"at","type":"timestamptz"}]
- PASS the client version WAS the cause: 2.47.10 fails and 2.118.0 delivers, same table, same insert
      --- client 2.97.0 (the version package-lock.json pins) ---
      CLIENT_VERSION 2.97.0
      SUBSCRIBED
      INSERTED
      STAGES socket_frames=5 join_replies=1 postgres_changes_frames=3 callback_fired=1 errors=0
      LATENCY insert_ms=10 deliver_ms=391
      EVENT_RECEIVED:{"at":"2026-11-10T02:22:35.04225+00:00","id":3,"label":"ab-app"}
      client 2.97.0 -> EVENT_RECEIVED
- PASS the supabase-js version the application actually ships (2.97.0) receives the event
- PASS a change reached the subscribed client in 391ms (insert round trip 10ms), within the 3000ms bound
- PASS a Realtime subscription was accepted through the proxy
      ----- Realtime's TENANT migrations, and anything that stopped them -----
      02:19:37.365 [info] == Migrated 20210706140551 in 0.0s
      02:19:37.388 [info] == Migrated 20220329161857 in 0.0s
      02:19:37.391 [info] == Migrated 20220410212326 in 0.0s
      02:19:37.401 [info] == Migrated 20220506102948 in 0.0s
      02:19:37.404 [info] == Migrated 20220527210857 in 0.0s
      02:19:37.406 [info] == Migrated 20220815211129 in 0.0s
      02:19:37.408 [info] == Migrated 20220815215024 in 0.0s
      02:19:37.411 [info] == Migrated 20220818141501 in 0.0s
      02:19:37.412 [info] == Migrated 20221018173709 in 0.0s
      02:19:37.414 [info] == Migrated 20221102172703 in 0.0s
      02:19:37.416 [info] == Migrated 20221223010058 in 0.0s
      02:19:37.421 [info] == Migrated 20230110180046 in 0.0s
      02:19:37.425 [info] == Migrated 20230810220907 in 0.0s
      02:19:37.428 [info] == Migrated 20230810220924 in 0.0s
      02:19:37.429 [info] == Migrated 20231024094642 in 0.0s
      02:19:37.431 [info] == Migrated 20240306114423 in 0.0s
      02:19:37.433 [info] == Migrated 20240418082835 in 0.0s
      02:19:37.435 [info] == Migrated 20240625211759 in 0.0s
      02:19:37.437 [info] == Migrated 20240704172020 in 0.0s
      02:19:37.439 [info] == Migrated 20240902173232 in 0.0s
      02:19:37.441 [info] == Migrated 20241106103258 in 0.0s
      02:19:37.443 [info] == Migrated 20250424203323 in 0.0s
      02:19:37.445 [info] == Migrated 20250613072131 in 0.0s
      02:19:37.447 [info] == Migrated 20250711044927 in 0.0s
      02:19:37.449 [info] == Migrated 20250811121559 in 0.0s
      02:19:37.451 [info] == Migrated 20250926223044 in 0.0s
      02:19:37.453 [info] == Migrated 20251204170944 in 0.0s
      02:19:37.456 [info] == Migrated 20251218000543 in 0.0s
      02:19:37.457 [info] == Migrated 20260209232800 in 0.0s
      02:19:37.459 [info] == Migrated 20260304000000 in 0.0s
      02:19:37.468 [info] == Migrated 20260422000000 in 0.0s
      02:19:37.471 [info] == Migrated 20260709151810 in 0.0s
      02:19:37.473 [info] == Migrated 20260805000000 in 0.0s
      02:19:38.578 project=alpha-shop external_id=alpha-shop error_code=TenantMigrationsDumpSkipped [error] TenantMigrationsDumpSkipped: %Postgrex.Error{
          message: "must be owner of schema realtime",
      02:19:38.588 [info] == Running 20211116024918 Realtime.Tenants.Migrations.CreateRealtimeSubscriptionTable.change/0 forward
      02:19:38.594 [info] == Migrated 20211116024918 in 0.0s
      02:19:38.597 [info] == Running 20211116045059 Realtime.Tenants.Migrations.CreateRealtimeCheckFiltersTrigger.change/0 forward
      02:19:38.599 [info] trigger "tr_check_filters" for relation "realtime.subscription" does not exist, skipping
      02:19:38.599 [info] == Migrated 20211116045059 in 0.0s
      02:19:38.601 [info] == Running 20211116050929 Realtime.Tenants.Migrations.CreateRealtimeQuoteWal2jsonFunction.change/0 forward
      02:19:38.602 [info] == Migrated 20211116050929 in 0.0s
      02:19:38.603 [info] == Running 20211116051442 Realtime.Tenants.Migrations.CreateRealtimeCheckEqualityOpFunction.change/0 forward
      02:19:38.604 [info] == Migrated 20211116051442 in 0.0s
      02:19:38.606 [info] == Running 20211116212300 Realtime.Tenants.Migrations.<redacted-blob>.change/0 forward
      02:19:38.607 [info] == Migrated 20211116212300 in 0.0s
      02:19:38.609 [info] == Running 20211116213355 Realtime.Tenants.Migrations.CreateRealtimeCastFunction.change/0 forward
      02:19:38.609 [info] == Migrated 20211116213355 in 0.0s
      02:19:38.611 [info] == Running 20211116213934 Realtime.Tenants.Migrations.<redacted-blob>.change/0 forward
      02:19:38.611 [info] == Migrated 20211116213934 in 0.0s
      02:19:38.613 [info] == Running 20211116214523 Realtime.Tenants.Migrations.CreateRealtimeApplyRlsFunction.change/0 forward
      02:19:38.616 [info] == Migrated 20211116214523 in 0.0s
      02:19:38.617 [info] == Running 20211122062447 Realtime.Tenants.Migrations.GrantRealtimeUsageToAuthenticatedRole.change/0 forward
      02:19:38.618 [info] == Migrated 20211122062447 in 0.0s
      02:19:38.619 [info] == Running 20211124070109 Realtime.Tenants.Migrations.<redacted-blob>.change/0 forward
      02:19:38.620 [info] == Migrated 20211124070109 in 0.0s
      02:19:38.622 [info] == Running 20211202204204 Realtime.Tenants.Migrations.<redacted-blob>.change/0 forward
      02:19:38.622 [info] == Migrated 20211202204204 in 0.0s
      02:19:38.624 [info] == Running 20211202204605 Realtime.Tenants.Migrations.<redacted-blob>.change/0 forward
      02:19:38.625 [info] == Migrated 20211202204605 in 0.0s
      ... truncated at 60 lines
      ----- how far its own migration history got -----
      tenant migrations applied: 91 of 91, highest 20261009120000
      the migration creating list_changes (20230328144023) applied: 1
      realtime functions: apply_rls, authorize, broadcast_changes, build_prepared_statement_sql, cast, check_equality_op, check_equality_op, is_visible_through_filters, list_changes, list_changes_sync, quote_wal2json, send, send_binary, settled_changes, subscription_check_filters, to_regrole, topic, wal2json_escape_identifier
      reserved roles: supabase_admin, supabase_auth_admin, supabase_storage_admin, supabase_read_only_user, supabase_realtime_admin, supabase_replication_admin, supabase_etl_admin, dashboard_user, pgbouncer, service_role*, authenticator*, authenticated*, anon*, supabase_privileged_role
      rt_user attributes: createrole=false superuser=false bypassrls=false
      supabase_realtime_admin exists: 1
- PASS all 91 of Realtime's tenant migrations are applied in alpha_shop
- PASS Realtime's role is a member of supabase_realtime_admin (asked of the database)
- PASS the Realtime client harness ran: CLIENT_VERSION 2.118.0
      ix_realtime_subscription_entity
      messages
      messages_2026_11_09
      messages_2026_11_09_inserted_at_topic_idx
      messages_2026_11_09_pkey
      messages_2026_11_10
      messages_2026_11_10_inserted_at_topic_idx
      messages_2026_11_10_pkey
      messages_2026_11_11
      messages_2026_11_11_inserted_at_topic_idx
      messages_2026_11_11_pkey
      messages_2026_11_12
      messages_2026_11_12_inserted_at_topic_idx
      messages_2026_11_12_pkey
      messages_2026_11_13
      messages_2026_11_13_inserted_at_topic_idx
      messages_2026_11_13_pkey
      messages_inserted_at_topic_index
      messages_pkey
      pk_subscription
      ... truncated at 20 lines
      ----- what Realtime actually built in alpha_shop -----
      realtime schema: yes
      realtime tables: 8
      list_changes present: 1
      rt_user can create in db: true
      ----- alpha-shop.realtime log (tail) -----
      02:22:14.525 project=alpha-shop external_id=alpha-shop error_code=DatabaseIpVersionIsIpv4 [warning] DatabaseIpVersionIsIpv4: Tenant database host postgres resolved to an IPv4 address
      02:22:14.525 project=alpha-shop external_id=alpha-shop error_code=DatabaseIpVersionIsIpv4 [warning] DatabaseIpVersionIsIpv4: Tenant database host postgres resolved to an IPv4 address
      02:22:14.525 error_code=DatabaseIpVersionIsIpv4 [warning] DatabaseIpVersionIsIpv4: Tenant database host postgres resolved to an IPv4 address
      02:22:14.526 project=alpha-shop external_id=alpha-shop [info] Initializing connection with the status: %Realtime.Tenants.ReplicationConnection{
        tenant_id: "alpha-shop",
        opts: [],
        step: :disconnected,
        publication_name: "supabase_realtime_messages_publication",
        replication_slot_name: "supabase_realtime_messages_replication_slot_alpha_shop",
        output_plugin: "pgoutput",
        proto_version: 2,
        relations: %{},
        buffer: [],
        monitored_pid: #PID<0.4022.0>,
        latency_committed_at: nil,
        query_timeout: 240000,
        pg_version: nil
      }
      02:22:14.531 project=alpha-shop external_id=alpha-shop [info] Checking if replication slot supabase_realtime_messages_replication_slot_alpha_shop exists
      02:22:14.532 project=alpha-shop external_id=alpha-shop error_code=DatabaseIpVersionIsIpv4 [warning] DatabaseIpVersionIsIpv4: Tenant database host postgres resolved to an IPv4 address
      02:22:14.540 project=alpha-shop external_id=alpha-shop [info] Check publication supabase_realtime_messages_publication for table realtime.messages exists
      02:22:14.543 project=alpha-shop external_id=alpha-shop [info] Create publication supabase_realtime_messages_publication for table realtime.messages
      02:22:14.546 project=alpha-shop external_id=alpha-shop [info] Create replication slot supabase_realtime_messages_replication_slot_alpha_shop using plugin pgoutput
      02:22:14.550 project=alpha-shop external_id=alpha-shop [info] #PID<0.4040.0> Starting stream replication for slot supabase_realtime_messages_replication_slot_alpha_shop using publication supabase_realtime_messages_publication and protocol version 2
      02:22:16.388 [info] Starting Elixir.Realtime.RateCounter for: {:channel, :subscription_errors, "alpha-shop"}
      02:22:18.635 project=alpha-shop [info] Billing metrics: [:realtime, :connections]
      02:22:23.636 project=alpha-shop [info] Billing metrics: [:realtime, :connections]
      02:22:28.637 project=alpha-shop [info] Billing metrics: [:realtime, :connections]
      02:22:33.633 [info] Muster[realtime@127.0.0.1|realtime_channels_local] status :converging -> :ready (members [:"realtime@127.0.0.1"])
      02:22:33.638 project=alpha-shop [info] Billing metrics: [:realtime, :connections]
      ----- replication slots and publication -----
      supabase_realtime_replication_slot_alpha_shop|wal2json|t|alpha_shop
      supabase_realtime_messages_replication_slot_alpha_shop|pgoutput|t|alpha_shop
      supabase_realtime|tick
      supabase_realtime_messages_publication|messages_2026_11_09
      supabase_realtime_messages_publication|messages_2026_11_10
      supabase_realtime_messages_publication|messages_2026_11_11
      supabase_realtime_messages_publication|messages_2026_11_12
      supabase_realtime_messages_publication|messages_2026_11_13
      3
- PASS an INSERT produced a Realtime event end to end
      EVENT_RECEIVED:{"at":"2026-11-10T02:22:34.724762+00:00","id":2,"label":"ab-new"}
- PASS a second Realtime application was provisioned and started
      gamma_rt.caddy switched to http:// (no ACME in staging)
        ✓ realtime.list_changes() exists, so the WAL reader has what it needs
            realtime.schema_migrations: 91 of 91 row(s)
      gamma-rt.realtime is ready (status running, health healthy)
- PASS the second tenant's Realtime is ready after its migrations completed
- KNOWN DEFECT (optional component) the SECOND tenant delivers, after a warm-up gap: a row written 75145ms earlier was missed, the next one arrived in 338ms
      CLIENT_VERSION 2.118.0
      SUBSCRIBED
      INSERTED
      WAITED 75145ms of a 75000ms window
      EVENT_RECEIVED_ON_SECOND_INSERT:{"at":"2026-11-10T02:24:31.820533+00:00","id":2,"label":"gamma-probe-2"}
      STAGES socket_frames=11 join_replies=4 postgres_changes_frames=3 callback_fired=1 errors=0
      LATENCY insert_ms=38 deliver_ms=75497
      ----- replication slots across the cluster -----
      supabase_realtime_messages_replication_slot_alpha_shop|alpha_shop|t|pgoutput
      supabase_realtime_messages_replication_slot_gamma_rt|gamma_rt|t|pgoutput
      supabase_realtime_replication_slot_alpha_shop|alpha_shop|t|wal2json
      supabase_realtime_replication_slot_gamma_rt|gamma_rt|t|wal2json
- PASS each Realtime tenant has its own replication slot (4 distinct)
- PASS 4 Realtime replication slot(s) are active, so both tenants are reading the WAL
- PASS the slots belong to different databases (2)
- PASS a change in alpha_shop did NOT reach gamma_rt's channel — the tenants are separate
      alpha-shop.realtime after the restart is ready (status running, health healthy)
- PASS alpha-shop.realtime came back and became ready after a restart
- KNOWN DEFECT (optional component) delivery resumed after the restart, with a warm-up gap: a row written 75148ms earlier was missed, the next one arrived in 474ms
      CLIENT_VERSION 2.118.0
      SUBSCRIBED
      INSERTED
      WAITED 75146ms of a 75000ms window
      EVENT_RECEIVED_ON_SECOND_INSERT:{"at":"2026-11-10T02:26:22.402739+00:00","id":6,"label":"after-restart-2"}
      STAGES socket_frames=11 join_replies=4 postgres_changes_frames=3 callback_fired=1 errors=0
      LATENCY insert_ms=27 deliver_ms=75635
      it took 75635ms after the restart -- around the poller's 60s oid re-check, not a hang

## 7. Object storage: upload, download, delete
- PASS an S3-compatible endpoint is running (SeaweedFS, standing in for R2)
- PASS the S3 bucket exists (HTTP 200)
- PASS storage-api started against the S3 backend
- PASS post-start granted the storage schema to the roles storage-api uses
        profiles : realtime,storage
        storage
        ✓ storage-api has created 12 table(s)
        ✓ grants applied to the storage schema, by the role that owns it
              storage grants applied to the tables storage-api created
        realtime
        ✓ the realtime schema exists with 8 table(s)
        ✓ realtime.list_changes() exists, so the WAL reader has what it needs
            realtime.schema_migrations: 91 of 91 row(s)
      RESULT storage=0 realtime=0
      storage tables storage-api created: bucket_lifecycle_states buckets buckets_analytics buckets_vectors iceberg_namespaces iceberg_tables lifecycle_abandoned_artifacts migrations objects s3_multipart_uploads s3_multipart_uploads_parts vector_indexes
- PASS every storage table is readable by anon, authenticated and service_role — checked as effective privileges
- PASS service_role can INSERT into every storage table
- PASS service_role may EXECUTE all 24 storage function(s)
- PASS created the product-images bucket through the proxy (HTTP 200)
- PASS UPLOAD through storage-api to the S3 backend (HTTP 200)
- PASS DOWNLOAD returned byte-identical content (4096 bytes, sha256 matches)
- PASS the object is physically in the S3 bucket, so the backend is really S3
      <Key>alpha_shop/product-images/test/probe.bin/76dc5280-cda1-4014-bc6f-304975f5bb3e</Key>
- PASS two more objects were written for the multi-delete test
- PASS MULTI-DELETE of two objects accepted (HTTP 200)
- PASS both objects are gone from the bucket after the multi-delete
- PASS DELETE removed the object (HTTP 200)
- PASS the object is gone from the bucket, confirmed through the S3 API

## 8. Everytinroom's own application, in a real browser
- PASS the real application received a live event and showed it in its interface
        application database : alpha_shop
        through              : http://alpha-shop.staging.test
        migrations: 36 applied, 0 could not apply (environmental ones are expected to fail here)
        PASS the application's own tables exist (products, sales, whatsapp_orders, staff, customers)
        PASS verify_pin() exists
        PASS the browser-facing role may EXECUTE verify_pin, so the real PIN screen can authenticate
        PASS everything verify_pin reads and writes exists (pin_attempts, staff_sessions, staff.permissions/active/pin_hash)
        PASS verify_pin returns a result when called directly (a wrong PIN, so no session was made)
        PASS a staging staff member exists (PIN generated for this run, never printed)
        PASS a second staging staff member exists, for the second workstation
        PASS verify_pin ACCEPTS the staging PIN when called in the database, so the auth path works below the API
        PASS live_state has a row and a trigger for each of the three watched tables
        PASS the browser-facing role may READ live_state and may not write it
        PASS a write bumps live_state.rev (0 to 1), so the till has something to poll
        installing the application's dependencies
        building the application pointed at http://alpha-shop.staging.test
        PASS the real application built against the staging platform
        PASS Playwright installed and importable, Chromium present
        opening the application at http://127.0.0.1:5599/
        PASS the application's own Login screen rendered (4 PIN field(s))
        PIN entry: 4 of 4 field(s) hold a digit (the digits themselves are never printed)
        PASS verify_pin() accepted the PIN and the till opened
        subscription introspection: no global handle; verified by behaviour instead
        inserted a sale; waiting up to 30s for the application to show it
        PASS THE APPLICATION RECEIVED THE LIVE EVENT AND SHOWED IT IN THE INTERFACE
        UI_LATENCY_MS 112 — from the insert being SENT to the figure being on screen; the insert itself took 31ms
          requests in that window: live_state×1, rpc/list_sales×1
          shown by: <div class="text-[13px] font-semibold"> in "GHS 42.50 Staging Probe · Cash"
        screenshot: /tmp/app-realtime-popup.png (taken after login; no PIN on screen)
        PASS a product change appeared in the interface without a refresh (2292ms)
        PASS a website order change appeared in the interface without a refresh (1783ms)
        PASS a second workstation signed in independently
        PASS BOTH workstations showed the same sale without a refresh (2799ms from the insert being sent; insert 7ms)
        inserted into gamma_rt (HTTP 401; its own key differs, so a refusal here is also correct)
        PASS a sale written to gamma_rt did not appear in this application's interface
        the first workstation is offline
        back online; waiting 15s for the reconnect and the application's own refresh to finish
        PASS live updates resumed after a network interruption, unattended (80ms from the insert being sent; insert 5ms)
          requests in that window: live_state×1, rpc/list_sales×1
          shown by: <div class="text-[13px] font-semibold"> in "GHS 88.80 Staging Probe · Cash"
        PASS the application restarted and signed in again
        PASS live updates work after the application was restarted (82ms from the insert being sent; insert 7ms)
          requests in that window: live_state×1, rpc/list_sales×1
          shown by: <div class="text-[13px] font-semibold"> in "GHS 66.60 Staging Probe · Cash"
        --- browser diagnostics ---
        console errors: 77
            Failed to load resource: the server responded with a status of 404 (File not found)
            Failed to load resource: the server responded with a status of 404 (Not Found)
            Failed to load resource: the server responded with a status of 404 (Not Found)
            Failed to load resource: the server responded with a status of 401 (Unauthorized)
            [load] bundles: permission denied for table bundles
            Failed to load resource: the server responded with a status of 401 (Unauthorized)
        failed requests: 13
            GET http://alpha-shop.staging.test/rest/v1/refunds?select=*&order=date.desc&limit=50 — net::ERR_ABORTED
            GET http://alpha-shop.staging.test/rest/v1/stock_takes?select=*&order=date.desc&limit=20 — net::ERR_ABORTED
            GET http://alpha-shop.staging.test/rest/v1/invoices?select=*&order=date.desc&limit=50 — net::ERR_ABORTED
            GET http://alpha-shop.staging.test/rest/v1/customers?select=id%2Cphone%2Cvisit_count%2Ctotal_spent%2Clast_visit&order=total_ — net::ERR_ABORTED
            GET http://alpha-shop.staging.test/rest/v1/whatsapp_orders?select=id%2Corder_no%2Cdate%2Ccustomer_name%2Ccustomer_phone%2Cit — net::ERR_ABORTED
            GET http://alpha-shop.staging.test/rest/v1/stock_adjustments?select=id%2Cdate%2Cproduct_id%2Cproduct_name%2Cqty%2Creason%2Cn — net::ERR_ABORTED
        websocket events: 8
            opened ws://alpha-shop.staging.test/realtime/v1/websocket?apikey=<redacted>
            recv postgres_changes: ["1","1","realtime:customer-display-reg-ccjl676m93p","phx_reply",{"status":"ok","response":{"postgres_changes":[]}}]
            closed after 1 frame(s), 1 mentioning postgres_changes
            opened ws://alpha-shop.staging.test/realtime/v1/websocket?apikey=<redacted>
            recv postgres_changes: ["1","1","realtime:customer-display-reg-ccjl676m93p","phx_reply",{"status":"ok","response":{"postgres_changes":[]}}]
            closed after 3 frame(s), 1 mentioning postgres_changes
            opened ws://alpha-shop.staging.test/realtime/v1/websocket?apikey=<redacted>
            recv postgres_changes: ["1","1","realtime:customer-display-reg-ccjl676m93p","phx_reply",{"status":"ok","response":{"postgres_changes":[]}}]
        PASS the browser run completed all of its checks
        passed 11  failed 0  blocked 0
        staging rows removed

## 9. Supabase Auth, for the application that actually uses it
- PASS GoTrue is running for the application that asked for auth
- PASS GoTrue answers /auth/v1/health through the proxy (HTTP 200)
- PASS a user was created through GoTrue's admin API with the service role key (HTTP 200)
- PASS open self-registration is refused (HTTP 422), as the default intends
- PASS the user is in beta_shop's own auth.users table
- PASS alpha_shop still has no auth schema, so the two do not share users
- PASS sign-in returned an access token
- PASS the token identifies that user to GoTrue, so the whole path works
- PASS beta_shop's token is REJECTED by alpha_shop's API (HTTP 401)

## 10. Backup and restore rehearsal
      alpha_shop now holds 500 rows summing to 24503.73
- PASS backup.sh completed with verification
- PASS a dump was produced: alpha_shop-20261110-022947.sql.gz (68K)
- PASS cluster globals were dumped too (roles and their passwords)
- PASS restore.sh restored into a separate database without touching the live one
- PASS restored row count matches (500)
- PASS restored money total matches (24503.73)
- PASS the live database was left alone (500 rows)
- PASS the storage schema survived the restore with all 12 of its tables
      alpha_shop has no auth schema, so there was none to restore
- PASS storage.objects exists in the restored database, so uploaded files keep their metadata

## 11. Scheduled jobs in another database, calling a new URL
- PASS cron.database_name is 'postgres', so no tenant owns the scheduler
- PASS a job was registered for alpha_shop from the postgres database
      waiting up to 100s for pg_cron to fire the job
- PASS the job actually executed in the other database (rows: 1)
- PASS pg_net.database_name is 'postgres' — HTTP-making jobs belong there
      waiting up to 100s for the http job to reach PostgREST
      the job is registered in the postgres database, where pg_net's worker is
      the URL is the container alias, not the staging hostname: pg_net runs
      inside the postgres container, which has no /etc/hosts entry for it
- PASS a cron job reached the new API URL through pg_net and the proxy
- PASS pg_net from an application's own database queues (1) and is never served (0 responses) — measured, and the reason HTTP jobs are registered in postgres

## 12. Resource usage, capacity, and provisioning from clean
      containers running: 11
      at rest, before any load:
      memory used on the machine at rest: 2075 MB of 15983 MB
      driving 8 concurrent clients at alpha_shop for 60s
- PASS the application served a sustained load with no non-2xx response
        REQUEST           COUNT       OK    p50 ms    p95 ms    max ms
        lookup             4997     4997         5        13        38
        open-sale          4997     4997         5        14        38
        add-items          4997     4997         5        13        37
        daily-total        4997     4997         5        15        32
        19988 succeeded (2xx) in 61s = 327 successful requests/second
        0 failed (non-2xx or no response), out of 19988 attempted
        rows written: 4997 sales, 9994 sale lines
- PASS measured throughput: 327 successful requests/second, 0 failed, opening a sale at p95 14 ms over 4997 successful writes

```
  central-postgres               304.4MiB     30.8%
  gamma-rt.realtime              200.6MiB      2.9%
  alpha-shop.realtime            191.3MiB      5.9%
  alpha-shop-storage              77.1MiB      0.0%
  staging-s3                      64.1MiB      0.2%
  alpha-shop-rest                 32.8MiB     21.7%
  central-caddy                   18.1MiB     21.8%
  alpha-shop-imgproxy             15.7MiB      1.1%
  gamma-rt-rest                   14.1MiB      3.5%
  beta-shop-auth                  10.2MiB      0.0%
  beta-shop-rest                   7.2MiB      0.0%
```
- PASS resource usage captured under load, with two applications provisioned
      peak, per container, measured while requests were being served:
      memory used on the machine after the load: 2134 MB of 15983 MB
      capacity.sh exited 2
- PASS capacity.sh produced a headroom estimate
        room for more applications
          about 4 more, and the limit would be memory
            by memory 4   by disk 4   by connections 6
      
- PASS health.sh ran to completion and reported every service healthy: HEALTH-COMPLETE checked=3 problems=0
- PASS a third application provisioned on an already-configured machine
- PASS re-provisioning kept the existing password instead of locking the app out
      standalone isolation test: 0 failure(s)

## 13. Running the whole deployment again, and surviving a reboot
- PASS bootstrap.sh ran a second time on an already-configured machine
- PASS the database password was NOT regenerated, so the server keeps access to its volume
- PASS PostgreSQL still answers after the second bootstrap
- PASS the application registry is unchanged (4 application(s))
      stopping every container, then starting the stack again — a reboot, in effect
      containers before: alpha-shop-imgproxy alpha-shop-rest alpha-shop-storage alpha-shop.realtime beta-shop-auth beta-shop-rest central-caddy central-postgres gamma-rt-rest gamma-rt.realtime staging-s3 
- PASS every container stopped cleanly
        gamma_shop was not running before the stop, so it is left alone
- PASS every container came back running and healthy after the whole stack was stopped
- PASS the application's data survived the restart (4997 rows, unchanged)
      alpha_shop.caddy switched to http:// (no ACME in staging)
- PASS the API answers again after the restart, unattended (HTTP 200)

## Logs from anything that is not healthy
      ----- central-caddy (running/starting) -----
      {"level":"error","ts":1794277980.145956,"logger":"tls.obtain","msg":"could not get certificate from issuer","identifier":"alpha-shop.staging.test","issuer":"acme.zerossl.com-v2-DV90","error":"HTTP 400 urn:ietf:params:acme:error:invalidContact - A contact URL for an account was invalid"}
      {"level":"error","ts":1794277980.1460147,"logger":"tls.obtain","msg":"will retry","error":"[alpha-shop.staging.test] Obtain: registering account [mailto:staging@example.invalid] with server: attempt 1: https://acme.zerossl.com/v2/DV90/newAccount: HTTP 400 urn:ietf:params:acme:error:invalidContact - A contact URL for an account was invalid","attempt":1,"retrying_in":60,"elapsed":0.626607804,"max_duration":2592000}
      {"level":"info","ts":1794278015.4729507,"msg":"shutting down apps, then terminating","signal":"SIGTERM"}
      {"level":"warn","ts":1794278015.472996,"msg":"exiting; byeee!! 👋","signal":"SIGTERM"}
      {"level":"info","ts":1794278015.4730237,"logger":"http","msg":"servers shutting down with eternal grace period"}
      {"level":"info","ts":1794278015.473237,"logger":"tls.cache.maintenance","msg":"stopped background certificate maintenance","cache":"0x20f6c92c7480"}
      {"level":"info","ts":1794278015.4732642,"logger":"tls.obtain","msg":"releasing lock","identifier":"alpha-shop.staging.test"}
      {"level":"error","ts":1794278015.4733415,"logger":"tls.obtain","msg":"unable to unlock","identifier":"alpha-shop.staging.test","lock_key":"issue_cert_alpha-shop.staging.test","error":"remove /data/caddy/locks/issue_cert_alpha-shop.staging.test.lock: no such file or directory"}
      {"level":"error","ts":1794278015.473355,"logger":"tls","msg":"job failed","error":"alpha-shop.staging.test: obtaining certificate: context canceled"}
      {"level":"info","ts":1794278015.473548,"msg":"shutdown complete","signal":"SIGTERM","exit_code":0}
      {"level":"info","ts":1794278015.8069804,"msg":"maxprocs: Leaving GOMAXPROCS=4: CPU quota undefined"}
      {"level":"info","ts":1794278015.806995,"msg":"GOMEMLIMIT is updated","GOMEMLIMIT":15084313804,"previous":9223372036854775807}
      {"level":"info","ts":1794278015.806998,"msg":"using config from file","file":"/etc/caddy/Caddyfile"}
      {"level":"info","ts":1794278015.8070004,"msg":"adapted config to JSON","adapter":"caddyfile"}
      {"level":"warn","ts":1794278015.8070018,"msg":"Caddyfile input is not formatted; run 'caddy fmt --overwrite' to fix inconsistencies","adapter":"caddyfile","file":"/etc/caddy/Caddyfile","line":9}
      {"level":"warn","ts":1794278015.8071787,"logger":"admin","msg":"admin endpoint disabled"}
      {"level":"warn","ts":1794278015.8074245,"logger":"http.auto_https","msg":"server is listening only on the HTTP port, so no automatic HTTPS will be applied to this server","server_name":"srv0","http_port":80}
      {"level":"info","ts":1794278015.8074853,"logger":"tls.cache.maintenance","msg":"started background certificate maintenance","cache":"0x383c00572800"}
      {"level":"warn","ts":1794278015.810462,"logger":"http","msg":"HTTP/2 skipped because it requires TLS","network":"tcp","addr":":80"}
      {"level":"warn","ts":1794278015.8105044,"logger":"http","msg":"HTTP/3 skipped because it requires TLS","network":"tcp","addr":":80"}
      {"level":"info","ts":1794278015.810524,"logger":"http.log","msg":"server running","name":"srv0","protocols":["h1","h2","h3"]}
      {"level":"info","ts":1794278015.8108435,"msg":"autosaved config (load with --resume flag)","file":"/config/caddy/autosave.json"}
      {"level":"info","ts":1794278015.8108556,"msg":"serving initial configuration"}
      {"level":"info","ts":1794278015.8111994,"logger":"tls","msg":"storage cleaning happened too recently; skipping for now","storage":"FileStorage:/data/caddy","instance":"b91c1bc7-769b-4326-a207-ed02b098fcb6","try_again":1794364415.8111982,"try_again_in":86399.999999569}
      {"level":"info","ts":1794278015.8114023,"logger":"tls","msg":"finished cleaning storage units"}
