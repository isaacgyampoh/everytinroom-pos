# Central hosting

One Ubuntu server, one PostgreSQL, one database per application. Everytinroom
is the first; others join without rebuilding anything.

Nothing in here has touched production. No DNS has changed, no Supabase data
has been read apart from counting rows, and nothing has been bought.

---

## The decision: not a full Supabase stack

The stock self-hosted Supabase stack is twelve containers. This runs **two
shared, plus one to five per application**, because the application was read
before the architecture was chosen.

### What was dropped, and the evidence

**GoTrue (Supabase Auth) — not deployed.**
```
$ grep -rn "\.auth\.\|signInWith\|getSession\|onAuthStateChange" src/
(nothing)
```
Staff sign in with a PIN checked by `verify_pin()` against the shop's own
`staff_sessions` table. There is not one call to `supabase.auth` in the
codebase. Running GoTrue would spend about 256 MB serving nothing.

This is also why row-level security cannot tell cashiers apart here: Postgres
sees the `anon` role for every till, so `auth.uid()` is null and the
privileged operations go through `SECURITY DEFINER` functions that check a
session token instead. That is the existing design and it carries over
unchanged.

**Kong / Envoy — replaced by Caddy.** The gateway's job here is TLS plus four
path prefixes. Caddy does that in forty lines and gets its own certificates;
Envoy needs a separate ACME client.

**Studio and postgres-meta — not deployed.** A database admin panel on a
public address is the most attacked thing you can host. Use psql through an
SSH tunnel:
```
ssh -L 5432:127.0.0.1:5432 root@SERVER
psql -h 127.0.0.1 -U postgres -d everytinroom
```

**Supavisor (connection pooling) — not deployed.** PostgREST keeps its own
pool. A pooler in front of it adds a hop and a failure mode for no benefit at
this size. Worth revisiting past roughly a dozen applications.

### What is kept, and why

| Service | Shared? | Why it has to be here |
|---|---|---|
| PostgreSQL | shared | The data. `supabase/postgres`, not plain `postgres`: production uses `supabase_vault`, `pg_cron` and `pg_net`, and the image ships them preloaded with the roles PostgREST expects. |
| Caddy | shared | TLS, certificates, and the Supabase URL layout. |
| PostgREST | per app | 73 of the 76 supabase-js call sites are `sb.from()` or `sb.rpc()`. |
| Realtime | per app, optional | Three `sb.channel()` subscriptions drive the sale confirmation, the till sound and the customer display. |
| Storage | per app, optional | Keeps `sb.storage.from().upload()` working unchanged, with Cloudflare R2 underneath. |
| imgproxy | with Storage | Thumbnails and resizing. A billed add-on on hosted Supabase; here it is CPU already paid for. |
| edge-runtime | per app, optional | The Deno functions: `charge-momo`, `paystack-webhook`, `sms-reports`, `ussd-handler`. |

Optional services are compose **profiles**, not copies of a file. An
application needing only a data API runs one container.

---

## Isolation

The promise is that one business cannot read another's data. Specifically:

- a database per application, with `CONNECT` revoked from `PUBLIC` and granted
  only to that application's own `<app>_authenticator`
- a JWT secret per application, so a token minted for one is rejected by
  another
- a password per application, in a mode-600 file owned by root
- `<app>_realtime` and `<app>_storage` roles per application, rather than the
  cluster-wide `supabase_storage_admin` the stock compose uses — otherwise
  every storage container would hold one password for a role that exists in
  every database

This is tested, not asserted:

```
deploy/scripts/test-provision-sql.sh
```

It provisions two throwaway applications and tries to open the first using the
second's password. That connection must be refused. It also checks that the
realtime role — necessarily privileged inside its own database, because
logical replication hands over every change — is refused by the other.

**What isolation this does not give.** All application containers share one
Docker network to reach Postgres, so separation is at the database layer, not
the network layer. A container compromise is contained by the credentials it
holds, not by the network. Shared Postgres also means a runaway query on one
application affects the others; `statement_timeout` is set per role to limit
that, not to eliminate it.

---

## Scheduled jobs

**pg_cron's scheduler runs in exactly one database.** `cron.database_name` is
`postgres` here, deliberately neutral rather than belonging to a tenant, so
every application registers its jobs with `cron.schedule_in_database()`.

**pg_net has the same limitation, and it is the one that bites.** Its
background worker reads `net.http_request_queue` in exactly the database named
by `pg_net.database_name` — `postgres` here — and running it on several
databases in one cluster is not supported. Called from any other database,
`net.http_post()` inserts a queue row, returns an id, and is never processed:
no error, no response row in `net._http_response`, no request. A job that
looks fine and does nothing.

