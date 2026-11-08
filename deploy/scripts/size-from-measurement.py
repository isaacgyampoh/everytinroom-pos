#!/usr/bin/env python3
"""
Size the VPS from MEASURED container memory, not from compose limits.

    deploy/scripts/size-from-measurement.py \
        --stats deploy/staging-results/report.md \
        --inventory /tmp/inventory.json

The compose files carry memory LIMITS -- ceilings that stop one service
starving the others. They are not what the services use, and sizing a server
from them overbuys. This reads what the staging run actually measured and
scales it by the services each inventoried project needs.

It is deliberately explicit about two things it cannot know:

  - staging runs ONE application with generated data. A real application with
    a restored database and live traffic uses more, so a headroom multiplier
    is applied and stated rather than hidden.
  - PostgreSQL's own usage scales with shared_buffers, which bootstrap sets
    from the machine's RAM. So postgres is sized from the TARGET machine, not
    from what staging measured on a different one.
"""

import argparse
import json
import re
import sys

# Contabo, 24-month term, incl. VAT, from contabo.com/en-us/pricing 2026-11-08.
VPS = [
    ("Cloud VPS 4",  4,  8192, 100,  4.40),
    ("Cloud VPS 6",  6, 12288, 200,  6.00),
    ("Cloud VPS 8",  8, 24576, 300, 11.20),
    ("Cloud VPS 12", 12, 49152, 400, 20.00),
    ("Cloud VPS 16", 16, 65536, 500, 29.60),
    ("Cloud VPS 18", 18, 98304, 600, 39.20),
]

# Which measured container maps to which per-application service.
SERVICE_OF = {
    "rest": "postgrest", "realtime": "realtime", "storage": "storage",
    "imgproxy": "storage", "functions": "functions", "auth": "gotrue",
}

OS_MB = 512          # Ubuntu at rest
CADDY_MB = 64        # measured below if present
# Real traffic against a restored database costs more than one staging app
# with generated rows. Stated, not buried.
LOAD_FACTOR = 1.6
# Never size to 100%: a server with no slack cannot take a backup or restore a
# dump, which are the moments it matters most.
HEADROOM = 1.35


def parse_mem(tok):
    """'123.4MiB' / '1.05GiB' / '512KiB' -> MB"""
    m = re.match(r"([0-9.]+)\s*([KMG])i?B", tok.strip(), re.I)
    if not m:
        return None
    v, unit = float(m.group(1)), m.group(2).upper()
    return {"K": v / 1024, "M": v, "G": v * 1024}[unit]


def parse_stats(path):
    """Pull the `docker stats` block out of the staging report."""
    text = open(path).read()
    found = {}
    for line in text.split("\n"):
        # "name  123.4MiB / 512MiB  0.15%"  (the report prints name mem cpu)
        m = re.match(r"\s*([a-z0-9][a-z0-9_.-]*)\s+([0-9.]+\s*[KMG]i?B)", line, re.I)
        if not m:
            continue
        name, mem = m.group(1), parse_mem(m.group(2))
        if mem is None:
            continue
        found[name] = max(found.get(name, 0), mem)
    return found


