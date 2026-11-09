import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { startLiveUpdates, changedSources, isMissingLiveState } from './liveUpdates'

// A stand-in for the PostgREST client, which answers whatever the test's
// script says for each successive poll. Nothing here touches a network.
function fakeSb(script) {
  const state = { polls: 0, lastSources: null }
  const sb = {
    state,
    from() {
      return {
        select() { return this },
        in(_col, vals) {
          state.polls++
          state.lastSources = vals
          const step = typeof script === 'function' ? script(state.polls) : script
          return Promise.resolve(step)
        },
      }
    },
  }
  return sb
}

const rows = (o) => ({ data: Object.entries(o).map(([source, rev]) => ({ source, rev })), error: null })

function counters() {
  const hit = { sales: 0, products: 0, whatsapp_orders: 0 }
  const handlers = {
    sales: async () => { hit.sales++ },
    products: async () => { hit.products++ },
    whatsapp_orders: async () => { hit.whatsapp_orders++ },
  }
  return { hit, handlers }
}

describe('changedSources — the diffing rule on its own', () => {
  it('a source that has never been seen does not count as changed', () => {
    const seen = new Map([['sales', null]])
    expect(changedSources(seen, [{ source: 'sales', rev: 7 }])).toEqual([])
  })

  it('an unchanged revision does not count as changed', () => {
    const seen = new Map([['sales', 7]])
    expect(changedSources(seen, [{ source: 'sales', rev: 7 }])).toEqual([])
  })

  it('a bumped revision counts, and only for the source that moved', () => {
    const seen = new Map([['sales', 7], ['products', 2]])
    const out = changedSources(seen, [{ source: 'sales', rev: 8 }, { source: 'products', rev: 2 }])
    expect(out).toEqual(['sales'])
  })

  it('a revision going BACKWARDS still counts — the table was reseeded', () => {
    const seen = new Map([['sales', 9]])
    expect(changedSources(seen, [{ source: 'sales', rev: 1 }])).toEqual(['sales'])
  })

  it('a source nobody subscribed to is ignored rather than reported', () => {
    const seen = new Map([['sales', 1]])
    expect(changedSources(seen, [{ source: 'expenses', rev: 4 }])).toEqual([])
  })

  it('no rows at all is not a change', () => {
    expect(changedSources(new Map([['sales', 1]]), [])).toEqual([])
    expect(changedSources(new Map([['sales', 1]]), null)).toEqual([])
  })
})

describe('isMissingLiveState — permanent versus temporary failure', () => {
  it('treats a table PostgREST cannot find as permanent', () => {
    expect(isMissingLiveState({ code: 'PGRST205', message: "Could not find the table 'public.live_state'" })).toBe(true)
    expect(isMissingLiveState({ code: '42P01', message: 'relation "live_state" does not exist' })).toBe(true)
  })

  it('treats a table it cannot read as permanent — a missing grant needs a migration too', () => {
    expect(isMissingLiveState({ code: '42501', message: 'permission denied for table live_state' })).toBe(true)
  })

  it('recognises the message alone when no code comes back', () => {
    expect(isMissingLiveState({ message: 'relation "public.live_state" does not exist' })).toBe(true)
  })

  it('treats a dead server or a dropped connection as temporary', () => {
    expect(isMissingLiveState({ message: 'Failed to fetch' })).toBe(false)
    expect(isMissingLiveState({ code: '503', message: 'service unavailable' })).toBe(false)
    expect(isMissingLiveState({ code: '57014', message: 'canceling statement due to statement timeout' })).toBe(false)
    expect(isMissingLiveState(null)).toBe(false)
  })
})

