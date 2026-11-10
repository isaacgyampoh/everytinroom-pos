#!/usr/bin/env python3
"""
Find schema that exists only in hand-run setup scripts.

    deploy/scripts/check-schema-gaps.py [--repo .]

The .sql files at the root of this repository were pasted into the Supabase
SQL editor by hand. Several added tables and columns the application reads,
and none of that was written into supabase/migrations/. Production had the
objects, so nothing noticed -- until a database was built from the migrations
alone and verify_pin answered HTTP 400 for every PIN, because staff.permissions
did not exist. Nobody could sign in.

This compares the two: every CREATE TABLE and ADD COLUMN in a root-level .sql
file must also be produced by something in supabase/migrations/.

DELIBERATELY ABSENT, and listed rather than silently skipped: the WhatsApp
agent's tables were removed on purpose, so the script that created them is
allowed to have no counterpart.
"""
import argparse, glob, os, re, sys

REMOVED_ON_PURPOSE = {"wa_agent_settings", "wa_messages"}

COLS = re.compile(r'ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:public\.)?"?(\w+)"?\s+ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?"?(\w+)"?', re.I)
TBLS = re.compile(r'CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?"?(\w+)"?', re.I)
BODY = re.compile(r'CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?"?(\w+)"?\s*\((.*?)\n\s*\);', re.S | re.I)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo", default=".")
    a = ap.parse_args()
    migs = sorted(glob.glob(os.path.join(a.repo, "supabase", "migrations", "*.sql")))
    roots = sorted(glob.glob(os.path.join(a.repo, "*.sql")))
    if not migs:
        print("  skipped: no supabase/migrations here"); return 0
    mig = "\n".join(open(f, encoding="utf-8", errors="replace").read() for f in migs)
    have_cols = {(t.lower(), c.lower()) for t, c in COLS.findall(mig)}
    for m in BODY.finditer(mig):
        t = m.group(1).lower()
        for line in m.group(2).split("\n"):
            mm = re.match(r'\s*"?(\w+)"?\s+\w', line)
            if mm:
                have_cols.add((t, mm.group(1).lower()))
    have_tbls = {t.lower() for t in TBLS.findall(mig)}

    gaps = []
    for f in roots:
        txt = open(f, encoding="utf-8", errors="replace").read()
        for t in TBLS.findall(txt):
            if t.lower() not in have_tbls and t.lower() not in REMOVED_ON_PURPOSE:
                gaps.append(f"{os.path.basename(f)}: table {t}")
        for t, c in COLS.findall(txt):
            if t.lower() in REMOVED_ON_PURPOSE:
                continue
            if (t.lower(), c.lower()) not in have_cols:
                gaps.append(f"{os.path.basename(f)}: column {t}.{c}")
    gaps = sorted(set(gaps))
    for g in gaps:
        print("  MISSING " + g)
    if gaps:
        print(f"\n  {len(gaps)} object(s) exist only in a hand-run script. A database built")
        print("  from supabase/migrations/ will not have them.")
        return 1
    print(f"  every table and column in {len(roots)} root-level script(s) is also in the migrations")
    return 0


if __name__ == "__main__":
    sys.exit(main())
