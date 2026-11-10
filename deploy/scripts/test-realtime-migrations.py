#!/usr/bin/env python3
"""
Replay Realtime's tenant migrations against a real PostgreSQL, as the role
this platform gives them, and find the first one that fails.

    deploy/scripts/test-realtime-migrations.py --migrations <dir> [--upto 20230328144023]

WHY THIS EXISTS
    Realtime builds the `realtime` schema -- realtime.subscription,
    realtime.apply_rls and realtime.list_changes -- with its own tenant
    migrations, run through Ecto against each tenant's database. When one of
    them fails, Realtime does not stop: it accepts websocket subscriptions
    and silently delivers nothing, because the WAL poller calls
    realtime.list_changes() and that function was never created.

    That is the failure mode that looks most like success, and it survived
    five staging runs. Each run cost twenty-five minutes to learn one fact.

    Every migration up to and including the one that creates list_changes is
    raw SQL inside `execute("...")`, so it can be replayed here in seconds
    against a throwaway database, as a NON-SUPERUSER role that owns the
    schema -- which is the condition the real server has and a laptop's
    `postgres` does not.

WHAT IT PROVES, AND WHAT IT DOES NOT
    It proves the SQL runs under those privileges. It does not prove Ecto
    drives it the same way, and it is not a substitute for a real subscribed
    client receiving a change -- the staging run does that. It is the thing
    that turns "something in ninety-one migrations" into a name and an error.

    Needs psql and a server you are superuser on. Creates and drops its own
    database and roles, named with a fixed prefix, and touches nothing else.
"""

import argparse
import hashlib
import os
import re
import subprocess
import sys

PFX = "zzrtmigtest"
DB = f"{PFX}_db"
OWNER = f"{PFX}_realtime"

PASS = FAIL = 0
# Files where extract() saw more execute( calls than it could read.
UNREAD = []


def ok(m):
    global PASS
    PASS += 1
    print(f"  \033[32mPASS\033[0m {m}")


def bad(m):
    global FAIL
    FAIL += 1
    print(f"  \033[31mFAIL\033[0m {m}")


# Set by --via-docker: run psql inside a container instead of on this machine.
# That is how this gets to run against the REAL supabase/postgres image, where
# the provisioning role is not a superuser -- which a laptop's postgres is, and
# which is the whole condition under test.
VIA_DOCKER = None


# A password for the owner role, generated per run. Connecting as a role over
# the local socket goes through peer authentication, where the OS user decides
# who you may be -- so `psql -U <owner>` inside the container is refused,
# because the OS user there is postgres. The first version did exactly that,
# ignored the failure, and then reported "stops at migration 1, 0 applied" on
# the real server: the scaffolding table was never created and every
# migration's final INSERT was refused. A tool written to end guesswork gave a
# confident wrong answer twice. Now the owner connects over TCP with a
# password, and the connection is CHECKED before anything is replayed.
OWNER_PW = hashlib.sha256(os.urandom(16)).hexdigest()


def psql(args, sql=None, db="postgres", user=None, stop=True, stdin=None):
    inner = ["psql", "-X", "-q", "-d", db]
    if stop:
        inner += ["-v", "ON_ERROR_STOP=1"]
    env = dict(os.environ)
    docker_env = []
    if user:
        inner += ["-U", user]
        env["PGPASSWORD"] = OWNER_PW
        # Inside the container, TCP on loopback with a password: a socket
        # connection there goes through peer authentication and the OS user is
        # postgres, so it cannot be this role. Outside, PGHOST is whatever the
        # caller set -- typically a socket directory for a throwaway cluster
        # that is not listening on TCP at all, so the host is left alone.
        if VIA_DOCKER:
            inner += ["-h", "127.0.0.1"]
            docker_env = ["-e", "PGPASSWORD"]
    elif VIA_DOCKER:
        inner += ["-U", "postgres"]
    if sql is not None:
        inner += ["-c", sql]
    if stdin is not None:
        inner += ["-f", "-"]
    inner += list(args)
    cmd = (["docker", "exec", "-i"] + docker_env + [VIA_DOCKER] + inner) \
        if VIA_DOCKER else inner
    r = subprocess.run(cmd, capture_output=True, text=True, input=stdin, env=env)
    return r.returncode, (r.stdout or "") + (r.stderr or "")


