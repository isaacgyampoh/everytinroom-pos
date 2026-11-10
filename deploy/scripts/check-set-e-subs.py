#!/usr/bin/env python3
"""
Find command substitutions that will kill their script under `set -e`.

    deploy/scripts/check-set-e-subs.py [--deploy deploy]

lib/common.sh sets `-euo pipefail`, so in every script that sources it an
assignment of the form

    x="$(some-command ...)"

terminates the whole script if some-command exits non-zero. For a command that
asks about the world -- docker inspect, curl, psql -- that is not an error
case, it is Tuesday: the container is not there yet, the service is not up,
the table does not exist.

health.sh had exactly one such assignment without a fallback. It printed the
shared checks and the first application, then stopped mid-loop, never reached
its own summary, and the staging run reported that as "health.sh reported
problems" -- a guess about a script that had crashed. Every other inspect in
that file already had `|| echo ...`.

It only shows up when a container is absent at the wrong moment, so it is
checked statically. Continuation lines are joined first, because the fallback
is often on the next line and the first version of this check reported two
correct call sites as defects.

A line may opt out with `# allow-bare-substitution` and a reason.
"""

import argparse
import os
import re
import sys

# Commands whose failure is ordinary rather than exceptional.
ASKS = r"(docker|curl|psql|pg_dump|pg_dumpall|pg_restore|openssl|awk|grep|sed|stat|find)"
ASSIGN = re.compile(r'^\s*(?:local\s+)?[A-Za-z_][A-Za-z0-9_]*=(?:"?\$\(|`)\s*' + ASKS + r'\b')


def joined_lines(path):
    """Yield (first_line_number, joined_text).

    Merges backslash continuations AND command substitutions that span lines
    without one -- `x=$(grep ...\n  ... || true)` is perfectly ordinary shell,
    and the first version of this check did not join it, so it reported four
    correct call sites as defects because the `|| true` was on a later line.
    """
    with open(path, encoding="utf-8", errors="replace") as fh:
        buf, start, depth = "", None, 0
        for n, raw in enumerate(fh, 1):  # depth is recomputed from buf each time
            line = raw.rstrip("\n")
            if start is None:
                start = n
            cont = line.endswith("\\")
            buf += (line[:-1] + " ") if cont else line
            # An awk or grep program can span lines, so a single quote opened
            # on one line closes on another. Counting parens inside such a
            # program is meaningless -- and the previous version did, which
            # left validate-all's own guard reported as a defect because the
            # `|| true` it already had was never joined on. So: while a quote
            # is open, keep accumulating and count nothing.
            if (buf.count("'") % 2) == 1:
                buf += " " if not cont else ""
                continue
            bare = re.sub(r"'[^']*'", "", buf)
            depth = bare.count("$(") - bare.count(")")
            if cont or depth > 0:
                buf += " " if not cont else ""
                continue
            yield start, buf
            buf, start, depth = "", None, 0
        if buf:
            yield start or 1, buf


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--deploy", default=os.path.dirname(
        os.path.dirname(os.path.abspath(__file__))))
    args = ap.parse_args()

    files = []
    for d in (os.path.join(args.deploy, "scripts"), args.deploy):
        if not os.path.isdir(d):
            continue
        for f in sorted(os.listdir(d)):
            if f.endswith(".sh"):
                files.append(os.path.join(d, f))

    bad, checked, scanned = [], 0, 0
    for fp in files:
        try:
            text = open(fp, encoding="utf-8", errors="replace").read()
        except OSError:
            continue
        # Only scripts that actually run under set -e.
        if "lib/common.sh" not in text:
            continue
        scanned += 1
        for n, line in joined_lines(fp):
            if not ASSIGN.match(line):
                continue
            checked += 1
            if "||" in line or "allow-bare-substitution" in line:
                continue
            bad.append((os.path.relpath(fp, args.deploy), n, line.strip()[:120]))

    print(f"CHECKED {checked} substitution(s) in {scanned} script(s) that run under set -e")
    for rel, n, line in bad:
        print(f"MISSING {rel}:{n}: {line}")
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
