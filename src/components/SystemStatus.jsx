import { useState, useEffect } from 'react'
import { useStore } from '../hooks/useStore'
import { getSupabase } from '../lib/supabase'
import { money } from '../lib/utils'
import { queueStats, listJobs, flush, retryJob, dropJob, onPendingChange } from '../lib/offlineQueue'
import { catalogueAge } from '../lib/offlineStore'
import { terminalLabel } from '../lib/hardware'
import toast from 'react-hot-toast'

// What an owner needs to know about the till, in words rather than logs. A
// cashier should never see a stack trace; an admin should never have to ask a
// developer whether sales are getting through.
export default function SystemStatus() {
  const { isAdmin } = useStore()
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine)
  const [stats, setStats] = useState(queueStats())
  const [jobs, setJobs] = useState(listJobs())
  const [server, setServer] = useState('checking')
  const [busy, setBusy] = useState(false)

  const refresh = () => { setStats(queueStats()); setJobs(listJobs()) }

  useEffect(() => {
    const off = onPendingChange(refresh)
    const up = () => setOnline(true), down = () => setOnline(false)
    window.addEventListener('online', up); window.addEventListener('offline', down)
    const t = setInterval(refresh, 5000)
    return () => { off(); clearInterval(t); window.removeEventListener('online', up); window.removeEventListener('offline', down) }
  }, [])

  // Ask the server something cheap rather than trusting navigator.onLine, which
  // only knows whether a cable is plugged in — not whether anything answers.
  useEffect(() => {
    let dead = false
    const ping = async () => {
      const t0 = Date.now()
      try {
        const { error } = await getSupabase().from('products_sale').select('id').limit(1)
        if (!dead) setServer(error ? 'unreachable' : (Date.now() - t0 > 2500 ? 'slow' : 'ok'))
      } catch { if (!dead) setServer('unreachable') }
    }
    ping()
    const t = setInterval(ping, 20000)
    return () => { dead = true; clearInterval(t) }
  }, [])

  const catAt = catalogueAge()

  const sendNow = async () => {
    setBusy(true)
    const r = await flush()
    setBusy(false); refresh()
    if (r.offline) toast.error('Still no connection')
    else if (r.sent) toast.success(`${r.sent} sale${r.sent > 1 ? 's' : ''} filed`)
    else if (r.left) toast('Nothing went through — the server is not answering yet', { icon: '!' })
    else toast.success('Everything is filed')
  }

  const Line = ({ label, value, tone }) => (
    <div className="flex items-center justify-between py-2.5 border-b border-gray-100 last:border-0 gap-4">
      <span className="text-[13px] text-gray-500">{label}</span>
      <span className={`text-[13px] font-semibold text-right ${tone || 'text-gray-900'}`}>{value}</span>
    </div>
  )

  const ok = 'text-emerald-600', bad = 'text-[#b3402b]', warn = 'text-amber-600'

  return (
    <div className="bg-white rounded-2xl p-5 md:p-6 shadow-md mb-5">
      <h2 className="text-sm font-bold text-gray-800 mb-1">System status</h2>
      <p className="text-[11px] text-gray-400 mb-3">This till — {terminalLabel()}</p>

      <Line label="Internet" value={online ? 'Connected' : 'Offline'} tone={online ? ok : bad} />
      <Line label="Shop server"
        value={server === 'ok' ? 'Answering' : server === 'slow' ? 'Slow' : server === 'checking' ? 'Checking…' : 'Not answering'}
        tone={server === 'ok' ? ok : server === 'checking' ? '' : server === 'slow' ? warn : bad} />
      <Line label="Product list"
        value={catAt ? `Saved on this till · ${new Date(catAt).toLocaleString('en-GB', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' })}` : 'Not saved yet'}
        tone={catAt ? ok : warn} />
      <Line label="Sales waiting to file"
        value={stats.total === 0 ? 'None' : `${stats.total} · ${money(stats.value)}`}
        tone={stats.total === 0 ? ok : warn} />
      {stats.failed > 0 && (
        <Line label="Sales needing attention" value={`${stats.failed}`} tone={bad} />
      )}
      {stats.oldest && (
        <Line label="Oldest waiting since"
          value={new Date(stats.oldest).toLocaleString('en-GB', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' })} />
      )}

      {stats.total > 0 && (
        <button onClick={sendNow} disabled={busy}
          className="mt-4 h-11 px-4 rounded-xl bg-[#16181d] text-white text-[13px] font-semibold disabled:opacity-40">
          {busy ? 'Sending…' : 'Try sending now'}
        </button>
      )}

      {/* The technical detail lives here, for an admin, out of a cashier's way. */}
      {isAdmin && stats.failed > 0 && (
        <details className="mt-4">
          <summary className="text-[12px] font-semibold text-gray-500 cursor-pointer">
            {stats.failed} sale{stats.failed > 1 ? 's' : ''} the server would not accept
          </summary>
          <div className="mt-2 space-y-2">
            {jobs.filter(j => j.status === 'failed').map(j => (
              <div key={j.id} className="rounded-xl bg-gray-50 border border-gray-200 p-3">
                <div className="text-[12.5px] font-semibold text-gray-800">
                  {money(j.total)} · {new Date(j.queuedAt).toLocaleString('en-GB')}
                </div>
                <div className="text-[11px] text-[#b3402b] mt-1 break-words">{j.lastError}</div>
                <div className="text-[10.5px] text-gray-400 mt-1">{j.attempts} attempts · {j.id}</div>
                <div className="flex gap-2 mt-2">
                  <button onClick={() => { retryJob(j.id); refresh(); toast('Will try again') }}
                    className="h-9 px-3 rounded-lg border-2 border-gray-200 text-[12px] font-semibold text-gray-600">Try again</button>
                  <button onClick={() => { if (confirm('Discard this sale? It will not be recorded anywhere.')) { dropJob(j.id); refresh() } }}
                    className="h-9 px-3 rounded-lg bg-[#b3402b] text-white text-[12px] font-semibold">Discard</button>
                </div>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  )
}
