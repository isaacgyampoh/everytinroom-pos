import { describe, it, expect, vi } from 'vitest'

// The queue's only outside contact is callRecordSale. Replacing it lets each
// test say exactly what the server did — succeeded, refused, or never answered.
const h = vi.hoisted(() => ({ recordSale: vi.fn(), sb: { __fake: true } }))
vi.mock('./supabase', () => ({ getSupabase: () => h.sb }))
vi.mock('./rpc', () => ({ callRecordSale: h.recordSale }))

import {
  newClientRef, enqueue, flush, pendingCount, queueStats,
  listJobs, dropJob, retryJob, isNetworkish,
} from './offlineQueue'

const KEY = 'pos-offline-sales'
const raw = () => JSON.parse(localStorage.getItem(KEY) || '[]')
const saleArgs = (ref, total = 10) => ({
  p_items: [{ lineTotal: total }],
  p_total: total,
  p_terminal: 'till-1',
  p_client_ref: ref,
})

const ok = (extra = {}) => ({ data: { success: true, receiptNo: 'R1', ...extra }, error: null })
const refused = (msg) => ({ data: { success: false, error: msg }, error: null })

describe('newClientRef', () => {
  it('is a CR- prefixed uppercase reference', () => {
    const ref = newClientRef()
    expect(ref).toMatch(/^CR-[0-9A-Z]{1,24}$/)
  })

  it('does not repeat', () => {
    const refs = new Set(Array.from({ length: 200 }, newClientRef))
    expect(refs.size).toBe(200)
  })
})

describe('enqueue', () => {
  it('keys the job on the client reference, which is the server idempotency key', () => {
    enqueue(saleArgs('CR-ONE'))
    expect(pendingCount()).toBe(1)
    expect(raw()[0].id).toBe('CR-ONE')
    expect(raw()[0].status).toBe('pending')
    expect(raw()[0].attempts).toBe(0)
  })

  it('records the basket total so an admin can see the money at stake', () => {
    enqueue({ p_items: [{ lineTotal: 12.5 }, { lineTotal: 2.5 }] })
    expect(raw()[0].total).toBe(15)
  })

  it('survives a corrupt store rather than losing the sale', () => {
    localStorage.setItem(KEY, 'not json at all')
    enqueue(saleArgs('CR-AFTER-CORRUPT'))
    expect(pendingCount()).toBe(1)
  })
})

