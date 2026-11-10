#!/usr/bin/env python3
"""
Decide whether a feature is ACTIVE, HISTORICAL, INACTIVE or UNKNOWN — before
anybody deletes anything.

    export SUPABASE_ACCESS_TOKEN=...          # read -rs keeps it out of history
    deploy/scripts/feature-status.py --feature whatsapp_agent --all
    deploy/scripts/feature-status.py --feature whatsapp_agent --ref abc123 --repo .
    deploy/scripts/feature-status.py --list

READ-ONLY. Every statement is a SELECT. It deletes nothing and suggests no
deletion for anything it cannot positively establish is dead.

WHY THIS EXISTS
    Everytinroom's WhatsApp agent had zero conversations, zero messages, and
    its master switch set to false. Removing it was right.

    Another project on the same account has the SAME zero rows with the switch
    set to TRUE and a function whose job is to empty those tables. There,
    "zero rows" is evidence of nothing. Reusing the first conclusion would
    have deleted a live feature.

    So emptiness is never sufficient. The rules this enforces:

      1. Never conclude a table is dead because it is empty.
      2. Read the feature switches and configuration.
      3. Read the functions, triggers, scheduled jobs and, where the
         repository is available, the frontend.
      4. Classify as active, historical, inactive or unknown.
      5. UNKNOWN is the default and requires a human decision.
      6. Check a guard against more than one real database before trusting it
         (--all does exactly that).

HOW TO READ THE VERDICT
    ACTIVE      something switched on, scheduled, or called. Do not remove.
    HISTORICAL  holds data nobody writes any more. Keep the data; the code
                may be removable.
    INACTIVE    empty, switched off, and nothing references it. A candidate,
                still behind a guarded script.
    UNKNOWN     could not be established. Needs a person.
"""

import argparse
import json
import os
import subprocess
import sys

API = "https://api.supabase.com/v1"

# A feature is a set of tables plus, optionally, where its on/off switch lives.
# Adding one here is how this becomes reusable rather than a one-off script.
FEATURES = {
    "whatsapp_agent": {
        "description": "WhatsApp AI agent: conversations, messages, settings",
        "tables": ["wa_conversations", "wa_messages", "wa_agent_settings"],
        "switch_table": "wa_agent_settings",
        "switch_key_col": "key",
        "switch_val_col": "value",
        "off_values": ["false", '"false"', "f", "0", "off"],
        "history_tables": ["wa_messages", "wa_conversations"],
        "frontend_hints": ["wa_agent_settings", "wa_conversations", "wa_messages",
                           "WhatsAppChats", "WhatsAppSettings"],
    },
    "social_automation": {
        "description": "Social posting automation",
        "tables": ["social_posts", "social_connections", "social_automation_rules",
                   "social_audit_log"],
        "switch_table": "social_automation_rules",
        "switch_key_col": "name",
        "switch_val_col": "enabled",
        "off_values": ["false", "f", "0"],
        "history_tables": ["social_posts", "social_audit_log"],
        "frontend_hints": ["social_posts", "social_connections", "social_automation_rules"],
    },
    "ussd_payments": {
        "description": "USSD payment sessions",
        "tables": ["ussd_sessions"],
        "switch_table": None,
        "history_tables": ["ussd_sessions"],
        "frontend_hints": ["ussd_sessions", "ussd_code", "next_ussd_code"],
    },
}


def curl_json(url, token, method="GET", body=None):
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
        return {"_raw": out[:300]}


def sql(ref, token, query):
    r = curl_json(f"{API}/projects/{ref}/database/query", token, "POST", {"query": query})
    return r if isinstance(r, list) else []


def one(ref, token, query, default=None):
    rows = sql(ref, token, query)
    if not rows:
        return default
    v = list(rows[0].values())[0]
    return default if v is None else v


def lit(values):
    return ", ".join("'" + str(v).replace("'", "''") + "'" for v in values)


