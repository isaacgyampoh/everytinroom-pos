#!/usr/bin/env python3
"""
Check that every ${VAR} the compose files need is actually written by the
script that creates the environment file, or has a default.

    deploy/scripts/check-compose-vars.py

WHY THIS EXISTS
    `docker compose up` fails with "VAR is not set" only when it runs, which
    on a staging runner costs twenty-five minutes to find out. Worse, a
    variable with an empty value does not fail at all: it interpolates to
    nothing, and the container starts with a broken setting. That is exactly
    how `email {$ACME_EMAIL}` put Caddy into a restart loop -- the compose file
    was fine, the variable simply never reached the container.

    So this reads both compose files, extracts every ${VAR} reference, and
    checks each one against:

      - a `${VAR:-default}` or `${VAR:?message}` form, which is self-handling
      - set_env_var calls in bootstrap.sh and provision-app.sh
      - a small list of variables compose itself provides

    It cannot prove a value is CORRECT, only that something sets it.
"""

import pathlib
import re
import sys

DEPLOY = pathlib.Path(__file__).resolve().parent.parent

# Provided by compose or by the shell, not by our scripts.
BUILTIN = {"COMPOSE_PROJECT_NAME", "COMPOSE_PROFILES", "PWD", "USER", "HOME"}

# ${VAR}, ${VAR:-x}, ${VAR:?x}, ${VAR-x}, ${VAR?x}, $VAR
REF = re.compile(r"\$\{([A-Za-z_][A-Za-z0-9_]*)(:?[-?+][^}]*)?\}|\$([A-Za-z_][A-Za-z0-9_]*)")


def refs_in(path):
    """Every variable reference, with whether it carries a default."""
    out = {}
    text = path.read_text()
    for m in REF.finditer(text):
        name = m.group(1) or m.group(3)
        has_default = bool(m.group(2))
        # A later bare reference must not mask an earlier defaulted one, and
        # vice versa: record whether EVERY occurrence is defaulted.
        if name in out:
            out[name] = out[name] and has_default
        else:
            out[name] = has_default
    return out


def written_by_scripts():
    """Variables our scripts put into an env file."""
    names = set()
    for sh in list(DEPLOY.glob("*.sh")) + list(DEPLOY.glob("scripts/*.sh")):
        text = sh.read_text()
        # set_env_var "$FILE" NAME value
        for m in re.finditer(r'set_env_var\s+"[^"]+"\s+([A-Za-z_][A-Za-z0-9_]*)', text):
            names.add(m.group(1))
        # set_env_var "$FILE" "$k" ... inside a loop over a literal list
        for m in re.finditer(r'for\s+\w+\s+in\s+([A-Z_0-9\s]+);\s*do', text):
            for n in m.group(1).split():
                if n.isupper():
                    names.add(n)
        # plain assignments that are later written, e.g. in staging-test via sed
        for m in re.finditer(r"s\|\^([A-Z_][A-Z0-9_]*)=", text):
            names.add(m.group(1))
    return names


def main():
    compose = [DEPLOY / "compose" / "docker-compose.yml",
               DEPLOY / "compose" / "app.compose.yml"]
    written = written_by_scripts()
    problems, checked = [], 0

    for path in compose:
        if not path.exists():
            problems.append(f"{path} is missing")
            continue
        for name, has_default in sorted(refs_in(path).items()):
            checked += 1
            if name in BUILTIN or has_default:
                continue
            if name not in written:
                problems.append(
                    f"{path.name}: ${{{name}}} has no default and no script writes it")

    print(f"  {checked} variable reference(s) across {len(compose)} compose files")
    print(f"  {len(written)} variable(s) are written by bootstrap.sh / provision-app.sh")
    if problems:
        print()
        for p in problems:
            print(f"  {p}")
        print()
        print("  Each one makes `docker compose up` fail with \"is not set\", or")
        print("  silently interpolate to nothing. Give it a default or write it.")
        sys.exit(1)
    print("  every reference is either defaulted or written by a script")


if __name__ == "__main__":
    main()