def classify(stats):
    """Map measured container names onto services and the shared stack."""
    per_app, shared = {}, {}
    for name, mem in stats.items():
        if name.startswith("central-postgres"):
            shared["postgres"] = mem
        elif name.startswith("central-caddy"):
            shared["caddy"] = mem
        elif name.startswith("staging-s3"):
            continue  # a test double, not part of the platform
        else:
            for suffix, svc in SERVICE_OF.items():
                if name.endswith("-" + suffix) or name.endswith("." + suffix):
                    per_app[svc] = max(per_app.get(svc, 0), mem)
                    break
    return per_app, shared


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--stats", required=True, help="the staging report containing docker stats")
    ap.add_argument("--inventory", required=True, help="inspect-supabase.py --json output")
    args = ap.parse_args()

    stats = parse_stats(args.stats)
    if not stats:
        sys.exit(f"no container memory figures found in {args.stats}.\n"
                 "The staging run must have reached its resource section.")
    per_app, shared = classify(stats)
    if not per_app:
        sys.exit("measured the shared stack but no per-application service; "
                 "the run did not get far enough to size applications.")

    projects = [p for p in json.load(open(args.inventory)) if p.get("reachable")]

    print("\nMEASURED, from the staging run")
    print(f"  {'container':<26} {'MB':>8}")
    for n, m in sorted(stats.items(), key=lambda x: -x[1]):
        print(f"  {n:<26} {m:>8.0f}")
    print()
    print("  Mapped to services:")
    for svc, mb in sorted(per_app.items(), key=lambda x: -x[1]):
        print(f"    {svc:<12} {mb:>7.0f} MB")
    for k, v in sorted(shared.items()):
        print(f"    {k:<12} {v:>7.0f} MB   (shared)")
    missing = {s for p in projects for s in p.get("needs", [])} - set(per_app) - {"cron"}
    if missing:
        print(f"\n  NOT MEASURED: {', '.join(sorted(missing))}")
        print("  Those fall back to their compose limit, which overstates them.")

    fallback = {"postgrest": 512, "realtime": 1024, "storage": 1280,
                "functions": 512, "gotrue": 512}

    print(f"\nPER PROJECT (measured x {LOAD_FACTOR} for real traffic)")
    print(f"  {'project':<40} {'services':<34} {'MB':>7}")
    total = 0.0
    for p in sorted(projects, key=lambda x: x.get("name") or ""):
        svcs = [s for s in p.get("needs", []) if s != "cron"]
        mb = sum(per_app.get(s, fallback.get(s, 0)) for s in svcs) * LOAD_FACTOR
        total += mb
        print(f"  {p['name'][:39]:<40} {','.join(svcs)[:33]:<34} {mb:>7.0f}")
    print(f"  {'':<40} {'TOTAL':<34} {total:>7.0f}")

    print("\nWHOLE SERVER")
    for label, apps in (("Everytinroom only",
                         [p for p in projects if p.get("ref") == "noiiuwkovoojkcwzupye"]),
                        ("all reachable projects", projects)):
        if not apps:
            continue
        app_mb = sum(sum(per_app.get(s, fallback.get(s, 0))
                         for s in p.get("needs", []) if s != "cron") * LOAD_FACTOR
                     for p in apps)
        disk_gb = max(2, int(sum((p.get("db_size_mb") or 0) + (p.get("storage_mb") or 0)
                                 for p in apps) / 1024) + 1)
        print(f"\n  {label}  ({len(apps)} application{'s' if len(apps) != 1 else ''})")
        print(f"    applications          {app_mb:>8.0f} MB")
        print(f"    caddy                 {shared.get('caddy', CADDY_MB):>8.0f} MB")
        print(f"    operating system      {OS_MB:>8.0f} MB")
        # Postgres is sized from the TARGET machine, since shared_buffers is a
        # share of its RAM. Try each plan and take the first that fits.
        chosen = None
        for name, cpu, ram, disk, price in VPS:
            pg = ram * 0.33 * 0.75 + 256        # shared_buffers plus backends
            need = (app_mb + shared.get("caddy", CADDY_MB) + OS_MB + pg) * HEADROOM
            if need <= ram and disk >= disk_gb * 3:
                chosen = (name, cpu, ram, disk, price, pg, need)
                break
        if not chosen:
            name, cpu, ram, disk, price = VPS[-1]
            pg = ram * 0.33 * 0.75 + 256
            need = (app_mb + shared.get("caddy", CADDY_MB) + OS_MB + pg) * HEADROOM
            chosen = (name, cpu, ram, disk, price, pg, need)
        name, cpu, ram, disk, price, pg, need = chosen
        print(f"    postgres on that plan {pg:>8.0f} MB   (shared_buffers scales with RAM)")
        print(f"    x{HEADROOM} headroom         {need:>8.0f} MB required")
        print(f"    data on disk          {disk_gb:>8} GB")
        print(f"    -> {name}: {cpu} vCPU, {ram} MB, {disk} GB "
              f"— ${price:.2f}/month, ${price * 12:.2f}/year")
        print(f"       {ram - need:>8.0f} MB spare after headroom")

    print(f"""
  Factors, stated rather than hidden:
    x{LOAD_FACTOR} on measured usage, because staging runs one application with
         generated data and no traffic.
    x{HEADROOM} overall, so the server can still take a backup or restore a dump.
    Disk sized at 3x current data, for backups and growth.

  These are measurements of this platform under a staging load. They are not
  a prediction of a busy shop, and no amount of arithmetic makes them one.
""")


if __name__ == "__main__":
    main()