def grep_repo(repo, hints):
    """Frontend references. Absence is only meaningful if the repo is the right
    one, so the caller is told when no repo was given."""
    if not repo or not os.path.isdir(repo):
        return None
    found = {}
    for h in hints:
        try:
            r = subprocess.run(
                ["grep", "-rl", "--include=*.js", "--include=*.jsx",
                 "--include=*.ts", "--include=*.tsx", "--include=*.vue", h,
                 os.path.join(repo, "src")],
                capture_output=True, text=True, timeout=60)
            files = [x for x in r.stdout.strip().split("\n") if x and "test" not in x.lower()]
            if files:
                found[h] = files
        except (subprocess.TimeoutExpired, OSError):
            return None
    return found


def assess(ref, name, feat, token, repo):
    res = {"ref": ref, "feature": name, "present": False, "verdict": "UNKNOWN",
           "reasons": [], "evidence": {}}

    present = [t for t in feat["tables"]
               if one(ref, token,
                      "select count(*) from information_schema.tables "
                      f"where table_schema='public' and table_name='{t}'", 0)]
    res["evidence"]["tables_present"] = present
    res["evidence"]["tables_absent"] = [t for t in feat["tables"] if t not in present]
    if not present:
        res["verdict"] = "ABSENT"
        res["reasons"].append("none of the feature's tables exist in this database")
        return res
    res["present"] = True

    # 1. Rows. Counted, but never sufficient on their own.
    counts = {}
    for t in present:
        counts[t] = one(ref, token, f"select count(*) from public.{t}", 0) or 0
    res["evidence"]["row_counts"] = counts
    has_rows = any(v > 0 for v in counts.values())
    has_history = any(counts.get(t, 0) > 0 for t in feat.get("history_tables", []))

    # 2. The switch.
    switch = {"found": False, "on": None, "values": []}
    st = feat.get("switch_table")
    if st and st in present:
        kc, vc = feat.get("switch_key_col"), feat.get("switch_val_col")
        cols = sql(ref, token,
                   "select column_name as c from information_schema.columns "
                   f"where table_schema='public' and table_name='{st}'")
        colnames = {r["c"] for r in cols}
        if kc in colnames and vc in colnames:
            rows = sql(ref, token,
                       f"select {kc}::text as k, {vc}::text as v from public.{st} order by 1")
            switch["found"] = True
            switch["values"] = [(r["k"], r["v"]) for r in rows]
            offs = {o.lower() for o in feat.get("off_values", [])}
            def is_off(v):
                return v is None or v.strip().strip('"').lower() in offs
            on_rows = [(k, v) for k, v in switch["values"] if not is_off(v)]
            switch["on"] = bool(on_rows)
            switch["on_rows"] = on_rows
        else:
            res["reasons"].append(
                f"{st} exists but has no {kc}/{vc} columns, so the switch could not be read")
    res["evidence"]["switch"] = switch

    # 3. Dependencies: functions, triggers, scheduled jobs, views, foreign keys.
    tl = lit(present)
    like = " or ".join([f"p.prosrc like '%{t}%'" for t in present])
    fns = [r["f"] for r in sql(ref, token,
        "select p.proname as f from pg_proc p join pg_namespace n on n.oid=p.pronamespace "
        f"where n.nspname='public' and ({like}) order by 1")]
    cleanup_fns = [f for f in fns if "cleanup" in f or "purge" in f or "prune" in f]
    trigs = [r["t"] for r in sql(ref, token,
        "select trigger_name as t from information_schema.triggers "
        f"where event_object_table in ({tl}) order by 1")]
    views = [r["v"] for r in sql(ref, token,
        "select table_name as v from information_schema.views where table_schema='public' and ("
        + " or ".join([f"view_definition like '%{t}%'" for t in present]) + ") order by 1")]
    fks = [r["t"] for r in sql(ref, token,
        "select tc.table_name as t from information_schema.table_constraints tc "
        "join information_schema.constraint_column_usage ccu on ccu.constraint_name=tc.constraint_name "
        f"where tc.constraint_type='FOREIGN KEY' and ccu.table_name in ({tl}) "
        f"and tc.table_name not in ({tl}) order by 1")]
    jobs = []
    if one(ref, token, "select count(*) from pg_extension where extname='pg_cron'", 0):
        jobs = [r["j"] for r in sql(ref, token,
            "select jobname as j from cron.job where active and ("
            + " or ".join([f"command like '%{t}%'" for t in present])
            + (" or " + " or ".join([f"command like '%{f}%'" for f in fns]) if fns else "")
            + ") order by 1")]
    res["evidence"].update({"functions": fns, "cleanup_functions": cleanup_fns,
                            "triggers": trigs, "views": views,
                            "incoming_foreign_keys": fks, "cron_jobs": jobs})

    # 4. Frontend.
    fe = grep_repo(repo, feat.get("frontend_hints", []))
    res["evidence"]["frontend"] = fe
    fe_refs = bool(fe)

    # --- the verdict -------------------------------------------------------
    if switch.get("on"):
        res["verdict"] = "ACTIVE"
        res["reasons"].append(
            "a feature switch is not set to off: "
            + ", ".join(f"{k}={v}" for k, v in switch.get("on_rows", [])))
    elif jobs:
        res["verdict"] = "ACTIVE"
        res["reasons"].append("an active scheduled job references it: " + ", ".join(jobs))
    elif fe_refs:
        res["verdict"] = "ACTIVE"
        res["reasons"].append("the frontend references it: " + ", ".join(sorted(fe)))
    elif fks:
        res["verdict"] = "ACTIVE"
        res["reasons"].append("other tables point at it with foreign keys: " + ", ".join(fks))
    elif has_history:
        res["verdict"] = "HISTORICAL"
        res["reasons"].append("holds rows but nothing switched on, scheduled or referencing it")
        res["reasons"].append("KEEP THE DATA; the code may still be removable")
    elif cleanup_fns:
        # The trap. Empty plus something whose job is to empty it proves nothing.
        res["verdict"] = "UNKNOWN"
        res["reasons"].append(
            "the tables are empty, but these functions exist to empty them: "
            + ", ".join(cleanup_fns))
        res["reasons"].append("emptiness is therefore not evidence of disuse")
    elif fe is None and feat.get("frontend_hints"):
        res["verdict"] = "UNKNOWN"
        res["reasons"].append("no repository was given, so the frontend was not checked")
        res["reasons"].append("pass --repo <path> to the application's source")
    elif not switch["found"] and feat.get("switch_table"):
        res["verdict"] = "UNKNOWN"
        res["reasons"].append("no readable feature switch, so on/off could not be established")
    elif not has_rows and switch.get("on") is False:
        if fe == {}:
            res["verdict"] = "INACTIVE"
            res["reasons"].append("empty, every switch set to off, and nothing references it")
            res["reasons"].append("a candidate for removal, and only behind a guarded script")
            res["reasons"].append(
                "this assumes the --repo given is THIS project's source; if it is not, "
                "the frontend has not actually been checked")
        else:
            res["verdict"] = "UNKNOWN"
            res["reasons"].append("empty and switched off, but the frontend was not checked")
    else:
        res["reasons"].append("the evidence does not clearly fit any category")
    return res


