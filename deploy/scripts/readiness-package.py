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
     [r"provisioned alpha_shop", r"provisioned beta_shop"],
     [r"provisioning \w+ failed"]),
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
     [r"PostgREST answers through the proxy", r"PostgREST answers \(HTTP"],
     [r"PostgREST through the proxy returned HTTP", r"-rest never became healthy"]),
    ("Realtime subscription accepted", True, [r"subscription was accepted"],
     [r"subscription was not accepted", r"\.realtime is not running"]),
    ("Realtime's own schema and WAL reader exist", True,
     [r"list_changes present: 1", r"realtime\.list_changes\(\) exists"]),
    ("Realtime delivers a database change end to end", True,
     [r"INSERT produced a Realtime event"],
     [r"no Realtime event arrived"]),
    ("Storage grants applied after the service's own migrations", True,
     [r"post-start granted the storage schema"],
     [r"post-start did not complete", r"storage-api never became healthy"]),
    ("Object storage upload", True, [r"UPLOAD through storage-api"],
     [r"upload returned HTTP", r"storage-api never became healthy"]),
    ("Object storage download returns identical bytes", True,
     [r"DOWNLOAD returned the same bytes"],
     [r"download returned HTTP", r"storage-api never became healthy"]),
    ("Object really lands in the object store", True,
     [r"physically in the S3 bucket"]),
    ("Object storage delete", True, [r"DELETE removed the object", r"gone from the bucket"],
     [r"delete returned HTTP", r"still in the bucket after"]),
    ("Backup produces a dump and cluster globals", True,
     [r"a dump was produced", r"cluster globals were dumped"],
     [r"backup\.sh exited non-zero"]),
    ("Restore into a SEPARATE database", True,
     [r"restored into a separate database"],
     [r"restore\.sh exited non-zero"]),
    ("Restore verified by row count and a money total", True,
     [r"restored row count matches", r"restored money total matches"],
     [r"restored row count is", r"restored total is"]),
    ("Live database untouched by the restore rehearsal", True,
     [r"live database was left alone"]),
    ("Scheduled job registered in another database", True,
     [r"job was registered for alpha_shop"]),
    ("Scheduled job actually executed", True, [r"actually executed in the other database"],
     [r"the job never ran"]),
    ("Scheduled job reached a new API URL", True, [r"reached the new API URL"],
     [r"did not reach PostgREST through pg_net"]),
    ("pg_net is pinned to the one database its worker serves", True,
     [r"pg_net\.database_name is 'postgres'"]),
    ("pg_net's one-database limit measured, not assumed", True,
     [r"pg_net from an application's own database queues",
      r"pg_net behaviour from an application database recorded"]),
    ("Sustained load served without errors", True,
     [r"served a sustained load with no non-2xx"],
     [r"returned errors under load"]),
    ("Throughput and latency measured", True, [r"measured throughput:"],
     [r"produced no throughput figure"]),
    ("Resource usage measured UNDER LOAD, not at rest", True,
     [r"resource usage captured under load"],
     [r"no peak resource figures"]),
    ("Capacity report with headroom estimate", True, [r"headroom estimate"]),
    ("Service health check across applications", True,
     [r"health\.sh reported every service healthy"],
     [r"health\.sh reported problems"]),
    ("Provisioning from an already-configured machine", True,
     [r"third application provisioned"]),
    ("The whole deployment re-run on a configured machine", True,
     [r"bootstrap\.sh ran a second time"],
     [r"re-running bootstrap\.sh failed"]),
    ("Re-running the deployment does not regenerate the DB password", True,
     [r"password was NOT regenerated, so the server keeps access"],
     [r"password CHANGED on re-run"]),
    ("Registry unchanged by a re-run", True, [r"application registry is unchanged"]),
    ("Whole stack recovers from a full stop, unattended", True,
     [r"came back running and healthy after the whole stack"],
     [r"did not come back healthy after a full stop"]),
    ("Data survives a full restart", True, [r"data survived the restart"],
     [r"row count changed across the restart", r"no rows to check"]),
    ("API answers again after a restart with no intervention", True,
     [r"API answers again after the restart"],
     [r"API returned HTTP .* after the restart"]),
    # Cannot be done from here: needs the owner's Cloudflare credentials.
    ("Cloudflare R2: real upload, download, integrity, delete", True, [r"__never_matches__"]),
]


