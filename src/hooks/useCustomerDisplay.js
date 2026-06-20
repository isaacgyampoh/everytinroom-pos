import { useEffect, useRef } from 'react'
import { useStore } from './useStore'
import { getSupabase } from '../lib/supabase'

/**
 * Broadcasts the live cart to the customer-facing display via Supabase
 * Realtime (broadcast channel — ephemeral, no DB writes, no payment code).
 * Mount once in the cashier app. A second window at #/customer-display
 * subscribes to the same channel.
 *
 * Hardened: waits for SUBSCRIBED before sending; answers "hello" pings
 * from a display that opens mid-sale so it immediately shows the cart.
 */
export function useCustomerDisplayBroadcast(extra = {}) {
  const cart = useStore(s => s.cart)
  const chRef = useRef(null)
  const readyRef = useRef(false)
  const stateRef = useRef(extra)
  stateRef.current = extra

  const buildPayload = () => {
    const c = useStore.getState().cart
    const sub = c.reduce((a, x) => a + x.lineTotal, 0)
    return {
      items: c.map(x => ({ name: x.name, qty: x.qty, price: x.price, lineTotal: x.lineTotal, image: x.image || '' })),
      count: c.reduce((a, x) => a + x.qty, 0),
      subtotal: sub,
      status: stateRef.current.status || 'shopping',
      total: stateRef.current.total != null ? stateRef.current.total : sub,
      receiptNo: stateRef.current.receiptNo || null,
      ts: Date.now(),
    }
  }

  const push = () => {
    const ch = chRef.current
    if (!ch || !readyRef.current) return
    ch.send({ type: 'broadcast', event: 'state', payload: buildPayload() })
  }

  useEffect(() => {
    const sb = getSupabase(); if (!sb) return
    const ch = sb.channel('customer-display', { config: { broadcast: { self: false } } })
    ch.on('broadcast', { event: 'hello' }, () => push())
    ch.subscribe(status => { if (status === 'SUBSCRIBED') { readyRef.current = true; push() } })
    chRef.current = ch
    return () => { readyRef.current = false; sb.removeChannel(ch); chRef.current = null }
  }, [])

  useEffect(() => { push() }, [cart, extra.status, extra.total, extra.receiptNo])
}

/** Fire a one-off broadcast (e.g. the "paid / thank you" screen). */
export function broadcastDisplay(payload) {
  const sb = getSupabase(); if (!sb) return
  const ch = sb.channel('customer-display-oneoff')
  ch.subscribe(status => {
    if (status === 'SUBSCRIBED') {
      ch.send({ type: 'broadcast', event: 'state', payload: { ...payload, ts: Date.now() } })
      setTimeout(() => sb.removeChannel(ch), 800)
    }
  })
}
