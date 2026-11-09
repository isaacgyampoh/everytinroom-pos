# VPS deployment package

Everything needed to stand the platform up on a Contabo VPS and move the
projects onto it, in the order it has to happen.

Nothing here has been bought, pointed or cut over. The last section lists the
four actions that need the account holder, and they are the only ones.

Every figure is either **measured** (a command was run on a real server and
its output recorded) or **ASSUMED**, and assumptions say what they rest on.
Nothing is estimated silently.

---

## 1. The server

| | |
|---|---|
| Plan | **Contabo Cloud VPS 8** |
| CPU / RAM | 8 vCPU / 24 GB |
| Disk | 300 GB SSD (or 150 GB NVMe — take the SSD, see below) |
| Price | **€11.20/month** on a 24-month term, **€14.00/month** standard |
| Annual | **€134.40** at the 24-month rate |
| Setup fee | none on terms longer than monthly |
| Location | a European region; Contabo has no African datacentre |

Take the **300 GB SSD** rather than the 150 GB NVMe. Seven databases plus
fourteen days of their dumps plus the image layers do not fit comfortably in
150 GB, and this workload is not disk-latency-bound: the load test measured
p95 of 14 ms for opening a sale, which is network and CPU, not storage.

### Why this plan and not a smaller one

Measured on a real server with three applications provisioned and 8 concurrent
clients driving the till for 60 seconds:

| Container | Peak memory |
|---|---|
| central-postgres | 258 MB |
| realtime (per application that uses it) | 192–203 MB |
| storage-api | 77 MB |
| postgrest (per application) | 10–31 MB |
| caddy (shared) | 18 MB |
| imgproxy | 15 MB |
| gotrue (per application that uses it) | 14 MB |

Machine total under that load: **2,095 MB of 15,983 MB**, and `capacity.sh`
projected room for about four more applications with memory as the binding
constraint — seven in total on a 16 GB machine.

The arithmetic for seven on 24 GB (24,576 MB), worst case — every application
running every service the till's own stack uses:

```
shared postgres + caddy                              276 MB
7 × (postgrest 31 + storage 77
     + imgproxy 15 + gotrue 14) = 7 × 137            959 MB
  (realtime, 200 MB each, is no longer deployed for
   the till; add 200 MB per project whose inventory
   shows it genuinely needs it)
PostgreSQL shared_buffers (lib/tuning.sh: 33% of
  the 75% it is given = ~25% of RAM)              6,082 MB
work_mem worst case (200 connections × 2 sorts
  × 11 MB)                                        4,400 MB
maintenance_work_mem (3 autovacuum workers
  × 1,536 MB)                                     4,608 MB
OS and Docker                                       ~800 MB
                                                 ----------
                                                 17,125 MB
```

That leaves about **7.3 GB spare** (24,576 - 17,125 = 7,451 MB), and the worst
case above is genuinely worst: it assumes all 200 connections sorting
simultaneously, three autovacuum workers each taking their full allowance, and
every application running storage, image resizing and auth — services most of
them do not need. `lib/tuning.sh`
contains a check that refuses settings whose worst case does not leave the
machine room to breathe.

Cloud VPS 6 (12 GB) would not survive that worst case. Cloud VPS 4 (8 GB, €4.40)
is the right size for **Everytinroom alone** and is worth noting separately in
case the migration is staged one project at a time.

---

## 2. The seven projects

Five projects can be inspected. Two are paused and cannot be: a paused project
answers no queries, so its service set and database size are unknowable
without resuming it.

**The per-project table is generated, not written by hand.** It comes from

```
deploy/scripts/inspect-supabase.py --json /tmp/inventory.json
deploy/scripts/size-from-measurement.py --stats <staging report> \
    --inventory /tmp/inventory.json
```

which reads the account and decides each project's services from what it
actually uses rather than from what a standard Supabase install provides:

| Service | Runs only if |
|---|---|
| postgrest | always — it is the data API |
| realtime | the project is named in `REALTIME_PROJECTS` |
| storage | a bucket holds objects |
| functions | edge functions are deployed |
| gotrue | `auth.users` has rows |
| cron | `pg_cron` has jobs |

