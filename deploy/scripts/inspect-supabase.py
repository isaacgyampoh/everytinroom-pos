#!/usr/bin/env python3
"""
Inspect every Supabase project on an account and work out what each one
actually needs, rather than what a standard Supabase install provides.

    export SUPABASE_ACCESS_TOKEN=sbp_...
    deploy/scripts/inspect-supabase.py                 # all projects
    deploy/scripts/inspect-supabase.py --ref abc123    # just one
    deploy/scripts/inspect-supabase.py --json out.json

This is step 1 to 5 of the migration framework: inspect the architecture,
identify the database, authentication, storage, scheduled jobs and
integrations, capture counts, and spot drift.

READ-ONLY. Every statement it sends is a SELECT. It never writes, and it
never prints a secret: it reports the NAMES of configured secrets and
environment variables and nothing else.

WHY IT DECIDES SERVICES RATHER THAN LISTING THEM
    The point of the central platform is to run what an application uses, not
    the full stack. Everytinroom has no single call to supabase.auth, so
    running GoTrue for it would cost ~256 MB serving nothing. That is a
    measurement, not a guess, and this makes the same measurement for every
    project:

      postgrest  always -- it is the data API
      realtime   only if tables are in a publication
      storage    only if a bucket holds objects
      functions  only if edge functions are deployed
      gotrue     only if auth.users has rows
      cron       only if pg_cron has jobs

Requires curl (Python's urllib has no CA bundle on stock macOS).
"""

import argparse
import json
import os
import subprocess
import sys

API = "https://api.supabase.com/v1"


def _curl(url, token, method="GET", body=None):
    cmd = ["curl", "-s", "--max-time", "60", "-X", method,
           "-H", f"Authorization: Bearer {token}"]
    if body is not None:
        cmd += ["-H", "Content-Type: application/json", "-d", json.dumps(body)]
    cmd.append(url)
    out = subprocess.run(cmd, capture_output=True, text=True).stdout
    if not out.strip():
        return None
    try:
        return json.loads(out)
    except json.JSONDecodeError:
        return {"_raw": out[:400]}


def sql(ref, token, query):
    """Run one read-only query. Returns [] on any failure rather than raising:
    a project can be paused, and one unreachable project must not stop the
    inventory."""
    r = _curl(f"{API}/projects/{ref}/database/query", token, "POST", {"query": query})
    return r if isinstance(r, list) else []


def one(ref, token, query, default=None):
    rows = sql(ref, token, query)
    if not rows:
        return default
    return list(rows[0].values())[0]


