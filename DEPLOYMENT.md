# Deploying the till

The app is a static Vite build. Vercel runs `npm run build` and serves `dist/`.
There is no server to run: everything behind the till — the database, the
payment and WhatsApp edge functions, the cron jobs — lives in Supabase and is
deployed separately.

## Moving the site to a different Vercel account

The backend is no longer compiled into the source, so a move is two environment
variables and a deploy. Nothing in `src/` needs editing.

1. **Create the project** on the new account and point it at
   `github.com/isaacgyampoh/everytinroom-pos`, branch `main`. Vercel reads
   `vercel.json`, so framework, build command, output directory, caching and
   the SPA rewrite all come across on their own — leave the dashboard's build
   settings alone.

2. **Set the environment variables** on the new project, for Production,
   Preview and Development:

   | Variable | Value |
   | --- | --- |
   | `VITE_SUPABASE_URL` | `https://noiiuwkovoojkcwzupye.supabase.co` |
   | `VITE_SUPABASE_ANON_KEY` | the anon key from Supabase → Settings → API |

   Both are optional. Unset, the build falls back to exactly these values, so
   the first deploy works before they are set — but set them anyway, or the
   next person to move the backend will be hunting through `src/lib/supabase.js`
   again. The anon key is public by design and is row-level-security scoped; the
   service-role key must never be set here.

   These are inlined **at build time**. Changing them in the dashboard does
   nothing until the next deploy.

3. **Move the domain.** `www.everytinroom.store` can only be attached to one
   Vercel project at a time, so it has to be removed from the old project
   before the new one will verify it. The till itself is a PWA installed from
   that hostname: until the DNS has moved, installed tills keep talking to the
   old deployment.

4. **Add the new deployment's origin to Supabase.** The hosted catalogue and
   the payment pages call Supabase from the browser, so the new hostname needs
   adding under Supabase → Authentication → URL Configuration, and to the
   allowed origins of any edge function that checks them.

5. **Re-link this working copy before deploying from the CLI.** `.vercel/` is
   local, untracked, and still points at whichever project it was linked to
   last — a `vercel deploy` from here goes to the OLD account without saying
   so. Run `vercel link` (or delete `.vercel/`) first, and confirm with
   `vercel project ls`.

## Checklist for the first deploy on a new account

- [ ] Build goes green in the Actions tab (`Web build`) and on Vercel.
- [ ] The deployment URL loads the till's sign-in screen, not a blank page.
- [ ] A cashier can sign in and ring up a cash sale.
- [ ] `#/catalog` loads the storefront.
- [ ] A payment link (`#/pay?...`) loads.
- [ ] `/sw.js` responds with `cache-control: public, max-age=0, must-revalidate`.
      If it is cached, deploys stop reaching installed tills:
      `curl -sI https://<deployment>/sw.js | grep -i cache-control`
- [ ] `/assets/<something>.js` responds with `max-age=31536000, immutable`.
- [ ] Deployment protection is **off** for the production domain. The old
      project had SSO protection on everything except custom domains; with it
      on, a preview URL asks a cashier to log into Vercel.

## Why the version on the counter can lag

A till is a PWA that can stay open for days. The service worker only swaps to a
new build when the basket is empty (`src/lib/appUpdate.js`), checks for one
every 30 minutes, and will not interrupt a sale. So a deploy reaching a counter
within the hour is normal, and a till mid-sale correctly ignores it.

If a deploy never arrives, the cause is almost always `/sw.js` being cached —
see the checklist above.