That matters for cost: Everytinroom makes no call to `supabase.auth` at all, so
running GoTrue for it would spend 14 MB and a container on nothing.

One of those rules had to be corrected as part of dropping Realtime. The
inventory used to add the Realtime service whenever a project had tables in
the `supabase_realtime` publication, which is how a subscribing client looks
from the outside. Everytinroom's three tables **are** published on Supabase
Cloud, for exactly that reason, and its till no longer subscribes — so the
inventory would have recommended a container and 1 GB of the memory budget for
a service the application does not use, contradicting the provisioning command
in section 8. Whether a project needs Realtime depends on whether its own
client code subscribes, which cannot be read from the database and is not
guessed: a publication is now recorded and reported and decides nothing, and
`REALTIME_PROJECTS` names the projects that genuinely need it. The
platform runs per-application services behind Compose **profiles** so an
application that does not need one does not start it.

`inspect-supabase.py` is read-only — every statement it sends is a `SELECT`,
and it reports the *names* of configured secrets and environment variables,
never their values. It needs a Supabase personal access token, which is
**outstanding account action 1** in section 9.

For the two paused projects, `size-from-measurement.py` marks every derived
figure `ASSUMED` and prints them in a section of their own, so they cannot be
mistaken for measurements. The sizing is computed twice — once for the five
that can be inspected, once for all seven with the two assumed — and both
totals appear in the output.

**Everytinroom is project one and should move first.** It is the one that has
been tested end to end, and it is the one whose breakage would be noticed
within minutes.

---

## 3. Central PostgreSQL and per-application isolation

One PostgreSQL container, one database per application, and the isolation is
enforced by the server rather than by convention.

```sql
REVOKE ALL ON DATABASE <db> FROM PUBLIC;
GRANT CONNECT ON DATABASE <db> TO <that application's role only>;
```

Isolation is **by grant, not by ownership**. Ownership would not stop another
application's role from connecting; a revoked `CONNECT` does, at the point of
connection, before any query runs.

Verified on a real server: an application's credentials were used against
another application's database and refused, and an auth token minted by one
application's GoTrue was rejected by another application's API with HTTP 401.
The standalone isolation test is 39 checks and runs in CI against a real
PostgreSQL.

Two constraints the design has to respect, both measured rather than assumed:

- **`pg_net` serves exactly one database** (`pg_net.database_name`). Every
  scheduled job that makes an HTTP call therefore lives in the `postgres`
  database and names its target inside `cron.schedule_in_database(...)`.
  `validate-all.sh` fails the build if a `net.http_*` call appears anywhere
  else.
- **Replication slots are cluster-wide.** Each Realtime tenant needs its own
  `SLOT_NAME_SUFFIX`, or the second tenant to start fails with
  `ReplicationSlotBeingUsed`. Three checks cover this, including that the
  slots belong to different databases.

---

## 4. R2 storage

Object storage is Cloudflare R2, reached through storage-api. Verified against
the real service, 9 checks of 9: credentials accepted, upload, download
byte-identical, ETag usable for verifying copies, listing, delete, and deletion
confirmed by a second request rather than assumed from the 204.

```
R2_ENDPOINT          https://<account-id>.r2.cloudflarestorage.com
R2_BUCKET            everytinroom-media
R2_REGION            auto
R2_ACCESS_KEY_ID     from an R2 API token, not a cfat_ account token
R2_SECRET_ACCESS_KEY ditto
```

Two settings that are deliberate:

- `STORAGE_S3_FORCE_PATH_STYLE: "true"` — R2 does not do virtual-host style
  buckets on the S3 API endpoint.
- `STORAGE_S3_REQUEST_CHECKSUM_CALCULATION: WHEN_REQUIRED`. I had long held
  that R2 rejects the SDK's default trailing checksum. **Tested against the
  real service, it accepts it (HTTP 200).** The setting stays because it is
  harmless and one less thing to depend on, but the reason recorded for it was
  wrong and is corrected here.

