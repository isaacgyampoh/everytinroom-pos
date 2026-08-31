// ============================================================================
// OFFLINE SALE QUEUE
//
// A till on a Ghanaian high street loses its connection several times a day.
// Until now that meant the shop simply could not sell: record_sale threw, the
// cashier saw "Error", and the customer waited at the counter.
//
// Cash sales don't actually need the network at the moment of the sale — only
// the record does. So a failed sale is parked here, the customer is served,
// and the queue drains itself the moment the connection returns.
//
// The thing that makes this safe is the client reference. Each queued sale
// carries one, generated once, and record_sale (migration 020) refuses to
// insert the same reference twice — so a replay that half-succeeded, or a
// double flush from two tabs, cannot ring the same basket up again.
//
// MoMo sales are deliberately NOT queued: the payment itself needs the network,
// so there is nothing to defer.
// ============================================================================

import { getSupabase } from './supabase'

const KEY = 'pos-offline-sales'
const listeners = new Set()

export function newClientRef() {
  const rand = (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID().replace(/-/g, '')
    : Math.random().toString(36).slice(2) + Date.now().toString(36)
  return 'CR-' + rand.slice(0, 24).toUpperCase()
}

function read() {
  try { const v = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(v) ? v : [] }
  catch { return [] }
}

function write(list) {
  localStorage.setItem(KEY, JSON.stringify(list))
  listeners.forEach(fn => { try { fn(list.length) } catch {} })
}

export function pendingCount() { return read().length }

export function onPendingChange(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

// A sale that couldn't reach the server. `args` is exactly what record_sale
// would have been called with, so replaying is a straight resend.
export function enqueue(args, meta = {}) {
  const list = read()
  list.push({ args, meta, queuedAt: new Date().toISOString(), attempts: 0 })
  write(list)
  return list.length
}

// Anything that isn't "the server said no" is worth retrying. A validation
// error would fail identically forever, so those are dropped rather than
// clogging the queue.
export function isNetworkish(err) {
  if (!err) return true
  const m = String(err.message || err).toLowerCase()
  return m.includes('fetch') || m.includes('network') || m.includes('timeout')
      || m.includes('failed') || m.includes('load') || m.includes('offline')
}

let flushing = false

export async function flush() {
  if (flushing) return { sent: 0, left: pendingCount() }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return { sent: 0, left: pendingCount(), offline: true }
  }
  const sb = getSupabase()
  if (!sb) return { sent: 0, left: pendingCount() }

  flushing = true
  let sent = 0
  try {
    // Oldest first, so receipts come out in the order they were rung up.
    let list = read()
    while (list.length) {
      const job = list[0]
      try {
        const { data, error } = await sb.rpc('record_sale', job.args)
        if (error) throw error
        if (data?.success) {
          sent++
          list = read().slice(1)
          write(list)
          continue
        }
        // The server rejected it on its merits. Retrying will never help, and
        // keeping it would block every sale behind it.
        console.error('Queued sale rejected, dropping:', data?.error, job)
        list = read().slice(1)
        write(list)
      } catch (e) {
        if (!isNetworkish(e)) {
          console.error('Queued sale failed permanently, dropping:', e, job)
          list = read().slice(1)
          write(list)
          continue
        }
        // Still no connection — stop and leave the rest for next time.
        job.attempts = (job.attempts || 0) + 1
        const cur = read()
        if (cur[0]) { cur[0].attempts = job.attempts; write(cur) }
        break
      }
    }
  } finally { flushing = false }

  return { sent, left: pendingCount() }
}

// Drain on reconnect, on tab focus, and on a slow timer for the case where the
// browser thinks it is online but the link is actually dead.
let started = false
export function startAutoFlush() {
  if (started || typeof window === 'undefined') return
  started = true
  window.addEventListener('online', () => { flush() })
  window.addEventListener('focus', () => { flush() })
  setInterval(() => { if (pendingCount()) flush() }, 30000)
  if (pendingCount()) flush()
}
