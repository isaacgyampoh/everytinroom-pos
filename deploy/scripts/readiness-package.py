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
    ("Every application's compose configuration is valid", True,
     [r"compose configuration is valid, so every service"],
     [r"compose configuration is INVALID"]),
    ("Only requested services provisioned", True,
     [r"has NO auth schema", r"profiles are 'auth'"]),
    ("Database isolation: credentials refused across applications", True,
     [r"credentials are REFUSED by", r"cannot read alpha_shop's data"]),
    ("Separate JWT secret per application", True, [r"different JWT secrets"]),
    ("GoTrue runs for the application that needs it", True,
     [r"GoTrue is running for the application"],
     [r"GoTrue (never|did not) become?.? healthy"]),
    ("GoTrue answers through the proxy", True,
     [r"GoTrue answers /auth/v1/health"],
     [r"GoTrue health returned HTTP"]),
    ("A user can be created through GoTrue's admin API", True,
     [r"user was created through GoTrue's admin API"],
     [r"admin user creation returned HTTP"]),
    ("Open self-registration is refused", True,
     [r"open self-registration is refused"],
     [r"anyone can register on this application"]),
    ("The user lands in that application's own auth.users", True,
     [r"user is in \w+'s own auth\.users"],
     [r"user is not in \w+'s auth\.users"]),
    ("Sign-in returns a usable token", True,
     [r"sign-in returned an access token", r"token identifies that user"],
     [r"sign-in returned HTTP .* with no access token",
      r"did not identify the user"]),
    ("One application's token is rejected by another's API", True,
     [r"token is REJECTED by alpha_shop's API"],
     [r"the JWT secrets are not separating them"]),
    ("Secret files are mode 600", True, [r"\.env is mode 600"]),
    ("Existing password never regenerated on re-run", True,
     [r"existing password is NOT regenerated", r"existing credentials found"]),
    ("Provisioning is idempotent", True,
     [r"re-provisioning .* changed nothing", r"re-provisioning kept the existing password"]),
    ("PostgREST answers through the proxy", True,
     [r"PostgREST answers through the proxy", r"PostgREST answers \(HTTP"],
     [r"PostgREST through the proxy returned HTTP", r"-rest never became healthy"]),
    ("Realtime is ready before a client subscribes", True,
     [r"Realtime is ready after its migrations completed"],
     [r"Realtime did not become ready after its migrations"]),
    ("Realtime subscription accepted", True, [r"subscription was accepted"],
     [r"subscription was not accepted", r"\.realtime is not running"]),
    ("The privilege Realtime's migrations need is actually held", True,
     [r"may set log_min_messages, so migration 20230328144023"],
     [r"may NOT set log_min_messages"]),
    ("Realtime's own migrations replay under this platform's privileges", True,
     [r"tenant migrations replay cleanly here"],
     [r"tenant migrations do not replay on this server"]),
    ("Realtime's own schema and WAL reader exist", True,
     [r"list_changes present: 1", r"realtime\.list_changes\(\) exists"],
     [r"list_changes present: 0", r"list_changes\(\) is MISSING"]),
    ("A second, independent Realtime tenant also delivers", True,
     [r"SECOND tenant also delivers a database change"],
     [r"second tenant delivered nothing"]),
    ("Each Realtime tenant has its own replication slot", True,
     [r"each Realtime tenant has its own replication slot"],
     [r"only \d+ Realtime replication slot for two tenants"]),
    ("Both tenants' replication slots are active", True,
     [r"Realtime replication slot\(s\) are active, so both tenants"],
     [r"replication slot\(s\) are active; a tenant with an inactive slot"]),
    ("The slots belong to different databases", True,
     [r"slots belong to different databases"],
     [r"slots belong to \d+ database\(s\); the tenants are not separated"]),
    ("A change in one application does not reach another's channel", True,
     [r"did NOT reach \w+'s channel"],
     [r"WAS delivered to \w+ — one application can see",
      r"cross-tenant check did not complete"]),
    ("Realtime becomes ready again after a restart", True,
     [r"came back and became ready after a restart"],
     [r"did not become ready after a restart"]),
    ("Delivery resumes after Realtime is restarted", True,
     [r"delivery resumed after the Realtime service was restarted"],
     [r"nothing was delivered after the restart"]),
    # The three migrations named in the acceptance requirement, each checked
    # by number. A count of 91 was my own criterion and the wrong one: the
    # last eight are Supabase-platform delegation that a non-superuser cannot
    # perform and nothing here uses. These three decide whether live updates
    # work.
    ("Realtime migration 20230328144023 applied (creates list_changes)", True,
     [r"migration 20230328144023 is applied"],
     [r"migration 20230328144023 is NOT applied"]),
    ("Realtime migration 20240401105812 applied (the reserved-role one)", True,
     [r"migration 20240401105812 is applied"],
     [r"migration 20240401105812 is NOT applied"]),
    ("Realtime migration 20260326120000 applied (the list_changes the poller calls)", True,
     [r"migration 20260326120000 is applied"],
     [r"migration 20260326120000 is NOT applied"]),
    ("Migration 69's actual function definition, not just its version row", True,
     [r"returns slot_changes_count, which is the definition"],
     [r"has the OLD definition, with no slot_changes_count",
      r"list_changes\(\) does not exist at all"]),
    ("Realtime's role may execute list_changes", True,
     [r"may execute realtime\.list_changes"],
     [r"may NOT execute realtime\.list_changes"]),
    ("All 91 tenant migrations applied, which Realtime requires to run CDC", True,
     [r"realtime\.schema_migrations: 91 of 91"],
     [r"stops its change-data-capture extension while any",
      r"could not apply migrations 84-91"]),
    ("Realtime's setup completed before a client subscribed", True,
     [r"post-start completed Realtime's setup"],
     [r"post-start could not complete Realtime's setup"]),
    ("Realtime's role is a member of supabase_realtime_admin", True,
     [r"member of supabase_realtime_admin, so its migrations can complete"],
     [r"is NOT a member of supabase_realtime_admin"]),
    ("The Realtime client harness actually ran", True,
     [r"client 2\.118\.0 installed"],
     [r"could not be prepared, so NO delivery test ran",
      r"could NOT be installed"]),
    ("Both client versions tested under identical conditions", True,
     [r"client version WAS the cause", r"both client versions deliver"],
     [r"BOTH client versions fail to receive the event",
      r"inconclusive comparison"]),
    # The arm that decides anything. The comparison above establishes that the
    # client library matters; this says whether the library IN THE SHIPPING
    # BUNDLE receives the event. Without it the suite could go green on a
    # version the till does not use, which is the mistake run 36 made.
    ("The supabase-js version the application ships delivers", True,
     [r"version the application actually ships \([0-9.]+\) receives the event"],
     [r"does NOT receive the event"]),
    # "Live" is a claim about time, and nothing measured it until now. The
    # figure runs from the API confirming the insert -- the row is committed
    # by then -- to the client's callback, so it covers WAL decode, the
    # poller, the broadcast and the socket.
    ("Delivery latency measured, not assumed", True,
     [r"reached the subscribed client in \d+ms"],
     [r"no delivery latency was recorded",
      r"past the 3000ms bound",
      r"there is no latency to report"]),
    # The real application, in a browser. Separate from the synthetic client,
    # because a synthetic client proving delivery does not prove the
    # application's own subscription and render path do.
    ("The browser harness itself ran", True,
     [r"Playwright installed and importable"],
     [r"playwright could not be installed",
      r"does not import", r"chromium could not be installed"]),
    ("The real application's Login screen renders", True,
     [r"application's own Login screen rendered"],
     [r"rendered no PIN entry"]),
    ("verify_pin accepts a staging PIN and the till opens", True,
     [r"verify_pin\(\) accepted the PIN and the till opened"],
     [r"did not reach its logged-in interface"]),
    ("The real application receives a live event and SHOWS it", True,
     [r"RECEIVED THE LIVE EVENT AND SHOWED IT IN THE INTERFACE"],
     [r"did not show the sale: its pos-live subscription delivered nothing",
      r"the real application did not show the live event"]),
    # A shop has more than one till, and the whole point of live updates is
    # that a sale rung up at one appears at the other. One browser proves a
    # subscription works; it does not prove that.
    # App.jsx subscribes to three tables. Only the one with a popup had ever
    # been exercised through the interface; the other two just call a
    # refresher, so the only way to see them work is to be on the page that
    # shows the data and watch it change.
    ("A product change appears in the interface", True,
     [r"a product change appeared in the interface without a refresh"],
     [r"a product change did NOT appear", r"could not insert the product probe"]),
    ("A website order change appears in the interface", True,
     [r"a website order change appeared in the interface without a refresh"],
     [r"a website order change did NOT appear", r"could not insert the website order probe"]),
    ("Two workstations both receive the same sale", True,
     [r"BOTH workstations showed the same sale without a refresh"],
     [r"of 2 workstations showed the sale",
      r"could not insert the multi-workstation sale",
      r"a second workstation could not sign in",
      r"the second workstation could not be opened"]),
    # A shop connection drops. These two say that nothing about that, or
    # about closing and reopening the till, leaves it silently stale.
    ("Live updates resume after a network interruption", True,
     [r"live updates resumed after a network interruption, unattended"],
     [r"did NOT resume after a network interruption",
      r"could not insert the reconnection probe",
      r"the network interruption check could not run"]),
    ("Live updates work after the application is restarted", True,
     [r"live updates work after the application was restarted"],
     [r"did NOT work after the application was restarted",
      r"did not reach its interface again after a restart",
      r"the application restart check could not run"]),
    ("The browser run finished rather than hanging", True,
     [r"passed \d+  failed \d+  blocked \d+"],
     [r"did not finish within 7 minutes"]),
    ("Another application's sale does not appear in this one's interface", True,
     [r"did not appear in this application's interface"],
     [r"APPEARED in \w+'s interface"]),
    ("Realtime delivers a database change end to end", True,
     [r"INSERT produced a Realtime event"],
     [r"no Realtime event arrived"]),
    ("Storage grants applied after the service's own migrations", True,
     [r"post-start granted the storage schema"],
     [r"post-start did not complete", r"storage-api never became healthy"]),
    ("Storage privileges verified as EFFECTIVE, not as a statement that ran", True,
     [r"checked as effective privileges"],
     [r"effective privileges are MISSING", r"created no tables, so there is nothing to grant"]),
    ("service_role can write every storage table", True,
     [r"service_role can INSERT into every storage table"],
     [r"service_role cannot INSERT into"]),
    ("service_role may execute storage's functions", True,
     [r"may EXECUTE all \d+ storage function"],
     [r"may execute only \d+ of"]),
    ("Object storage multi-delete works", True,
     [r"MULTI-DELETE of two objects accepted",
      r"both objects are gone from the bucket after the multi-delete"],
     [r"multi-delete returned HTTP", r"multi-deleted objects are still in the bucket"]),
    ("Object storage upload", True, [r"UPLOAD through storage-api"],
     [r"upload returned HTTP", r"storage-api never became healthy"]),
    ("Object storage download returns identical bytes", True,
     [r"DOWNLOAD returned byte-identical content"],
     [r"download returned HTTP .* and the bytes differ", r"storage-api never became healthy"]),
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
    # Row counts and a money total only ever looked at public. A restore that
    # dropped everything OUTSIDE public passed both, and storage.objects is
    # where a product photo's location lives -- lose it and the catalogue has
    # no pictures even though every byte is still in R2.
    ("Schemas outside public survive the restore", True,
     [r"schema survived the restore with all",
      r"storage\.objects exists in the restored database"],
     [r"DROP errors were NOT harmless",
      r"did not survive the restore",
      r"storage\.objects is missing from the restored database"]),
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
     [r"health\.sh ran to completion and reported every service healthy"],
     [r"health\.sh ran to completion and found problems",
      r"health\.sh did not run to completion"]),
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
    # Was blocked on the owner's credentials; they exist now, so this is read
    # from the R2 verification report rather than being permanently unprovable.
    ("Cloudflare R2: credentials accepted on the real service", True,
     [r"bucket is reachable and the credentials are accepted"],
     [r"access denied", r"does not exist at that endpoint"]),
    ("Cloudflare R2: upload accepted", True, [r"UPLOAD accepted"],
     [r"upload failed with HTTP"]),
    ("Cloudflare R2: download is byte-identical", True,
     [r"DOWNLOAD returned byte-identical content"],
     [r"download returned \d+ bytes, expected"]),
    ("Cloudflare R2: ETag usable for verifying copies", True,
     [r"ETag is a plain MD5 and matches", r"ETag is multipart"],
     [r"does not match the MD5", r"no ETag was returned"]),
    ("Cloudflare R2: object appears in a listing", True,
     [r"LIST shows the object under its prefix"],
     [r"LIST did not show the object"]),
    ("Cloudflare R2: delete accepted", True, [r"DELETE accepted"],
     [r"delete failed with HTTP"]),
    ("Cloudflare R2: deletion confirmed by a second request", True,
     [r"the object is gone — confirmed by a second request"],
     [r"still answers HTTP .* after the delete"]),
    ("Cloudflare R2: the SDK's default checksum shape, tested for real", True,
     [r"trailing-checksum upload was ACCEPTED",
      r"trailing-checksum upload was REFUSED"],
     [r"WHEN_REQUIRED shape was refused too"]),
]


