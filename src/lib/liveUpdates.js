// ===========================================================================
// Live updates by polling a three-row table, instead of holding a websocket.
//
//   const stop = startLiveUpdates(sb, {
//     sales:           () => store.refreshSales(),
//     products:        () => store.refreshProducts(),
//     whatsapp_orders: () => store.refreshWAOrders(),
//   })
//
// WHAT IT POLLS
//   public.live_state — one row per watched table, holding a revision number
//   that a statement-level trigger bumps on any change. See
//   deploy/sql/30-live-state.sql. The request is three rows from a three-row
//   table: a few hundred bytes, and it costs the same whether the shop has
//   sold ten things or ten million.
//
// WHY POLLING
//   The till needs to know THAT something changed so it can call the
//   refreshers it already has; it does not need the changed row pushed to it.
//   App.jsx's handlers already re-read from the API rather than trusting a
//   pushed payload. So the only thing a websocket was buying was latency, and
//   it cost a whole extra service that did not deliver reliably on the
//   self-hosted stack.
//
// WHAT IT COSTS
//   One small request per interval per open till. At the default three
//   seconds that is 1,200 requests an hour per workstation, each one a
//   primary-key read of three rows. A shop with four tills is about an eighth
//   of a request per second.
//
// WHAT IT DOES NOT DO
//   Poll while the tab is hidden: a till on a screen nobody is looking at
//   does not need refreshing, and it resumes the moment the tab is shown. It
//   also backs off when the API is unreachable rather than hammering a server
//   that is down, and recovers without being reloaded.
//
// THE DEGRADED MODE, AND WHY IT EXISTS
//   A till's JavaScript and its database are deployed separately. If this
//   code reaches a backend where live_state has not been created yet — or
//   where it exists but the read grants are missing — then polling it would
//   fail every time and the till would receive NOTHING. That is worse than
//   what it replaced. So a missing or unreadable live_state is not an error
//   to retry forever: it switches to calling every refresher on a slower
//   interval, which needs no new table and no new grant. Updates are then
//   twenty seconds late instead of three, and the till keeps working.
// ===========================================================================

const DEFAULTS = {
  intervalMs: 3000,          // felt instantaneous at a till; see the note above
  degradedIntervalMs: 20000, // no live_state: refresh everything, slower
  maxBackoffMs: 30000,       // a server that is down is not helped by more requests
  onError: null,
  onDegrade: null,
}

// Does this error mean "live_state is not available on this backend", as
// opposed to "the server is down" or "the network dropped"? The first is
// permanent until somebody applies a migration, so retrying is pointless and
// the right answer is the degraded mode. The second is temporary and the right
// answer is to back off and keep trying.
//
// PostgREST reports a table that is not in its schema cache as PGRST205 (and
// as a bare 42P01 on older versions), and a table it can see but not read as
// 42501.
export function isMissingLiveState(error) {
  if (!error) return false
  const code = String(error.code || '')
  if (code === 'PGRST205' || code === 'PGRST202' || code === '42P01' || code === '42501') return true
  const msg = `${error.message || ''} ${error.details || ''} ${error.hint || ''}`.toLowerCase()
  if (!msg.includes('live_state')) return false
  return msg.includes('does not exist') || msg.includes('could not find') ||
         msg.includes('permission denied') || msg.includes('not exist')
}

export function startLiveUpdates(sb, handlers, options = {}) {
  if (!sb) return () => {}
  const opts = { ...DEFAULTS, ...options }
  const sources = Object.keys(handlers)
  if (sources.length === 0) return () => {}

  // null means "not seen yet": the first poll records the current revisions
  // WITHOUT firing every handler, so opening the till does not immediately
  // trigger three refreshes of data it has just loaded.
  const seen = new Map(sources.map((s) => [s, null]))
  let stopped = false
  let timer = null
  let backoff = 0
  let consecutiveErrors = 0
  let degraded = false

  const schedule = (ms) => {
    if (stopped) return
    clearTimeout(timer)
    timer = setTimeout(tick, ms)
  }

  const runAll = async () => {
    for (const s of sources) {
      if (stopped) return
      try { await handlers[s]() } catch (e) { /* a refresher's own problem */ }
    }
  }

  async function tick() {
    if (stopped) return
    // A hidden tab is a screen nobody is looking at.
    if (typeof document !== 'undefined' && document.hidden) {
      schedule(degraded ? opts.degradedIntervalMs : opts.intervalMs)
      return
    }

    if (degraded) {
      await runAll()
      schedule(opts.degradedIntervalMs)
      return
    }

    try {
      const { data, error } = await sb
        .from('live_state')
        .select('source,rev')
        .in('source', sources)
      if (error) throw error

      consecutiveErrors = 0
      backoff = 0
      for (const row of data || []) {
        const prev = seen.get(row.source)
        if (prev === undefined) continue            // a source nobody asked for
        if (prev === null) { seen.set(row.source, row.rev); continue }
        if (row.rev !== prev) {
          seen.set(row.source, row.rev)
          try { await handlers[row.source]() } catch (e) { /* as above */ }
        }
      }
      schedule(opts.intervalMs)
    } catch (e) {
      if (isMissingLiveState(e)) {
        // Permanent until a migration is applied. Say so once, then keep the
        // till updating the only way left.
        degraded = true
        if (opts.onDegrade) { try { opts.onDegrade(e) } catch {} }
        schedule(0)
        return
      }
      consecutiveErrors++
      // Exponential, capped. The till keeps working offline; this is only
      // about not shouting at a server that cannot answer.
      backoff = Math.min(opts.maxBackoffMs,
                         Math.max(opts.intervalMs, backoff * 2 || opts.intervalMs * 2))
      if (opts.onError) { try { opts.onError(e, consecutiveErrors) } catch {} }
      schedule(backoff)
    }
  }

  // Coming back from a hidden tab or a dropped connection should feel
  // immediate, not "up to three seconds".
  const wake = () => {
    if (!stopped && (typeof document === 'undefined' || !document.hidden)) schedule(0)
  }
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', wake)
  if (typeof window !== 'undefined') window.addEventListener('online', wake)

  schedule(0)

  const stop = function stop() {
    stopped = true
    clearTimeout(timer)
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', wake)
    if (typeof window !== 'undefined') window.removeEventListener('online', wake)
  }
  // Readable by the browser acceptance test, which has to be able to state
  // which mode it measured rather than assuming the fast one.
  stop.isDegraded = () => degraded
  return stop
}

// Exported for the tests: the diffing rule in one place, so it can be checked
// without a browser or a database.
export function changedSources(seen, rows) {
  const out = []
  for (const row of rows || []) {
    const prev = seen.get(row.source)
    if (prev === undefined || prev === null) continue
    if (row.rev !== prev) out.push(row.source)
  }
  return out
}
