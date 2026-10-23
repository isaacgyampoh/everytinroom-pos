import { describe, it, expect, vi } from 'vitest'
import { isMissingFunction, callRecordSale, rpcCompat } from './rpc'

// A stand-in for the supabase client that records what it was asked for and
// replies from a script.
function fakeSb(...replies) {
  const calls = []
  return {
    calls,
    rpc: vi.fn(async (fn, args) => {
      calls.push({ fn, args })
      return replies[calls.length - 1] ?? { data: null, error: null }
    }),
  }
}

const MISSING = { code: 'PGRST202', message: 'Could not find the function public.record_sale(...)' }
const NOT_AUTHORISED = { code: '42501', message: 'Not authorised' }

describe('isMissingFunction', () => {
  it('recognises the PostgREST code', () => {
    expect(isMissingFunction({ code: 'PGRST202' })).toBe(true)
  })

  it('recognises the message when the code is absent', () => {
    expect(isMissingFunction({ message: 'Could not find the function public.x' })).toBe(true)
    expect(isMissingFunction({ details: 'no matches were found in the schema cache' })).toBe(true)
  })

  // The whole safety of the fallback rests on this: anything that is not
  // "the function is missing" must NOT be retried with a weaker signature.
  it('does not treat a permission denial as a missing function', () => {
    expect(isMissingFunction(NOT_AUTHORISED)).toBe(false)
  })

  it('is false for no error at all', () => {
    expect(isMissingFunction(null)).toBe(false)
    expect(isMissingFunction(undefined)).toBe(false)
  })
})

describe('callRecordSale', () => {
  const args = {
    p_items: [{ lineTotal: 10 }],
    p_total: 10,
    p_terminal: 'till-1',
    p_client_ref: 'CR-ABC',
  }

  it('sends the full signature and returns it when the server has migration 020', async () => {
    const sb = fakeSb({ data: { success: true, receiptNo: 'R1' }, error: null })
    const res = await callRecordSale(sb, args)

    expect(sb.rpc).toHaveBeenCalledTimes(1)
    expect(sb.calls[0].args).toHaveProperty('p_terminal', 'till-1')
    expect(sb.calls[0].args).toHaveProperty('p_client_ref', 'CR-ABC')
    expect(res.data.success).toBe(true)
    expect(res.degraded).toBeUndefined()
  })

  it('retries without the post-020 arguments when the function is missing', async () => {
    const sb = fakeSb(
      { data: null, error: MISSING },
      { data: { success: true, receiptNo: 'R2' }, error: null },
    )
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const res = await callRecordSale(sb, args)

    expect(sb.rpc).toHaveBeenCalledTimes(2)
    // Exactly the two post-020 arguments are dropped, and nothing else.
    expect(sb.calls[1].args).not.toHaveProperty('p_terminal')
    expect(sb.calls[1].args).not.toHaveProperty('p_client_ref')
    expect(sb.calls[1].args).toEqual({ p_items: args.p_items, p_total: 10 })
    expect(res.data.success).toBe(true)
    expect(res.degraded).toBe(true)
  })

  // A sale rejected by a migrated database must not be re-sent against the
  // legacy signature — that is how the same basket gets rung up twice.
  it('does not retry when the server understood the call and said no', async () => {
    const sb = fakeSb({ data: null, error: NOT_AUTHORISED })
    const res = await callRecordSale(sb, args)

    expect(sb.rpc).toHaveBeenCalledTimes(1)
    expect(res.error).toBe(NOT_AUTHORISED)
    expect(res.degraded).toBeUndefined()
  })

  it('leaves the caller-supplied args object untouched', async () => {
    const sb = fakeSb({ data: null, error: MISSING }, { data: { success: true }, error: null })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const before = JSON.parse(JSON.stringify(args))
    await callRecordSale(sb, args)
    expect(args).toEqual(before)
  })
})

describe('rpcCompat', () => {
  it('uses the new signature when it exists', async () => {
    const sb = fakeSb({ data: { ok: true }, error: null })
    const res = await rpcCompat(sb, 'process_refund', { p_token: 't', p_id: 1 }, { p_id: 1 })

    expect(sb.rpc).toHaveBeenCalledTimes(1)
    expect(sb.calls[0].args).toHaveProperty('p_token')
    expect(res.degraded).toBeUndefined()
  })

  it('falls back to the legacy signature when the function is missing', async () => {
    const sb = fakeSb({ data: null, error: MISSING }, { data: { ok: true }, error: null })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const res = await rpcCompat(sb, 'process_refund', { p_token: 't', p_id: 1 }, { p_id: 1 })

    expect(sb.rpc).toHaveBeenCalledTimes(2)
    expect(sb.calls[1].args).toEqual({ p_id: 1 })
    expect(res.degraded).toBe(true)
  })

  it('never bypasses a genuine authorisation failure', async () => {
    const sb = fakeSb({ data: null, error: NOT_AUTHORISED })
    const res = await rpcCompat(sb, 'process_refund', { p_token: 't' }, { p_id: 1 })

    expect(sb.rpc).toHaveBeenCalledTimes(1)
    expect(res.error).toBe(NOT_AUTHORISED)
  })

  it('returns the original failure when no legacy signature was offered', async () => {
    const sb = fakeSb({ data: null, error: MISSING })
    const res = await rpcCompat(sb, 'process_refund', { p_token: 't' }, null)

    expect(sb.rpc).toHaveBeenCalledTimes(1)
    expect(res.error).toBe(MISSING)
  })
})
