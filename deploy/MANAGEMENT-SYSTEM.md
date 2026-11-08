# Central management system — architecture and requirements

A separate application for managing every project from one place: what is
deployed, whether it is healthy, what customers owe, and what needs attention.

**Not built yet.** This is the design and the requirements, as asked for in
Phase 5. It is written after building the hosting platform, so the shape it
takes is driven by what the platform actually exposes rather than by a wish
list.

---

## The one decision that matters most

**The management system must not hold infrastructure credentials, and its
frontend must never see them.**

It is tempting to give a dashboard the database password and the server's SSH
key so it can "just read everything". That turns one browser session into
total control of every business on the server. The design below inverts it:

- the **server pushes** facts outward into the management database
- the management app **reads rows**, and holds no credential for anything it
  reports on
- there is no code path from the dashboard to a production database

So a compromise of the dashboard costs you the dashboard's own data — which is
serious, because that includes customer billing — and not the five businesses
it watches.

### A second thing that is easy to get wrong

If the management system runs on the central server and the central server goes
down, **the thing that tells you it is down goes down with it.** Self-hosted
monitoring that reports on its own host is not monitoring.

So uptime and "is the server alive" checks come from **outside**: a scheduled
GitHub Actions workflow (free on a public repository, already in use for the
integration tests) hits each project's health endpoint and the server's
`/healthz`, and alerts if a check fails or if the server has stopped pushing
metrics. Everything else — capacity history, backup status, customer records —
lives on the server, because it is only interesting when the server is up.

---

## Where it runs

Another application on the central platform, provisioned the same way as any
other:

```
/srv/central/provision-app.sh --name central_admin \
  --domain admin.CHANGEME --auth --no-start
```

It gets its own database, its own `central_admin_authenticator` role with
CONNECT on nothing else, and its own JWT secret — the same isolation every
other project gets, tested by `deploy/scripts/test-provision-sql.sh`.

It needs `--auth`. This is the one application here that has real human users
with passwords and roles, so GoTrue earns its 512 MB. (That service was added
to the platform because inspecting the account found two existing projects
already using it — see `inspect-supabase.py`.)

**Its database must hold nothing else.** It will contain customer names,
amounts owed and payment history, which is the most sensitive data on the
server. Isolation is not optional for it.

---

## How facts get in

Three sources, all push-based, none of which lets the dashboard reach out.

### 1. The host agent

A cron job on the server — not a service the dashboard can call:

```
*/5 * * * * root /srv/central/capacity.sh --json | \
  /srv/central/scripts/push-metrics.sh
```

`capacity.sh --json` already produces exactly what is needed: memory, CPU,
disk, database sizes, connection counts, container health, network totals,
backup age and the headroom estimate, with an overall verdict. `--json` exists
today; `push-metrics.sh` is the piece to write, and it is small: POST the
document to `/rest/v1/metric_snapshots` with a service token that can INSERT
into that one table and read nothing.

That token is the only credential involved, it lives in a mode-600 file on the
server, and its blast radius is "can add a metrics row".

### 2. The external watcher

A scheduled workflow, outside the server:

- `GET https://<each project>/rest/v1/` — expect 200 or 404, not a timeout
- `GET https://<server>/healthz` — expect `ok`
- check the newest `metric_snapshots` row is less than 15 minutes old; if the
  agent has gone quiet, that is itself the alert

### 3. Deployment and security events

- `provision-app.sh` and `migrate-from-supabase.sh` write an audit row on
  completion, success or failure
- a weekly workflow runs `npm audit` and a secret scan across each repository
  and records findings
- `backup.sh` writes its outcome, so "the backup failed" is a fact rather than
  something nobody noticed

---

## Data model

Sketched, not final. One schema, RLS on every table, no table readable by
`anon`.

```
projects            name, repo, production_url, hosting_provider, database,
                    required_services[], storage_mb, integrations[],
                    migration_status, estimated_ram_mb, estimated_cost
                    -- seeded from inspect-supabase.py, which already
                    -- produces every one of these fields

deployments         project_id, version, deployed_at, deployed_by, outcome,
                    commit_sha, notes

metric_snapshots    captured_at, overall, memory_pct, cpu_pct, disk_pct,
                    db_connections, db_total_mb, containers_unhealthy,
                    backup_age_hours, headroom_apps, headroom_limit, raw jsonb
                    -- one row per 5 minutes; see retention below

health_checks       project_id, checked_at, source ('internal'|'external'),
                    status_code, ok, latency_ms

security_findings   project_id, kind ('dependency'|'exposed_secret'|
                    'privilege'|'other'), severity, title, detail,
                    first_seen, resolved_at

customers           name, contact, notes
subscriptions       customer_id, project_id, package, modules[],
                    installed_at, activated, expires_on, amount_due, currency
payments            subscription_id, paid_on, amount, method, reference
                    -- outstanding balance is derived, never stored: a stored
                    -- balance and a payment history WILL disagree eventually

notifications       kind, severity, subject, body, created_at, sent_at,
                    channel, acknowledged_at
audit_log           actor, action, target, at, detail jsonb
app_users           -- GoTrue's auth.users holds credentials
                    -- this holds role: 'owner' | 'operator' | 'viewer'
```

