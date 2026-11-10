#!/usr/bin/env python3
"""
Find shell variables used before they are assigned.

    deploy/scripts/check-unbound.py deploy/*.sh deploy/scripts/*.sh

Every script here runs with `set -u`, so reading a variable before it has a
value is not a warning: the script dies on the spot. `bash -n` does not catch
it, because it is a runtime error in syntactically valid code.

This has now bitten twice in this repository:

    bootstrap.sh: SSH_PORT  -- assigned inside the firewall step, read in the
                               exposure step, so --no-firewall killed it
    bootstrap.sh: ENV_FILE  -- assigned in step 7, read in step 6, so the
                               script died before starting a single container

Both were invisible locally and cost a full staging run each.

HOW IT WORKS, AND WHAT IT CANNOT DO
    It reads top to bottom and records the line of each variable's first
    assignment, including `A=1; B=2` on one line, `for X in`, `read -r X`,
    `local X=`, and `${X:=default}`. Then it reports any read that occurs on an
    earlier line than that first assignment.

    This is a line-order check, not control-flow analysis. It cannot know that
    a read inside a function body runs after the caller has assigned the
    variable, so function bodies are skipped unless the variable is never
    assigned anywhere. It is deliberately quiet rather than noisy: a checker
    that cries wolf gets switched off.
"""

import re

# A quoted heredoc (<<'X') is passed through verbatim: the shell expands
# nothing inside it. Scanning those bodies reported a JavaScript template
# variable, ${kind}, as a shell variable read before assignment.
QUOTED_HEREDOC = re.compile(r"<<-?'([A-Za-z_][A-Za-z0-9_]*)'")
import sys

# Things that look like variables but come from the shell or the environment.
IGNORE = {
    "PATH", "HOME", "PWD", "IFS", "SHELL", "USER", "LOGNAME", "TERM", "LANG",
    "PS1", "PS2", "OPTIND", "OPTARG", "RANDOM", "SECONDS", "LINENO", "FUNCNAME",
    "BASH_SOURCE", "BASH_VERSION", "PIPESTATUS", "REPLY", "EUID", "UID", "HOSTNAME",
    "DEBIAN_FRONTEND", "GITHUB_OUTPUT", "GITHUB_STEP_SUMMARY", "NO_COLOR",
    # Set by /etc/os-release, which the scripts source.
    "ID", "VERSION_ID", "VERSION_CODENAME", "PRETTY_NAME", "NAME",
    # Documented inputs a caller may export.
    "DOCKER_VERSION", "ASSUME_YES", "SUPABASE_DB_URL", "SUPABASE_ACCESS_TOKEN",
    "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "S3_ENDPOINT", "S3_BUCKET",
    "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY", "PGHOST", "PGPORT", "PGUSER",
    "PGPASSWORD", "PGDATABASE", "BACKUP_KEEP_DAYS", "STAGING_REPORT",
    "SCRIPT_NAME", "STEP_TOTAL", "JWT_SECRET", "ANON_KEY", "SERVICE_ROLE_KEY",
    "APP_NAME", "APP_DB", "APP_DOMAIN", "COMPOSE_PROFILES", "ACME_EMAIL",
}

# A line ending in this comment is skipped. Used where a variable belongs to a
# DIFFERENT shell -- for instance shell code built here and executed inside a
# container, where the variable is set by a file sourced there.
PRAGMA = "check-unbound: ignore"

ASSIGN = re.compile(r"""
    (?:^|;|\s|\(\()\s*
    (?:export\s+|declare\s+-\w+\s+|local\s+|readonly\s+)?
    ([A-Za-z_][A-Za-z0-9_]*)\s*=
""", re.X)
FOR_LOOP = re.compile(r"\bfor\s+([A-Za-z_][A-Za-z0-9_]*)\s+in\b")
READ_CMD = re.compile(r"\bread\s+(?:-\w+\s+)*([A-Za-z_][A-Za-z0-9_]*)")
WHILE_READ = re.compile(r"\bwhile\s+(?:IFS=\S*\s+)?read\s+(?:-\w+\s+)*(.+?)(?:;|\bdo\b)")
# A read with a default or an alternate is safe under set -u.
SAFE_USE = re.compile(r"\$\{([A-Za-z_][A-Za-z0-9_]*)(:[-=?+]|[-=?+]|:\?)")
USE = re.compile(r"\$\{?([A-Za-z_][A-Za-z0-9_]*)")


# Any `.` or `source` line, taking whatever .sh path it mentions. The forms
# in use here include `. "$HERE/lib/x.sh"` and
# `. "$(cd "$(dirname "$0")/.." && pwd)/lib/x.sh"`, so the path is pulled
# out rather than matched structurally.
SOURCE = re.compile(r"^\s*(?:\.|source)\s")
SOURCE_PATH = re.compile(r"([A-Za-z0-9_.-]+/[A-Za-z0-9_./-]*\.sh)")


