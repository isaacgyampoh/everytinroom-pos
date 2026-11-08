#!/usr/bin/env python3
"""
Build the migration-readiness package from actual evidence files.

    deploy/scripts/readiness-package.py \
        --full      deploy/staging-results/report.md \
        --prereq    deploy/staging-results/prereq-report.md \
        --inventory /tmp/inventory.json \
        --out       /tmp/READINESS.md

It reads the staging reports and the inventory and writes the package. It does
NOT accept claims as arguments.

Every acceptance test is listed with one of three states:

    PASSED        a named check in a report says PASS
    FAILED        a named check says FAIL
    NOT VERIFIED  no check for it was found in any report

NOT VERIFIED is the default. A test that did not run cannot be reported as
anything else, and the summary refuses to call the platform ready while any
required test is not PASSED. That refusal is the point of the script: the
verdict comes from the evidence rather than from whoever is writing the
summary.
"""

import argparse
import json
import os
import re
import sys

# The acceptance tests, and the report text that proves each one. A test is
# PASSED only if a PASS line matching one of its patterns exists.
TESTS = [
    ("Docker installed automatically on a clean machine", True,
     [r"Docker Engine installed and responding", r"official apt repository"]),
    ("Compose plugin installed", True, [r"Compose plugin installed"]),
    ("Shared stack starts", True, [r"central-postgres is running", r"central-caddy is running"]),
    ("PostgreSQL healthy and answering", True,
     [r"central-postgres reports healthy", r"PostgreSQL answers queries"]),
    ("Database not exposed to the internet", True, [r"bound to 127\.0\.0\.1 only"]),
    ("Image's preloaded libraries not clobbered", True,
     [r"preloaded libraries survived"]),
    ("wal_level is logical (Realtime prerequisite)", True, [r"wal_level is logical"]),
    ("Central roles and application registry", True,
     [r"central\.applications registry exists", r"registry has the needs_auth column"]),
    ("Restart recovery, unattended", True,
     [r"returned to healthy after a restart", r"restart policy is unless-stopped"]),
    ("Two applications provisioned with different services", True,
     [r"provisioned alpha_shop", r"provisioned beta_shop"]),
    ("Only requested services provisioned", True,
     [r"has NO auth schema", r"profiles are 'auth'"]),
    ("Database isolation: credentials refused across applications", True,
     [r"credentials are REFUSED by", r"cannot read alpha_shop's data"]),
    ("Separate JWT secret per application", True, [r"different JWT secrets"]),
    ("Secret files are mode 600", True, [r"\.env is mode 600"]),
    ("Existing password never regenerated on re-run", True,
     [r"existing password is NOT regenerated", r"existing credentials found"]),
    ("Provisioning is idempotent", True,
     [r"re-provisioning .* changed nothing", r"re-provisioning kept the existing password"]),
    ("PostgREST answers through the proxy", True,
     [r"PostgREST answers through the proxy", r"PostgREST answers \(HTTP"]),
    ("Realtime subscription accepted", True, [r"subscription was accepted"]),
    ("Realtime delivers a database change end to end", True,
     [r"INSERT produced a Realtime event"]),
    ("Object storage upload", True, [r"UPLOAD through storage-api"]),
    ("Object storage download returns identical bytes", True,
     [r"DOWNLOAD returned the same bytes"]),
    ("Object really lands in the object store", True,
     [r"physically in the S3 bucket"]),
    ("Object storage delete", True, [r"DELETE removed the object", r"gone from the bucket"]),
    ("Backup produces a dump and cluster globals", True,
     [r"a dump was produced", r"cluster globals were dumped"]),
    ("Restore into a SEPARATE database", True,
     [r"restored into a separate database"]),
    ("Restore verified by row count and a money total", True,
     [r"restored row count matches", r"restored money total matches"]),
    ("Live database untouched by the restore rehearsal", True,
     [r"live database was left alone"]),
    ("Scheduled job registered in another database", True,
     [r"job was registered for alpha_shop"]),
    ("Scheduled job actually executed", True, [r"actually executed in the other database"]),
    ("Scheduled job reached a new API URL", True, [r"reached the new API URL"]),
    ("Resource usage measured", True, [r"resource usage captured"]),
    ("Capacity report with headroom estimate", True, [r"headroom estimate"]),
    ("Service health check across applications", True, [r"health\.sh reported every service healthy"]),
    ("Provisioning from an already-configured machine", True,
     [r"third application provisioned"]),
    # Cannot be done from here: needs the owner's Cloudflare credentials.
    ("Cloudflare R2: real upload, download, integrity, delete", True, [r"__never_matches__"]),
]


def load(path):
    if not path or not os.path.isfile(path):
        return ""
    return open(path, encoding="utf-8", errors="replace").read()


