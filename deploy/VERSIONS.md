# Pinned versions

Every image tag is fixed. `latest` on a server that restarts at 3am is how a
working stack becomes a broken one with nobody touching it.

## What is pinned, and to what

| Component | Tag | Why this one |
|---|---|---|
| `supabase/postgres` | `17.6.1.136` | Not plain `postgres`. Production uses `supabase_vault`, `pg_cron` and `pg_net`; this image ships them preloaded along with the `anon`/`authenticated`/`service_role`/`authenticator` roles PostgREST and Realtime expect. |
| `postgrest/postgrest` | `v14.18` | The `v` is part of the tag — `postgrest/postgrest:16.5` does not exist. |
| `supabase/realtime` | `v2.148.3` | |
| `supabase/storage-api` | `v1.89.12` | |
| `supabase/edge-runtime` | `v1.77.9` | |
| `darthsim/imgproxy` | `v4.0.21` | Image transformations are a billed add-on on hosted Supabase. Self-hosted this is CPU already paid for. |
| `caddy` | `2.11.9-alpine` | |

## Why not the newest release of each

These are the versions Supabase itself ships and tests together in
`supabase/supabase/docker/docker-compose.yml`. At the time of writing, upstream
had newer releases available — PostgREST v16.5, Realtime v2.153.5, storage
v1.90.0, edge-runtime v1.78.1 — and they are deliberately **not** used.

PostgREST, Realtime and Storage all talk to the same database and to each
other. Supabase's combination is the one with miles on it; picking the newest
of each independently is a combination nobody has run. The application is
being moved off a working backend, so the goal is for nothing to change in how
it behaves.

Bump them when there is a reason — a security fix, or a feature that is needed
— one at a time, in staging.

## Docker Engine is not pinned

`bootstrap.sh` installs the current stable release from Docker's own apt
repository. `DOCKER_VERSION` can pin an exact version:

```
DOCKER_VERSION=5:27.3.1-1~ubuntu.24.04~noble ./bootstrap.sh
```

It is not the default because apt versions are withdrawn from that repository
over time, so a pin recorded today becomes an install that cannot be
reproduced in a year — the opposite of what pinning is for. Reproducibility is
pinned where it holds: the image tags above, which are what decide how the
stack behaves.

## Checking a tag exists before trusting it

```
curl -s -o /dev/null -w '%{http_code}\n' \
  https://hub.docker.com/v2/repositories/postgrest/postgrest/tags/v14.18
```

`200` means it is there. This is worth doing before any bump: a tag that does
not exist fails at `docker compose up`, after the firewall and directories are
already configured.

## Ubuntu

22.04 (jammy), 24.04 (noble) and 26.04 (resolute) are accepted; 24.04 or 26.04
is the sensible choice. `bootstrap.sh` checks that Docker's repository has a
build for the release's codename before it tries to install anything, because
for a few weeks after a new Ubuntu release it does not.