The bucket is **not** public. Objects are served through storage-api, which
applies the application's own access rules.

Credentials live in `deploy/.r2.env`, mode 600, gitignored, and
`validate-all.sh` fails if that path is ever tracked.

---

## 5. Authentication and Realtime

**Everytinroom does not use Supabase Auth.** It checks a PIN against its own
`staff` table — bcrypt hashes via pgcrypto, `verify_pin()` issuing a row in
`staff_sessions`. No GoTrue container is started for it. That is tested: the
run confirms `alpha_shop` has no `auth` schema at all while the application
that does need auth has its own.

For the projects that do use it, GoTrue runs per application, with its own
`auth` schema in its own database. Verified 21 checks of 21, including that
open self-registration is refused and that one application's token is rejected
by another's API.

**Realtime is not used by the till, and is not deployed for it.**

It was, and it worked in steady state — measured at 275 ms with the
application's own client version. It was dropped because of how it fails.
Restarting the Realtime container left it accepting subscriptions and
answering `{"message":"Subscribed to PostgreSQL","status":"ok"}` while
delivering nothing at all, with no error in its log and no recovery after
ninety-five seconds. A newly provisioned tenant behaved the same way. In its
own poller:

```elixir
# Stopping with a :shutdown reason means the :transient child is NOT restarted
defp retry_or_stop(%{retry_count: retry_count} = state, reason)
     when retry_count >= @max_retries do
  log_error("ReplicationPollerMaxRetriesReached", reason)
  {:stop, {:shutdown, :max_retries_reached}, state}
end
```

The change-data-capture worker stops for good while the channel layer carries
on acknowledging clients. A till that has silently stopped updating looks
exactly like a quiet afternoon, and nobody finds out until two cashiers
disagree about stock.

The till now reads revision counters from `public.live_state` — three rows,
one per watched table, bumped by a statement-level trigger — polled through
the same authenticated API it already uses. Migration `034_live_state.sql`
creates it. What that removes from this deployment:

| No longer needed | Was |
|---|---|
| the Realtime container | ~200 MB per application |
| 91 tenant migrations | a provisioning step that could stop the tenant |
| `supabase_realtime_admin` | a reserved role, granted `WITH ADMIN OPTION` |
| `GRANT SET ON PARAMETER log_min_messages` | a privilege grant with a superuser fallback |
| `REALTIME_SLOT_SUFFIX` | one replication slot per tenant, cluster-wide |
| the `post-start.sh --only realtime` step | migrations applied as the image's superuser |

What it costs: updates arrive in about three seconds instead of 275 ms. At a
till that is not a difference anyone notices, and the request is a
primary-key read of three rows — about an eighth of a request per second
across four workstations, the same whether the shop has sold ten things or
ten million.

What it gains, by construction rather than by testing: a reconnection, a
service restart and a reboot all recover by themselves, because every poll is
a fresh request and there is no long-lived connection to be silently dead. The
client also degrades rather than failing if it reaches a backend where
`live_state` has not been created yet — it falls back to refreshing everything
on a slower cycle and says so in the console, instead of delivering nothing.

**The platform still supports Realtime** for any of the other six projects
whose inventory shows it is needed, and the defect above is theirs to inherit
if so. It is recorded in the readiness report as a known defect in an optional
component rather than quietly dropped. The three things it needs, all enforced
in provisioning, are:

1. A narrow `GRANT SET ON PARAMETER log_min_messages`, or tenant migrations
   stop at `20230328144023` and `realtime.list_changes()` is never created.
2. The reserved role `supabase_realtime_admin`, created and granted
   `WITH ADMIN OPTION`, or migration 40 fails.
3. **All 91 tenant migrations.** Migrations 84–91 do work this platform has no
   use for, and I documented them as skippable on that basis. That was wrong:
   Realtime applies its list in order and `MigrationsFailedToRun` stops the
   tenant, and a stopped tenant still accepts websocket subscriptions, so it
   reads as healthy while delivering nothing. `post-start.sh` applies them as
   the image's superuser from statements extracted verbatim upstream.

