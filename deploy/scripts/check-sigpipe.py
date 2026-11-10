#!/usr/bin/env python3
"""
Find pipelines that kill their own script by closing a pipe early.

    deploy/scripts/check-sigpipe.py [--deploy deploy]

WHAT GOES WRONG
    lib/common.sh sets `-euo pipefail`. With pipefail, a pipeline's exit
    status is that of the LAST command to fail, not the last command. And a
    writer whose reader goes away is killed by SIGPIPE, which the shell
    reports as status 141. So

        grep ERROR "$log" | head -10 | sed 's/^/    /'

    is a landmine. With ten error lines or fewer it works. With eleven, head
    has what it wants and closes the pipe, grep is killed by SIGPIPE, the
    pipeline's status becomes 141, and `set -e` aborts the script on that
    line. No message, no diagnosis -- the script simply stops.

WHERE IT HAS BITTEN
    restore.sh                 printing the errors from a restore. It aborted
                               immediately BEFORE the row counts and money
                               totals -- the only output that proves whether
                               the restore was good. Nineteen staging runs
                               passed because each had ten errors or fewer;
                               the twentieth had 135 and reported the restore
                               as failed when it had in fact succeeded.
    migrate-from-supabase.sh   twice, in the two places that summarise what
                               went wrong during a real migration of a real
                               shop. Same shape, same silent abort.

    Both are operator-facing recovery paths, and both failed only when there
    was a lot to report -- which is precisely when somebody is reading.

WHAT THIS CHECKS
    A pipeline written as a bare statement (not an assignment, not inside a
    command substitution) where some stage can close the pipe before its
    upstream has finished writing. Assignments from substitutions are covered
    by check-set-e-subs.py instead.

    Guarded forms are accepted: a trailing `|| true`, `|| :`, `|| echo ...`,
    or a line inside a `bash -c "..."` string, which is a different shell with
    its own (unset) -e.

HOW TO FIX ONE
    Let the reader consume everything and truncate on the way out:

        awk 'NR <= 10 { print "    " $0 }' <<< "$(grep ERROR "$log")"
        grep ERROR "$log" | awk 'NR <= 10 { print "    " $0 }'

    awk reads its input to the end, so nothing upstream is ever signalled.

A line may opt out with `# allow-sigpipe` and a reason.
"""

import argparse
import os
import re
import sys

PRAGMA = "allow-sigpipe"

# Stages that stop reading before their input is exhausted. `tail` is NOT one:
# it has to read everything to know what the end is. Nor is `sort`, `wc`,
# `awk` or `sed` without an explicit quit.
EARLY_CLOSERS = [
    (re.compile(r"\|\s*head\b(?!\s*-c)"), "head stops reading after N lines"),
    (re.compile(r"\|\s*grep\s+(?:-\w+\s+)*-\w*q"), "grep -q stops at the first match"),
    (re.compile(r"\|\s*sed\s+(?:-n\s+)?['\"]?\d*q"), "sed q stops at that line"),
    (re.compile(r"\|\s*read\b"), "read takes one line and leaves"),
]

GUARD = re.compile(r"\|\|\s*(true|:|echo|printf|note|warn|dim|return|continue|break)\b")
# A pipeline on the left of && or || is exempt from set -e -- measured, not
# assumed: `seq 1 100000 | grep -q 5 && echo hi` does not abort the script,
# it just skips the right-hand side. That is still a trap (the `&& die` never
# fires), but it is a different and much less likely one, and reporting it
# here would bury the shape that really does kill scripts.
AND_OR_LIST = re.compile(r"(?:\|\||&&)\s*\S")
ASSIGNMENT = re.compile(r"^\s*(?:local\s+|export\s+|readonly\s+)?[A-Za-z_][A-Za-z0-9_]*=")
# `if cmd | head -1 | grep -q x; then` -- the condition of if/while/until is
# exempt from set -e, so a non-zero status there is a branch, not a death.
CONDITION = re.compile(r"^\s*(if|elif|while|until)\b|^\s*\[\[|&&\s*(if|while)\b")


def sources_set_e(path, text):
    if re.search(r"^\s*set\s+-\w*e", text, re.M):
        return True
    return bool(re.search(r"^\s*(?:\.|source)\s+.*(?:common|tuning)\.sh", text, re.M))


def join_continuations(lines):
    """Return [(first_line_number, joined_text)], so a fallback on the next
    physical line is not missed."""
    out, buf, start = [], "", None
    for i, raw in enumerate(lines, 1):
        if start is None:
            start = i
        stripped = raw.rstrip()
        if stripped.endswith("\\"):
            buf += stripped[:-1] + " "
            continue
        out.append((start, buf + stripped))
        buf, start = "", None
    if start is not None:
        out.append((start, buf))
    return out


def blank_strings(code):
    """Blank out double-quoted runs, keeping the line's length.

    Two of this check's first three findings were the text of advice, not
    code:  warn "  docker logs x | head -60".  A checker that reports a help
    message as a defect is one nobody runs twice, so quoted text is removed
    before anything is matched. Length is preserved so reported columns, and
    any other regex on the same line, still line up.
    """
    out, i, n, q = [], 0, len(code), None
    while i < n:
        c = code[i]
        if q is None and c in "\"'":
            q = c
            out.append(c)
        elif q is not None and c == q:
            q = None
            out.append(c)
        elif q is not None:
            out.append(" ")
        else:
            out.append(c)
        i += 1
    return "".join(out)


def check(path):
    try:
        text = open(path, encoding="utf-8", errors="replace").read()
    except OSError as e:
        return [f"{path}: cannot read: {e}"]
    if not sources_set_e(path, text):
        return []

    problems = []
    for lineno, line in join_continuations(text.split("\n")):
        bare = line.strip()
        if not bare or bare.startswith("#") or PRAGMA in line:
            continue
        # Strip trailing comments so a `# ... | head` note is not a finding,
        # then quoted text, so advice printed to the operator is not either.
        code = blank_strings(line.split(" #", 1)[0])
        if "|" not in code:
            continue
        # A different shell, with its own unset -e.
        if "bash -c" in code or "sh -c" in code:
            continue
        # Assignments are check-set-e-subs.py's department.
        if ASSIGNMENT.match(code) or "$(" in code or "`" in code:
            continue
        if CONDITION.search(code) or GUARD.search(code) or AND_OR_LIST.search(code):
            continue
        for rx, why in EARLY_CLOSERS:
            if rx.search(code):
                problems.append(f"{path}:{lineno}: {why}, so anything upstream "
                                f"of it can die of SIGPIPE and abort this script")
                break
    return problems


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--deploy", default="deploy")
    ap.add_argument("files", nargs="*")
    a = ap.parse_args()

    files = list(a.files)
    if not files:
        for root, _dirs, names in os.walk(a.deploy):
            for n in sorted(names):
                if n.endswith(".sh"):
                    files.append(os.path.join(root, n))

    bad = []
    for f in sorted(files):
        bad += check(f)
    for b in bad:
        print("  " + b)
    if bad:
        print(f"\n  {len(bad)} pipeline(s) can be killed by SIGPIPE under set -e.")
        print("  Replace the early-closing stage with awk 'NR <= N', which reads to the end.")
        sys.exit(1)
    print(f"  no pipeline closes a pipe early under set -e ({len(files)} script(s) read)")


if __name__ == "__main__":
    main()
