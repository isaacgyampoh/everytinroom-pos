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

## What has NOT been proven

`deploy/scripts/validate-all.sh` runs 72 checks: shell syntax, YAML, every
image tag against Docker Hub, the SQL, the tuning arithmetic, the capacity
thresholds, JWT signing against an independent implementation, and the
isolation test against a real PostgreSQL.

It cannot prove:

- **that the containers start.** There is no Docker on the laptop this was
  written on.
- **that Realtime delivers events.** Its tenant comes from the first label of
  the Host header, which only a real request through Caddy exercises. This is
  the most likely thing to need a second attempt.
- **that uploads reach R2.** Needs Cloudflare credentials.
- **that the restored database behaves.** Needs the production dump.

Those four need a staging server. Until then this is a validated foundation,
not a tested deployment, and the difference matters.

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