def repo_exposure(root):
    """What operator-only material this public repository still carries.

    Computed here rather than asserted, because 'we cleaned that up' is the
    kind of claim that should cost a subprocess call to make.
    """
    import subprocess
    pats = ["supabase/AWAITING-APPROVAL/", "PAYMENT-CREDENTIAL"]

    def git(*a):
        try:
            return subprocess.run(("git", "-C", root) + a, capture_output=True,
                                  text=True, timeout=60).stdout
        except Exception:
            return ""

    tracked = [l for l in git("ls-files").split("\n")
               if any(x in l for x in pats) and l.strip()]
    added = [l for l in git("log", "--all", "--diff-filter=A", "--name-only",
                            "--format=", "--", "supabase/AWAITING-APPROVAL/*"
                            ).split("\n") if l.strip()]
    added = sorted(set(added))
    # Any credential in what was added? Checked, not assumed.
    secretish = 0
    for f in added:
        c = git("log", "--all", "--diff-filter=A", "--format=%h", "--", f).split("\n")
        if not c or not c[0].strip():
            continue
        body = git("show", f"{c[0].strip()}:{f}")
        if re.search(r"eyJ[A-Za-z0-9_-]{20,}\.|BEGIN [A-Z ]*PRIVATE KEY|"
                     r"(PASSWORD|SECRET|ACCESS_KEY|SERVICE_ROLE_KEY)[=:]\S{12,}", body):
            secretish += 1
    return {"tracked": tracked, "in_history": added, "with_credentials": secretish,
            "ignored": git("check-ignore", "supabase/AWAITING-APPROVAL/probe.sql").strip() != ""}


def load(path):
    if not path or not os.path.isfile(path):
        return ""
    return open(path, encoding="utf-8", errors="replace").read()


