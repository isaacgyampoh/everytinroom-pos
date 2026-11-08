#!/usr/bin/env python3
"""
Capture the authoritative Everytinroom schema from the live database.

WHY THIS EXISTS
    supabase/migrations/ cannot rebuild production. Replaying all 34 files
    into an empty PostgreSQL leaves a database missing staff.permissions,
    products.group_tag and the stock_ledger table — objects the application
    reads every day and that no migration creates. Production carries 27
    tables and 16 triggers; the migrations account for 19 and 3. Somewhere
    along the way changes were made in the dashboard and never written back.

    That matters more for a server move than for day-to-day work: a migration
    plan that replays the folder onto a new host produces a schema the app
    cannot run on, and the failure appears as missing columns at the till
    rather than as an error during the move.

    So the source of truth is the live database. This reads it — strictly
    read-only, through the Management API, no password required — and writes
    a baseline the migration can actually be built from and diffed against.

    pg_dump --schema-only would be better and needs the database password,
    which the Management API deliberately does not hand out. This gets the
    same facts from the catalogue.

    SUPABASE_ACCESS_TOKEN and SUPABASE_PROJECT_REF from the environment.
"""

import json
import os
import pathlib
import shutil
import subprocess
import sys

API = "https://api.supabase.com/v1/projects"

QUERIES = {
    "01-extensions": "select extname, extversion from pg_extension order by extname",
    "02-tables": """select table_name, column_name, data_type, is_nullable,
                      coalesce(column_default,'') as default_value
                    from information_schema.columns
                    where table_schema='public' order by table_name, ordinal_position""",
    "03-constraints": """select tc.table_name, tc.constraint_name, tc.constraint_type,
                           coalesce(cc.check_clause,'') as check_clause
                         from information_schema.table_constraints tc
                         left join information_schema.check_constraints cc
                           on cc.constraint_name = tc.constraint_name
                         where tc.table_schema='public' order by tc.table_name, tc.constraint_name""",
    "04-indexes": "select tablename, indexname, indexdef from pg_indexes where schemaname='public' order by tablename, indexname",
    "05-functions": """select p.proname, pg_get_functiondef(p.oid) as definition
                       from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                       where n.nspname='public' order by p.proname""",
    "06-triggers": """select c.relname as table_name, t.tgname, pg_get_triggerdef(t.oid) as definition
                      from pg_trigger t join pg_class c on c.oid=t.tgrelid
                      join pg_namespace n on n.oid=c.relnamespace
                      where not t.tgisinternal and n.nspname='public'
                      order by c.relname, t.tgname""",
    "07-policies": """select tablename, policyname, cmd, roles::text,
                        coalesce(qual,'') as using_expr, coalesce(with_check,'') as check_expr
                      from pg_policies where schemaname='public' order by tablename, policyname""",
    "08-grants": """select table_name, grantee, string_agg(privilege_type, ',' order by privilege_type) as privs
                    from information_schema.role_table_grants
                    where table_schema='public' and grantee in ('anon','authenticated','service_role')
                    group by table_name, grantee order by table_name, grantee""",
    "09-sequences": """select sequence_name, data_type, start_value, increment
                       from information_schema.sequences where sequence_schema='public' order by sequence_name""",
    "10-views": "select table_name, view_definition from information_schema.views where table_schema='public' order by table_name",
    "11-cron": "select jobname, schedule, active from cron.job order by jobname",
    "12-rls": """select c.relname, c.relrowsecurity as rls_enabled
                 from pg_class c join pg_namespace n on n.oid=c.relnamespace
                 where n.nspname='public' and c.relkind='r' order by c.relname""",
}


def run(ref, token, sql):
    """Through curl rather than urllib.

    Python's urllib verifies against the system trust store, which on a stock
    macOS install has no CA bundle — every call fails with
    CERTIFICATE_VERIFY_FAILED and nothing is captured. curl carries its own
    bundle, is present on every machine this will run on, and the token goes
    in a header rather than the command line so it stays out of the process
    list.
    """
    if not shutil.which("curl"):
        sys.exit("curl is required.")
    payload = json.dumps({"query": sql})
    p = subprocess.run(
        ["curl", "-s", "--max-time", "90", "--retry", "2", "-X", "POST",
         f"{API}/{ref}/database/query",
         "-H", "@-", "-H", "Content-Type: application/json",
         "--data-binary", payload],
        input=f"Authorization: Bearer {token}\n", capture_output=True, text=True)
    if p.returncode != 0:
        raise RuntimeError(f"curl exit {p.returncode}")
    return json.loads(p.stdout)


def main():
    token = os.environ.get("SUPABASE_ACCESS_TOKEN", "").strip()
    ref = os.environ.get("SUPABASE_PROJECT_REF", "").strip()
    if not token or not ref:
        sys.exit("Set SUPABASE_ACCESS_TOKEN and SUPABASE_PROJECT_REF.")

    out = pathlib.Path(__file__).resolve().parent.parent / "supabase" / "schema"
    out.mkdir(parents=True, exist_ok=True)

    summary = {}
    for name, sql in QUERIES.items():
        try:
            rows = run(ref, token, sql)
        except Exception as e:
            print(f"  {name:<18} could not read: {type(e).__name__}")
            continue
        if isinstance(rows, dict):
            print(f"  {name:<18} {rows.get('message', rows)}")
            continue
        (out / f"{name}.json").write_text(json.dumps(rows, indent=1, sort_keys=True) + "\n")
        summary[name] = len(rows)
        print(f"  {name:<18} {len(rows):>4} rows")

    (out / "00-summary.json").write_text(json.dumps({
        "project_ref": ref,
        "captured_counts": summary,
    }, indent=1) + "\n")
    print(f"\nWritten to {out}")
    print("Commit it. A diff against the next snapshot is how schema drift becomes visible")
    print("instead of being discovered during a server move.")


if __name__ == "__main__":
    main()
