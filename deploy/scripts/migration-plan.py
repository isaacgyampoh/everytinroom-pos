#!/usr/bin/env python3
"""
Turn the inventory into a per-project migration plan and readiness report.

    export SUPABASE_ACCESS_TOKEN=sbp_...
    deploy/scripts/inspect-supabase.py --json /tmp/inv.json --out /dev/null
    deploy/scripts/migration-plan.py /tmp/inv.json --out-dir /tmp/plans

Steps 6 and 11 of the migration framework: generate a migration plan, and
produce a readiness report. It reads the inventory and writes, per project:

    <name>/PLAN.md        the ordered steps, with the real commands
    <name>/READINESS.md   what is ready, what is blocked, what it will cost

READ-ONLY. It touches no database and no server; it reads a JSON file.

A plan is only as good as its refusals, so this is deliberately blunt about
what it does NOT know: anything needing a credential it has never seen is
listed as a blocker rather than assumed to be fine.
"""

import argparse
import json
import os
import pathlib
import sys

# Contabo's published plans, 24-month term, from contabo.com/en-us/pricing
# as read on 2026-11-08. Re-check before committing money.
VPS = [
    ("Cloud VPS 4", 4, 8192, 100, 4.40),
    ("Cloud VPS 6", 6, 12288, 200, 6.00),
    ("Cloud VPS 8", 8, 24576, 300, 11.20),
    ("Cloud VPS 12", 12, 49152, 400, 20.00),
    ("Cloud VPS 16", 16, 65536, 500, 29.60),
]

# What PostgreSQL itself wants, before any application service. From
# deploy/lib/tuning.sh: Postgres takes about three quarters of RAM, of which
# shared_buffers is a third.
PG_OVERHEAD_MB = 1024      # the server process and its workers at rest
CADDY_MB = 64
OS_MB = 512


def pick_vps(total_service_mb, total_disk_gb):
    """Smallest plan that fits, with headroom. Returns (plan, reason)."""
    need_ram = total_service_mb + PG_OVERHEAD_MB + CADDY_MB + OS_MB
    # Leave a third spare: a server at 90% has no room to take a backup or
    # restore a dump, which are exactly the moments it matters.
    need_ram_with_headroom = int(need_ram * 1.5)
    for name, cpu, ram, disk, price in VPS:
        if ram >= need_ram_with_headroom and disk >= total_disk_gb * 3:
            return (name, cpu, ram, disk, price), (
                f"needs ~{need_ram} MB of service memory; this plan has {ram} MB, "
                f"leaving {ram - need_ram} MB spare")
    n, c, r, d, p = VPS[-1]
    return (n, c, r, d, p), "nothing in the range fits comfortably; this is the largest"