def inspect(project, token):
    ref = project["id"]
    p = {
        "name": project.get("name"),
        "ref": ref,
        "region": project.get("region"),
        "status": project.get("status"),
        "created": (project.get("created_at") or "")[:10],
        "reachable": False,
    }

    if one(ref, token, "select 1") != 1:
        # Paused or unreachable. Recorded honestly rather than guessed at.
        p["note"] = "could not query the database (project may be paused)"
        return p
    p["reachable"] = True

    p["postgres"] = (one(ref, token, "select version()") or "")[:30]
    p["db_size_mb"] = one(ref, token,
        "select (pg_database_size(current_database())/1024/1024)::bigint", 0)
    p["tables"] = one(ref, token,
        "select count(*) from information_schema.tables "
        "where table_schema='public' and table_type='BASE TABLE'", 0)
    p["views"] = one(ref, token,
        "select count(*) from information_schema.views where table_schema='public'", 0)
    p["functions"] = one(ref, token,
        "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace "
        "where n.nspname='public'", 0)
    p["policies"] = one(ref, token,
        "select count(*) from pg_policies where schemaname='public'", 0)
    p["rls_tables"] = one(ref, token,
        "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace "
        "where n.nspname='public' and c.relkind='r' and c.relrowsecurity", 0)
    p["triggers"] = one(ref, token,
        "select count(*) from information_schema.triggers where trigger_schema='public'", 0)
    p["indexes"] = one(ref, token,
        "select count(*) from pg_indexes where schemaname='public'", 0)
    p["extensions"] = [r["extname"] for r in sql(ref, token,
        "select extname from pg_extension order by 1")]

    # --- authentication: does it use GoTrue at all? ---
    p["auth_users"] = one(ref, token, "select count(*) from auth.users", 0) or 0
    # A custom auth table is the other possibility, and the one Everytinroom
    # uses. Worth naming so provisioning knows the application is not
    # anonymous just because auth.users is empty.
    p["custom_auth_tables"] = [r["t"] for r in sql(ref, token,
        "select table_name as t from information_schema.tables "
        "where table_schema='public' and table_name in "
        "('staff','staff_sessions','users','accounts','members','employees') order by 1")]

    # --- realtime: which tables are published ---
    p["realtime_tables"] = [r["t"] for r in sql(ref, token,
        "select tablename as t from pg_publication_tables "
        "where pubname='supabase_realtime' order by 1")]

    # --- scheduled jobs ---
    has_cron = one(ref, token,
        "select count(*) from pg_extension where extname='pg_cron'", 0)
    if has_cron:
        p["cron_jobs"] = [
            {"name": r.get("jobname"), "schedule": r.get("schedule"),
             "active": r.get("active"),
             # The COMMAND IS NOT CAPTURED. A job body can contain a task
             # secret in a header, and this report is written to a file.
             "calls_http": r.get("calls_http"),
             "hardcodes_project_url": r.get("hardcodes_url")}
            for r in sql(ref, token,
                "select jobname, schedule, active, "
                "(command like '%net.http_post%') as calls_http, "
                "(command like '%supabase.co%') as hardcodes_url "
                "from cron.job order by jobname")]
    else:
        p["cron_jobs"] = []

    # --- a dormant-looking feature that may not be dormant ---
    #
    # Everytinroom had a WhatsApp AI agent with empty conversation tables and
    # its master switch set to false, so it was safe to remove. Another
    # project on the same account has the SAME empty tables with the switch
    # set to TRUE, and a cleanup function that empties them -- so "0 rows"
    # says nothing there. Reporting the switch alongside the row counts is
    # the difference between removing dead code and removing a live feature.
    p["agent"] = None
    if one(ref, token,
           "select count(*) from information_schema.tables "
           "where table_schema='public' and table_name='wa_agent_settings'", 0):
        enabled = one(ref, token,
            "select count(*) from public.wa_agent_settings "
            "where lower(trim(both '\"' from value::text)) <> 'false'", 0)
        p["agent"] = {
            "settings_rows": one(ref, token, "select count(*) from public.wa_agent_settings", 0),
            "conversations": one(ref, token, "select count(*) from public.wa_conversations", 0),
            "messages": one(ref, token, "select count(*) from public.wa_messages", 0),
            "enabled_settings": enabled,
            "has_cleanup_function": bool(one(ref, token,
                "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace "
                "where n.nspname='public' and (p.prosrc like '%wa_conversations%' "
                "or p.prosrc like '%wa_messages%') and p.proname like '%cleanup%'", 0)),
        }

    # --- storage ---
    p["buckets"] = [
        {"name": r.get("bucket"), "objects": r.get("objects"), "mb": r.get("mb")}
        for r in sql(ref, token,
            "select b.name as bucket, count(o.id) as objects, "
            "coalesce(sum((o.metadata->>'size')::bigint)/1024/1024,0)::bigint as mb "
            "from storage.buckets b left join storage.objects o on o.bucket_id=b.id "
            "group by b.name order by 3 desc")]
    p["storage_mb"] = sum((b.get("mb") or 0) for b in p["buckets"])

    # --- drift: the live schema against the migration files ---
    p["applied_migrations"] = one(ref, token,
        "select count(*) from supabase_migrations.schema_migrations", None)

    # --- edge functions and secret NAMES (never values) ---
    fns = _curl(f"{API}/projects/{ref}/functions", token)
    p["edge_functions"] = sorted(
        [f"{f.get('slug')} (v{f.get('version')})" for f in fns]) if isinstance(fns, list) else []
    secrets = _curl(f"{API}/projects/{ref}/secrets", token)
    p["secret_names"] = sorted(s.get("name") for s in secrets) if isinstance(secrets, list) else []

    # --- what the central platform must actually run for this project ---
    needs = ["postgrest"]
    if p["realtime_tables"]:
        needs.append("realtime")
    if p["storage_mb"] > 0 or any((b.get("objects") or 0) > 0 for b in p["buckets"]):
        needs.append("storage")
    if p["edge_functions"]:
        needs.append("functions")
    if (p["auth_users"] or 0) > 0:
        needs.append("gotrue")
    if p["cron_jobs"]:
        needs.append("cron")
    p["needs"] = needs

    # Memory, from the limits in app.compose.yml rather than invented.
    cost = {"postgrest": 512, "realtime": 1024, "storage": 768 + 512,
            "functions": 512, "gotrue": 256}
    p["est_service_mb"] = sum(cost.get(n, 0) for n in needs)

    # --- things a migration will trip over ---
    flags = []
    if any(j.get("hardcodes_project_url") for j in p["cron_jobs"]):
        n = sum(1 for j in p["cron_jobs"] if j.get("hardcodes_project_url"))
        flags.append(f"{n} cron job(s) hardcode the project URL and must be rewritten at cutover")
    if "supabase_vault" in p["extensions"]:
        flags.append("uses supabase_vault, so the supabase/postgres image is required (not plain postgres)")
    if (p["auth_users"] or 0) == 0 and p["custom_auth_tables"]:
        flags.append(f"custom authentication ({', '.join(p['custom_auth_tables'])}), so GoTrue is not needed")
    if p["rls_tables"] and p["policies"] == 0:
        flags.append("RLS is enabled on tables with no policies — those tables are unreadable")
    if p["tables"] and not p["rls_tables"]:
        flags.append("no table has RLS enabled")
    if p["applied_migrations"] is None:
        flags.append("no supabase_migrations schema: the live database is the only source of truth")
    if p["storage_mb"] > 10240:
        flags.append(f"storage is {p['storage_mb']} MB, above R2's 10 GB free tier")
    ag = p.get("agent")
    if ag:
        if ag["enabled_settings"]:
            flags.append(
                "a WhatsApp agent is present and its master switch is NOT false -- "
                "do NOT remove it on the assumption that empty conversation tables "
                "mean unused" + (", especially as a cleanup function empties them"
                                 if ag["has_cleanup_function"] else ""))
        elif ag["conversations"] or ag["messages"]:
            flags.append("a WhatsApp agent is present and holds conversation history")
        else:
            flags.append("a WhatsApp agent is present, switched off and holding no "
                         "history -- a candidate for removal, behind the guarded drop")
    p["flags"] = flags
    return p


