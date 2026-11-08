# Edge functions — what is deployed, and what to deploy next time

Checked 2026-11-08 by downloading every deployed bundle and comparing it with
the repository.

## The names do not match

The deployed slugs are dashboard-generated, so the repository and the platform
disagree about what each function is called. Deploying by repository directory
name would create new functions beside the live ones rather than replacing
them.

| Deployed slug | What it actually is | In the repo | Keep? |
|---|---|---|---|
| `charge-momo` | payments, SMS, reports, Paystack webhook | `charge-momo` — **byte-identical** | yes |
| `clever-worker` | the USSD handler | `ussd-handler` | yes |
| `super-task` | a duplicate of `clever-worker` | `ussd-handler` | **decide** |
| ~~`smart-function`~~ | the WhatsApp AI agent | removed | deleted 2026-11-08 |

### Two things to decide before cutover

**`super-task` is a duplicate.** Byte-identical to `clever-worker`, referenced
by nothing — no database function, no cron job, no frontend call. One of the
two can go, but which one is live depends on what the USSD gateway is
configured to call, and that configuration is not in this repository. Check the
gateway before deleting either.

**Two repository functions are not deployed at all:**

- `paystack-webhook` — not deployed, and not needed: `charge-momo` handles the
  webhook itself and contains the signature verification.
- `sms-reports` — not deployed, and not needed: four `sms_*_report()` SQL
  functions do that work, called directly by cron.

So the migration deploys **two** functions, not four. Deploying all four would
add two endpoints nobody calls.

## Compatibility with the self-hosted runtime

All three deployed functions use only `Deno.env` and a `serve()` handler, and
reach the database over plain `fetch` against the REST API rather than through
a client library's platform features. That is unusually portable — nothing in
them depends on Supabase-hosted behaviour.

Three things still need attention:

1. **Imports are fetched at runtime.**

   ```
   https://deno.land/std@0.168.0/http/server.ts
   https://esm.sh/@supabase/supabase-js@2
   ```

   Deno fetches these on first run and caches them in the `deno-cache` volume.
   A server without egress to `deno.land` and `esm.sh` will start the container
   and fail every request.

2. **`@supabase/supabase-js@2` is not pinned.** A breaking change inside the v2
   line arrives silently on the next cold start. Pin it to an exact version
   before cutover.

3. **There is a hardcoded fallback to the old project.** `charge-momo` reads
   `SUPABASE_URL` with the old project's URL as its default. If that variable
   is not set on the new server, the function keeps talking to the old backend
   and nothing errors. The same pattern appears in the two cron jobs that
   embed a URL.

## The router

`app.compose.yml` starts the runtime with
`--main-service /home/deno/functions/main`. That router is not part of the
image and is vendored in `compose/functions-main/` — see its README. Without
it the container starts and serves nothing.

## Getting the sources

```
export SUPABASE_ACCESS_TOKEN=...   # read -rs keeps it out of your history
supabase functions download charge-momo   --project-ref <ref>
supabase functions download clever-worker --project-ref <ref>
```

Each function's own secrets cannot be read back out of the platform. They must
be set by hand on the new server; `provision-app.sh` writes a `functions.env`
listing the names each surviving function reads.