def plan_for(p):
    """The ordered migration steps for one project."""
    name = p["name"]
    slug = "".join(ch if ch.isalnum() else "_" for ch in name.lower()).strip("_")[:31]
    if slug and slug[0].isdigit():
        slug = "app_" + slug
    needs = p.get("needs", [])
    flags = p.get("flags", [])

    L, A = [], None
    A = L.append
    A(f"# Migration plan — {name}")
    A("")
    A(f"Project ref `{p['ref']}` · region {p.get('region')} · {p.get('db_size_mb')} MB "
      f"database · {p.get('storage_mb')} MB storage")
    A("")
    A("Generated from the inventory. Every command below is real; none of them")
    A("has been run against this project.")
    A("")
    A("## What this project actually needs")
    A("")
    A(f"`{', '.join(needs)}`")
    A("")
    A("Decided by measurement, not by what a Supabase install includes:")
    A("")
    A(f"- PostgREST: always — it is the data API ({p.get('tables')} tables, {p.get('functions')} functions)")
    rt = p.get("realtime_tables") or []
    A(f"- Realtime: {'YES — ' + str(len(rt)) + ' published tables (' + ', '.join(rt[:4]) + ')' if rt else 'no — no table is in a publication'}")
    A(f"- Storage: {'YES — ' + str(p.get('storage_mb')) + ' MB across ' + str(len(p.get('buckets') or [])) + ' buckets' if 'storage' in needs else 'no — no bucket holds objects'}")
    A(f"- Edge functions: {'YES — ' + ', '.join(p.get('edge_functions') or []) if 'functions' in needs else 'no — none deployed'}")
    A(f"- GoTrue: {'YES — ' + str(p.get('auth_users')) + ' users in auth.users' if 'gotrue' in needs else 'NO — auth.users is empty' + (', sign-in is custom (' + ', '.join(p.get('custom_auth_tables') or []) + ')' if p.get('custom_auth_tables') else '')}")
    A(f"- pg_cron: {'YES — ' + str(len(p.get('cron_jobs') or [])) + ' jobs' if 'cron' in needs else 'no jobs'}")
    A("")
    A("## Steps")
    A("")
    A("### 1. Provision the isolated database and services")
    A("")
    A("```")
    A(f"/srv/central/provision-app.sh \\")
    A(f"  --name {slug} \\")
    A(f"  --domain api.CHANGEME \\")
    for f_, flag in (("realtime", "--realtime"), ("storage", "--storage"),
                     ("functions", "--functions"), ("gotrue", "--auth")):
        if f_ in needs:
            A(f"  {flag} \\")
    A("  --no-start")
    A("```")
    A("")
    A(f"Gives `{slug}` its own database, its own `{slug}_authenticator` role with")
    A("CONNECT on nothing else, and its own JWT secret.")
    A("")
    A("### 2. Copy the data")
    A("")
    A("```")
    A("read -rs SUPABASE_DB_URL && export SUPABASE_DB_URL   # keeps it out of history")
    A(f"/srv/central/scripts/migrate-from-supabase.sh --app {slug}")
    A("```")
    A("")
    A("Reads the source only. Reconciles row counts and a money total afterwards")
    A("and exits non-zero if anything differs.")
    A("")
    if "cron" in needs:
        hard = [j for j in (p.get("cron_jobs") or []) if j.get("hardcodes_project_url")]
        A("### 3. Scheduled jobs")
        A("")
        A(f"{len(p.get('cron_jobs') or [])} jobs. They are NOT carried by a schema dump —")
        A("pg_cron keeps them in the `postgres` database, not the application's.")
        A("")
        if hard:
            A(f"**{len(hard)} of them hardcode the old project URL inside the job body**:")
            for j in hard:
                A(f"- `{j['name']}` at `{j['schedule']}`")
            A("")
            A("Left alone, after cutover these keep calling the old backend and nothing")
            A("errors — the reports simply come from the wrong place. The migration")
            A("script writes them to a file for review rather than applying them.")
            A("")
        A("They also need rewriting from `cron.schedule()` to")
        A("`cron.schedule_in_database(..., '" + slug + "')`, because the scheduler runs in")
        A("the `postgres` database on the central server.")
        A("")
    if "storage" in needs:
        A("### 4. Object storage")
        A("")
        for b in (p.get("buckets") or []):
            if (b.get("objects") or 0) > 0:
                A(f"- `{b['name']}`: {b['objects']} objects, {b['mb']} MB")
        A("")
        total = p.get("storage_mb") or 0
        if total <= 10240:
            A(f"{total} MB fits inside Cloudflare R2's 10 GB free tier, and R2 charges")
            A("nothing for egress. Expected cost: **$0**.")
        else:
            over = (total - 10240) / 1024
            A(f"{total} MB exceeds R2's 10 GB free tier by {over:.1f} GB, which is")
            A(f"about **${over * 0.015:.2f}/month** at $0.015 per GB-month.")
        A("")
        A("Files are copied to R2 and verified BEFORE any application reference")
        A("changes, and the originals are not deleted.")
        A("")
    A("### 5. Verify before anything is switched")
    A("")
    A("```")
    A(f"/srv/central/scripts/migrate-from-supabase.sh --app {slug} --verify-only")
    A(f"/srv/central/scripts/backup.sh --app {slug} --verify")
    A(f"/srv/central/scripts/restore.sh --app {slug} --file <newest dump>   # rehearses")
    A("/srv/central/scripts/health.sh")
    A("/srv/central/capacity.sh")
    A("```")
    A("")
    A("### 6. Cutover — needs separate authorization")
    A("")
    A("Point the frontend's build environment at the new API, deploy it, watch it,")
    A("and only then change DNS. The old backend keeps running throughout, so the")
    A("rollback is to put the old URL back and redeploy.")
    A("")
    if flags:
        A("## Known obstacles")
        A("")
        for f in flags:
            A(f"- {f}")
        A("")
    return slug, "\n".join(L)


