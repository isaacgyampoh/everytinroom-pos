#!/usr/bin/env python3
"""
Check that every scheduled job the inventory found is re-registered correctly:
right database, schedule and command preserved exactly, nothing lost, nothing
duplicated.

    deploy/scripts/test-cron-placement.py --inventory /tmp/inventory.json

WHY EACH JOB, AND NOT A SAMPLE
    pg_net's worker serves one database. A job that makes an HTTP call has to
    be registered in `postgres`; a job that only runs SQL belongs in its
    application's own database. Put the wrong way round, an HTTP job queues a
    request and is never served: no error, no response, no request, and a
    report that silently stops arriving. migrate-from-supabase.sh used to
    rewrite every job the second way.

    There is no sampling that makes that safe. Each job is checked.

WHAT IT RUNS
    deploy/sql/migrate/classify-cron-jobs.sql, the same file the migration
    uses, against a cron.job table built from the inventory -- the real job
    names, schedules and whether each one calls out. It then parses the
    generated SQL and compares it to what the inventory said, job by job.

WHAT IT CANNOT CHECK
    The inventory records each job's name, schedule and whether it calls
    net.http_*, not its full body. The commands here are stand-ins consistent
    with that flag, which is what the classifier keys on. Running the jobs
    themselves would mean running production's work, and that is not something
    a test does.

    Needs psql and a local server you are superuser on. Creates and drops one
    database named with a fixed prefix.
"""

import argparse
import json
import os
import re
import subprocess
import sys

DB = "zzcronplacement"
PASS = FAIL = 0


def ok(m):
    global PASS
    PASS += 1
    print(f"  \033[32mPASS\033[0m {m}")


def bad(m):
    global FAIL
    FAIL += 1
    print(f"  \033[31mFAIL\033[0m {m}")


def psql(sql=None, args=(), db="postgres", tuples=False):
    cmd = ["psql", "-X", "-q", "-v", "ON_ERROR_STOP=1", "-d", db]
    if tuples:
        cmd = ["psql", "-tAqX", "-d", db]
    if sql is not None:
        cmd += ["-c", sql]
    cmd += list(args)
    r = subprocess.run(cmd, capture_output=True, text=True)
    return r.returncode, (r.stdout or "") + (r.stderr or "")