def q(sql, db=DB):
    inner = ["psql", "-tAqX", "-d", db, "-c", sql]
    if VIA_DOCKER:
        inner = ["psql", "-tAqX", "-U", "postgres", "-d", db, "-c", sql]
        inner = ["docker", "exec", "-i", VIA_DOCKER] + inner
    r = subprocess.run(inner, capture_output=True, text=True)
    return (r.stdout or "").strip()


# ---------------------------------------------------------------------------
# Extracting the SQL. Each migration module calls execute/1 one or more times,
# with either a heredoc or a plain double-quoted string. No interpolation and
# no two-argument execute in this version, which is checked rather than
# assumed: anything unparseable is reported, never skipped silently.
# ---------------------------------------------------------------------------
# Six migrations use Ecto's DSL rather than raw SQL, so there is no string to
# lift out of them. These are hand-written equivalents, keyed by version.
#
# They are STAND-INS, and that matters for reading the result: this tool exists
# to find privilege walls, and for that a table has to exist with roughly the
# right shape. A column type that differs from Ecto's choice would not change
# which GRANT or ALTER is refused. A missing table would, which is why these
# are here rather than skipped.
#
# All six are later than the migration that creates list_changes.
DSL_EQUIVALENT = {
    # create table(:channels) + unique_index. Ecto adds a bigserial id and
    # timestamps() adds inserted_at/updated_at as timestamp(0) not null.
    "20231018144023": [
        'create table if not exists realtime.channels ('
        ' id bigserial primary key,'
        ' name varchar(255) not null,'
        ' inserted_at timestamp(0) not null default now(),'
        ' updated_at timestamp(0) not null default now())',
        'create unique index if not exists channels_name_index on realtime.channels (name)',
    ],
    '20240108234812': ['alter table realtime.channels add column if not exists "check" boolean default false'],
    '20240418121054': [
        'alter table realtime.channels drop column if exists "check"',
        'alter table realtime.broadcasts drop column if exists "check"',
        'alter table realtime.presences drop column if exists "check"',
    ],
    '20240919163305': ['alter table realtime.messages add column if not exists uuid uuid'],
    # Upstream's change/0 is a bare string, which Ecto does not execute. So
    # this migration really is a no-op, and the replay matches that rather
    # than inventing the statement it looks like it meant.
    '20250506224012': [],
    '20250905041441': [
        'create index if not exists messages_inserted_at_topic_index'
        ' on realtime.messages (inserted_at desc, topic)'
        " where (extension = 'broadcast' and private IS TRUE)",
    ],
}

# Some migrations use BOTH the DSL and execute(). For those the equivalent is
# PREPENDED to the SQL lifted out of the file, rather than replacing it: the
# first version substituted, so `ALTER TABLE realtime.broadcasts` ran against
# a table the DSL half was supposed to have created.
DSL_PREFIX = {
    # create table(:broadcasts) with a reference to channels, plus timestamps.
    '20240227174441': [
        'create table if not exists realtime.broadcasts ('
        ' id bigserial primary key,'
        ' channel_id bigint not null references realtime.channels(id) on delete cascade,'
        ' "check" boolean not null default false,'
        ' inserted_at timestamp(0) not null default now(),'
        ' updated_at timestamp(0) not null default now())',
        'create unique index if not exists broadcasts_channel_id_index'
        ' on realtime.broadcasts (channel_id)',
    ],
    '20240321100241': [
        'create table if not exists realtime.presences ('
        ' id bigserial primary key,'
        ' channel_id bigint not null references realtime.channels(id) on delete cascade,'
        ' "check" boolean not null default false,'
        ' inserted_at timestamp(0) not null default now(),'
        ' updated_at timestamp(0) not null default now())',
        'create unique index if not exists presences_channel_id_index'
        ' on realtime.presences (channel_id)',
    ],
}

# `~S"""` as well as `"""`. Elixir's sigil form is used by four of the
# ninety-one migrations, and the first version of this regex did not match it
# -- so those files' function definitions were silently skipped while their
# trailing ALTER FUNCTION statements were extracted. The generated SQL then
# failed with `function realtime.settled_changes(...) does not exist`, because
# the statement that creates it had been dropped on the floor.
#
# A regex that silently matches less than it should is the worst kind, so
# extract() now also REPORTS how many execute( calls it found versus how many
# it could read, and the caller fails if those differ.
HEREDOC = re.compile(r'execute\(\s*(?:~[sS])?"""(.*?)"""\s*\)', re.S)
PLAIN = re.compile(r'execute\(\s*(?:~[sS])?"((?:[^"\\]|\\.)*)"\s*\)', re.S)
# Every execute( call, however its argument is written, for the count check.
ANY_EXECUTE = re.compile(r'execute\(', re.S)