One operational fact to know rather than be surprised by: Realtime's
change-data-capture poller cancels its own timer when it reads an empty
table-oid list and waits 60 seconds before looking again. A tenant that has
just started or just been restarted can therefore be silent for up to a minute
before delivering normally. It recovers unattended; nothing needs doing.

---

## 6. Backups and tested restoration

```
02:15 daily   scripts/backup.sh --all          (cron, installed by provision-app.sh)
```

- `pg_dump --format=plain --clean --if-exists --quote-all-identifiers` per
  database, gzipped. `--no-owner` is deliberately **not** used: ownership is
  part of the security model, and a restore that makes everything owned by one
  role undoes the isolation.
- `pg_dumpall --globals-only` as well, so a restore comes up with its roles and
  their passwords. A dump without it restores a database nobody can connect to.
- Completeness is checked against the **database**, not a byte count: the dump
  must contain at least as many `CREATE TABLE` statements as the database has
  tables. An empty database legitimately produces a dump of a few hundred
  bytes, and rejecting that as "too small to be real" once failed a correct
  backup.
- Retention: `BACKUP_KEEP_DAYS`, default 14.

Restoration is rehearsed rather than trusted. `restore.sh` restores into a
**separate** database by default and never touches the live one unless told to.
Verified on a real server: row count and the sum of `sales.total` matched the
source exactly, the live database was confirmed unchanged, and the schemas
outside `public` came back with all their tables — including `storage.objects`,
which records where each uploaded file lives. Losing that would leave the
catalogue with no pictures even though every byte was still in R2, and row
counts and money totals would both still have passed.

A note on what a restore prints. A `--clean` dump emits `DROP` statements
first, and every one of them fails on a database that does not have the object
yet — which is always the case when restoring into a fresh target. Run 40
produced 135 such lines. They are expected. **The row counts and money totals
printed afterwards are what proves the restore, not the error count.**

That is also where a real defect was found, in the recovery path:

```sh
grep -i '^ERROR' "$LOG" | head -10 | sed 's/^/      /'
```

With more than ten error lines, `head` closes the pipe, `grep` is killed by
SIGPIPE, `pipefail` reports 141 and `set -e` aborts the script — immediately
**before** the row counts and money totals. A restore that had succeeded was
reported as a failure, and the operator lost the only output that would have
told them otherwise. Nineteen runs passed because each had ten lines or fewer.
The real migration script carried two more copies of the same shape, in the two
places that summarise what went wrong while moving a live shop, and
provisioning carried a third. All four now read their input to the end, and
`check-sigpipe.py` keeps the shape out; it was verified against a planted
instance.

---

## 7. Monitoring, firewall and recovery

### Firewall

`bootstrap.sh` configures ufw: default deny inbound, allow outbound, and
exactly three ports in — SSH (read from `sshd_config` rather than assumed to be
22), 80 for the ACME challenge and the HTTPS redirect, and 443. PostgreSQL is
**not** exposed; it is reached over the Docker network and, for maintenance,
through the container's own unix socket.

### Monitoring

```
:07 hourly    capacity.sh --quiet      RAM, CPU, disk, database, containers, network, backups
on demand     scripts/health.sh        are the services actually answering
```

`capacity.sh` exits 0, 1 or 2 for OK, warning and critical, so cron and any
external uptime checker can act on the exit code. It reads only — it never
restarts a container, prunes an image or touches data. It reads the database
through the container's unix socket as `postgres`, so no password appears on a
command line where `ps` would show it; `central_monitor` is the least-privilege
role for an external agent connecting over TCP.

`health.sh` prints a `HEALTH-COMPLETE checked=N problems=N` marker when it
finishes. That exists because it once crashed mid-loop on an unguarded
`docker inspect` under `set -e`, and the run reported "health.sh reported
problems" — a guess about a script that had died. Without the marker, a crash
and a clean run look the same.

### Recovery