**Retention.** A snapshot every five minutes is ~105,000 rows a year. Keep raw
rows for 14 days, then roll up to hourly averages. Without that, the management
database quietly becomes the largest thing on the server — which would be a
funny way for a capacity monitor to cause a capacity problem.

---

## Access control

Three roles, enforced in SQL and not in the browser:

| | viewer | operator | owner |
|---|---|---|---|
| see project list, health, capacity | yes | yes | yes |
| see customer records and balances | no | yes | yes |
| record a payment | no | yes | yes |
| change subscription terms or prices | no | no | yes |
| see the audit log | no | no | yes |
| manage users and roles | no | no | yes |

The rule learned from Everytinroom applies here with force: **a permission
check in the browser is a convenience, not a control.** Everytinroom's nav hid
admin pages from cashiers while the pages stayed reachable by typing the URL,
and its anon key could read the whole ledger. So:

- every table has RLS, and policies key off `auth.uid()` and the role in
  `app_users` — which works here because this application really does use
  GoTrue, unlike the POS
- financial writes go through `SECURITY DEFINER` functions that check the role,
  so "record a payment" is one auditable entry point
- `anon` gets nothing: no SELECT on any table in this schema
- no table grants TRUNCATE to anybody but the owner role (the central server
  had TRUNCATE open to its public key on 21 tables; that is fixed, and this
  schema starts correct)

---

## Notifications

Through channels that already exist and already cost nothing extra:

| Event | Channel | Urgency |
|---|---|---|
| a project stops answering | SMS, then email | immediate |
| the server stops pushing metrics | SMS | immediate |
| a backup failed, or none for 30h | email | same day |
| capacity warning (`capacity.sh` exits 1) | email | same day |
| capacity critical (exits 2) | SMS | immediate |
| a security finding appears | email | same day |
| a renewal is 30, 14 and 7 days away | email | scheduled |
| a payment is overdue | email, then SMS at 14 days | scheduled |

SMS reuses mNotify, which is already configured and paid for on two projects.
Email goes over SMTP. **No new paid service**, per the standing rule.

Two properties that matter more than the list:

- **Deduplicate.** One outage must not send forty messages. A notification
  carries a kind and a target, and a repeat inside a cooling-off window updates
  the existing row instead of sending again.
- **An unsent notification is a bug.** `sent_at` being null for more than a few
  minutes is itself an alert condition, or the first thing you will never hear
  about is the thing that stops notifications working.

---

## What to build, in order

Each step is useful on its own, and none of it needs the server bought first.

1. **`push-metrics.sh` plus the `metric_snapshots` table.** `capacity.sh
   --json` already produces the data. This gives capacity history immediately,
   with no frontend at all.
2. **The external watcher workflow.** Uptime alerting that does not depend on
   the server it watches.
3. **`projects` seeded from `inspect-supabase.py`.** The inventory already
   produces every field; this makes it queryable instead of a file.
4. **A read-only dashboard.** Projects, health, capacity, backup status. No
   writes, so no risk, and it is immediately the thing worth having.
5. **Customers, subscriptions and payments**, with the role model and the
   `SECURITY DEFINER` write path.
6. **Notifications.**
7. **Security findings**, fed by the dependency and secret scans.

Steps 1 to 3 are worth doing before the Contabo server exists: they run against
the staging environment and against the existing Supabase projects as they are.

---

## Honest limits

- A dashboard on the same server as the applications shares their fate. The
  external watcher covers "is it up"; it does not cover "the dashboard is up
  but wrong".
- Capacity numbers are a snapshot every five minutes. A spike between
  snapshots is invisible.
- Dependency scanning finds published vulnerabilities in declared
  dependencies. It does not find a flaw in your own code, and a clean report
  is not a secure application.
- Renewal and payment tracking is a record of what you entered. It is not an
  accounting system and should not be treated as one.
