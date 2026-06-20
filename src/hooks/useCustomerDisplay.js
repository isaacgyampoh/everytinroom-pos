import { useEffect, useRef } from 'react'
import { useStore } from './useStore'
import { getSupabase } from '../lib/supabase'

/**
 * Customer-facing display sync via Supabase Realtime broadcast.
 * A single shared channel ('customer-display') is used for everything:
 * live cart updates, the 'paying' state, and the 'paid' thank-you.
 * Ephemeral — no DB writes, no payment code.
 */

let sharedChannel = null
let channelReady = false

function ensureChannel() {
  if (sharedChannel) return sharedChannel
  const sb = getSupabase(); if (!sb) return null
  const ch = sb.channel('customer-display', { config: { broadcast: { self: false } } })
  ch.subscribe(status => { channelReady = (status === 'SUBSCRIBED') })
  sharedChannel = ch
  return ch
}

function sendState(payload) {
  const ch = ensureChannel(); if (!ch) return
  const fire = () => ch.send({ type: 'broadcast', event: 'state', payload: { ...payload, ts: Date.now() } })
  if (channelReady) fire()
  else setTimeout(fire, 250) // give the channel a moment to subscribe
}

/** Mounted once in the cashier app — broadcasts the live cart. */
export function useCustomerDisplayBroadcast(extra = {}) {
  const cart = useStore(s => s.cart)
  const stateRef = useRef(extra)
  stateRef.current = extra

  const pushCart = () => {
    const c = useStore.getState().cart
    const sub = c.reduce((a, x) => a + x.lineTotal, 0)
    sendState({
      items: c.map(x => ({ name: x.name, qty: x.qty, price: x.price, lineTotal: x.lineTotal, image: x.image || '' })),
      count: c.reduce((a, x) => a + x.qty, 0),
      subtotal: sub,
      status: stateRef.current.status || 'shopping',
      total: stateRef.current.total != null ? stateRef.current.total : sub,
      receiptNo: stateRef.current.receiptNo || null,
    })
  }

  useEffect(() => {
    const ch = ensureChannel(); if (!ch) return
    // a display that opens mid-sale says 'hello' — reply with current cart
    ch.on('broadcast', { event: 'hello' }, () => pushCart())
    return () => {} // keep channel alive for the session
  }, [])

  useEffect(() => { pushCart() }, [cart, extra.status, extra.total, extra.receiptNo])
}

/** One-off broadcast (paying / paid) on the same shared channel. */
export function broadcastDisplay(payload) {
  sendState(payload)
}
