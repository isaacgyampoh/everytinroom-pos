#!/usr/bin/env python3
"""
Check that every "$ROOT_DIR/..." and "$DEPLOY/..." path the scripts use names a
file that exists.

    DEPLOY=deploy deploy/scripts/check-paths.py

Both roots are the same tree seen from two places: $DEPLOY is this directory in
the repository, $ROOT_DIR is where bootstrap.sh copies it on the server. So a
path that does not resolve here will not resolve there either -- it will fail
on the server, at the moment the file is needed, which is the worst time to
find out. provision-app.sh calling scripts/post-start.sh is exactly this
shape, and nothing checked it.

Prints one CHECKED line and a MISSING line per unresolved path.
"""

import os
import re
import sys

# Created at run time by bootstrap or provisioning, not shipped in the repo.
RUNTIME = ("apps/", "logs/", "backups/", "compose/caddy-sites/",
           "compose/postgres/90-central.conf", "compose/Caddyfile",
           "staging-results/")

EXT = r'(?:sh|sql|py|yml|yaml|tmpl|template|conf|mjs|json)'
# $ROOT_DIR and $DEPLOY both mean the deploy tree.
PAT = re.compile(r'\$(?:\{)?(?:ROOT_DIR|DEPLOY)(?:\})?/'
                 r'([A-Za-z0-9_./-]+\.' + EXT + r')')
# $HERE means the directory of the script doing the reading, which is how
# provision-app.sh reaches scripts/post-start.sh -- the link this whole check
# exists to protect, and the one the first version missed.
PAT_HERE = re.compile(r'\$(?:\{)?HERE(?:\})?/'
                      r'([A-Za-z0-9_./-]+\.' + EXT + r')')


def main():
    deploy = os.environ.get("DEPLOY") or os.path.dirname(
        os.path.dirname(os.path.abspath(__file__)))
    deploy = os.path.abspath(deploy)
    bad, checked = set(), 0
    for root, dirs, files in os.walk(deploy):
        dirs[:] = [d for d in dirs if d != "staging-results"]
        for f in files:
            if not f.endswith((".sh", ".py")):
                continue
            fp = os.path.join(root, f)
            try:
                text = open(fp, encoding="utf-8", errors="replace").read()
            except OSError:
                continue
            for line in text.split("\n"):
                # Comment lines are skipped. A comment explaining what
                # $ROOT_DIR/scripts/post-start.sh is for is not a call to it,
                # and treating it as one makes the prose a liability.
                if line.lstrip().startswith("#"):
                    continue
                for base, pat in ((deploy, PAT), (os.path.dirname(fp), PAT_HERE)):
                    for m in pat.finditer(line):
                        rel = m.group(1)
                        if rel.startswith(RUNTIME):
                            continue
                        checked += 1
                        if not os.path.exists(os.path.join(base, rel)):
                            bad.add(f"{os.path.relpath(fp, deploy)} -> {rel}")
    print(f"CHECKED {checked}")
    for b in sorted(bad):
        print(f"MISSING {b}")
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