def extract(path):
    ver = os.path.basename(path).split("_")[0]
    if ver in DSL_EQUIVALENT:
        return list(DSL_EQUIVALENT[ver]), True
    prefix = list(DSL_PREFIX.get(ver, []))
    text = open(path, encoding="utf-8").read()
    found = []
    for m in HEREDOC.finditer(text):
        found.append((m.start(), m.group(1)))
    for m in PLAIN.finditer(text):
        found.append((m.start(), m.group(1).replace('\\"', '"').replace("\\\\", "\\")))
    found.sort(key=lambda x: x[0])
    sqls = prefix + [s.strip() for _, s in found if s.strip()]
    # Did we read every execute( in the file? A mismatch means the argument is
    # written in a form these patterns do not cover, and skipping it silently
    # is how a generated file came to reference a function nothing created.
    n_calls = len(ANY_EXECUTE.findall(text))
    if n_calls != len(found):
        UNREAD.append((os.path.basename(path), n_calls, len(found)))
    # Did the file do anything this cannot see?
    uses_dsl = bool(re.search(r'^\s*(create table|alter table|create index|drop |rename )',
                              text, re.M | re.I))
    return sqls, uses_dsl


def _holds_parameter():
    """Does the owner hold SET on log_min_messages? Read back, not assumed."""
    return q(f"select has_parameter_privilege('{OWNER}','log_min_messages','SET')::text",
             db="postgres") == "true"