So jobs split by what they do, not by which application owns them:

| The job | Where it is registered | How |
|---|---|---|
| runs SQL only | the application's own database | `cron.schedule_in_database('name', sched, sql, 'app_db')` |
| makes an HTTP call | the `postgres` database | `cron.schedule('name', sched, $$select net.http_post(...)$$)` |
| reads app data **and then** calls out | must be split | the SQL half becomes a PostgREST RPC in the app database; the HTTP job calls that URL |

The staging run measures this rather than asserting it: section 9 schedules an
HTTP job in `postgres` and requires it to arrive, then makes the same call from
the application's own database and records that it queues and is never served.

Everytinroom's six jobs need attention at cutover, for two reasons found by
reading the live database:

1. They are registered with `cron.schedule()`, which schedules in whichever
   database it is called from — on Supabase there is only one, so every job
   lands together. Here they have to be sorted by the table above: the
   HTTP-calling ones stay on `cron.schedule()` in `postgres`, the SQL-only
   ones become `cron.schedule_in_database(..., 'everytinroom')`.
2. **The job bodies have the old project URL hardcoded in them**:
   ```sql
   SELECT cron.schedule('morning-report', '0 6 * * *', $$SELECT net.http_post(
     url := 'https://<old-project>.supabase.co/functions/v1/charge-momo?...'
   )$$);
   ```
   Left alone, after cutover they keep calling the old backend. Nothing
   errors. The reports simply come from the wrong place, or stop.

Also worth knowing: the live job names (`sms-morning`, `etr-report-monthly`)
do not match the migration files (`morning-report`). Live cron has drifted
from the repository, so **the live database is the source of truth**, not
`supabase/migrations/`. `migrate-from-supabase.sh` reads the jobs out of the
live `cron.job` table and writes them to a file for review rather than
applying them.

---

## Realtime

Realtime needs one thing from this platform that nothing else does, and it
fails in a way worth knowing about.

**It builds its own schema.** Ninety-one tenant migrations create
`realtime.subscription`, `realtime.apply_rls` and `realtime.list_changes` —
the function its write-ahead-log poller calls on every cycle. The thirtieth of
those creates `list_changes`, and the function is declared

```sql
create or replace function realtime.list_changes(...)
  returns setof realtime.wal_rls
  language sql
  set log_min_messages to 'fatal'
```

`log_min_messages` is a superuser-only parameter, so a role that may not set
it may not create that function. Ecto stops at the first failure, and
**Realtime then starts anyway**: a client subscribes, the channel reports
`SUBSCRIBED`, and no database change is ever delivered. The only sign is in
Realtime's own log, repeating `function realtime.list_changes(...) does not
exist` once per poll. On Supabase's own servers this never appears, because
Realtime connects there as a superuser.

So `21-realtime.sql` grants exactly one parameter privilege:

```sql
GRANT SET ON PARAMETER log_min_messages TO <app>_realtime;
```

That lets the role quiet its own logging and nothing else. Privileges on
parameters are themselves granted and initially only a superuser holds them,
so if the provisioning role cannot make the grant, `provision-app.sh` makes it
once as the image's superuser and then **checks that the privilege is held**
rather than trusting the statement — a GRANT that the grantor may not make
raises, while a GRANT on an object it does not own only warns.

### The second thing it needs, and why it is not optional

Migration 40 of 91 creates the role `supabase_realtime_admin` and moves
ownership of Realtime's broadcast and presence tables to it. On this image
that role does not exist, it is one of `supautils.reserved_roles`, and an
application's realtime role cannot create roles — so without help that
migration fails, and **nothing after a failed migration runs.**

I first wrote this up as a limitation affecting only broadcast and presence.
That was wrong, and the run that followed said so:

```
column "slot_changes_count" does not exist
query: SELECT ... slot_changes_count FROM realtime.list_changes(...)
```

Migration 30 creates `list_changes` as it was in 2023. Migration **69**
replaces it with the version Realtime v2.148 actually calls. Migration 40 sits
between them. So stopping at 40 leaves live database updates broken too, with
the client reporting `SUBSCRIBED` throughout.

So `provision-app.sh` creates that role and grants it to the application's
realtime role, both as the image's superuser — which is how Supabase's own
platform runs these migrations, and why none of this appears there. Realtime
then runs its own migrations, so the schema is whatever Realtime says it
should be rather than something reconstructed from reading its source.

A membership grant on a reserved role is the operation that has taken this
server down twice, so it is followed by a liveness probe: if PostgreSQL stops
answering, provisioning stops and says so rather than carrying on. The
membership is then confirmed with `pg_has_role`, not inferred from the
statement not erroring.

**It does not weaken isolation.** `supabase_realtime_admin` is a cluster-level
role, so several applications' realtime roles may each be members of it — but
those roles hold `CONNECT` on their own database and no other, and that is the
boundary. Membership in a shared role creates no path into a database the role
cannot open.

### Why 83 of 91 migrations is the right answer, not a shortfall

With both privileges in place Realtime applies 83 of its 91 tenant
migrations. The remaining eight are not skipped to make a number look better;
they cannot be performed by an application's role and nothing here uses them.

Migration 84 is representative:

```sql
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin
  IN SCHEMA realtime
  GRANT SELECT, INSERT ON TABLES TO postgres WITH GRANT OPTION
