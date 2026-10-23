import { describe, it, expect, vi, beforeEach } from 'vitest'

// A supabase stand-in. `rpc` answers from a script; `from(...)` returns the
// chain the direct-table fallback builds.
const h = vi.hoisted(() => {
  const state = { rpc: null, table: null }
  const sb = {
    rpc: vi.fn(async (fn, args) => state.rpc(fn, args)),
    from: vi.fn(() => {
      const chain = {
        select: () => chain,
        order: () => chain,
        limit: () => chain,
        eq: () => chain,
        then: (res) => Promise.resolve(state.table()).then(res),
      }
      return chain
    }),
  }
  return { state, sb }
})
vi.mock('../lib/supabase', () => ({ getSupabase: () => h.sb }))
vi.mock('../lib/offlineStore', () => ({ saveCatalogue: () => {}, loadCatalogue: () => null }))

import { useStore } from './useStore'

const MISSING = { code: 'PGRST202', message: 'Could not find the function public.list_sales' }
const row = (no, total) => ({
  id: 'id-' + no, receipt_no: no, date: '2026-10-23T10:00:00.000Z', items: [],
  subtotal: total, discount: 0, total, profit: 0, payment: 'Cash',
  split_cash: 0, split_momo: 0, customer: 'Walk-in', type: 'Retail',
  cashier: 'Ama', voided: false,
})

beforeEach(() => {
  h.state.rpc = async () => ({ data: [], error: null })
  h.state.table = () => ({ data: [], error: null })
  useStore.setState({ user: null, isAdmin: false, token: null, sales: [], _secondaryLoaded: false })
})

describe('reading the sales ledger', () => {
  it('asks list_sales, with the session token, and maps what comes back', async () => {
    useStore.setState({ token: 'tok-123' })
    h.state.rpc = async (fn, args) => {
      expect(fn).toBe('list_sales')
      expect(args).toEqual({ p_token: 'tok-123', p_limit: 300 })
      return { data: [row('R-1', 25)], error: null }
    }

    await useStore.getState().refreshSales()

    expect(h.sb.rpc).toHaveBeenCalledTimes(1)
    expect(h.sb.from).not.toHaveBeenCalled()      // the table was never touched
    const sales = useStore.getState().sales
    expect(sales).toHaveLength(1)
    expect(sales[0].receiptNo).toBe('R-1')
    expect(sales[0].total).toBe(25)
  })

  // The fallback is what makes migration 031 safe to run ahead of a deploy,
  // and a deploy safe to ship ahead of the migration.
  it('falls back to the table when list_sales does not exist yet', async () => {
    useStore.setState({ token: 'tok-123' })
    h.state.rpc = async () => ({ data: null, error: MISSING })
    h.state.table = () => ({ data: [row('R-OLD', 10)], error: null })
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    await useStore.getState().refreshSales()

    expect(h.sb.from).toHaveBeenCalledWith('sales')
    expect(useStore.getState().sales[0].receiptNo).toBe('R-OLD')
  })

  // The dangerous case. Once migration 032 has closed the table, a direct read
  // succeeds but returns only the last two days — so falling back on a GENUINE
  // error would not fail, it would quietly make every report wrong. Only a
  // missing function may fall back.
  it('does NOT fall back when list_sales exists but fails', async () => {
    useStore.setState({ token: 'tok-123', sales: [] })
    h.state.rpc = async () => ({ data: null, error: { code: '42501', message: 'permission denied' } })
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})

    await useStore.getState().refreshSales()

    expect(h.sb.from).not.toHaveBeenCalled()
    expect(useStore.getState().sales).toEqual([])
    expect(err).toHaveBeenCalled()
  })

  it('survives the function returning something that is not a list', async () => {
    useStore.setState({ token: 'tok-123' })
    h.state.rpc = async () => ({ data: null, error: null })
    await useStore.getState().refreshSales()
    expect(useStore.getState().sales).toEqual([])
  })
})

describe('signing in', () => {
  // The first load runs before anyone has signed in, so with 031 it comes back
  // empty and _secondaryLoaded stops it being retried. Sales must therefore be
  // refetched on login for EVERY staff member, not just one who can see cost —
  // otherwise a cashier's Receipts page is blank.
  it('refetches sales for a cashier who cannot see cost', async () => {
    const calls = []
    h.state.rpc = async (fn, args) => { calls.push(fn); return { data: [row('R-9', 5)], error: null } }

    useStore.getState().login({ id: 'c1', name: 'Ama', permissions: [] }, false, 'tok-abc')
    await Promise.resolve(); await Promise.resolve()

    expect(useStore.getState().canSeeCost()).toBe(false)
    expect(calls).toContain('list_sales')
  })

  it('still refetches sales for an admin', async () => {
    const calls = []
    h.state.rpc = async (fn) => { calls.push(fn); return { data: [], error: null } }

    useStore.getState().login({ id: 'a1', name: 'Boss', permissions: ['admin'] }, true, 'tok-admin')
    await Promise.resolve(); await Promise.resolve()

    expect(calls).toContain('list_sales')
  })
})
