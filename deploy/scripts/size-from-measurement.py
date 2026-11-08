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

The figures it reads are PEAK per container, sampled while the staging run was
actually serving requests -- eight concurrent clients doing product lookups,
opening sales, writing sale lines and reading a running total through Caddy and
PostgREST. They are not idle figures. An earlier version of this read the idle
numbers, which is how a server gets sized for a shop with nobody in it.

It is deliberately explicit about two things it cannot know:

  - staging runs ONE application, with generated rows and a synthetic load, on
    a CI runner. Eight concurrent clients is a busier till than Everytinroom
    has, but a restored database is larger than generated rows and another
    project may be busier, so a factor is applied and stated rather than
    hidden.
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
# Applied to the PEAK measured under load. The staging load is synthetic and
# the database is generated, so this covers a restored database's larger
# working set and a busier project than Everytinroom -- not the traffic
# itself, which is now measured. Stated, not buried.
LOAD_FACTOR = 1.4
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
    """Pull the `docker stats` block out of the staging report.

    ONLY from inside a fenced block. This used to scan the whole file, which
    was safe while the report was a list of verdicts and is not safe now that
    it carries container logs: a log line reading "cache 12MiB" would be taken
    for a container called "cache" and sized as one.

    A container reporting 0B is recorded as UNMEASURED rather than as zero. A
    service whose container never started reads as free, and a server sized
    on that is a server too small for the service to start on.
    """
    text = open(path).read()
    found, zero = {}, set()
    inside = False
    for line in text.split("\n"):
        if line.strip().startswith("```"):
            inside = not inside
            continue
        if not inside:
            continue
        # "name  123.4MiB / 512MiB  0.15%"  (the report prints name mem cpu)
        m = re.match(r"\s*([a-z0-9][a-z0-9_.-]*)\s+([0-9.]+\s*[KMGT]?i?B)", line, re.I)
        if not m:
            continue
        name = m.group(1)
        mem = parse_mem(m.group(2))
        if mem is None or mem == 0:
            zero.add(name)
            continue
        found[name] = max(found.get(name, 0), mem)
    for n in zero - set(found):
        found[n] = None          # present in the stats, but no usable figure
    return found


def classify(stats):
    """Map measured container names onto services and the shared stack.

    Containers with no usable figure are returned separately rather than
    counted as nothing.
    """
    per_app, shared, unmeasured = {}, {}, []
    for name, mem in stats.items():
        if mem is None:
            unmeasured.append(name)
            continue
        if name.startswith("central-postgres"):
            shared["postgres"] = mem
        elif name.startswith("central-caddy"):
            shared["caddy"] = mem
        elif name.startswith("staging-s3"):
            continue  # a test double, not part of the platform
        else:
            for suffix, svc in SERVICE_OF.items():
                if name.endswith("-" + suffix) or name.endswith("." + suffix):
                    # SUM, not max. imgproxy and storage-api are two separate
                    # containers that both belong to the "storage" service, and
                    # taking the larger of the two dropped imgproxy's memory
                    # from every sizing. parse_stats() has already reduced
                    # repeated samples of one container to its peak, so there
                    # is nothing here to de-duplicate.
                    per_app[svc] = per_app.get(svc, 0) + mem
                    break
    return per_app, shared, unmeasured


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--stats", required=True, help="the staging report containing docker stats")
    ap.add_argument("--inventory", required=True, help="inspect-supabase.py --json output")
    args = ap.parse_args()

    stats = parse_stats(args.stats)
    if not stats:
        sys.exit(f"no container memory figures found in {args.stats}.\n"
                 "The staging run must have reached its resource section.")
    per_app, shared, unmeasured = classify(stats)
    if not per_app:
        sys.exit("measured the shared stack but no per-application service; "
                 "the run did not get far enough to size applications.")

    projects = [p for p in json.load(open(args.inventory)) if p.get("reachable")]

    print("\nMEASURED, from the staging run")
    print(f"  {'container':<26} {'MB':>8}")
    for n, m in sorted(stats.items(), key=lambda x: -(x[1] or 0)):
        print(f"  {n:<26} {'  no figure' if m is None else f'{m:>8.0f}'}")
    print()
    print("  Mapped to services:")
    for svc, mb in sorted(per_app.items(), key=lambda x: -x[1]):
        print(f"    {svc:<12} {mb:>7.0f} MB")
    for k, v in sorted(shared.items()):
        print(f"    {k:<12} {v:>7.0f} MB   (shared)")
    if unmeasured:
        print()
        print(f"  NO USABLE FIGURE: {', '.join(sorted(unmeasured))}")
        print("  Those containers appear in the stats at 0B, which means they were")
        print("  not running when the sample was taken. They are NOT counted as")
        print("  zero: a service that never started reads as free, and a server")
        print("  sized on that is one the service cannot start on.")
    missing = {s for p in projects for s in p.get("needs", [])} - set(per_app) - {"cron"}
    if missing:
        print(f"\n  NOT MEASURED: {', '.join(sorted(missing))}")
        print("  Those fall back to their compose limit, which overstates them.")

    fallback = {"postgrest": 512, "realtime": 1024, "storage": 1280,
                "functions": 512, "gotrue": 512}

    print(f"\nPER PROJECT (peak under load x {LOAD_FACTOR})")
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
    x{LOAD_FACTOR} on the peak measured under load, because staging runs one
         application with generated rows and a synthetic load, not a restored
         database on a busy day.
    x{HEADROOM} overall, so the server can still take a backup or restore a dump.
    Disk sized at 3x current data, for backups and growth.

  One more thing this cannot know: the staging load is driven at ONE
  application. Every container is sampled, but a service that only the second
  application runs -- gotrue, in this staging layout -- is sampled while idle,
  so its figure is a floor rather than a peak. Any project sized on it is
  sized on less evidence than the rest.

  These are peak measurements of this platform under a synthetic load on a CI
  runner. They are not a prediction of a busy shop, and no amount of
  arithmetic makes them one.
""")


if __name__ == "__main__":
    main()