```

That is the same "act as another role" this platform bans in its own SQL — a
role may change its own default privileges, not another's. Migrations 84 to 91
all do work of that kind: delegating Realtime's `messages` tables and schema
usage between `supabase_admin` and `postgres`, then revoking grant options
again. They exist so that Supabase's own platform tooling can reach those
tables. There is no such tooling here.

**What is required is checked directly, by number and by effect:**

| Migration | What it does | How it is verified |
|---|---|---|
| `20230328144023` | creates `realtime.list_changes()` | version row present |
| `20240401105812` | creates `supabase_realtime_admin` and moves ownership; blocks everything after it | version row present |
| `20260326120000` | replaces `list_changes()` with the five-column version this Realtime calls | version row present **and** `pg_get_function_result()` read back and checked for `slot_changes_count` |

Then the behaviour itself: a real `@supabase/supabase-js` client subscribes
through Caddy, a row is inserted through PostgREST, and the event must arrive.
That is done on two independent tenants, a change in one must **not** reach the
other's channel, and the service is restarted and has to resume delivering
unattended. A version row says someone wrote a number into a table; those
checks say the thing works.

### Checking it without a server

`deploy/scripts/test-realtime-migrations.py` replays those migrations against
a throwaway database as a non-superuser, and proves both directions in
seconds: without the grant it stops at `20230328144023` for that exact
reason, and with it `list_changes` and the five functions around it exist. It
runs in the staging suite too, with `--via-docker`, against the real image.

---

## Using it

### 1. The server

```
scp -r deploy root@SERVER:/root/
ssh root@SERVER '/root/deploy/bootstrap.sh --acme-email you@example.com'
```

Ten steps: Ubuntu version, Docker Engine, Compose plugin, verification,
firewall, directories, environment files, start, container health, and a check
of what is actually reachable from the internet. Safe to re-run — it never
regenerates a secret, because a new database password cannot open an existing
database.

### 2. An application

```
/srv/central/provision-app.sh \
  --name everytinroom \
  --domain api.everytinroom.store \
  --realtime --storage --functions