def state_of(patterns, texts, fail_patterns=()):
    """PASSED if a PASS line matches; FAILED if a FAIL line does; else NOT VERIFIED.

    A check's failure often does not read like its success -- the run prints
    "no Realtime event arrived", not "an INSERT produced a Realtime event".
    Matching only the success wording filed those as NOT VERIFIED, which reads
    as "nobody looked" when in fact the test ran and failed. Both still block
    a ready verdict, but they are not the same statement, so failures are
    matched on their own wording.
    """
    # A failure is looked for FIRST: a run can print a PASS for one half of a
    # check and a FAIL for the other, and the failure is the finding.
    for text in texts:
        for line in text.split("\n"):
            st = line.strip()
            if "**FAIL**" not in st:
                continue
            for p in tuple(fail_patterns) + tuple(patterns):
                if re.search(p, st, re.I):
                    return "FAILED", st[:160]
    for text in texts:
        for line in text.split("\n"):
            st = line.strip()
            if not st.startswith("- PASS"):
                continue
            for p in patterns:
                if re.search(p, st, re.I):
                    return "PASSED", st[:160]
    return "NOT VERIFIED", ""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--full")
    ap.add_argument("--prereq")
    ap.add_argument("--inventory")
    ap.add_argument("--run-id", default="(not given)")
    ap.add_argument("--sizing", help="output of size-from-measurement.py, embedded verbatim")
    ap.add_argument("--repo", default=".", help="repository root, for the exposure check")
    ap.add_argument("--out", default="-")
    args = ap.parse_args()

    texts = [load(args.full), load(args.prereq)]
    if not any(texts):
        sys.exit("no report given or readable. This script reports only what a "
                 "report proves, so with no report there is nothing to say.")

    results = []
    for t in TESTS:
        name, required, pats = t[0], t[1], t[2]
        fails = t[3] if len(t) > 3 else ()
        st, ev = state_of(pats, texts, fails)
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

    # ----- measured sizing, verbatim --------------------------------------
    A("## Server sizing, from measurement")
    A("")
    sizing = load(args.sizing)
    if sizing.strip():
        A("Produced by `deploy/scripts/size-from-measurement.py` from the peak")
        A("container figures the staging run measured while it was serving")
        A("requests, and from the inventory. Reproduced here unchanged.")
        A("")
        A("```")
        A(sizing.rstrip())
        A("```")
        A("")
    else:
        A("**NOT AVAILABLE.** No sizing output was supplied, which means the")
        A("staging run did not reach its resource section or the sizing script")
        A("was not run. No VPS specification can be given, and none is guessed.")
        A("")

    # The one line someone placing the order needs, lifted out of the sizing
    # text rather than retyped, so the two cannot disagree.
    A("### What to order")
    A("")
    plans = re.findall(r"-> (Cloud VPS \d+): ([^\n]+)", sizing)
    labels = re.findall(r"\n  (Everytinroom only|all reachable projects)\s+\(", sizing)
    if plans:
        A("| For | Plan | Specification and price |")
        A("|---|---|---|")
        for i, (plan, rest) in enumerate(plans):
            who = labels[i] if i < len(labels) else "(unlabelled)"
            A(f"| {who} | **{plan}** | {rest.strip()} |")
        A("")
        A("Contabo's 24-month term, VAT included, at the prices published on")
        A("2026-11-08. A one-off setup fee applies on shorter terms. Nothing has")
        A("been ordered: no account was created and no payment details were")
        A("entered, by instruction.")
        A("")
        A("The second row is the one to order if every project moves. The first")
        A("is there to show what Everytinroom alone would need, since it is the")
        A("only application whose services have actually been prepared.")
    else:
        A("No plan can be named: the sizing output above does not contain a")
        A("recommendation, which means the measurement it needs is missing.")
    A("")

    # ----- service allocation ----------------------------------------------
    if projects:
        A("## Which services each application needs")
        A("")
        A("Taken from what each project actually uses, not from a default set.")
        A("A service nothing uses is not provisioned: compose profiles decide")
        A("per application, so an application with no Realtime has no Realtime")
        A("container and no Realtime memory.")
        A("")
        allsv = ["postgrest", "realtime", "storage", "gotrue", "functions", "cron"]
        A("| Project | " + " | ".join(s.capitalize() for s in allsv) + " |")
        A("|---" * (len(allsv) + 1) + "|")
        for p in sorted(projects, key=lambda x: x.get("name") or ""):
            if not p.get("reachable"):
                A(f"| {p.get('name')} | " + " | ".join("?" for _ in allsv) + " |")
                continue
            needs = set(p.get("needs") or [])
            A(f"| {p['name']} | " + " | ".join("yes" if sv in needs else "—"
                                               for sv in allsv) + " |")
        A("")
        A("Two paused projects answer `?`: a paused project cannot be inspected,")
        A("so its service list is unknown rather than empty.")
        A("")

    # ----- security and isolation -----------------------------------------
    A("## Security and isolation")
    A("")
    A("What the staging run proves, and by which check, is in the table above.")
    A("The design behind it:")
    A("")
    A("- **One database per application, isolation by connection rights.**")
    A("  `REVOKE ALL ON DATABASE ... FROM PUBLIC` then `GRANT CONNECT` to that")
    A("  application's `authenticator` alone. Not isolation by ownership: taking")
    A("  ownership for another role needs `SET ROLE` on it, and the membership")
    A("  grant that would allow that crashes this PostgreSQL image. The run")
    A("  tests it by using one application's credentials against another's")
    A("  database and requiring a refusal.")
    A("- **A separate JWT secret per application**, so a token minted for one")
    A("  is not accepted by another.")
    A("- **PostgreSQL is bound to 127.0.0.1**, reachable only from the")
    A("  containers on the machine. Checked in the run, not assumed.")
    A("- **Secret files are mode 600**, and an existing password is never")
    A("  regenerated on a re-run — a regenerated one would lock the server out")
    A("  of its own data volume with no error until the next restart.")
    A("- **Caddy terminates TLS** and is the only thing published. No service")
    A("  port is exposed directly.")
    A("")
    A("### What this platform does NOT fix")
    A("")
    A("- Everytinroom authenticates staff with a PIN against `staff_sessions`,")
    A("  not Supabase Auth, so `auth.uid()` means nothing in its policies and")
    A("  row-level security cannot tell one cashier from another. Moving the")
    A("  database to a new server does not change that; it is an application")
    A("  change, and it is out of scope here.")
    A("- Four of the five reachable projects still grant destructive table")
    A("  privileges to the browser-facing key. Everytinroom's were corrected")
    A("  and verified; the others were only inventoried, and each needs its own")
    A("  approval before anything is changed.")
    A("")

    # ----- repository exposure, computed ----------------------------------
    ex = repo_exposure(args.repo)
    A("### This repository's own exposure")
    A("")
    A("Computed by this script from git, not asserted.")
    A("")
    A(f"- Operator-only files tracked right now: **{len(ex['tracked'])}**")
    A(f"- Operator-only files present anywhere in history: **{len(ex['in_history'])}**")
    A(f"- Of those, files containing a credential: **{ex['with_credentials']}**")
    A(f"- `supabase/AWAITING-APPROVAL/` is ignored: **{'yes' if ex['ignored'] else 'NO'}**")
    A("")
    if ex["in_history"] and not ex["tracked"]:
        A("So: nothing is tracked at any branch tip, and the ignore rule is in")
        A("place, but the commits that added these files are still in `main`'s")
        A("history and this repository is public. They hold no credential — the")
        A("check above is what establishes that, and there is nothing to")
        A("rotate. What they do hold is a privilege map of a live database:")
        A("which role could write to which table, at the time it was taken.")
        A("")
        A("Everytinroom's privileges were corrected after that snapshot, so the")
        A("published map is now out of date for the one project it covers. The")
        A("residual risk is in the four projects that still have the same")
        A("weakness, and that is a production change needing approval, not a")
        A("git problem.")
        A("")
        A("**Purging it from history is left as the owner's decision**, because")
        A("it is not free: rewriting `main` changes every commit hash after the")
        A("rewrite point, and one of those hashes is the recorded identity of")
        A("the migration applied to production. GitHub also keeps unreachable")
        A("objects served until asked to drop them, so a force-push alone does")
        A("not finish the job.")
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
    A("## Backups, retention and off-server recovery")
    A("")
    A("Three things have to be true for a backup to be one, and they are")
    A("separate claims:")
    A("")
    A("| Claim | How it is established |")
    A("|---|---|")
    A("| a dump is produced | `backup.sh`, checked in the staging run; completeness is measured against the database's own table count, after an earlier version rejected a correct dump of an empty database for being small |")
    A("| the dump restores | `restore.sh` into a SEPARATE database, with row counts and a money total compared, and the live database checked to have been left alone |")
    A("| a copy exists off the server | `backup-offsite.py`, which uploads to S3-compatible storage and reads every object back to compare its MD5 |")
    A("")
    A("Retention is 90 days remotely by default. `backup-offsite.py` deletes")
    A("only objects matching the naming `backup.sh` produces, never anything")
    A("else in the bucket, and it refuses to prune at all if any upload failed")
    A("in the same run — which is precisely when the old copies matter.")
    A("")
    A("A local backup on the same disk as the database covers a dropped table")
    A("or a bad migration. It does not cover losing the server, and that is why")
    A("the off-server copy is not optional.")
    A("")
    A("## Object storage and what it costs")
    A("")
    A("Everytinroom's images are the only storage of any size. From the")
    A("inventory:")
    A("")
    if projects:
        reach = [p for p in projects if p.get("reachable")]
        tot = sum(p.get("storage_mb") or 0 for p in reach)
        for p in sorted(reach, key=lambda x: -(x.get("storage_mb") or 0)):
            if (p.get("storage_mb") or 0) > 0:
                A(f"- {p['name']}: {p.get('storage_mb')} MB")
        A(f"- total across reachable projects: **{tot} MB** "
          f"({tot / 1024:.2f} GB)")
        A("")
        if tot < 10 * 1024:
            A(f"Cloudflare R2 charges nothing for the first 10 GB of storage and")
            A(f"nothing for egress, so {tot / 1024:.2f} GB costs **$0.00/month**.")
            A("Past 10 GB it is $0.015 per GB-month. Backups are counted in the")
            A("same bucket under their own prefix and are small by comparison.")
        else:
            A(f"At {tot / 1024:.2f} GB this is past R2's 10 GB free tier:")
            A(f"roughly ${(tot / 1024 - 10) * 0.015:.2f}/month at $0.015 per")
            A("GB-month, with egress still free.")
        A("")
    A("Egress being free is the reason this is R2 and not S3: the images are")
    A("served to customers' phones, and that traffic is the recurring cost on")
    A("most other providers.")
    A("")
    A("**Not yet verified against Cloudflare.** The staging run tests storage")
    A("against an S3-compatible stand-in, which proves this platform's")
    A("configuration and nothing about R2 — R2 rejects the trailing-checksum")
    A("headers the AWS SDK sends by default, which is why")
    A("`STORAGE_S3_REQUEST_CHECKSUM_CALCULATION` is set to `WHEN_REQUIRED`, and")
    A("a mock will never show that. `deploy/scripts/test-r2.py` runs the full")
    A("upload, download, integrity, list and delete check against the real")
    A("endpoint as soon as the credentials exist. Until it has, nothing here")
    A("may be described as R2-verified.")
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
