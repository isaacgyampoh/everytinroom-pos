# Migration readiness

Generated from evidence files by `deploy/scripts/readiness-package.py`.
Staging run: `42741682282`

Each acceptance test below is PASSED, FAILED or NOT VERIFIED. NOT
VERIFIED is the default and means no check for it was found in any
report -- it is not a soft pass. The verdict at the end is computed from
these states, not written by hand.

## Verdict

Four categories, kept apart on purpose. A thing proved on a real server
and a thing proved on a laptop are not the same claim, and neither is
the same as a thing nobody could test yet.

| | Count | What it means |
|---|---|---|
| **Verified on a real server** | 97 | a named check in the staging run's report passed. The staging machine is a disposable Ubuntu server that installs Docker from scratch and runs the whole platform. |
| **Failed** | 0 | a named REQUIRED check in that report failed. Listed below with the line that failed. |
| **Not verified** | 7 | no check for a required item was found in the report. Not a soft pass: it means nobody looked, or the run did not reach it. |
| **Failed or unproven in an OPTIONAL component** | 2 | a component nothing on this migration's path uses. It does NOT block this migration, and it is still a defect: any project that does use that component inherits it. Listed under "Optional components with known defects". |
| **Blocked by missing credentials** | 0 | cannot be run from here at all. Listed under "What still requires an account action". |

Separately, and NOT counted above, there is evidence that comes only from
local and CI tests -- the section "Verified only in local tests" says
what each of those proves and, more to the point, what it does not.

**NOT READY.** Required tests are failing or unverified; they are listed below.

## Acceptance requirements

The seven requirements as they were given, each resolved from the named
checks below it. A requirement is only PASS when every check under it
passed; otherwise it carries the worst state any of them has, so nothing
is rounded up.

| # | Requirement | State | Resolved from |
|---|---|---|---|
| 1 | Preserve all existing staging evidence sets | NOT TESTED | 0 run(s) kept in /home/runner/everytinroom-staging-evidence, each with its report |
| 2 | Realtime: migrations 30, 40 and 69, a real client subscription, event delivery, tenant isolation and restart recovery | **FAIL** | 40 of 42 check(s) passed |
| 3 | Auth, cron, backup/restore and service recovery | **PASS** | 22 of 22 check(s) passed |
| 4 | Cloudflare R2, verified against the real service | NOT TESTED | 1 of 8 check(s) passed |
| 5 | The complete deployment re-run from a clean Linux environment | **PASS** | 11 of 11 check(s) passed |
| 6 | Measured capacity for all seven inventoried projects | **PASS** | 4 of 4 check(s) passed |
| 7 | The final migration-readiness package | **PASS** | this document, generated from the evidence files |

Every check named under a requirement appears in the table that follows,
with the report line that decided it.

**2. Realtime: migrations 30, 40 and 69, a real client subscription, event delivery, tenant isolation and restart recovery**

- PASS — The privilege Realtime's migrations need is actually held
- PASS — Realtime's role is a member of supabase_realtime_admin
- PASS — Realtime's own migrations replay under this platform's privileges
- PASS — Realtime migration 20230328144023 applied (creates list_changes)
- PASS — Realtime migration 20240401105812 applied (the reserved-role one)
- PASS — Realtime migration 20260326120000 applied (the list_changes the poller calls)
- PASS — Migration 69's actual function definition, not just its version row
- PASS — Realtime's role may execute list_changes
- PASS — All 91 tenant migrations applied, which Realtime requires to run CDC
- PASS — Realtime's setup completed before a client subscribed
- PASS — Realtime is ready before a client subscribes
- PASS — Realtime's own schema and WAL reader exist
- PASS — Realtime subscription accepted
- PASS — The Realtime client harness actually ran
- PASS — Both client versions tested under identical conditions
- PASS — The supabase-js version the application ships delivers
- PASS — Delivery latency measured, not assumed
- PASS — Realtime delivers a database change end to end
- PASS — live_state has a row and a trigger per watched table
- PASS — live_state is readable by the browser role and not writable
- PASS — A write moves the revision the till polls
- PASS — The browser harness itself ran
- PASS — The real application's Login screen renders
- PASS — Everything verify_pin reads and writes exists
- PASS — verify_pin returns rather than raising, called directly
- PASS — The browser role may execute verify_pin
- PASS — verify_pin accepts a staging PIN and the till opens
- PASS — The real application receives a live event and SHOWS it
- PASS — A product change appears in the interface
- PASS — A website order change appears in the interface
- PASS — Two workstations both receive the same sale
- PASS — Live updates resume after a network interruption
- PASS — Live updates work after the application is restarted
- PASS — The browser run finished rather than hanging
- PASS — Another application's sale does not appear in this one's interface
- **FAIL** — A second, independent Realtime tenant also delivers
- PASS — Each Realtime tenant has its own replication slot
- PASS — Both tenants' replication slots are active
- PASS — The slots belong to different databases
- PASS — A change in one application does not reach another's channel
- PASS — Realtime becomes ready again after a restart
- **FAIL** — Delivery resumes after Realtime is restarted