describe('flush', () => {
  it('sends a queued sale and removes it', async () => {
    enqueue(saleArgs('CR-SEND'))
    h.recordSale.mockResolvedValueOnce(ok())

    const res = await flush()

    expect(h.recordSale).toHaveBeenCalledTimes(1)
    expect(h.recordSale.mock.calls[0][1]).toMatchObject({ p_client_ref: 'CR-SEND' })
    expect(res.sent).toBe(1)
    expect(pendingCount()).toBe(0)
  })

  it('replays the SAME client reference, so the server can refuse a duplicate', async () => {
    enqueue(saleArgs('CR-STABLE'))
    h.recordSale.mockRejectedValueOnce(new Error('network timeout'))
    await flush()
    // The reference must not be regenerated between attempts, or the
    // idempotency guard is useless and the basket rings up twice.
    expect(raw()[0].args.p_client_ref).toBe('CR-STABLE')

    raw()                                   // job is still queued
    localStorage.setItem(KEY, JSON.stringify(raw().map(j => ({ ...j, nextRetryAt: 0 }))))
    h.recordSale.mockResolvedValueOnce(ok())
    await flush()
    expect(h.recordSale.mock.calls[1][1].p_client_ref).toBe('CR-STABLE')
  })

  // A sale the server already has comes back as a duplicate, not a second
  // sale. That is the idempotency key working, and it counts as filed.
  it('treats an already-recorded sale as done', async () => {
    enqueue(saleArgs('CR-DUP'))
    h.recordSale.mockResolvedValueOnce(ok({ duplicate: true }))

    const res = await flush()

    expect(res.sent).toBe(1)
    expect(pendingCount()).toBe(0)
  })

  it('sends several queued sales oldest first', async () => {
    enqueue(saleArgs('CR-1'))
    enqueue(saleArgs('CR-2'))
    enqueue(saleArgs('CR-3'))
    h.recordSale.mockResolvedValue(ok())

    const res = await flush()

    expect(res.sent).toBe(3)
    expect(h.recordSale.mock.calls.map(c => c[1].p_client_ref)).toEqual(['CR-1', 'CR-2', 'CR-3'])
    expect(pendingCount()).toBe(0)
  })

  it('parks a sale the server refused instead of retrying it for ever', async () => {
    enqueue(saleArgs('CR-NO'))
    h.recordSale.mockResolvedValueOnce(refused('Stock would go negative'))

    const res = await flush()

    expect(res.sent).toBe(0)
    expect(pendingCount()).toBe(1)              // not dropped on the floor
    expect(raw()[0].status).toBe('failed')
    expect(raw()[0].lastError).toBe('Stock would go negative')
    // A refusal is not retried: the queue must not spin on it.
    h.recordSale.mockClear()
    await flush()
    expect(h.recordSale).not.toHaveBeenCalled()
  })

  it('backs off after a connection failure and keeps the sale pending', async () => {
    enqueue(saleArgs('CR-NET'))
    h.recordSale.mockRejectedValueOnce(new Error('Failed to fetch'))

    const before = Date.now()
    const res = await flush()

    expect(res.sent).toBe(0)
    expect(pendingCount()).toBe(1)
    const job = raw()[0]
    expect(job.status).toBe('pending')
    expect(job.attempts).toBe(1)
    expect(job.nextRetryAt).toBeGreaterThan(before)
  })

  it('does not send a sale that is still waiting out its backoff', async () => {
    enqueue(saleArgs('CR-WAIT'))
    localStorage.setItem(KEY, JSON.stringify(
      raw().map(j => ({ ...j, nextRetryAt: Date.now() + 60_000 }))))

    const res = await flush()

    expect(h.recordSale).not.toHaveBeenCalled()
    expect(res.sent).toBe(0)
    expect(queueStats().waiting).toBe(1)
  })

  it('stops retrying unattended after the give-up threshold', async () => {
    enqueue(saleArgs('CR-GIVEUP'))
    // Seven failures already behind it; the eighth is the last.
    localStorage.setItem(KEY, JSON.stringify(
      raw().map(j => ({ ...j, attempts: 7, nextRetryAt: 0 }))))
    h.recordSale.mockRejectedValueOnce(new Error('network down'))

    await flush()

    expect(raw()[0].attempts).toBe(8)
    expect(raw()[0].status).toBe('failed')
  })

  it('does not touch the network when the till is offline', async () => {
    enqueue(saleArgs('CR-OFF'))
    navigator.onLine = false

    const res = await flush()

    expect(h.recordSale).not.toHaveBeenCalled()
    expect(res.offline).toBe(true)
    expect(pendingCount()).toBe(1)
  })
})

describe('what the admin screen sees', () => {
  it('never hands out the sale payload', () => {
    enqueue(saleArgs('CR-PRIVATE'))
    const jobs = listJobs()
    expect(jobs).toHaveLength(1)
    expect(jobs[0]).not.toHaveProperty('args')
    expect(jobs[0].id).toBe('CR-PRIVATE')
  })

  it('totals the money sitting unfiled', () => {
    enqueue(saleArgs('CR-A', 20))
    enqueue(saleArgs('CR-B', 5))
    const s = queueStats()
    expect(s.total).toBe(2)
    expect(s.ready).toBe(2)
    expect(s.value).toBe(25)
  })

  it('lets an admin drop a job that will never succeed', () => {
    enqueue(saleArgs('CR-DROP'))
    dropJob('CR-DROP')
    expect(pendingCount()).toBe(0)
  })

  it('lets an admin reset a failed job for another try', async () => {
    enqueue(saleArgs('CR-RETRY'))
    h.recordSale.mockResolvedValueOnce(refused('nope'))
    await flush()
    expect(raw()[0].status).toBe('failed')

    retryJob('CR-RETRY')

    expect(raw()[0].status).toBe('pending')
    expect(raw()[0].attempts).toBe(0)
    expect(raw()[0].nextRetryAt).toBe(0)
  })
})

describe('isNetworkish', () => {
  it('treats connection trouble as worth retrying', () => {
    for (const m of ['Failed to fetch', 'network error', 'request timeout',
                     'load failed', 'you are offline']) {
      expect(isNetworkish(new Error(m))).toBe(true)
    }
  })

  it('treats a validation refusal as not worth retrying', () => {
    expect(isNetworkish(new Error('Stock would go negative'))).toBe(false)
    expect(isNetworkish(new Error('Not authorised'))).toBe(false)
  })
})