def sourced_assignments(path, lines):
    """Variables assigned in files this script sources.

    Without this, every TUNE_* from lib/tuning.sh is reported as never
    assigned -- a checker that produces nine false reports for one real one
    gets ignored, which is worse than not having it.
    """
    import os
    names = set()
    base = os.path.dirname(os.path.abspath(path))
    for line in lines:
        if not SOURCE.match(line):
            continue
        pm = SOURCE_PATH.search(line)
        if not pm:
            continue
        rel = pm.group(1)
        # The match may carry a leading variable name, e.g. "$HERE/lib/x.sh"
        # yields "HERE/lib/x.sh". Try the whole thing, then drop leading
        # components one at a time.
        rels = [rel]
        parts = rel.split("/")
        for k in range(1, len(parts)):
            rels.append("/".join(parts[k:]))
        cands = []
        for r in rels:
            cands += [os.path.join(base, r), os.path.join(base, "..", r),
                      os.path.join(base, "..", "..", r)]
        for cand in cands:
            cand = os.path.normpath(cand)
            if os.path.isfile(cand):
                try:
                    txt = open(cand, encoding="utf-8", errors="replace").read()
                except OSError:
                    continue
                for mm in ASSIGN.finditer(txt):
                    names.add(mm.group(1))
                break
    return names


def strip_quoted(line):
    """Blank out single-quoted runs, but only OUTSIDE double quotes.

    `${VAR}` inside a single-quoted string is literal text -- it appears in
    help text and error messages here -- and is not a variable read.

    The double-quote exception is not a nicety. These scripts send SQL, and
    SQL quotes its own literals with apostrophes:

        pg "select verify_pin('${PIN}')"

    The shell is still expanding ${PIN} there, because the apostrophes are
    inside a double-quoted string and have no meaning to it. Blanking them
    anyway hid exactly that read, and this check reported "no variable is read
    before it is assigned" for a script that used PIN sixteen lines before it
    was generated -- which is the one thing it exists to catch.
    """
    out, i, n = [], 0, len(line)
    in_dquote = False
    while i < n:
        c = line[i]
        if c == '\\' and i + 1 < n:          # an escaped character, kept as-is
            out.append(c)
            out.append(line[i + 1])
            i += 2
            continue
        if c == '"':
            in_dquote = not in_dquote
            out.append(c)
            i += 1
            continue
        if c == "'" and not in_dquote:
            j = line.find("'", i + 1)
            if j == -1:
                break
            out.append(" " * (j - i + 1))
            i = j + 1
            continue
        out.append(c)
        i += 1
    return "".join(out)