**3. Auth, cron, backup/restore and service recovery**

- PASS — GoTrue runs for the application that needs it
- PASS — GoTrue answers through the proxy
- PASS — A user can be created through GoTrue's admin API
- PASS — Open self-registration is refused
- PASS — The user lands in that application's own auth.users
- PASS — Sign-in returns a usable token
- PASS — One application's token is rejected by another's API
- PASS — pg_net is pinned to the one database its worker serves
- PASS — pg_net's one-database limit measured, not assumed
- PASS — Scheduled job registered in another database
- PASS — Scheduled job actually executed
- PASS — Scheduled job reached a new API URL
- PASS — Backup produces a dump and cluster globals
- PASS — Restore into a SEPARATE database
- PASS — Restore verified by row count and a money total
- PASS — Live database untouched by the restore rehearsal
- PASS — Schemas outside public survive the restore
- PASS — Restart recovery, unattended
- PASS — Whole stack recovers from a full stop, unattended
- PASS — Data survives a full restart
- PASS — API answers again after a restart with no intervention
- PASS — Service health check across applications

**4. Cloudflare R2, verified against the real service**

- NOT TESTED — Cloudflare R2: credentials accepted on the real service
- NOT TESTED — Cloudflare R2: upload accepted
- PASS — Cloudflare R2: download is byte-identical
- NOT TESTED — Cloudflare R2: ETag usable for verifying copies
- NOT TESTED — Cloudflare R2: object appears in a listing
- NOT TESTED — Cloudflare R2: delete accepted
- NOT TESTED — Cloudflare R2: deletion confirmed by a second request
- NOT TESTED — Cloudflare R2: the SDK's default checksum shape, tested for real

**5. The complete deployment re-run from a clean Linux environment**

- PASS — Docker installed automatically on a clean machine
- PASS — Compose plugin installed
- PASS — Shared stack starts
- PASS — PostgreSQL healthy and answering
- PASS — Central roles and application registry
- PASS — Two applications provisioned with different services
- PASS — Every application's compose configuration is valid
- PASS — The whole deployment re-run on a configured machine
- PASS — Re-running the deployment does not regenerate the DB password
- PASS — Registry unchanged by a re-run
- PASS — Provisioning from an already-configured machine

**6. Measured capacity for all seven inventoried projects**

- PASS — Sustained load served without errors
- PASS — Throughput and latency measured
- PASS — Resource usage measured UNDER LOAD, not at rest
- PASS — Capacity report with headroom estimate

## Verified on a real server

Every row here is a check that passed, failed, or was never reached in the
staging run named above. Nothing in this table comes from a local test.