def markdown(projects):
    L = []
    A = L.append
    A("# Project inventory")
    A("")
    A("Generated by `deploy/scripts/inspect-supabase.py`. Read-only.")
    A("Contains no credentials: configured secrets are listed by name only.")
    A("")
    reach = [p for p in projects if p.get("reachable")]
    A(f"{len(projects)} projects, {len(reach)} reachable.")
    A("")
    A("## Summary")
    A("")
    A("| Project | Status | DB | Storage | Tables | Needs | Est. RAM |")
    A("|---|---|---|---|---|---|---|")
    for p in projects:
        if not p.get("reachable"):
            A(f"| {p['name']} | {p['status']} | — | — | — | not inspected | — |")
            continue
        A(f"| {p['name']} | {p['status']} | {p['db_size_mb']} MB | {p['storage_mb']} MB "
          f"| {p['tables']} | {', '.join(p['needs'])} | {p['est_service_mb']} MB |")
    A("")
    tot_db = sum(p.get("db_size_mb") or 0 for p in reach)
    tot_st = sum(p.get("storage_mb") or 0 for p in reach)
    tot_ram = sum(p.get("est_service_mb") or 0 for p in reach)
    A(f"- Combined database size: **{tot_db} MB**")
    A(f"- Combined storage: **{tot_st} MB**")
    A(f"- Combined service memory if every project ran at once: **{tot_ram} MB "
      f"({tot_ram/1024:.1f} GB)**, plus PostgreSQL and the proxy.")
    A("")
    A("The memory figures are the compose limits, which are ceilings rather than")
    A("measured usage. Real figures come from the staging run.")
    A("")
    for p in projects:
        A(f"## {p['name']}")
        A("")
        A(f"- Ref: `{p['ref']}`  ·  region {p.get('region')}  ·  status {p.get('status')}  ·  created {p.get('created')}")
        if not p.get("reachable"):
            A(f"- **{p.get('note', 'not reachable')}**")
            A("")
            continue
        A(f"- PostgreSQL: {p.get('postgres')}")
        A(f"- Database: {p['db_size_mb']} MB · {p['tables']} tables · {p['views']} views · "
          f"{p['functions']} functions · {p['policies']} policies on {p['rls_tables']} RLS tables · "
          f"{p['triggers']} triggers · {p['indexes']} indexes")
        A(f"- Extensions: {', '.join(p['extensions']) or 'none'}")
        A(f"- Auth: {p['auth_users']} GoTrue users"
          + (f"; custom auth tables: {', '.join(p['custom_auth_tables'])}" if p['custom_auth_tables'] else ""))
        A(f"- Realtime tables: {', '.join(p['realtime_tables']) or 'none'}")
        if p.get("agent"):
            a = p["agent"]
            A(f"- WhatsApp agent: {a['settings_rows']} settings "
              f"({a['enabled_settings']} not false), {a['conversations']} conversations, "
              f"{a['messages']} messages"
              + (", cleanup function present" if a["has_cleanup_function"] else ""))
        if p["buckets"]:
            A("- Storage:")
            for b in p["buckets"]:
                A(f"    - `{b['name']}`: {b['objects']} objects, {b['mb']} MB")
        else:
            A("- Storage: no buckets")
        if p["cron_jobs"]:
            A("- Scheduled jobs:")
            for j in p["cron_jobs"]:
                tag = " **hardcodes project URL**" if j.get("hardcodes_project_url") else ""
                A(f"    - `{j['name']}` at `{j['schedule']}` (active={j['active']}){tag}")
        else:
            A("- Scheduled jobs: none")
        A(f"- Edge functions: {', '.join(p['edge_functions']) or 'none'}")
        A(f"- Configured secrets (names only): {', '.join(p['secret_names']) or 'none'}")
        A(f"- Migration history rows: {p['applied_migrations'] if p['applied_migrations'] is not None else 'no supabase_migrations schema'}")
        A(f"- **Central platform must run: {', '.join(p['needs'])}** (~{p['est_service_mb']} MB)")
        if p["flags"]:
            A("- Migration notes:")
            for f in p["flags"]:
                A(f"    - {f}")
        A("")
    return "\n".join(L)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ref", help="inspect only this project ref")
    ap.add_argument("--json", help="also write the raw findings here")
    ap.add_argument("--out", default="-", help="markdown destination (default stdout)")
    args = ap.parse_args()

    token = os.environ.get("SUPABASE_ACCESS_TOKEN", "").strip()
    if not token:
        sys.exit("SUPABASE_ACCESS_TOKEN is not set.\n"
                 "  read -rs SUPABASE_ACCESS_TOKEN && export SUPABASE_ACCESS_TOKEN\n"
                 "Using 'read -rs' keeps it out of your shell history.")

    projects = _curl(f"{API}/projects", token)
    if not isinstance(projects, list):
        sys.exit(f"Could not list projects. The token may be invalid or expired.\n  {projects}")
    if args.ref:
        projects = [p for p in projects if p["id"] == args.ref]
        if not projects:
            sys.exit(f"No project with ref {args.ref}")

    found = []
    for proj in sorted(projects, key=lambda x: x.get("name") or ""):
        print(f"inspecting {proj.get('name')} ({proj['id']}) ...", file=sys.stderr)
        found.append(inspect(proj, token))

    md = markdown(found)
    if args.out == "-":
        print(md)
    else:
        with open(args.out, "w") as f:
            f.write(md + "\n")
        print(f"wrote {args.out}", file=sys.stderr)
    if args.json:
        with open(args.json, "w") as f:
            json.dump(found, f, indent=2)
        print(f"wrote {args.json}", file=sys.stderr)


if __name__ == "__main__":
    main()
