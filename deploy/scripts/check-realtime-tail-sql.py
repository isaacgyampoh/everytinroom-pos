#!/usr/bin/env python3
"""
Check that deploy/sql/migrate/realtime-migrations-84-91.sql still matches
Realtime's own migration files.

    deploy/scripts/check-realtime-tail-sql.py --migrations <dir>

That file exists because Realtime's last eight tenant migrations do work an
application's role cannot, and Realtime stops the tenant when any migration
fails -- so they have to be applied by the image's superuser instead. The
statements in it are extracted verbatim from Realtime's own files.

A hand-maintained copy of someone else's migrations drifts. So this
re-extracts them and compares, statement by statement, and fails if they
differ. Run it after changing the pinned Realtime version.
"""

import argparse
import importlib.util
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))


def load_extractor():
    spec = importlib.util.spec_from_file_location(
        "rt", os.path.join(HERE, "test-realtime-migrations.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def norm(sql):
    """Whitespace-insensitive, so reformatting is not reported as drift."""
    return re.sub(r"\s+", " ", sql.strip().rstrip(";")).lower()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--migrations", default="/tmp/realtime-src/lib/realtime/tenants/repo/migrations")
    ap.add_argument("--file", default=os.path.join(
        HERE, "..", "sql", "migrate", "realtime-migrations-84-91.sql"))
    args = ap.parse_args()

    if not os.path.isdir(args.migrations):
        print(f"SKIP no migration sources at {args.migrations}")
        print("     deploy/scripts/fetch-realtime-migrations.sh puts them there")
        return 0
    if not os.path.isfile(args.file):
        print(f"MISSING {args.file} does not exist")
        return 1

    rt = load_extractor()
    files = sorted(f for f in os.listdir(args.migrations) if f.endswith(".ex"))
    tail = files[83:]
    expected = []
    for f in tail:
        for sql in rt.extract(os.path.join(args.migrations, f))[0]:
            expected.append((f, norm(sql)))

    have = open(args.file, encoding="utf-8").read()
    missing = [(f, s) for f, s in expected if s not in norm(have)]
    print(f"CHECKED {len(expected)} statement(s) from {len(tail)} migration(s)")
    for f, s in missing:
        print(f"MISSING {f}: {s[:110]}")
    # Every version must be recorded, too: a statement applied without its
    # version row means Realtime runs the migration again and fails again.
    for f in tail:
        ver = f.split("_")[0]
        if f"VALUES ({ver}," not in have:
            print(f"MISSING version row for {ver}")
            missing.append((f, "version row"))
    return 1 if missing else 0


if __name__ == "__main__":
    sys.exit(main())