def show(r, feat):
    colour = {"ACTIVE": "\033[31m", "HISTORICAL": "\033[33m",
              "INACTIVE": "\033[32m", "UNKNOWN": "\033[35m", "ABSENT": "\033[2m"}
    c = colour.get(r["verdict"], "")
    print(f"\n  {c}{r['verdict']:<11}\033[0m {r['ref']}  ({feat['description']})")
    for why in r["reasons"]:
        print(f"      - {why}")
    if not r["present"]:
        return
    e = r["evidence"]
    rc = ", ".join(f"{k}={v}" for k, v in (e.get("row_counts") or {}).items())
    print(f"      rows      : {rc or 'none'}")
    sw = e.get("switch") or {}
    if sw.get("found"):
        print("      switches  : " + ", ".join(f"{k}={v}" for k, v in sw["values"]))
    for label, key in (("functions", "functions"), ("cleanup fns", "cleanup_functions"),
                       ("triggers", "triggers"), ("views", "views"),
                       ("incoming FKs", "incoming_foreign_keys"), ("cron jobs", "cron_jobs")):
        v = e.get(key) or []
        if v:
            print(f"      {label:<10}: {', '.join(v)}")
    fe = e.get("frontend")
    if fe is None:
        print("      frontend  : NOT CHECKED (no --repo given)")
    elif fe:
        print(f"      frontend  : {', '.join(sorted(fe))}")
    else:
        # Absence of references in the WRONG repository means nothing, and
        # this is exactly where a confident-looking "no references" would
        # mislead somebody into a deletion.
        print("      frontend  : none found in the repository given — which proves")
        print("                  nothing unless that repository is THIS project's")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--feature", help="which feature (see --list)")
    ap.add_argument("--ref", help="one project ref")
    ap.add_argument("--all", action="store_true", help="every project on the account")
    ap.add_argument("--repo", help="path to the application's source, for the frontend check")
    ap.add_argument("--list", action="store_true", help="list the known features")
    ap.add_argument("--json", help="write the findings here")
    args = ap.parse_args()

    if args.list:
        print("\nKnown features:\n")
        for k, v in FEATURES.items():
            print(f"  {k:<20} {v['description']}")
            print(f"  {'':<20} tables: {', '.join(v['tables'])}")
        print()
        return
    if not args.feature:
        sys.exit("--feature is required (see --list)")
    if args.feature not in FEATURES:
        sys.exit(f"unknown feature {args.feature!r}. Known: {', '.join(FEATURES)}")
    if not args.ref and not args.all:
        sys.exit("give --ref <project> or --all")

    token = os.environ.get("SUPABASE_ACCESS_TOKEN", "").strip()
    if not token:
        sys.exit("SUPABASE_ACCESS_TOKEN is not set.\n"
                 "  read -rs SUPABASE_ACCESS_TOKEN && export SUPABASE_ACCESS_TOKEN")

    feat = FEATURES[args.feature]
    if args.all:
        projects = curl_json(f"{API}/projects", token)
        if not isinstance(projects, list):
            sys.exit("could not list projects; the token may be invalid")
        refs = [(p["id"], p.get("name")) for p in projects]
    else:
        refs = [(args.ref, args.ref)]

    print(f"\nFeature: {args.feature} — {feat['description']}")
    print("Read-only. Nothing is deleted and nothing is recommended for deletion")
    print("unless it can be positively shown to be dead.")
    if args.repo and args.all:
        print()
        print("  NOTE: --repo points at ONE application's source, but --all inspects")
        print("  every project. The frontend check is only meaningful for the project")
        print("  that repository belongs to. For the others, treat 'no references' as")
        print("  'not checked' and re-run per project with its own --repo.")

    out, counts = [], {}
    for ref, name in refs:
        if one(ref, token, "select 1") != 1:
            print(f"\n  \033[2mSKIPPED\033[0m     {ref} ({name}) — not reachable, may be paused")
            counts["UNREACHABLE"] = counts.get("UNREACHABLE", 0) + 1
            continue
        r = assess(ref, args.feature, feat, token, args.repo)
        r["project"] = name
        out.append(r)
        counts[r["verdict"]] = counts.get(r["verdict"], 0) + 1
        show(r, feat)

    print("\n  " + "  ".join(f"{k}={v}" for k, v in sorted(counts.items())))
    removable = [r for r in out if r["verdict"] == "INACTIVE"]
    uncertain = [r for r in out if r["verdict"] == "UNKNOWN"]
    print()
    if removable:
        print(f"  {len(removable)} database(s) where this feature looks genuinely dead.")
        print("  Even there, removal goes through a guarded script that re-checks")
        print("  the same conditions inside its own transaction and aborts if they")
        print("  have changed since.")
    if uncertain:
        print(f"  {len(uncertain)} database(s) could NOT be established. Those need a")
        print("  decision from someone who knows the business, not a default.")
    if not removable and not uncertain:
        print("  Nothing here is a removal candidate.")
    print()
    if args.json:
        with open(args.json, "w") as f:
            json.dump(out, f, indent=2)
        print(f"  findings written to {args.json}\n")


if __name__ == "__main__":
    main()