def readiness_for(p, slug):
    needs = p.get("needs", [])
    svc_mb = p.get("est_service_mb") or 0
    L, A = [], None
    A = L.append
    A(f"# Readiness — {p['name']}")
    A("")
    A("| | |")
    A("|---|---|")
    A(f"| Database | {p.get('db_size_mb')} MB, {p.get('tables')} tables |")
    A(f"| Storage | {p.get('storage_mb')} MB |")
    A(f"| Services | {', '.join(needs)} |")
    A(f"| Service memory ceiling | {svc_mb} MB |")
    A("")
    A("## Ready")
    A("")
    ready = [
        "an isolated database, role and JWT secret — provisioning is tested",
        "backup and restore scripts, with the restore rehearsing into a separate database by default",
        "a read-only migration script that reconciles row counts and a money total",
        "health and capacity reporting",
    ]
    for r in ready:
        A(f"- {r}")
    A("")
    A("## Blocked, and on what")
    A("")
    blockers = []
    blockers.append(("database password", "The migration needs `SUPABASE_DB_URL` from "
                     "Settings → Database. It contains the password, so it is read from "
                     "the environment and never stored."))
    if "storage" in needs:
        blockers.append(("Cloudflare R2 credentials", "A bucket and an API token. Until "
                         "those are set, storage starts but every upload fails."))
    if "functions" in needs:
        fns = ", ".join(p.get("edge_functions") or [])
        blockers.append(("edge function sources and secrets",
                         f"Deployed: {fns}. The sources download with the Supabase CLI, "
                         f"but each function's secrets must be set by hand — they cannot "
                         f"be read back out of the platform."))
    if "gotrue" in needs:
        blockers.append(("auth migration", f"{p.get('auth_users')} users in auth.users. "
                         "Password hashes move with the dump, but any external provider "
                         "and SMTP must be reconfigured."))
    if p.get("applied_migrations") is None:
        blockers.append(("no migration history", "There is no `supabase_migrations` "
                         "schema, so the live database is the only authoritative source. "
                         "Migrate from a dump, never by replaying migration files."))
    for t, d in blockers:
        A(f"- **{t}** — {d}")
    A("")
    A("## Not yet proven for this project")
    A("")
    A("- No dump of this database has been restored on the platform.")
    A("- Its application has not been pointed at the platform.")
    A(f"- {'Realtime has not been tested with its tables.' if 'realtime' in needs else 'Realtime is not needed.'}")
    A("")
    A("The platform's own integration tests run on a disposable Linux machine and")
    A("cover provisioning, isolation, Realtime, storage, backup and restore. That")
    A("is the platform, not this project's data.")
    A("")
    return "\n".join(L)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("inventory", help="the --json output of inspect-supabase.py")
    ap.add_argument("--out-dir", default="migration-plans")
    args = ap.parse_args()

    with open(args.inventory) as f:
        projects = json.load(f)
    out = pathlib.Path(args.out_dir)
    out.mkdir(parents=True, exist_ok=True)

    reachable = [p for p in projects if p.get("reachable")]
    total_svc = sum(p.get("est_service_mb") or 0 for p in reachable)
    total_disk_gb = max(1, int(sum((p.get("db_size_mb") or 0) + (p.get("storage_mb") or 0)
                                   for p in reachable) / 1024) + 1)

    for p in projects:
        if not p.get("reachable"):
            continue
        slug, plan = plan_for(p)
        d = out / slug
        d.mkdir(exist_ok=True)
        (d / "PLAN.md").write_text(plan + "\n")
        (d / "READINESS.md").write_text(readiness_for(p, slug) + "\n")
        print(f"  {p['name']:<40} -> {d}/")

    chosen, reason = pick_vps(total_svc, total_disk_gb)
    name, cpu, ram, disk, price = chosen
    one = [p for p in reachable if (p.get("db_size_mb") or 0) > 0]
    first = max(one, key=lambda x: x.get("storage_mb") or 0) if one else None
    first_vps, first_reason = pick_vps(first.get("est_service_mb") if first else 0, 2)

    S, A = [], None
    A = S.append
    A("# Server sizing and cost")
    A("")
    A("Derived from the inventory, not chosen first and justified afterwards.")
    A("")
    A(f"{len(reachable)} reachable projects. Service memory ceilings add up to")
    A(f"**{total_svc} MB ({total_svc/1024:.1f} GB)**, and all their data together is about")
    A(f"**{total_disk_gb} GB**.")
    A("")
    A("Those are compose limits — ceilings, not measured usage. The measured")
    A("figures come from the staging run.")
    A("")
    A("## If only the first project moves")
    A("")
    fn, fc, fr, fd, fp = first_vps
    A(f"**{fn}** — {fc} vCPU, {fr} MB RAM, {fd} GB — **${fp:.2f}/month, ${fp*12:.2f}/year**")
    A("")
    A(f"{first_reason}")
    A("")
    A("## If every project eventually moves")
    A("")
    A(f"**{name}** — {cpu} vCPU, {ram} MB RAM, {disk} GB — **${price:.2f}/month, ${price*12:.2f}/year**")
    A("")
    A(f"{reason}")
    A("")
    A("## The rest of the bill")
    A("")
    A("| Item | Monthly |")
    A("|---|---|")
    A(f"| VPS ({name}) | ${price:.2f} |")
    tot_storage_gb = sum(p.get("storage_mb") or 0 for p in reachable) / 1024
    r2 = max(0.0, (tot_storage_gb - 10) * 0.015)
    A(f"| Cloudflare R2 ({tot_storage_gb:.1f} GB, 10 GB free, egress free) | ${r2:.2f} |")
    A("| Cloudflare DNS and TLS | $0.00 |")
    A("| Let's Encrypt certificates | $0.00 |")
    A(f"| **Total** | **${price + r2:.2f}** |")
    A("")
    A(f"Annual: **${(price + r2) * 12:.2f}**")
    A("")
    A("No paid API, no subscription, no per-seat licence. Everything in the stack")
    A("is open source: PostgreSQL, PostgREST, Realtime, GoTrue, storage-api,")
    A("imgproxy and Caddy. Image transformations, which are a billed add-on on")
    A("hosted Supabase, become CPU already paid for.")
    A("")
    A("## Growing out of it")
    A("")
    A("Contabo resizes a VPS in place. Stop the stack, resize, start it, re-run")
    A("`bootstrap.sh` — it recalculates PostgreSQL's memory for the new machine.")
    A("No database, secret or application configuration changes. `capacity.sh`")
    A("reports how many more applications fit and which resource binds first.")
    A("")
    (out / "SIZING-AND-COST.md").write_text("\n".join(S) + "\n")
    print(f"  {'sizing and cost':<40} -> {out}/SIZING-AND-COST.md")


if __name__ == "__main__":
    main()