def check(path):
    try:
        lines = open(path, encoding="utf-8", errors="replace").read().split("\n")
    except OSError as e:
        return [f"{path}: cannot read: {e}"]

    external = sourced_assignments(path, lines)

    # Blank out quoted-heredoc bodies before scanning. The shell expands
    # nothing inside <<'X' ... X, so a ${name} in one belongs to whatever
    # language the heredoc contains. This file carries a JavaScript client in
    # such a heredoc, and its ${kind} was reported as a shell variable read
    # before assignment -- a false positive that would train someone to
    # ignore the check.
    lines = list(lines)
    i = 0
    blanked = 0
    while i < len(lines):
        m = QUOTED_HEREDOC.search(lines[i].split("#", 1)[0])
        if m:
            term = m.group(1)
            j = i + 1
            while j < len(lines) and lines[j].strip() != term:
                lines[j] = ""
                blanked += 1
                j += 1
            i = j + 1
            continue
        i += 1

    first_assign, problems = {}, []
    in_func, depth = False, 0

    # Pass one: where is each variable first given a value?
    for i, raw in enumerate(lines, 1):
        line = raw.split("#", 1)[0] if not raw.strip().startswith("#") else ""
        for m in ASSIGN.finditer(line):
            first_assign.setdefault(m.group(1), i)
        for rx in (FOR_LOOP, READ_CMD):
            for m in rx.finditer(line):
                first_assign.setdefault(m.group(1), i)
        for m in WHILE_READ.finditer(line):
            for nm in re.findall(r"[A-Za-z_][A-Za-z0-9_]*", m.group(1)):
                first_assign.setdefault(nm, i)

    # Pass two: any read strictly before that line?
    for i, raw in enumerate(lines, 1):
        stripped = raw.strip()
        if stripped.startswith("#") or PRAGMA in raw:
            continue
        line = raw.split("#", 1)[0]

        # Track function bodies: a read inside one may legitimately happen
        # after a caller assigns, which this check cannot see.
        if re.search(r"^\s*(?:function\s+)?[A-Za-z_][A-Za-z0-9_]*\s*\(\)\s*\{", line):
            depth = line.count("{") - line.count("}")
            # A ONE-LINE DEFINITION ENDS ON ITS OWN LINE.
            #
            #     pg() { echo "$1"; }
            #
            # braces balance here, so there is no body to skip. Setting
            # in_func anyway carried it to the NEXT line, which was then
            # skipped as though it were inside the function -- and the line
            # after a one-line helper is exactly where these scripts do their
            # first real work. Combined with the quoting bug above, that is
            # why a read of PIN sixteen lines before its assignment went
            # unreported.
            in_func = depth > 0
            continue
        if in_func:
            depth += line.count("{") - line.count("}")
            if depth <= 0:
                in_func = False
            continue

        # TWO VIEWS OF THE SAME LINE, AND WHY.
        #
        # strip_quoted blanks single-quoted text, because `${VAR}` in a
        # help message is not a read. It cannot be trusted on a line like
        #
        #     X="$(pg "select verify_pin('${PIN}')")"
        #
        # where a nested double quote inside $( ) takes any line-based quote
        # tracker out of the string it is still in, so the SQL's apostrophes
        # look like shell quoting and ${PIN} is blanked. That is not a bug to
        # patch, it is the limit of reading shell one line at a time.
        #
        # So the stripped view is used as before, and the RAW view is used as
        # well -- but only to catch a read whose variable is assigned LATER in
        # this same file, and only on lines that are not printing text at the
        # operator. A variable this file assigns further down is never
        # literal help text when it appears above, which is what makes the
        # raw view safe to trust in that one case.
        raw_line = line
        line = strip_quoted(line)
        is_output = re.match(r'^\s*(echo|printf|warn|dim|note|say|good|bad|info|ok|die)\b', raw_line)
        if not is_output:
            for m in USE.finditer(raw_line):
                nm = m.group(1)
                if nm in IGNORE or nm in external or re.match(r"^\d+$", nm):
                    continue
                w = first_assign.get(nm)
                if w is not None and w > i and nm not in {q.group(1) for q in SAFE_USE.finditer(raw_line)}:
                    problems.append(
                        f"{path}:{i}: ${nm} is read here but first assigned on line {w}")
        # A BACKSLASH-ESCAPED dollar is a literal one. `\$SRC_URL` inside a
        # double-quoted string is text handed to another shell -- a container's
        # -- and `\$\$` is Postgres dollar-quoting. Neither is a read here.
        line = re.sub(r"\\\$", " ", line)
        # Postgres dollar-quoting ($$ ... $$ and $tag$ ... $tag$) appears in
        # the SQL these scripts send. The text inside is SQL, not shell.
        line = re.sub(r"\$\$.*?\$\$", " ", line)
        line = re.sub(r"\$\$", " ", line)
        line = re.sub(r"\$[a-z]+\$", " ", line)
        safe = {m.group(1) for m in SAFE_USE.finditer(line)}
        for m in USE.finditer(line):
            name = m.group(1)
            # C_* are the colour variables from lib/common.sh. They are NOT
            # blanket-skipped: a script that does not source common.sh and
            # uses one is broken, and a blanket skip hid exactly that bug.
            if name in IGNORE or name in safe:
                continue
            if name in external:          # assigned by a sourced file
                continue
            if re.match(r"^\d+$", name):
                continue
            where = first_assign.get(name)
            if where is None:
                problems.append(f"{path}:{i}: ${name} is never assigned in this file")
            elif where > i:
                problems.append(
                    f"{path}:{i}: ${name} is read here but first assigned on line {where}")
    return problems


def main():
    if len(sys.argv) < 2:
        sys.exit("usage: check-unbound.py FILE...")
    bad = []
    for p in sys.argv[1:]:
        bad += check(p)
    # Deduplicate per variable per file: one report is enough to act on.
    #
    # Not every message names a variable. `cannot read: ...` does not, and
    # splitting on "$" then taking [1] raised IndexError on it -- so pointing
    # this checker at a path that does not exist crashed it with a traceback
    # instead of saying the file could not be read. A checker that dies on bad
    # input teaches people to distrust it.
    seen, out = set(), []
    for b in bad:
        parts = b.split("$")
        if len(parts) < 2:
            out.append(b)          # not a per-variable report; always keep it
            continue
        key = (b.split(":")[0], parts[1].split(" ")[0])
        if key in seen:
            continue
        seen.add(key)
        out.append(b)
    for b in out:
        print("  " + b)
    if out:
        reads = [b for b in out if "is read here" in b or "never assigned" in b]
        errs = [b for b in out if b not in reads]
        if reads:
            print(f"\n  {len(reads)} variable(s) read before assignment. Under set -u each one")
            print("  aborts the script at that line.")
        if errs:
            print(f"\n  {len(errs)} file(s) could not be read, so nothing was checked in them.")
        sys.exit(1)
    print("  no variable is read before it is assigned")


if __name__ == "__main__":
    main()