def state_of(patterns, texts):
    """PASSED if a PASS line matches; FAILED if a FAIL line does; else NOT VERIFIED."""
    for text in texts:
        for line in text.split("\n"):
            if not line.strip().startswith("- "):
                continue
            for p in patterns:
                if re.search(p, line, re.I):
                    if "**FAIL**" in line:
                        return "FAILED", line.strip()[:160]
                    if line.strip().startswith("- PASS"):
                        return "PASSED", line.strip()[:160]
    return "NOT VERIFIED", ""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--full")
    ap.add_argument("--prereq")
    ap.add_argument("--inventory")
    ap.add_argument("--run-id", default="(not given)")
    ap.add_argument("--out", default="-")
    args = ap.parse_args()

    texts = [load(args.full), load(args.prereq)]
    if not any(texts):
        sys.exit("no report given or readable. This script reports only what a "
                 "report proves, so with no report there is nothing to say.")

    results = []
    for name, required, pats in TESTS:
        st, ev = state_of(pats, texts)
        results.append((name, required, st, ev))

    passed = [r for r in results if r[2] == "PASSED"]
    failed = [r for r in results if r[2] == "FAILED"]
    unver = [r for r in results if r[2] == "NOT VERIFIED"]
    ready = not failed and not unver

    projects = []
    if args.inventory and os.path.isfile(args.inventory):
        projects = json.load(open(args.inventory))

    L, A = [], None
    A = L.append
    A("# Migration readiness")
    A("")
    A(f"Generated from evidence files by `deploy/scripts/readiness-package.py`.")
    A(f"Staging run: `{args.run_id}`")
    A("")
    A("Each acceptance test below is PASSED, FAILED or NOT VERIFIED. NOT")
    A("VERIFIED is the default and means no check for it was found in any")
    A("report -- it is not a soft pass. The verdict at the end is computed from")
    A("these states, not written by hand.")
    A("")
    A("## Verdict")
    A("")
    A(f"- Passed: **{len(passed)}**")
    A(f"- Failed: **{len(failed)}**")
    A(f"- Not verified: **{len(unver)}**")
    A("")
    if ready:
        A("**Every required acceptance test has passing evidence.**")
    else:
        A("**NOT READY.** Required tests are failing or unverified; they are listed below.")
    A("")
    A("## Acceptance tests")
    A("")
    A("| Test | State | Evidence |")
    A("|---|---|---|")
    for name, required, st, ev in results:
        mark = {"PASSED": "PASSED", "FAILED": "**FAILED**", "NOT VERIFIED": "NOT VERIFIED"}[st]
        A(f"| {name} | {mark} | {ev.replace('|', '/')[:90] if ev else '—'} |")
    A("")
    if failed:
        A("### Failing")
        A("")
        for name, _, _, ev in failed:
            A(f"- **{name}** — {ev}")
        A("")
    if unver:
        A("### Not verified")
        A("")
        for name, _, _, _ in unver:
            A(f"- {name}")
        A("")
        A("Each of these either did not run or has no matching check. Nothing")
        A("here may be described as working.")
        A("")

    if projects:
        A("## The seven inventoried projects")
        A("")
        A("| Project | Status | DB | Storage | Services needed | Migration state |")
        A("|---|---|---|---|---|---|")
        for p in sorted(projects, key=lambda x: x.get("name") or ""):
            if not p.get("reachable"):
                A(f"| {p.get('name')} | {p.get('status')} | — | — | not inspected | "
                  f"paused; cannot be assessed |")
                continue
            A(f"| {p['name']} | {p.get('status')} | {p.get('db_size_mb')} MB | "
              f"{p.get('storage_mb')} MB | {', '.join(p.get('needs', []))} | "
              f"{'prepared' if p.get('ref') == 'noiiuwkovoojkcwzupye' else 'inventoried only'} |")
        A("")
        reach = [p for p in projects if p.get("reachable")]
        A(f"- Reachable: **{len(reach)} of {len(projects)}**. Two are paused and were "
          f"not inspected; a paused project cannot be sized or migrated until it is resumed.")
        A(f"- Combined database size: **{sum(p.get('db_size_mb') or 0 for p in reach)} MB**")
        A(f"- Combined storage: **{sum(p.get('storage_mb') or 0 for p in reach)} MB**")
        A("")
        flagged = [(p["name"], f) for p in reach for f in (p.get("flags") or [])]
        if flagged:
            A("### Per-project migration notes")
            A("")
            for n, f in flagged:
                A(f"- **{n}**: {f}")
            A("")

    A("## What still requires an account action")
    A("")
    A("These cannot be completed from here. Each is named, with what it unblocks.")
    A("")
    A("| Needed | Unblocks | Why it cannot be done here |")
    A("|---|---|---|")
    A("| Cloudflare R2 bucket + API token | real R2 upload/download/delete verification, and the image migration | only the account owner can create them; `deploy/scripts/test-r2.py` runs the full check once they exist |")
    A("| `SUPABASE_DB_URL` for each project | copying a production database | it contains the database password |")
    A("| Each edge function's own secrets | the functions running on the new server | they cannot be read back out of the platform |")
    A("| The payment-provider credential | server-side payment verification and stock deduction | see the local operator note |")
    A("| A VPS | any real deployment | not purchased, by instruction |")
    A("")
    A("## Limits of this evidence")
    A("")
    A("- The staging environment is a GitHub-hosted runner, not a VPS. No real")
    A("  VPS deployment has been tested, and none is claimed.")
    A("- Object storage is verified against an S3-compatible stand-in. That")
    A("  proves this platform's configuration and NOTHING about Cloudflare R2,")
    A("  which has its own checksum behaviour.")
    A("- Staging runs generated data, not a restored production database.")
    A("- Resource figures are measured under a staging load, which is lighter")
    A("  than a trading shop.")
    A("- Two projects are paused and were not inspected at all.")
    A("")
    out = "\n".join(L) + "\n"
    if args.out == "-":
        print(out)
    else:
        open(args.out, "w").write(out)
        print(f"wrote {args.out}", file=sys.stderr)
    # Exit non-zero while anything required is unproven, so this cannot be
    # used to rubber-stamp a run.
    sys.exit(0 if ready else 1)


if __name__ == "__main__":
    main()