def body_for(job):
    """A command consistent with what the inventory recorded about this job."""
    name = job["name"]
    if job.get("calls_http"):
        url = ("https://OLDPROJECTREF.supabase.co/functions/v1/" + name
               if job.get("hardcodes_project_url")
               else "https://api.example.test/functions/v1/" + name)
        return (f"select net.http_post(url := '{url}', "
                f"headers := '{{\"Content-Type\":\"application/json\"}}'::jsonb, "
                f"body := '{{\"job\":\"{name}\"}}'::jsonb)")
    return f"insert into public.job_log (job) values ('{name}')"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--inventory", required=True)
    ap.add_argument("--sql", default=None, help="classify-cron-jobs.sql (default: alongside this script)")
    args = ap.parse_args()

    here = os.path.dirname(os.path.abspath(__file__))
    sqlfile = args.sql or os.path.join(here, "..", "sql", "migrate", "classify-cron-jobs.sql")
    sqlfile = os.path.abspath(sqlfile)
    if not os.path.isfile(sqlfile):
        sys.exit(f"{sqlfile} does not exist")

    host = os.environ.get("PGHOST", "")
    if host and host not in ("localhost", "127.0.0.1") and not host.startswith("/"):
        sys.exit(f"REFUSING: PGHOST is {host!r}. This creates and drops a database.")
    rc, out = psql("select 1")
    if rc != 0:
        sys.exit(f"cannot reach PostgreSQL:\n{out}")

    projects = [p for p in json.load(open(args.inventory)) if p.get("reachable")]
    with_jobs = [p for p in projects if p.get("cron_jobs")]
    all_jobs = [(p["name"], j) for p in with_jobs for j in p["cron_jobs"]]
    exp_http = [x for x in all_jobs if x[1].get("calls_http")]
    exp_sql = [x for x in all_jobs if not x[1].get("calls_http")]

    print("\nScheduled job placement, job by job")
    print(f"  inventory : {args.inventory}")
    print(f"  jobs      : {len(all_jobs)} across {len(with_jobs)} project(s)")
    print(f"  of those  : {len(exp_http)} call net.http_*, {len(exp_sql)} run SQL only\n")
    if not all_jobs:
        sys.exit("the inventory records no scheduled jobs, so there is nothing to check")

    psql(f'DROP DATABASE IF EXISTS "{DB}" WITH (FORCE)')
    rc, out = psql(f'CREATE DATABASE "{DB}"')
    if rc != 0:
        sys.exit(f"could not create {DB}:\n{out}")

    total_ok = True
    for p in with_jobs:
        app_db = re.sub(r"[^a-z0-9_]", "_", p["name"].lower())
        jobs = p["cron_jobs"]
        psql("drop schema if exists cron cascade; create schema cron;"
             " create table cron.job (jobid serial, schedule text, command text,"
             " jobname text, active boolean)", db=DB)
        for j in jobs:
            cmd = body_for(j)
            esc = cmd.replace("'", "''")
            jn = j["name"].replace("'", "''")
            sc = j["schedule"].replace("'", "''")
            rc, out = psql(f"insert into cron.job (schedule, command, jobname, active) "
                           f"values ('{sc}', '{esc}', '{jn}', "
                           f"{'true' if j.get('active', True) else 'false'})", db=DB)
            if rc != 0:
                bad(f"{p['name']}: could not stage job {j['name']}: {out.strip()[:120]}")
                total_ok = False

        r = subprocess.run(["psql", "-tAqX", "-d", DB, "-v", f"app_db={app_db}",
                            "-f", sqlfile], capture_output=True, text=True)
        gen = r.stdout or ""
        if r.returncode != 0:
            bad(f"{p['name']}: the classifier failed: {(r.stderr or '').strip()[:160]}")
            total_ok = False
            continue

        print(f"  \033[1m{p['name']}\033[0m  ({len(jobs)} job(s) -> {app_db})")
        for j in jobs:
            name = j["name"]
            want_http = bool(j.get("calls_http"))
            # The line that registers THIS job.
            lines = [l for l in gen.split("\n") if f"'{name}'" in l and "cron.schedule" in l]
            if len(lines) != 1:
                bad(f"    {name}: {len(lines)} registration line(s), expected exactly 1")
                total_ok = False
                continue
            line = lines[0]
            is_http = line.strip().startswith("SELECT cron.schedule(")
            is_sql = "cron.schedule_in_database(" in line
            if want_http and not is_http:
                bad(f"    {name}: calls net.http_* but was NOT registered in postgres")
                total_ok = False
                continue
            if not want_http and not is_sql:
                bad(f"    {name}: runs SQL only but was not registered against {app_db}")
                total_ok = False
                continue
            if not want_http and f"'{app_db}'" not in line:
                bad(f"    {name}: registered against the wrong database")
                total_ok = False
                continue
            # Schedule preserved exactly.
            if f"'{j['schedule']}'" not in line:
                bad(f"    {name}: schedule not preserved (expected {j['schedule']!r})")
                total_ok = False
                continue
            # Command preserved exactly, inside the dollar-quoted body.
            m = re.search(r"\$job\$(.*)\$job\$", line, re.S)
            if not m or m.group(1) != body_for(j):
                bad(f"    {name}: command body was altered")
                total_ok = False
                continue
            # The old URL must still be visible, so a human can find and fix it.
            if j.get("hardcodes_project_url") and "supabase.co" not in line:
                bad(f"    {name}: the old project URL was silently removed")
                total_ok = False
                continue
            where = "postgres" if want_http else app_db
            flag = "  OLD URL INSIDE" if j.get("hardcodes_project_url") else ""
            ok(f"    {name:<26} {j['schedule']:<14} -> {where}{flag}")

        # Nothing invented, nothing lost.
        n_reg = len([l for l in gen.split("\n") if "cron.schedule" in l])
        if n_reg == len(jobs):
            ok(f"    {n_reg} registration(s) for {len(jobs)} job(s) — none lost, none invented")
        else:
            bad(f"    {n_reg} registration(s) for {len(jobs)} job(s)")
            total_ok = False

    # The whole-estate count the owner asked to see accounted for.
    print()
    if total_ok:
        ok(f"all {len(exp_http)} HTTP-calling job(s) are registered in postgres, where pg_net's worker is")
        ok(f"all {len(exp_sql)} SQL-only job(s) are registered against their own application's database")
    else:
        bad("at least one job would be registered in the wrong place; see above")

    psql(f'DROP DATABASE IF EXISTS "{DB}" WITH (FORCE)')
    print(f"\n  passed {PASS}  failed {FAIL}\n")
    sys.exit(1 if FAIL else 0)


if __name__ == "__main__":
    main()
