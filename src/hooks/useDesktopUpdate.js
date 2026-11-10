import { useEffect, useState } from 'react'
import { getSupabase } from '../lib/supabase'
import { isNewerVersion } from '../lib/version'

// ============================================================================
// THE PACKAGED TILL DOES NOT UPDATE ITSELF
//
// The browser and PWA builds pick up a deploy through the service worker, and
// appUpdate.js swaps to it the moment the basket is empty. The Windows build
// cannot: its bundle is served from disk inside the installer, which is exactly
// what lets it open and trade with no line at all.
//
// So a packaged till runs whatever it was installed with, for ever, and the
// only cure is somebody running a newer installer. There is a release system
// already — admins publish one to the app_releases table and Terminal & printer
// has a download button — but nothing ever told a shop a new one existed. A
// till could sit on a build from months ago with nobody aware.
//
// This closes that loop: ask the shell what it is running, compare it against
// the newest published release, and say so.
// ============================================================================

const SIX_HOURS = 6 * 60 * 60 * 1000
const SNOOZE_KEY = 'pos-update-snoozed'

export function useDesktopUpdate() {
  const [update, setUpdate] = useState(null)

  useEffect(() => {
    let cancelled = false

    const run = async () => {
      // Only the packaged shell answers this. In the browser build the SPA
      // rewrite returns index.html, which is not JSON, so this throws and we
      // leave — the web till must never be told to reinstall itself.
      let info
      try {
        const r = await fetch('/__app.json', { cache: 'no-store' })
        if (!r.ok) return
        info = await r.json()
      } catch { return }
      if (!info?.packaged || !info.version) return

      try {
        const { data, error } = await getSupabase()
          .from('app_releases')
          .select('version,notes,published_at')
          .eq('platform', 'windows').eq('active', true)
          .order('published_at', { ascending: false })
          .limit(1)
        if (error || cancelled) return
        const latest = data?.[0]
        if (!latest || !isNewerVersion(latest.version, info.version)) return

        // Snoozed per version, so dismissing one does not hide the next.
        let snoozed = null
        try { snoozed = sessionStorage.getItem(SNOOZE_KEY) } catch {}
        if (snoozed === latest.version) return

        setUpdate({ version: latest.version, running: info.version, notes: latest.notes || '' })
      } catch { /* a till with no line is not a till needing an update prompt */ }
    }

    run()
    // A few times a day. This is a shop, not a CI runner — a new installer is
    // a rare event and checking harder would only add noise.
    const iv = setInterval(run, SIX_HOURS)
    return () => { cancelled = true; clearInterval(iv) }
  }, [])

  const snooze = () => {
    try { if (update) sessionStorage.setItem(SNOOZE_KEY, update.version) } catch {}
    setUpdate(null)
  }

  return { update, snooze }
}