def replay(migrations, upto, all_, grant_parameter, pre_create_admin, label):
    """Set up a fresh database and replay. Returns (applied, stopped_at)."""
    psql([], sql=f'DROP DATABASE IF EXISTS "{DB}" WITH (FORCE)', stop=False)
    psql([], sql=f'REVOKE ALL ON PARAMETER log_min_messages FROM "{OWNER}"', stop=False)
    psql([], sql=f'DROP ROLE IF EXISTS "{OWNER}"', stop=False)
    rc, out = psql([], sql=f'CREATE ROLE "{OWNER}" LOGIN NOCREATEROLE NOSUPERUSER '
                           f"PASSWORD '{OWNER_PW}'")
    if rc != 0:
        sys.exit(f"could not create the role:\n{out}")
    for r in ("anon", "authenticated", "service_role"):
        psql([], sql=f'CREATE ROLE "{r}" NOLOGIN', stop=False)
    rc, out = psql([], sql=f'CREATE DATABASE "{DB}" TEMPLATE template0 '
                           f"ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C'")
    if rc != 0:
        sys.exit(f"could not create the database:\n{out}")
    for sql in (f'GRANT CONNECT ON DATABASE "{DB}" TO "{OWNER}"',
                f'GRANT CREATE ON DATABASE "{DB}" TO "{OWNER}"',
                "CREATE SCHEMA IF NOT EXISTS realtime",
                # WITH GRANT OPTION: migration 20240401105812 grants on the
                # schema itself, and ALL without the grant option is not
                # enough to re-grant. Found by replaying past list_changes.
                f'GRANT ALL ON SCHEMA realtime TO "{OWNER}" WITH GRANT OPTION',
                "GRANT USAGE ON SCHEMA realtime TO anon, authenticated, service_role",
                "CREATE EXTENSION IF NOT EXISTS pgcrypto",
                "CREATE SCHEMA IF NOT EXISTS extensions"):
        psql([], sql=sql, db=DB, stop=False)
    if grant_parameter:
        # Privileges on parameters are themselves granted, and initially only a
        # superuser holds them -- so inside the real image this has to be made
        # as supabase_admin, exactly as provision-app.sh does. Run as
        # `postgres` it fails with "permission denied for parameter", and the
        # first version ignored that: phase two then behaved identically to
        # phase one and reported the grant as making no difference.
        #
        # And it is VERIFIED rather than assumed, because that was the mistake.
        psql([], sql=f'GRANT SET ON PARAMETER log_min_messages TO "{OWNER}"', stop=False)
        if VIA_DOCKER and not _holds_parameter():
            subprocess.run(["docker", "exec", "-i", VIA_DOCKER, "psql", "-q",
                            "-U", "supabase_admin", "-d", "postgres", "-c",
                            f'GRANT SET ON PARAMETER log_min_messages TO "{OWNER}"'],
                           capture_output=True, text=True)
        if not _holds_parameter():
            print("  setup: SET ON PARAMETER log_min_messages is NOT HELD — "
                  "phase two cannot mean anything, so it is not claimed to")
    if pre_create_admin:
        if VIA_DOCKER:
            for stmt in ('CREATE ROLE supabase_realtime_admin NOINHERIT NOLOGIN NOREPLICATION',
                         f'GRANT supabase_realtime_admin TO "{OWNER}" WITH ADMIN OPTION'):
                subprocess.run(["docker", "exec", "-i", VIA_DOCKER, "psql", "-q",
                                "-U", "supabase_admin", "-d", "postgres", "-c", stmt],
                               capture_output=True, text=True)
        psql([], sql='CREATE ROLE supabase_realtime_admin NOINHERIT NOLOGIN NOREPLICATION',
             stop=False)
        psql([], sql=f'GRANT supabase_realtime_admin TO "{OWNER}" WITH ADMIN OPTION', stop=False)
    # Created BY the owner, not created and then handed over. On a stock
    # server the provisioning role is a superuser and ALTER TABLE ... OWNER TO
    # works; on the real image it is not, so the transfer silently failed, the
    # table stayed owned by postgres, and every migration's final INSERT was
    # refused -- the whole replay reported "stops at migration 1, 0 applied"
    # and looked like a platform finding when it was this line.
    psql([], sql="CREATE TABLE IF NOT EXISTS realtime.schema_migrations "
                 "(version bigint primary key, inserted_at timestamp default now())",
         db=DB, user=OWNER, stop=False)

    # Before replaying anything: can the owner connect, as itself? If not,
    # every migration below fails for a reason that has nothing to do with
    # Realtime, and the result looks like a platform finding.
    rc, out = psql([], sql="select current_user", db=DB, user=OWNER)
    if rc != 0 or OWNER not in out:
        sys.exit(f"{OWNER} cannot connect to {DB} as itself, so nothing was "
                 f"replayed and no conclusion can be drawn:\n{out.strip()[:400]}")

    files = sorted(f for f in os.listdir(migrations) if f.endswith(".ex"))
    applied, stopped_at, unparsed = 0, None, []
    for f in files:
        ver = f.split("_")[0]
        if not ver.isdigit():
            continue
        sqls, uses_dsl = extract(os.path.join(migrations, f))
        if not sqls and ver in DSL_EQUIVALENT:
            psql([], sql=f"INSERT INTO realtime.schema_migrations (version) VALUES ({ver})",
                 db=DB, user=OWNER, stop=False)
            applied += 1
            if not all_ and int(ver) >= int(upto):
                break
            continue
        if not sqls:
            unparsed.append(f)
            continue
        body = "BEGIN;\n" + "\n".join(s.rstrip().rstrip(";") + ";\n" for s in sqls) \
               + f"INSERT INTO realtime.schema_migrations (version) VALUES ({ver});\nCOMMIT;\n"
        rc, out = psql([], db=DB, user=OWNER, stdin=body)
        if rc == 0:
            applied += 1
        else:
            first = next((l for l in out.splitlines() if "ERROR" in l), out.strip()[:200])
            stopped_at = (f, first.strip())
            break
        if not all_ and int(ver) >= int(upto):
            break
    return applied, stopped_at, unparsed


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--migrations", required=True,
                    help="Realtime's lib/realtime/tenants/repo/migrations directory")
    ap.add_argument("--upto", default="20230328144023",
                    help="stop after this version (default: the one creating list_changes)")
    ap.add_argument("--keep", action="store_true", help="leave the database behind")
    ap.add_argument("--via-docker", default=None, metavar="CONTAINER",
                    help="run psql inside this container, so the replay happens "
                         "against the real image and its non-superuser postgres")
    ap.add_argument("--all", action="store_true",
                    help="replay every migration, not just up to --upto")
    ap.add_argument("--grant-parameter", action="store_true",
                    help="grant SET ON PARAMETER log_min_messages, as provisioning would")
    ap.add_argument("--pre-create-admin", action="store_true",
                    help="create supabase_realtime_admin and grant it to the owner, "
                         "as the image and provisioning would")
    args = ap.parse_args()

    if not os.path.isdir(args.migrations):
        sys.exit(f"{args.migrations} is not a directory")
    if not any(f.endswith(".ex") for f in os.listdir(args.migrations)):
        sys.exit(f"no .ex files in {args.migrations}")

    global VIA_DOCKER
    VIA_DOCKER = args.via_docker
    host = os.environ.get("PGHOST", "")
    if not VIA_DOCKER and host and host not in ("localhost", "127.0.0.1") \
            and not host.startswith("/"):
        sys.exit(f"REFUSING: PGHOST is {host!r}. This creates and drops databases.")
    rc, out = psql([], sql="select 1")
    if rc != 0:
        sys.exit(f"cannot reach PostgreSQL:\n{out}")

    print("\nReplaying Realtime's tenant migrations")
    print(f"  from : {args.migrations}")
    print(f"  as   : {OWNER}, a NON-superuser that owns the realtime schema")
    if VIA_DOCKER:
        print(f"  via  : docker exec {VIA_DOCKER} — the real image, whose postgres "
              f"is not a superuser either")
    print(f"  upto : {args.upto}{' (then everything, --all)' if args.all else ''}\n")

    KEY = "20230328144023"   # the migration that creates list_changes

    # ---------------------------------------------------------------------
    # PHASE 1 -- WITHOUT the parameter grant. This has to FAIL, and fail at
    # the known migration. If it ever starts passing, either Realtime changed
    # that function or PostgreSQL changed who may set log_min_messages, and
    # either way the grant in 21-realtime.sql needs revisiting rather than
    # being carried forever.
    # ---------------------------------------------------------------------
    print("  \033[1mwithout GRANT SET ON PARAMETER log_min_messages\033[0m")
    applied, stopped, _ = replay(args.migrations, args.upto, False, False,
                                 args.pre_create_admin, "no-grant")
    if stopped and stopped[0].startswith(KEY):
        ok(f"stops at {KEY}, as expected, after {applied} migration(s)")
        print(f"       {stopped[1][:150]}")
        if "log_min_messages" in stopped[1]:
            ok("and the reason is log_min_messages, which is what the grant addresses")
        else:
            bad(f"but for a different reason than log_min_messages: {stopped[1][:120]}")
    elif stopped:
        bad(f"stops at {stopped[0]}, not at {KEY} — the diagnosis has changed")
        print(f"       {stopped[1][:150]}")
    else:
        bad(f"every migration passed WITHOUT the grant ({applied} applied). "
            "The grant in 21-realtime.sql may no longer be needed; check before removing it.")

    # ---------------------------------------------------------------------
    # PHASE 2 -- WITH the grant, which is what deploy/sql/21-realtime.sql
    # does. This has to get past it and leave list_changes in place.
    # ---------------------------------------------------------------------
    print("\n  \033[1mwith the grant, as 21-realtime.sql makes it\033[0m")
    applied, stopped, unparsed = replay(args.migrations, args.upto, args.all, True,
                                        args.pre_create_admin, "granted")
    if stopped is None:
        ok(f"{applied} migration(s) replayed with no failure")
    else:
        bad(f"still stops at {stopped[0]} after {applied} migration(s)")
        print(f"       {stopped[1][:200]}")

    for fn in ("list_changes", "apply_rls", "subscription_check_filters",
               "cast", "check_equality_op", "quote_wal2json"):
        n = q("select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace "
              f"where n.nspname='realtime' and p.proname='{fn}'")
        if n == "1":
            ok(f"realtime.{fn}() exists")
        else:
            bad(f"realtime.{fn}() is MISSING — "
                + ("the WAL poller calls this one on every cycle"
                   if fn == "list_changes" else "apply_rls depends on it"))

    if unparsed:
        print(f"\n  {len(unparsed)} file(s) had no extractable SQL and were NOT replayed:")
        for f in unparsed[:8]:
            print(f"      {f}")
        print("  Those use Ecto's DSL in a form this does not reproduce. Every one of")
        print("  them is LATER than the migration that creates list_changes, so they")
        print("  do not affect the result above -- but --all is best-effort for that")
        print("  reason, and only the staging run covers the whole set.")

    if not args.keep:
        psql([], sql=f'DROP DATABASE IF EXISTS "{DB}" WITH (FORCE)', stop=False)
        psql([], sql=f'REVOKE ALL ON PARAMETER log_min_messages FROM "{OWNER}"', stop=False)
        psql([], sql=f'DROP ROLE IF EXISTS "{OWNER}"', stop=False)
        psql([], sql='DROP ROLE IF EXISTS supabase_realtime_admin', stop=False)
    else:
        print(f"\n  kept: database {DB}, role {OWNER}")

    print(f"\n  passed {PASS}  failed {FAIL}\n")
    sys.exit(1 if FAIL else 0)


if __name__ == "__main__":
    main()