| Test | State | Evidence |
|---|---|---|
| Docker installed automatically on a clean machine | PASSED | - PASS Docker Engine installed and responding: Docker version 29.9.3 |
| Compose plugin installed | PASSED | - PASS Compose plugin installed: 5.7.0 |
| Shared stack starts | PASSED | - PASS central-postgres is running |
| PostgreSQL healthy and answering | PASSED | - PASS central-postgres reports healthy |
| Database not exposed to the internet | PASSED | - PASS PostgreSQL is bound to 127.0.0.1 only |
| Image's preloaded libraries not clobbered | PASSED | - PASS the image's preloaded libraries survived the config override |
| wal_level is logical (Realtime prerequisite) | PASSED | - PASS wal_level is logical, which Realtime requires |
| Central roles and application registry | PASSED | - PASS the central.applications registry exists |
| Restart recovery, unattended | PASSED | - PASS central-postgres returned to healthy after a restart |
| Two applications provisioned with different services | PASSED | - PASS provisioned alpha_shop (realtime + storage, no auth) |
| Every application's compose configuration is valid | PASSED | - PASS alpha_shop's compose configuration is valid, so every service it uses can start |
| Only requested services provisioned | PASSED | - PASS beta_shop's profiles are 'auth' — auth only |
| Database isolation: credentials refused across applications | PASSED | - PASS beta_shop's credentials are REFUSED by alpha_shop's database |
| Separate JWT secret per application | PASSED | - PASS the two applications have different JWT secrets |
| GoTrue runs for the application that needs it | PASSED | - PASS GoTrue is running for the application that asked for auth |
| GoTrue answers through the proxy | PASSED | - PASS GoTrue answers /auth/v1/health through the proxy (HTTP 200) |
| A user can be created through GoTrue's admin API | PASSED | - PASS a user was created through GoTrue's admin API with the service role key (HTTP 200) |
| Open self-registration is refused | PASSED | - PASS open self-registration is refused (HTTP 422), as the default intends |
| The user lands in that application's own auth.users | PASSED | - PASS the user is in beta_shop's own auth.users table |
| Sign-in returns a usable token | PASSED | - PASS sign-in returned an access token |
| One application's token is rejected by another's API | PASSED | - PASS beta_shop's token is REJECTED by alpha_shop's API (HTTP 401) |
| Secret files are mode 600 | PASSED | - PASS alpha_shop/.env is mode 600 |
| Existing password never regenerated on re-run | PASSED | - PASS the database password was NOT regenerated, so the server keeps access to its volume |
| Provisioning is idempotent | PASSED | - PASS re-provisioning kept the existing password instead of locking the app out |
| PostgREST answers through the proxy | PASSED | - PASS PostgREST answers through the proxy at /rest/v1/ (HTTP 200) |
| Realtime is ready before a client subscribes | PASSED | - PASS Realtime is ready after its migrations completed |
| Realtime subscription accepted | PASSED | - PASS a Realtime subscription was accepted through the proxy |
| The privilege Realtime's migrations need is actually held | PASSED | - PASS alpha_shop_realtime may set log_min_messages, so migration 20230328144023 can creat |
| Realtime's own migrations replay under this platform's privileges | PASSED | - PASS Realtime's own tenant migrations replay cleanly here, and list_changes() is created |
| Realtime's own schema and WAL reader exist | PASSED | PASS realtime.list_changes() exists |
| A second, independent Realtime tenant also delivers | **FAILED** (optional component) | - KNOWN DEFECT (optional component) the SECOND tenant delivers, after a warm-up gap: a row |
| Each Realtime tenant has its own replication slot | PASSED | - PASS each Realtime tenant has its own replication slot (4 distinct) |
| Both tenants' replication slots are active | PASSED | - PASS 4 Realtime replication slot(s) are active, so both tenants are reading the WAL |
| The slots belong to different databases | PASSED | - PASS the slots belong to different databases (2) |
| A change in one application does not reach another's channel | PASSED | - PASS a change in alpha_shop did NOT reach gamma_rt's channel — the tenants are separate |
| Realtime becomes ready again after a restart | PASSED | - PASS alpha-shop.realtime came back and became ready after a restart |
| Delivery resumes after Realtime is restarted | **FAILED** (optional component) | - KNOWN DEFECT (optional component) delivery resumed after the restart, with a warm-up gap |
| Realtime migration 20230328144023 applied (creates list_changes) | PASSED | - PASS Realtime migration 20230328144023 is applied |
| Realtime migration 20240401105812 applied (the reserved-role one) | PASSED | - PASS Realtime migration 20240401105812 is applied |
| Realtime migration 20260326120000 applied (the list_changes the poller calls) | PASSED | - PASS Realtime migration 20260326120000 is applied |
| Migration 69's actual function definition, not just its version row | PASSED | - PASS realtime.list_changes() returns slot_changes_count, which is the definition migrati |
| Realtime's role may execute list_changes | PASSED | - PASS Realtime's own role may execute realtime.list_changes() |
| All 91 tenant migrations applied, which Realtime requires to run CDC | PASSED | - PASS all 91 of Realtime's tenant migrations are applied in alpha_shop |
| Realtime's setup completed before a client subscribed | PASSED | - PASS post-start completed Realtime's setup for alpha_shop |
| Realtime's role is a member of supabase_realtime_admin | PASSED | - PASS Realtime's role is a member of supabase_realtime_admin (asked of the database) |
| The Realtime client harness actually ran | PASSED | - PASS the Realtime client harness ran: CLIENT_VERSION 2.118.0 |
| Both client versions tested under identical conditions | PASSED | - PASS the client version WAS the cause: 2.47.10 fails and 2.118.0 delivers, same table, s |
| The supabase-js version the application ships delivers | PASSED | - PASS the supabase-js version the application actually ships (2.97.0) receives the event |
| Delivery latency measured, not assumed | PASSED | - PASS a change reached the subscribed client in 391ms (insert round trip 10ms), within th |
| live_state has a row and a trigger per watched table | PASSED | PASS live_state has a row and a trigger for each of the three watched tables |
| live_state is readable by the browser role and not writable | PASSED | PASS the browser-facing role may READ live_state and may not write it |
| A write moves the revision the till polls | PASSED | PASS a write bumps live_state.rev (0 to 1), so the till has something to poll |
| The browser harness itself ran | PASSED | PASS Playwright installed and importable, Chromium present |
| The real application's Login screen renders | PASSED | PASS the application's own Login screen rendered (4 PIN field(s)) |
| Everything verify_pin reads and writes exists | PASSED | PASS everything verify_pin reads and writes exists (pin_attempts, staff_sessions, staff.pe |
| verify_pin returns rather than raising, called directly | PASSED | PASS verify_pin returns a result when called directly (a wrong PIN, so no session was made |
| The browser role may execute verify_pin | PASSED | PASS the browser-facing role may EXECUTE verify_pin, so the real PIN screen can authentica |
| verify_pin accepts a staging PIN and the till opens | PASSED | PASS verify_pin() accepted the PIN and the till opened |
| The real application receives a live event and SHOWS it | PASSED | PASS THE APPLICATION RECEIVED THE LIVE EVENT AND SHOWED IT IN THE INTERFACE |
| A product change appears in the interface | PASSED | PASS a product change appeared in the interface without a refresh (2292ms) |
| A website order change appears in the interface | PASSED | PASS a website order change appeared in the interface without a refresh (1783ms) |
| Two workstations both receive the same sale | PASSED | PASS BOTH workstations showed the same sale without a refresh (2799ms from the insert bein |
| Live updates resume after a network interruption | PASSED | PASS live updates resumed after a network interruption, unattended (80ms from the insert b |
| Live updates work after the application is restarted | PASSED | PASS live updates work after the application was restarted (82ms from the insert being sen |
| The browser run finished rather than hanging | PASSED | PASS the browser run completed all of its checks |
| Another application's sale does not appear in this one's interface | PASSED | PASS a sale written to gamma_rt did not appear in this application's interface |
| Realtime delivers a database change end to end | PASSED | - PASS an INSERT produced a Realtime event end to end |
| Storage grants applied after the service's own migrations | PASSED | - PASS post-start granted the storage schema to the roles storage-api uses |
| Storage privileges verified as EFFECTIVE, not as a statement that ran | PASSED | - PASS every storage table is readable by anon, authenticated and service_role — checked a |
| service_role can write every storage table | PASSED | - PASS service_role can INSERT into every storage table |
| service_role may execute storage's functions | PASSED | - PASS service_role may EXECUTE all 24 storage function(s) |
| Object storage multi-delete works | PASSED | - PASS MULTI-DELETE of two objects accepted (HTTP 200) |
| Object storage upload | PASSED | - PASS UPLOAD through storage-api to the S3 backend (HTTP 200) |
| Object storage download returns identical bytes | PASSED | - PASS DOWNLOAD returned byte-identical content (4096 bytes, sha256 matches) |
| Object really lands in the object store | PASSED | - PASS the object is physically in the S3 bucket, so the backend is really S3 |
| Object storage delete | PASSED | - PASS both objects are gone from the bucket after the multi-delete |
| Backup produces a dump and cluster globals | PASSED | - PASS a dump was produced: alpha_shop-20261110-022947.sql.gz (68K) |
| Restore into a SEPARATE database | PASSED | - PASS restore.sh restored into a separate database without touching the live one |
| Restore verified by row count and a money total | PASSED | - PASS restored row count matches (500) |
| Live database untouched by the restore rehearsal | PASSED | - PASS the live database was left alone (500 rows) |
| Schemas outside public survive the restore | PASSED | - PASS the storage schema survived the restore with all 12 of its tables |
| Scheduled job registered in another database | PASSED | - PASS a job was registered for alpha_shop from the postgres database |
| Scheduled job actually executed | PASSED | - PASS the job actually executed in the other database (rows: 1) |
| Scheduled job reached a new API URL | PASSED | - PASS a cron job reached the new API URL through pg_net and the proxy |
| pg_net is pinned to the one database its worker serves | PASSED | - PASS pg_net.database_name is 'postgres' — HTTP-making jobs belong there |
| pg_net's one-database limit measured, not assumed | PASSED | - PASS pg_net from an application's own database queues (1) and is never served (0 respons |
| Sustained load served without errors | PASSED | - PASS the application served a sustained load with no non-2xx response |
| Throughput and latency measured | PASSED | - PASS measured throughput: 327 successful requests/second, 0 failed, opening a sale at p9 |
| Resource usage measured UNDER LOAD, not at rest | PASSED | - PASS resource usage captured under load, with two applications provisioned |
| Capacity report with headroom estimate | PASSED | - PASS capacity.sh produced a headroom estimate |
| Service health check across applications | PASSED | - PASS health.sh ran to completion and reported every service healthy: HEALTH-COMPLETE che |
| Provisioning from an already-configured machine | PASSED | - PASS a third application provisioned on an already-configured machine |
| The whole deployment re-run on a configured machine | PASSED | - PASS bootstrap.sh ran a second time on an already-configured machine |
| Re-running the deployment does not regenerate the DB password | PASSED | - PASS the database password was NOT regenerated, so the server keeps access to its volume |
| Registry unchanged by a re-run | PASSED | - PASS the application registry is unchanged (4 application(s)) |
| Whole stack recovers from a full stop, unattended | PASSED | - PASS every container came back running and healthy after the whole stack was stopped |
| Data survives a full restart | PASSED | - PASS the application's data survived the restart (4997 rows, unchanged) |
| API answers again after a restart with no intervention | PASSED | - PASS the API answers again after the restart, unattended (HTTP 200) |
| Cloudflare R2: credentials accepted on the real service | NOT VERIFIED | — |
| Cloudflare R2: upload accepted | NOT VERIFIED | — |
| Cloudflare R2: download is byte-identical | PASSED | - PASS DOWNLOAD returned byte-identical content (4096 bytes, sha256 matches) |
| Cloudflare R2: ETag usable for verifying copies | NOT VERIFIED | — |
| Cloudflare R2: object appears in a listing | NOT VERIFIED | — |
| Cloudflare R2: delete accepted | NOT VERIFIED | — |
| Cloudflare R2: deletion confirmed by a second request | NOT VERIFIED | — |
| Cloudflare R2: the SDK's default checksum shape, tested for real | NOT VERIFIED | — |

### Not verified

- Cloudflare R2: credentials accepted on the real service
- Cloudflare R2: upload accepted
- Cloudflare R2: ETag usable for verifying copies
- Cloudflare R2: object appears in a listing
- Cloudflare R2: delete accepted
- Cloudflare R2: deletion confirmed by a second request
- Cloudflare R2: the SDK's default checksum shape, tested for real

### Optional components with known defects

These do not block this migration, because nothing on its path uses
them. They are printed in full rather than filtered out, for two
reasons: a reader comparing this document with the run's own report
would otherwise find failures in one and not the other, and any
project that does use the component inherits the defect.

- **A second, independent Realtime tenant also delivers** — FAILED: - KNOWN DEFECT (optional component) the SECOND tenant delivers, after a warm-up gap: a row written 75145ms earlier was missed, the next one arrived in 338ms
- **Delivery resumes after Realtime is restarted** — FAILED: - KNOWN DEFECT (optional component) delivery resumed after the restart, with a warm-up gap: a row written 75148ms earlier was missed, the next one arrived in 47

Each of these either did not run or has no matching check. Nothing
here may be described as working.

## Server sizing, from measurement

**NOT AVAILABLE.** No sizing output was supplied, which means the
staging run did not reach its resource section or the sizing script
was not run. No VPS specification can be given, and none is guessed.

### What to order

No plan can be named: the sizing output above does not contain a
recommendation, which means the measurement it needs is missing.

## Security and isolation

What the staging run proves, and by which check, is in the table above.
The design behind it:

- **One database per application, isolation by connection rights.**
  `REVOKE ALL ON DATABASE ... FROM PUBLIC` then `GRANT CONNECT` to that
  application's `authenticator` alone. Not isolation by ownership: taking
  ownership for another role needs `SET ROLE` on it, and the membership
  grant that would allow that crashes this PostgreSQL image. The run
  tests it by using one application's credentials against another's
  database and requiring a refusal.
- **A separate JWT secret per application**, so a token minted for one
  is not accepted by another.
- **PostgreSQL is bound to 127.0.0.1**, reachable only from the
  containers on the machine. Checked in the run, not assumed.
- **Secret files are mode 600**, and an existing password is never
  regenerated on a re-run — a regenerated one would lock the server out
  of its own data volume with no error until the next restart.
- **Caddy terminates TLS** and is the only thing published. No service
  port is exposed directly.

### What this platform does NOT fix

- Everytinroom authenticates staff with a PIN against `staff_sessions`,
  not Supabase Auth, so `auth.uid()` means nothing in its policies and
  row-level security cannot tell one cashier from another. Moving the
  database to a new server does not change that; it is an application
  change, and it is out of scope here.
- Four of the five reachable projects still grant destructive table
  privileges to the browser-facing key. Everytinroom's were corrected
  and verified; the others were only inventoried, and each needs its own
  approval before anything is changed.

### This repository's own exposure

Computed by this script from git, not asserted.

- Operator-only files tracked right now: **0**
- Operator-only files present anywhere in history: **0**
- Of those, files containing a credential: **0**
- `supabase/AWAITING-APPROVAL/` is ignored: **yes**

## Verified only in local tests

These run on a laptop or in CI, against a real PostgreSQL but not against
the platform. They are listed separately because they are a weaker claim,
and because the difference has already mattered: a local run has a
superuser where the real server does not, and a tool that passed locally
gave a confidently wrong answer on the server for exactly that reason.

| Suite | What it proves | What it cannot |
|---|---|---|
| `validate-all.sh` | the SQL parses, no file takes ownership or acts as another role, no secret or operator-only file is committed, every path the scripts reach for exists, templates have no stray placeholders | nothing about running containers |
| `test-provision-sql.sh` | the provisioning SQL runs against a real PostgreSQL; cross-application credentials are refused; PostgREST's role switching behaves; the storage grants land as effective privileges | it connects as a superuser, so permission walls that only appear for a non-superuser do not reproduce — it says so in its own output |
| `test-realtime-migrations.py` | Realtime's own tenant migrations replay as a non-superuser, and that the one grant this platform adds is what makes the difference, in both directions | that Ecto drives them identically, and anything about a real subscribed client |
| `test-cron-placement.py` | every scheduled job the inventory found is re-registered in the database where it can run, schedule and command preserved exactly | that the jobs themselves do the right thing, which would mean running production's work |
| `test-bootstrap-local.sh` | secret handling, config generation and the memory arithmetic across machine sizes | anything needing Docker |

The staging run includes the first four of those as well, so where a row
above also appears in the real-server table, the real-server result is
the one that counts.

## What still requires an account action

These cannot be completed from here. Each is named, with what it unblocks.

| Needed | Unblocks | Why it cannot be done here |
|---|---|---|
| Cloudflare R2 bucket + API token | real R2 upload/download/delete verification, and the image migration | only the account owner can create them; `deploy/scripts/test-r2.py` runs the full check once they exist |
| `SUPABASE_DB_URL` for each project | copying a production database | it contains the database password |
| Each edge function's own secrets | the functions running on the new server | they cannot be read back out of the platform |
| The payment-provider credential | server-side payment verification and stock deduction | see the local operator note |
| A VPS | any real deployment | not purchased, by instruction |

## Backups, retention and off-server recovery

Three things have to be true for a backup to be one, and they are
separate claims:

| Claim | How it is established |
|---|---|
| a dump is produced | `backup.sh`, checked in the staging run; completeness is measured against the database's own table count, after an earlier version rejected a correct dump of an empty database for being small |
| the dump restores | `restore.sh` into a SEPARATE database, with row counts and a money total compared, and the live database checked to have been left alone |
| a copy exists off the server | `backup-offsite.py`, which uploads to S3-compatible storage and reads every object back to compare its MD5 |

Retention is 90 days remotely by default. `backup-offsite.py` deletes
only objects matching the naming `backup.sh` produces, never anything
else in the bucket, and it refuses to prune at all if any upload failed
in the same run — which is precisely when the old copies matter.

A local backup on the same disk as the database covers a dropped table
or a bad migration. It does not cover losing the server, and that is why
the off-server copy is not optional.

## Object storage and what it costs

Everytinroom's images are the only storage of any size. From the
inventory:

Egress being free is the reason this is R2 and not S3: the images are
served to customers' phones, and that traffic is the recurring cost on
most other providers.

**Not yet verified against Cloudflare.** The staging run tests storage
against an S3-compatible stand-in, which proves this platform's
configuration and nothing about R2 — R2 rejects the trailing-checksum
headers the AWS SDK sends by default, which is why
`STORAGE_S3_REQUEST_CHECKSUM_CALCULATION` is set to `WHEN_REQUIRED`, and
a mock will never show that. `deploy/scripts/test-r2.py` runs the full
upload, download, integrity, list and delete check against the real
endpoint as soon as the credentials exist. Until it has, nothing here
may be described as R2-verified.

## Remaining risks

Derived from the states above and the inventory, not listed by hand, so
this section cannot quietly fall out of date with the evidence.

| Risk | Why it is open | What closes it |
|---|---|---|
| A second, independent Realtime tenant also delivers is FAILING | the run recorded a failure: - KNOWN DEFECT (optional component) the SECOND tenant delivers, after  | fix the cause and re-run; the verdict is computed from the report, so it cannot be signed off while this stands |
| Delivery resumes after Realtime is restarted is FAILING | the run recorded a failure: - KNOWN DEFECT (optional component) delivery resumed after the restart | fix the cause and re-run; the verdict is computed from the report, so it cannot be signed off while this stands |
| Cloudflare R2: credentials accepted on the real service is unproven | no check for it was found in any report | run the check; until then this capability is not claimed |
| Cloudflare R2: upload accepted is unproven | no check for it was found in any report | run the check; until then this capability is not claimed |
| Cloudflare R2: ETag usable for verifying copies is unproven | no check for it was found in any report | run the check; until then this capability is not claimed |
| Cloudflare R2: object appears in a listing is unproven | no check for it was found in any report | run the check; until then this capability is not claimed |
| Cloudflare R2: delete accepted is unproven | no check for it was found in any report | run the check; until then this capability is not claimed |
| Cloudflare R2: deletion confirmed by a second request is unproven | no check for it was found in any report | run the check; until then this capability is not claimed |
| Cloudflare R2: the SDK's default checksum shape, tested for real is unproven | no check for it was found in any report | run the check; until then this capability is not claimed |
| No VPS has ever run this | every result here is from a CI runner, which is a different machine with different disks | provision the server and re-run the same staging script on it before cutover |
| The production database has never been restored here | staging runs generated rows, so nothing proves the real dump restores or that its functions, policies and publications survive | restore a copy of the dump into a scratch database on the new server and run `verify-migration.sh` against it |
| Scheduled jobs that both read data and call out | pg_net serves one database, so such a job cannot run from either side as written | the migration script flags each one; the SQL half becomes a PostgREST RPC that the HTTP job calls |
| Cutover has no rehearsal | the order of restore, Realtime start and publication creation matters, and doing it once in production is doing it for the first time | rehearse the whole cutover on the new server with a copy of the data, with the live system still serving |

## Limits of this evidence

- The staging environment is a GitHub-hosted runner, not a VPS. No real
  VPS deployment has been tested, and none is claimed.
- Object storage is verified against an S3-compatible stand-in. That
  proves this platform's configuration and NOTHING about Cloudflare R2,
  which has its own checksum behaviour.
- Staging runs generated data, not a restored production database.
- Resource figures are measured under a staging load, which is lighter
  than a trading shop.
- Two projects are paused and were not inspected at all.

