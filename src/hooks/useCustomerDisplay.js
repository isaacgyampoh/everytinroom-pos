import { useEffect, useRef } from 'react'
import { useStore } from './useStore'
import { getSupabase } from '../lib/supabase'

/**
 * Broadcasts the live cart to the customer-facing display via Supabase
 * Realtime (broadcast channel — ephemeral, no DB writes, no payment code).
 * Mount once in the cashier app. A second browser window opened at
 * #/customer-display subscribes to the same channel.
 */
export function useCustomerDisplayBroadcast(extra = {}) {
  const cart = useStore(s => s.cart)
  const chRef = useRef(null)
  const stateRef = useRef(extra)
  stateRef.current = extra

  // open channel once
  useEffect(() => {
    const sb = getSupabase(); if (!sb) return
    const ch = sb.channel('customer-display', { config: { broadcast: { self: false } } })
    ch.subscribe()
    chRef.current = ch
    return () => { sb.removeChannel(ch); chRef.current = null }
  }, [])

  // broadcast whenever the cart (or status) changes
  useEffect(() => {
    const ch = chRef.current; if (!ch) return
    const sub = cart.reduce((a, c) => a + c.lineTotal, 0)
    const payload = {
      items: cart.map(c => ({ name: c.name, qty: c.qty, price: c.price, lineTotal: c.lineTotal, image: c.image || '' })),
      count: cart.reduce((a, c) => a + c.qty, 0),
      subtotal: sub,
      status: stateRef.current.status || 'shopping',
      total: stateRef.current.total != null ? stateRef.current.total : sub,
      receiptNo: stateRef.current.receiptNo || null,
      ts: Date.now(),
    }
    ch.send({ type: 'broadcast', event: 'state', payload })
  }, [cart, extra.status, extra.total, extra.receiptNo])
}

/** Fire a one-off broadcast (e.g. the "paid / thank you" screen). */
export function broadcastDisplay(payload) {
  const sb = getSupabase(); if (!sb) return
  const ch = sb.channel('customer-display-oneoff')
  ch.subscribe(status => {
    if (status === 'SUBSCRIBED') {
      ch.send({ type: 'broadcast', event: 'state', payload: { ...payload, ts: Date.now() } })
      setTimeout(() => sb.removeChannel(ch), 500)
    }
  })
}