describe('startLiveUpdates — the polling loop', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('returns a no-op when there is no client, so a till with no backend still boots', () => {
    const stop = startLiveUpdates(null, { sales: () => {} })
    expect(typeof stop).toBe('function')
    stop()
  })

  it('the FIRST poll records the current revisions and fires nothing', async () => {
    const { hit, handlers } = counters()
    const sb = fakeSb(rows({ sales: 5, products: 3, whatsapp_orders: 1 }))
    const stop = startLiveUpdates(sb, handlers, { intervalMs: 1000 })

    await vi.advanceTimersByTimeAsync(0)
    expect(sb.state.polls).toBe(1)
    expect(hit).toEqual({ sales: 0, products: 0, whatsapp_orders: 0 })
    stop()
  })

  it('asks only for the sources it was given', async () => {
    const sb = fakeSb(rows({ sales: 1 }))
    const stop = startLiveUpdates(sb, { sales: async () => {} }, { intervalMs: 1000 })
    await vi.advanceTimersByTimeAsync(0)
    expect(sb.state.lastSources).toEqual(['sales'])
    stop()
  })

  it('fires the handler for the source whose revision moved, and no other', async () => {
    const { hit, handlers } = counters()
    const sb = fakeSb((n) => (n === 1
      ? rows({ sales: 5, products: 3, whatsapp_orders: 1 })
      : rows({ sales: 6, products: 3, whatsapp_orders: 1 })))
    const stop = startLiveUpdates(sb, handlers, { intervalMs: 1000 })

    await vi.advanceTimersByTimeAsync(0)      // first poll: record
    await vi.advanceTimersByTimeAsync(1000)   // second poll: sales moved
    expect(hit).toEqual({ sales: 1, products: 0, whatsapp_orders: 0 })
    stop()
  })

  it('does not fire the same change twice', async () => {
    const { hit, handlers } = counters()
    const sb = fakeSb((n) => (n === 1 ? rows({ sales: 5 }) : rows({ sales: 6 })))
    const stop = startLiveUpdates(sb, { sales: handlers.sales }, { intervalMs: 1000 })

    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(1000)   // 5 -> 6, fires
    await vi.advanceTimersByTimeAsync(1000)   // still 6, silent
    await vi.advanceTimersByTimeAsync(1000)
    expect(hit.sales).toBe(1)
    stop()
  })

  it('keeps polling on an interval', async () => {
    const sb = fakeSb(rows({ sales: 1 }))
    const stop = startLiveUpdates(sb, { sales: async () => {} }, { intervalMs: 1000 })
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(5000)
    expect(sb.state.polls).toBe(6)
    stop()
  })

  it('stop() ends it — a signed-out till does not keep calling the API', async () => {
    const sb = fakeSb(rows({ sales: 1 }))
    const stop = startLiveUpdates(sb, { sales: async () => {} }, { intervalMs: 1000 })
    await vi.advanceTimersByTimeAsync(0)
    const after = sb.state.polls
    stop()
    await vi.advanceTimersByTimeAsync(10000)
    expect(sb.state.polls).toBe(after)
  })

  it('backs off when the server cannot answer, instead of hammering it', async () => {
    const seenErrors = []
    const sb = fakeSb(() => ({ data: null, error: { message: 'Failed to fetch' } }))
    const stop = startLiveUpdates(sb, { sales: async () => {} }, {
      intervalMs: 1000, maxBackoffMs: 8000, onError: (e, n) => seenErrors.push(n),
    })

    await vi.advanceTimersByTimeAsync(0)        // poll 1 fails -> wait 2000
    expect(sb.state.polls).toBe(1)
    await vi.advanceTimersByTimeAsync(1999)
    expect(sb.state.polls).toBe(1)              // it did NOT retry at the normal interval
    await vi.advanceTimersByTimeAsync(1)
    expect(sb.state.polls).toBe(2)              // 2000ms later
    await vi.advanceTimersByTimeAsync(4000)
    expect(sb.state.polls).toBe(3)              // then 4000ms
    expect(seenErrors).toEqual([1, 2, 3])
    expect(stop.isDegraded()).toBe(false)       // a dead server is not a missing table
    stop()
  })

  it('recovers after an outage without being reloaded', async () => {
    const { hit, handlers } = counters()
    const sb = fakeSb((n) => {
      if (n === 1) return rows({ sales: 5 })
      if (n === 2) return { data: null, error: { message: 'Failed to fetch' } }
      return rows({ sales: 6 })
    })
    const stop = startLiveUpdates(sb, { sales: handlers.sales }, { intervalMs: 1000 })

    await vi.advanceTimersByTimeAsync(0)        // record 5
    await vi.advanceTimersByTimeAsync(1000)     // fails
    await vi.advanceTimersByTimeAsync(2000)     // backoff elapses, sees 6
    expect(hit.sales).toBe(1)
    stop()
  })

  it('a MISSING live_state degrades to refreshing everything, instead of delivering nothing', async () => {
    const { hit, handlers } = counters()
    const degradeCalls = []
    const sb = fakeSb(() => ({
      data: null,
      error: { code: 'PGRST205', message: "Could not find the table 'public.live_state' in the schema cache" },
    }))
    const stop = startLiveUpdates(sb, handlers, {
      intervalMs: 1000, degradedIntervalMs: 5000, onDegrade: (e) => degradeCalls.push(e.code),
    })

    await vi.advanceTimersByTimeAsync(0)        // poll fails permanently
    expect(degradeCalls).toEqual(['PGRST205'])
    expect(stop.isDegraded()).toBe(true)

    // The degraded pass is scheduled for "as soon as possible", which under
    // fake timers means the next tick rather than this same flush.
    await vi.advanceTimersByTimeAsync(1)        // immediate degraded pass
    expect(hit).toEqual({ sales: 1, products: 1, whatsapp_orders: 1 })

    await vi.advanceTimersByTimeAsync(5000)     // and again on the slower interval
    expect(hit).toEqual({ sales: 2, products: 2, whatsapp_orders: 2 })

    // It stopped asking for a table that is not there.
    expect(sb.state.polls).toBe(1)
    stop()
  })

  it('a handler that throws does not kill the loop', async () => {
    const sb = fakeSb((n) => (n === 1 ? rows({ sales: 1 }) : rows({ sales: n })))
    let calls = 0
    const stop = startLiveUpdates(sb, {
      sales: async () => { calls++; throw new Error('refreshSales blew up') },
    }, { intervalMs: 1000 })

    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(1000)
    await vi.advanceTimersByTimeAsync(1000)
    expect(calls).toBe(2)
    expect(sb.state.polls).toBe(3)
    stop()
  })
})
