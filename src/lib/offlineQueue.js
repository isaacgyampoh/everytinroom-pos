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
import { callRecordSale } from './rpc'

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
  list.push({
    id: args.p_client_ref || newClientRef(),   // the server's idempotency key
    op: 'record_sale',
    args, meta,
    queuedAt: new Date().toISOString(),
    attempts: 0,
    status: 'pending',      // pending | failed
    lastError: null,
    nextRetryAt: 0,         // epoch ms; 0 means "try immediately"
    total: Number(args.p_items?.reduce?.((a, i) => a + Number(i.lineTotal || 0), 0) || 0),
  })
  write(list)
  return list.length
}

// Wait longer after each failure instead of hammering a server that is already
// struggling: 5s, 15s, 45s, 2m, 6m, then hold at 15 minutes.
const BACKOFF_MS = [5e3, 15e3, 45e3, 120e3, 360e3, 900e3]
const backoffFor = (attempts) => BACKOFF_MS[Math.min(attempts, BACKOFF_MS.length - 1)]

// After this many failures a job stops being retried on its own and waits for
// somebody to look at it, rather than retrying forever in silence.
const GIVE_UP_AFTER = 8

// What the admin System Status screen reports.
export function queueStats() {
  const list = read()
  const now = Date.now()
  return {
    total: list.length,
    ready: list.filter(j => j.status !== 'failed' && (j.nextRetryAt || 0) <= now).length,
    waiting: list.filter(j => j.status !== 'failed' && (j.nextRetryAt || 0) > now).length,
    failed: list.filter(j => j.status === 'failed').length,
    value: list.reduce((a, j) => a + Number(j.total || 0), 0),
    oldest: list.length ? list[0].queuedAt : null,
    lastError: list.find(j => j.lastError)?.lastError || null,
  }
}

// An admin clearing a job that will never succeed.
export function dropJob(id) {
  write(read().filter(j => j.id !== id))
}

// An admin asking a failed job to try once more.
export function retryJob(id) {
  const list = read()
  const j = list.find(x => x.id === id)
  if (j) { j.status = 'pending'; j.attempts = 0; j.nextRetryAt = 0; write(list) }
}

export function listJobs() {
  return read().map(({ args, ...rest }) => rest)   // never hand out the payload
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
  let sent = 0, deferred = 0
  try {
    // Oldest first, so receipts come out in the order they were rung up. Each
    // pass takes a fresh copy — an admin may have dropped a job meanwhile.
    for (let i = 0; i < read().length; i++) {
      const list = read()
      const job = list[i]
      if (!job) break
      if (job.status === 'failed') continue
      if ((job.nextRetryAt || 0) > Date.now()) { deferred++; continue }

      let outcome
      try {
        const { data, error } = await callRecordSale(sb, job.args)
        if (error) throw error
        // A replay of a sale the server already has comes back as a duplicate
        // rather than a second sale. That is the idempotency key doing its job,
        // and it counts as done.
        outcome = data?.success ? 'done' : 'rejected'
        if (outcome === 'rejected') job.lastError = data?.error || 'The server rejected this sale'
      } catch (e) {
        outcome = isNetworkish(e) ? 'retry' : 'rejected'
        job.lastError = String(e.message || e).slice(0, 200)
      }

      const fresh = read()
      const idx = fresh.findIndex(j => j.id === job.id)
      if (idx < 0) continue                       // dropped while we were away

      if (outcome === 'done') {
        sent++
        fresh.splice(idx, 1)
        write(fresh)
        i--                                       // the list just shifted
        continue
      }

      if (outcome === 'rejected') {
        // The server understood it and said no. Retrying changes nothing, so
        // park it for an admin instead of dropping a sale on the floor or
        // blocking everything behind it.
        fresh[idx] = { ...fresh[idx], status: 'failed', lastError: job.lastError }
        write(fresh)
        continue
      }

      // Connection trouble. Back off, and stop unattended retries eventually.
      const attempts = (fresh[idx].attempts || 0) + 1
      fresh[idx] = {
        ...fresh[idx],
        attempts,
        lastError: job.lastError,
        status: attempts >= GIVE_UP_AFTER ? 'failed' : 'pending',
        nextRetryAt: Date.now() + backoffFor(attempts),
      }
      write(fresh)
      deferred++
      break                                       // still offline; stop the pass
    }
  } finally { flushing = false }

  return { sent, left: pendingCount(), deferred, stats: queueStats() }
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