# The owner's seven acceptance requirements, each mapped to the checks that
# decide it. Written out rather than inferred, so a requirement cannot quietly
# lose a check: if a name here does not match a test above, it reads NOT
# TESTED, which is the honest answer for a check nobody wrote.
REQUIREMENTS = [
    ("Preserve all existing staging evidence sets", []),
    ("Realtime: migrations 30, 40 and 69, a real client subscription, event "
     "delivery, tenant isolation and restart recovery", [
        "The privilege Realtime's migrations need is actually held",
        "Realtime's role is a member of supabase_realtime_admin",
        "Realtime's own migrations replay under this platform's privileges",
        "Realtime migration 20230328144023 applied (creates list_changes)",
        "Realtime migration 20240401105812 applied (the reserved-role one)",
        "Realtime migration 20260326120000 applied (the list_changes the poller calls)",
        "Migration 69's actual function definition, not just its version row",
        "Realtime's role may execute list_changes",
        "All 91 tenant migrations applied, which Realtime requires to run CDC",
        "Realtime's setup completed before a client subscribed",
        "Realtime is ready before a client subscribes",
        "Realtime's own schema and WAL reader exist",
        "Realtime subscription accepted",
        "The Realtime client harness actually ran",
        "Both client versions tested under identical conditions",
        "The supabase-js version the application ships delivers",
        "Delivery latency measured, not assumed",
        "Realtime delivers a database change end to end",
        "The browser harness itself ran",
        "The real application's Login screen renders",
        "verify_pin accepts a staging PIN and the till opens",
        "The real application receives a live event and SHOWS it",
        "A product change appears in the interface",
        "A website order change appears in the interface",
        "Two workstations both receive the same sale",
        "Live updates resume after a network interruption",
        "Live updates work after the application is restarted",
        "The browser run finished rather than hanging",
        "Another application's sale does not appear in this one's interface",
        "A second, independent Realtime tenant also delivers",
        "Each Realtime tenant has its own replication slot",
        "Both tenants' replication slots are active",
        "The slots belong to different databases",
        "A change in one application does not reach another's channel",
        "Realtime becomes ready again after a restart",
        "Delivery resumes after Realtime is restarted",
     ]),
    ("Auth, cron, backup/restore and service recovery", [
        "GoTrue runs for the application that needs it",
        "GoTrue answers through the proxy",
        "A user can be created through GoTrue's admin API",
        "Open self-registration is refused",
        "The user lands in that application's own auth.users",
        "Sign-in returns a usable token",
        "One application's token is rejected by another's API",
        "pg_net is pinned to the one database its worker serves",
        "pg_net's one-database limit measured, not assumed",
        "Scheduled job registered in another database",
        "Scheduled job actually executed",
        "Scheduled job reached a new API URL",
        "Backup produces a dump and cluster globals",
        "Restore into a SEPARATE database",
        "Restore verified by row count and a money total",
        "Live database untouched by the restore rehearsal",
        "Schemas outside public survive the restore",
        "Restart recovery, unattended",
        "Whole stack recovers from a full stop, unattended",
        "Data survives a full restart",
        "API answers again after a restart with no intervention",
        "Service health check across applications",
     ]),
    ("Cloudflare R2, verified against the real service", [
        "Cloudflare R2: credentials accepted on the real service",
        "Cloudflare R2: upload accepted",
        "Cloudflare R2: download is byte-identical",
        "Cloudflare R2: ETag usable for verifying copies",
        "Cloudflare R2: object appears in a listing",
        "Cloudflare R2: delete accepted",
        "Cloudflare R2: deletion confirmed by a second request",
        "Cloudflare R2: the SDK's default checksum shape, tested for real",
     ]),
    ("The complete deployment re-run from a clean Linux environment", [
        "Docker installed automatically on a clean machine",
        "Compose plugin installed",
        "Shared stack starts",
        "PostgreSQL healthy and answering",
        "Central roles and application registry",
        "Two applications provisioned with different services",
        "Every application's compose configuration is valid",
        "The whole deployment re-run on a configured machine",
        "Re-running the deployment does not regenerate the DB password",
        "Registry unchanged by a re-run",
        "Provisioning from an already-configured machine",
     ]),
    ("Measured capacity for all seven inventoried projects", [
        "Sustained load served without errors",
        "Throughput and latency measured",
        "Resource usage measured UNDER LOAD, not at rest",
        "Capacity report with headroom estimate",
     ]),
    ("The final migration-readiness package", []),
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
    ap.add_argument("--extra", action="append", default=[],
                    help="more evidence files, e.g. the R2 verification report")
    ap.add_argument("--inventory")
    ap.add_argument("--run-id", default="(not given)")
    ap.add_argument("--sizing", help="output of size-from-measurement.py, embedded verbatim")
    ap.add_argument("--repo", default=".", help="repository root, for the exposure check")
    ap.add_argument("--evidence-dir", default=None,
                    help="where archived staging runs are kept, for requirement 1")
    ap.add_argument("--out", default="-")
    args = ap.parse_args()

    texts = [load(args.full), load(args.prereq)] + [load(x) for x in args.extra]
    if not any(texts):
        sys.exit("no report given or readable. This script reports only what a "
                 "report proves, so with no report there is nothing to say.")

    results = []
    for t in TESTS:
        name, required, pats = t[0], t[1], t[2]
        fails = t[3] if len(t) > 3 else ()
        st, ev = state_of(pats, texts, fails)
        results.append((name, required, st, ev, pats))

    # A test whose pattern is the never-matching sentinel cannot be run from
    # here at all. It is blocked, not unverified, and saying so is the
    # difference between "nobody looked" and "nobody could".
    blocked = [r for r in results if r[2] == "NOT VERIFIED" and
               any("__never_matches__" in p for p in r[4])]
    results = [r for r in results if r not in blocked]
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
    A("Four categories, kept apart on purpose. A thing proved on a real server")
    A("and a thing proved on a laptop are not the same claim, and neither is")
    A("the same as a thing nobody could test yet.")
    A("")
    A("| | Count | What it means |")
    A("|---|---|---|")
    A(f"| **Verified on a real server** | {len(passed)} | a named check in the "
      f"staging run's report passed. The staging machine is a disposable Ubuntu "
      f"server that installs Docker from scratch and runs the whole platform. |")
    A(f"| **Failed** | {len(failed)} | a named check in that report failed. "
      f"Listed below with the line that failed. |")
    A(f"| **Not verified** | {len(unver)} | no check for it was found in the "
      f"report. Not a soft pass: it means nobody looked, or the run did not "
      f"reach it. |")
    A(f"| **Blocked by missing credentials** | {len(blocked)} | cannot be run "
      f"from here at all. Listed under \"What still requires an account "
      f"action\". |")
    A("")
    A("Separately, and NOT counted above, there is evidence that comes only from")
    A("local and CI tests -- the section \"Verified only in local tests\" says")
    A("what each of those proves and, more to the point, what it does not.")
    A("")
    if ready:
        A("**Every required acceptance test has passing evidence from a real server.**")
    else:
        A("**NOT READY.** Required tests are failing or unverified; they are listed below.")
    A("")
    # ----- the owner's acceptance requirements, rolled up ------------------
    A("## Acceptance requirements")
    A("")
    A("The seven requirements as they were given, each resolved from the named")
    A("checks below it. A requirement is only PASS when every check under it")
    A("passed; otherwise it carries the worst state any of them has, so nothing")
    A("is rounded up.")
    A("")
    by_name = {r[0]: r[2] for r in results}
    for r in blocked:
        by_name[r[0]] = "BLOCKED"
    rank = {"FAILED": 3, "NOT VERIFIED": 2, "BLOCKED": 1, "PASSED": 0}
    A("| # | Requirement | State | Resolved from |")
    A("|---|---|---|---|")
    # Two of the seven are not staging checks -- they are things done here --
    # so they are established here, from the filesystem, rather than left to
    # read NOT TESTED beside work that was actually done.
    ev_dir = args.evidence_dir or os.path.join(
        os.path.expanduser("~"), "everytinroom-staging-evidence")
    kept = sorted(d for d in os.listdir(ev_dir)
                  if d.startswith("run-")) if os.path.isdir(ev_dir) else []
    with_report = [d for d in kept
                   if os.path.isfile(os.path.join(ev_dir, d, "report.md"))
                   or os.path.isfile(os.path.join(ev_dir, d, "prereq-report.md"))]
    LOCAL = {
        1: (("PASSED" if len(with_report) >= 9 else
             "FAILED" if with_report else "NOT VERIFIED"),
            f"{len(with_report)} run(s) kept in {ev_dir}, each with its report"),
        7: ("PASSED", "this document, generated from the evidence files"),
    }
    for i, (req, names) in enumerate(REQUIREMENTS, 1):
        if not names and i in LOCAL:
            st, shown = LOCAL[i]
            label = {"PASSED": "**PASS**", "FAILED": "**FAIL**",
                     "NOT VERIFIED": "NOT TESTED"}[st]
            A(f"| {i} | {req} | {label} | {shown} |")
            continue
        states = [by_name.get(n, "NOT VERIFIED") for n in names]
        if not states:
            A(f"| {i} | {req} | NOT TESTED | no check is mapped to it |")
            continue
        worst = max(states, key=lambda x: rank[x])
        npass = sum(1 for x in states if x == "PASSED")
        label = {"PASSED": "**PASS**", "FAILED": "**FAIL**",
                 "NOT VERIFIED": "NOT TESTED", "BLOCKED": "**BLOCKED**"}[worst]
        A(f"| {i} | {req} | {label} | {npass} of {len(states)} check(s) passed |")
    A("")
    A("Every check named under a requirement appears in the table that follows,")
    A("with the report line that decided it.")
    A("")
    for i, (req, names) in enumerate(REQUIREMENTS, 1):
        if not names:
            continue
        A(f"**{i}. {req}**")
        A("")
        for n in names:
            st = by_name.get(n, "NOT VERIFIED")
            mark = {"PASSED": "PASS", "FAILED": "**FAIL**",
                    "NOT VERIFIED": "NOT TESTED", "BLOCKED": "**BLOCKED**"}[st]
            A(f"- {mark} — {n}")
        A("")

    A("## Verified on a real server")
    A("")
    A("Every row here is a check that passed, failed, or was never reached in the")
    A("staging run named above. Nothing in this table comes from a local test.")
    A("")
    A("| Test | State | Evidence |")
    A("|---|---|---|")
    for name, required, st, ev, _pats in results:
        mark = {"PASSED": "PASSED", "FAILED": "**FAILED**", "NOT VERIFIED": "NOT VERIFIED"}[st]
        A(f"| {name} | {mark} | {ev.replace('|', '/')[:90] if ev else '—'} |")
    A("")
    if failed:
        A("### Failing")
        A("")
        for name, _, _, ev, _p in failed:
            A(f"- **{name}** — {ev}")
        A("")
    if unver:
        A("### Not verified")
        A("")
        for name, _, _, _, _p in unver:
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
    labels = re.findall(r"\n  (Everytinroom only|the five projects that could be inspected"
                        r"|all seven, the two paused ones ASSUMED)\s+\(", sizing)
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
        A("The last row is the one to order if every project moves, including the")
        A("two that are paused and could not be inspected — those are counted on")
        A("a stated assumption, marked ASSUMED in the sizing above, because")
        A("leaving them out would size a server for five when seven are meant to")
        A("move. The first row shows what Everytinroom alone needs, since it is")
        A("the only application whose services have actually been prepared.")
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
    # ----- scheduled jobs, placed by what they do ------------------------
    if projects:
        jobs = [(p["name"], j) for p in projects if p.get("reachable")
                for j in (p.get("cron_jobs") or [])]
        if jobs:
            http = [x for x in jobs if x[1].get("calls_http")]
            sql = [x for x in jobs if not x[1].get("calls_http")]
            urls = [x for x in jobs if x[1].get("hardcodes_project_url")]
            A("## Scheduled jobs, and where each one has to live")
            A("")
            A(f"**{len(jobs)} job(s) across {len({n for n, _ in jobs})} project(s).** "
              f"{len(http)} make an HTTP call and {len(sql)} run SQL only. "
              f"{len(urls)} have the old project URL written into the job body "
              f"and keep calling the old backend after cutover unless they are "
              f"edited -- without erroring.")
            A("")
            A("pg_net's worker serves exactly one database, so a job that makes")
            A("an HTTP call has to be registered in `postgres`, and a job that")
            A("only runs SQL belongs in its application's own database. That is")
            A("not a preference: a `net.http_post()` from an application")
            A("database queues a row and is never served.")
            A("")
            A("| Project | Job | Schedule | Calls out | Registered in | Old URL inside |")
            A("|---|---|---|---|---|---|")
            for n, j in sorted(jobs, key=lambda x: (x[0], x[1].get("name") or "")):
                where = "`postgres`" if j.get("calls_http") else "the application's own"
                A(f"| {n} | `{j.get('name')}` | `{j.get('schedule')}` | "
                  f"{'yes' if j.get('calls_http') else 'no'} | {where} | "
                  f"{'**yes**' if j.get('hardcodes_project_url') else 'no'} |")
            A("")
            A("`migrate-from-supabase.sh` reads these out of the live `cron.job`")
            A("table at migration time and writes the re-registration SQL with")
            A("each job already placed, flagging any that both read data and")
            A("call out -- those cannot run from either database as written and")
            A("have to be split. The live table is the source of truth, not the")
            A("repository's migrations, which have drifted from it.")
            A("")
            A("One consequence worth stating: every project's HTTP jobs end up")
            A("registered in the same `postgres` database, so `cron.job` there")
            A("lists jobs belonging to several applications. Only the server's")
            A("administrator can read it, and no application can see another's")
            A("data through it, but it is shared state and worth knowing about.")
            A("")

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

    A("## Verified only in local tests")
    A("")
    A("These run on a laptop or in CI, against a real PostgreSQL but not against")
    A("the platform. They are listed separately because they are a weaker claim,")
    A("and because the difference has already mattered: a local run has a")
    A("superuser where the real server does not, and a tool that passed locally")
    A("gave a confidently wrong answer on the server for exactly that reason.")
    A("")
    A("| Suite | What it proves | What it cannot |")
    A("|---|---|---|")
    A("| `validate-all.sh` | the SQL parses, no file takes ownership or acts as "
      "another role, no secret or operator-only file is committed, every path "
      "the scripts reach for exists, templates have no stray placeholders | "
      "nothing about running containers |")
    A("| `test-provision-sql.sh` | the provisioning SQL runs against a real "
      "PostgreSQL; cross-application credentials are refused; PostgREST's role "
      "switching behaves; the storage grants land as effective privileges | it "
      "connects as a superuser, so permission walls that only appear for a "
      "non-superuser do not reproduce — it says so in its own output |")
    A("| `test-realtime-migrations.py` | Realtime's own tenant migrations "
      "replay as a non-superuser, and that the one grant this platform adds is "
      "what makes the difference, in both directions | that Ecto drives them "
      "identically, and anything about a real subscribed client |")
    A("| `test-cron-placement.py` | every scheduled job the inventory found is "
      "re-registered in the database where it can run, schedule and command "
      "preserved exactly | that the jobs themselves do the right thing, which "
      "would mean running production's work |")
    A("| `test-bootstrap-local.sh` | secret handling, config generation and the "
      "memory arithmetic across machine sizes | anything needing Docker |")
    A("")
    A("The staging run includes the first four of those as well, so where a row")
    A("above also appears in the real-server table, the real-server result is")
    A("the one that counts.")
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
    if blocked:
        A("### Blocked by missing credentials, specifically")
        A("")
        for name, _, _, _, _p in blocked:
            A(f"- **{name}** — cannot be attempted from here. It is not counted as")
            A("  passed or failed, because neither would be true.")
        A("")
        A("Until these run, nothing in this package describes them as working.")
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

    # ----- remaining risks, derived ---------------------------------------
    A("## Remaining risks")
    A("")
    A("Derived from the states above and the inventory, not listed by hand, so")
    A("this section cannot quietly fall out of date with the evidence.")
    A("")
    A("| Risk | Why it is open | What closes it |")
    A("|---|---|---|")
    for name, _, st, ev, _p in results:
        if st == "FAILED":
            A(f"| {name} is FAILING | the run recorded a failure: "
              f"{ev.replace('|', '/')[:70]} | fix the cause and re-run; the "
              f"verdict is computed from the report, so it cannot be signed off "
              f"while this stands |")
    for name, _, st, _, _p in results:
        if st == "NOT VERIFIED":
            A(f"| {name} is unproven | no check for it was found in any report "
              f"| run the check; until then this capability is not claimed |")
    # Risks that are true regardless of how the run went.
    A("| No VPS has ever run this | every result here is from a CI runner, "
      "which is a different machine with different disks | provision the "
      "server and re-run the same staging script on it before cutover |")
    A("| The production database has never been restored here | staging runs "
      "generated rows, so nothing proves the real dump restores or that its "
      "functions, policies and publications survive | restore a copy of the "
      "dump into a scratch database on the new server and run "
      "`verify-migration.sh` against it |")
    if projects:
        paused = [p.get("name") for p in projects if not p.get("reachable")]
        if paused:
            A(f"| {len(paused)} project(s) cannot be assessed at all | they are "
              f"paused, so their size, extensions and services are unknown | "
              f"resume each one long enough to inspect it, or decide it is not "
              f"migrating |")
        flagged = [(p["name"], f) for p in projects if p.get("reachable")
                   for f in (p.get("flags") or [])]
        if flagged:
            A(f"| {len(flagged)} per-project finding(s) from the inventory | "
              f"listed under the per-project notes above | each is that "
              f"project's own decision and needs its own approval |")
    A("| Scheduled jobs that both read data and call out | pg_net serves one "
      "database, so such a job cannot run from either side as written | the "
      "migration script flags each one; the SQL half becomes a PostgREST RPC "
      "that the HTTP job calls |")
    A("| Cutover has no rehearsal | the order of restore, Realtime start and "
      "publication creation matters, and doing it once in production is doing "
      "it for the first time | rehearse the whole cutover on the new server "
      "with a copy of the data, with the live system still serving |")
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