```

Ten steps: register, isolated database, credentials, PostgREST, Realtime,
storage, application services, migrations, domain and HTTPS, backups and
monitoring. Also safe to re-run.

It does **not** touch DNS. Nothing reaches the server until you create the
record yourself, which is what makes this safe to run while the old backend is
still live.

### 3. The data

```
read -rs SUPABASE_DB_URL && export SUPABASE_DB_URL   # keeps it out of history
/srv/central/scripts/migrate-from-supabase.sh --app everytinroom
```

Only reads the source. Reconciles row counts and `sum(sales.total)` afterwards
and exits non-zero if anything differs.

### Day to day

```
/srv/central/capacity.sh              # RAM, CPU, disk, database, containers, network, backups
/srv/central/scripts/health.sh        # are the services actually answering
/srv/central/scripts/backup.sh --all --verify
/srv/central/scripts/restore.sh --app everytinroom --file ...   # rehearses by default
cd /srv/central/apps/everytinroom && ./compose.sh ps
```

`capacity.sh` exits 0, 1 or 2 for OK, warning and critical, so cron and any
uptime checker can act on it. It runs hourly; backups run at 02:15.

### On a Mac, for testing

```
deploy/mac/docker-setup-mac.sh
```

Installs Colima — Apache-2.0, free for any use — rather than Docker Desktop,
whose licence requires a paid subscription above a size threshold. `--desktop`
if you would rather.

---

## Capacity

`capacity.sh` ends with an estimate of how many more applications fit, as the
**minimum** of what memory, disk and connections allow, and says which is the
binding limit.

It is an estimate from what is free at that moment, assuming each new
application runs every service. It is not a promise, and no server hosts an
unlimited number: a busy application costs many times an idle one.

When it reaches zero, Contabo resizes a VPS in place. Stop the stack, resize,
start it, re-run `bootstrap.sh` — it recalculates PostgreSQL's memory settings
for the new machine. No database, secret or application configuration changes.
That is the point of putting the tuning in a generated file rather than typing
numbers into a config.

---

## What is proven, and by what

Three different kinds of evidence, which are worth keeping apart.

**On a real server.** `deploy/scripts/staging-test.sh` runs on a throwaway
Ubuntu machine with no Docker on it: bootstrap installs Docker from the
official repository, the shared stack comes up, two applications are
provisioned with different services, and then twelve sections of checks run
against them — isolation, Realtime end to end, object storage through the S3
API, Supabase Auth, backup and restore into a separate database, scheduled
jobs firing in another database, resource use under a generated load, the
whole deployment re-run, and recovery from stopping every container. Each run
publishes its report, and `deploy/scripts/archive-run.sh` keeps every report
outside this repository, because the workflow force-pushes onto one branch and
a report read once and then overwritten has already produced one wrong
conclusion here.

**Locally, against a real PostgreSQL but not against the platform.**
`validate-all.sh` runs the static checks and then four suites: the
provisioning SQL end to end, Realtime's own tenant migrations replayed as a
non-superuser, every inventoried scheduled job's placement, and bootstrap's
secret handling and arithmetic. These are a weaker claim and are reported
separately in the readiness package. One of them connects as a superuser,
which is exactly why it cannot reproduce the permission walls this platform
keeps finding — it says so in its own output.

**Not at all, yet.** These are named rather than glossed:

- ~~uploads to Cloudflare R2~~ — **done.** Verified against the real service
  on 2026-11-09 with the owner's credentials: bucket reachable, upload
  accepted, download **byte-identical**, ETag a plain MD5 that matches (which
  is what `migrate-storage.py` relies on to verify a copied image), object
  listed, deleted, and confirmed gone by a second request. 9 checks, 0
  failures. The report is in the evidence archive; it records the bucket and
  the probe prefix, and the account id is replaced by a placeholder.

  One claim this corrected: it used to say here that R2 rejects the
  trailing-checksum headers the AWS SDK sends by default. It does not — that
  exact shape was accepted with HTTP 200. `STORAGE_S3_REQUEST_CHECKSUM_CALCULATION`
  stays at `WHEN_REQUIRED` because it is also accepted and sends less, but it
  is not the load-bearing setting it was described as.
- **a restored production database.** Staging generates its own rows. Nothing
  here proves the real dump restores, or that its functions, policies and
  publications survive the trip.
- **a real VPS.** Every result comes from a CI runner: a different machine,
  different disks, different network. The same staging script should be run on
  the server before cutover.
- **Realtime end to end.** The two privileges its migrations need are now
  granted and verified, and the staging run checks delivery on two independent
  tenants, that one tenant's change does not reach the other, and that
  delivery resumes after a restart. Until a run shows those passing, live
  updates are not claimed to work.

Until those are done this is a tested platform, not a completed migration,
and the difference matters.

---

## Files

```
deploy/
  bootstrap.sh              Part B — ten-step Ubuntu setup
  provision-app.sh          Part C — ten-step application provisioning
  capacity.sh               Part D — resources, with warnings
  VERSIONS.md               every pinned tag and why that one
  lib/
    common.sh               logging, guards, secret handling that never prints
    tuning.sh               PostgreSQL memory from the machine's real size
    capacity-lib.sh         thresholds and the headroom estimate
  compose/
    docker-compose.yml      shared: postgres + caddy
    app.compose.yml         one application; optional services as profiles
    Caddyfile               TLS and the Supabase URL layout
    caddy-site.template     rendered per application
    postgres/90-central.conf.tmpl
  sql/
    10-create-app-db.sql    database, roles, CONNECT isolation
    20-app-grants.sql       schema, SET ROLE, per-role limits, no table grants
    21-realtime.sql         _realtime schema and role
    22-storage.sql          per-application storage role
  scripts/
    migrate-from-supabase.sh   read-only copy, with reconciliation
    backup.sh / restore.sh     globals + per database; restore rehearses
    health.sh                  are the services answering
    mint-jwt.sh                the anon key is a signed JWT, not a random string
    validate-all.sh            every check that works without a server
    test-provision-sql.sh      the isolation test
    test-tuning.sh             the memory arithmetic
    test-capacity.sh           the thresholds
  mac/docker-setup-mac.sh      Docker locally, without installing by hand
```

Secrets live in `/srv/central/.env` and `/srv/central/apps/<name>/.env`, mode
600, root only, and are excluded from git. Scripts report the **names** of what
they set and never the values.