| Situation | Action |
|---|---|
| a service is not answering | `cd /srv/central/apps/<app> && ./compose.sh ps`, then `restart` |
| the machine rebooted | containers come back by restart policy; verified by a real reboot in the suite |
| a database is damaged | `scripts/restore.sh --app <app> --file <dump>` into a probe database first, reconcile, then `--into` the live name |
| the whole machine is lost | `bootstrap.sh` on a new one, `provision-app.sh` per application, restore the dumps and the globals |

Full-stack recovery is rehearsed in the suite: the deployment is run again from
clean on an already-configured machine, every container is stopped and the
stack started again — a reboot in effect — and the data is reconciled
afterwards. The most recent rehearsal: **3,874 rows, unchanged**, with the
restart policy confirmed as `unless-stopped` so the containers come back by
themselves. Re-running `bootstrap.sh` is safe: it never regenerates a secret,
because a new database password cannot open an existing database.

---

## 8. The deployment and migration sequence

Steps 1–4 touch nothing that is live. The shop keeps running on Supabase
throughout, because **nothing reaches the new server until DNS is changed**,
and that is step 6.

```
1. The server
   scp -r deploy root@SERVER:/root/
   ssh root@SERVER '/root/deploy/bootstrap.sh --acme-email <you>'

   Ten steps: Ubuntu version, Docker Engine, Compose plugin, verification,
   firewall, directories, environment files, start, container health, and a
   check of what is actually reachable from the internet. Safe to re-run.

2. Each application, Everytinroom first
   /srv/central/provision-app.sh \
     --name everytinroom --domain api.everytinroom.store \
     --storage --functions

   No --realtime: the till polls revision counters instead of holding a
   websocket (section 5). Add it only for a project whose inventory shows
   it is needed, and read the defect in section 5 first.

   Ten steps: register, isolated database, credentials, PostgREST, Realtime,
   storage, application services, migrations, domain and HTTPS, backups and
   monitoring. Does NOT touch DNS. Safe to re-run.

3. The data, read-only from the source
   /srv/central/scripts/migrate-from-supabase.sh --app everytinroom

   Reads the source only. Reconciles row counts and sum(sales.total)
   afterwards and exits non-zero if anything differs.

4. The scheduled jobs
   Reviewed by hand before applying, because job bodies contain the OLD
   project URL hardcoded in their SQL. Left as they are, they keep calling
   the old project after cutover. The script extracts them, warns, and
   prints every offending URL it found.

5. Verify, with the shop still live on Supabase
   /srv/central/capacity.sh
   /srv/central/scripts/health.sh
   /srv/central/scripts/backup.sh --all --verify
   /srv/central/scripts/restore.sh --app everytinroom --file <the dump>

6. Cutover  — NEEDS APPROVAL
   Point api.everytinroom.store at the new server, and set
   VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY in Vercel to the new API.
   Both are build-time values, so the till needs a redeploy to pick them up.

7. Watch, then repeat from step 2 for the next project
   Keep the Supabase project running and paid until the new one has carried
   a full week including a weekend. Rolling back is changing two env vars
   and redeploying, for as long as the old project still exists.
```

The till's backend is already env-configurable — `VITE_SUPABASE_URL` and
`VITE_SUPABASE_ANON_KEY`, read in one place and used through `fnUrl()` and
`storageUrl()` helpers — so re-pointing it is two variables and a redeploy, not
a code change. Unset, it falls back to the current live project, so a
deployment that sets nothing is unchanged. The `Web build` workflow fails if a
hardcoded project host reaches `dist/assets/`.

---

## 9. What needs the account holder

Four things, and nothing else in this document does.

1. **A Supabase personal access token**, read-only use, for the project
   inventory in section 2. Without it the seven-project table rests on an
   earlier inventory rather than a current measurement, and the two paused
   projects cannot be named. Revoke it once the inventory is taken.
2. **Buying the VPS** (€11.20/month, 24-month term). Not done.
3. **The DNS change** at step 6. Not done.
4. **Keeping the Supabase projects paid** until each migrated project has run
   a week on the new server. Cancelling early removes the rollback.

Not done, and not to be done without saying so: no VPS purchased, no DNS
changed, no production database cut over, no Supabase project cancelled, no
source data deleted.
