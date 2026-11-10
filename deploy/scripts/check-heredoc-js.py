#!/usr/bin/env python3
"""
Syntax-check JavaScript that lives inside a shell heredoc.

    deploy/scripts/check-heredoc-js.py [--deploy deploy]

WHY
    staging-test.sh carries a real supabase-js client in a quoted heredoc:

        cat > rt.mjs <<'JS'
        ...about 90 lines of JavaScript...
        JS

    `bash -n` does not look inside it -- to the shell it is text -- so a
    syntax error there is invisible until a staging run has spent twenty
    minutes getting to it, and then surfaces as a delivery failure rather
    than as a broken test. This file has already produced two misleading runs
    on its own: once when the heredoc was written AFTER the loop that used it,
    and once when the client it installed could not be imported.

WHAT IT DOES
    Extracts every `<<'TAG' ... TAG` body whose target filename ends .mjs or
    .js and runs `node --check` on it. Nothing is executed.

    Quoted heredocs only (<<'TAG'). An unquoted one is interpolated by the
    shell before node ever sees it, so what is in the file is not what runs
    and checking it would be checking the wrong text.
"""

import argparse
import os
import re
import subprocess
import sys
import tempfile

# cat > name.mjs <<'TAG'   ...   TAG
HEREDOC = re.compile(
    r"^[^\n]*>\s*(?P<file>[\w./-]+\.(?:mjs|js))\s*<<-?'(?P<tag>[A-Za-z_][A-Za-z0-9_]*)'[^\n]*\n"
    r"(?P<body>.*?)\n(?P=tag)\s*$",
    re.S | re.M,
)


def check(path, node):
    try:
        text = open(path, encoding="utf-8", errors="replace").read()
    except OSError as e:
        return [f"{path}: cannot read: {e}"], 0

    problems, found = [], 0
    for m in HEREDOC.finditer(text):
        found += 1
        name = m.group("file")
        line = text[:m.start()].count("\n") + 1
        with tempfile.NamedTemporaryFile("w", suffix=".mjs", delete=False) as f:
            f.write(m.group("body"))
            tmp = f.name
        try:
            r = subprocess.run([node, "--check", tmp],
                               capture_output=True, text=True, timeout=60)
            if r.returncode != 0:
                # node reports its own temp path and line numbers; the line
                # numbers are relative to the heredoc body, so the offset of
                # the heredoc in the shell file is given too.
                detail = (r.stderr or r.stdout).strip().splitlines()
                keep = [d for d in detail if "SyntaxError" in d or "^" in d][:3]
                problems.append(
                    f"{path}:{line}: the {name} heredoc does not parse "
                    f"(body line numbers are relative to line {line + 1}): "
                    + " / ".join(keep or detail[:2]))
        except (OSError, subprocess.TimeoutExpired) as e:
            problems.append(f"{path}:{line}: could not run node: {e}")
        finally:
            os.unlink(tmp)
    return problems, found


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--deploy", default="deploy")
    ap.add_argument("--node", default="node")
    ap.add_argument("files", nargs="*")
    a = ap.parse_args()

    # No node, no check -- and said so, rather than passing silently.
    try:
        subprocess.run([a.node, "--version"], capture_output=True, timeout=30)
    except (OSError, subprocess.TimeoutExpired):
        print("  skipped: node is not available, so embedded JavaScript was not checked")
        return 0

    files = list(a.files)
    if not files:
        for root, _dirs, names in os.walk(a.deploy):
            for n in sorted(names):
                if n.endswith(".sh"):
                    files.append(os.path.join(root, n))

    bad, total = [], 0
    for f in sorted(files):
        p, n = check(f, a.node)
        bad += p
        total += n
    for b in bad:
        print("  " + b)
    if bad:
        print(f"\n  {len(bad)} embedded JavaScript heredoc(s) do not parse.")
        sys.exit(1)
    print(f"  {total} embedded JavaScript heredoc(s) parse")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
