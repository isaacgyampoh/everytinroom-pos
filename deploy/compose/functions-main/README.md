# The edge-runtime main router

Vendored verbatim from `supabase/supabase/docker/volumes/functions/main/`.
**Do not edit these two files.** Re-fetch them when bumping the
`supabase/edge-runtime` tag, and record the date below.

Fetched 2026-11-08, against `supabase/edge-runtime:v1.77.9`.

## Why it is here at all

`app.compose.yml` starts the runtime with
`--main-service /home/deno/functions/main`. That main service is not part of
the image: it is the router that receives every request, works out which
function the path names, and spawns a worker for it. Without it the
`functions` profile starts a container that serves nothing.

`provision-app.sh` copies this directory into each application's
`functions/main/`, so an application's own function directories sit beside it.

## It needs outbound internet at boot

The router imports `jsr:@panva/jose`, and the shop's own functions import from
`deno.land/std` and `esm.sh`. Deno fetches those on first run and caches them
in the `deno-cache` volume. A server with no egress to those hosts will start
the container and fail every request.

That is worth knowing before cutover, not after.
