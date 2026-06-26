import { useEffect, useRef } from 'react'
import { useStore } from './useStore'
import { getSupabase } from '../lib/supabase'

/**
 * Customer-facing display sync via Supabase Realtime broadcast.
 *
 * IMPORTANT: each POS device has its own PRIVATE channel keyed to a
 * per-device register id, so multiple cashiers (each on their own phone/
 * tablet) never mix carts on the customer screen. The cashier's POS and
 * the customer screen it opens share the same id via the URL (?reg=...).
 * Ephemeral — no DB writes, no payment code.
 */

// Stable per-device id (persists in localStorage for this browser/device).
export function getRegisterId() {
  try {
    let id = localStorage.getItem('pos-register-id')
    if (!id) {
      id = 'reg-' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4)
      localStorage.setItem('pos-register-id', id)
    }
    return id
  } catch {
    return 'reg-default'
  }
}

const channelName = (regId) => `customer-display-${regId || getRegisterId()}`

let sharedChannel = null
let channelReady = false
let sharedChannelName = null

function ensureChannel() {
  const name = channelName()
  if (sharedChannel && sharedChannelName === name) return sharedChannel
  const sb = getSupabase(); if (!sb) return null
  // if a stale channel exists for a different name, drop it
  if (sharedChannel && sharedChannelName !== name) { try { sb.removeChannel(sharedChannel) } catch {} sharedChannel = null; channelReady = false }
  const ch = sb.channel(name, { config: { broadcast: { self: false } } })
  ch.subscribe(status => { channelReady = (status === 'SUBSCRIBED') })
  sharedChannel = ch
  sharedChannelName = name
  return ch
}

function sendState(payload) {
  const ch = ensureChannel(); if (!ch) return
  const fire = () => ch.send({ type: 'broadcast', event: 'state', payload: { ...payload, ts: Date.now() } })
  if (channelReady) fire()
  else setTimeout(fire, 250)
}

/** Mounted once in the cashier app — broadcasts the live cart on this device's private channel. */
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
    ch.on('broadcast', { event: 'hello' }, () => pushCart())
    return () => {}
  }, [])

  useEffect(() => { pushCart() }, [cart, extra.status, extra.total, extra.receiptNo])
}

/** One-off broadcast (paying / paid) on this device's private channel. */
export function broadcastDisplay(payload) {
  sendState(payload)
}

// Track the customer window so we don't open duplicates.
let customerWin = null

/** True if the customer screen window is currently open. */
export function isCustomerScreenOpen() {
  return !!(customerWin && !customerWin.closed)
}

/**
 * Auto-open the customer screen on the SECOND physical display.
 * Built for non-technical use: after the cashier logs in, this fires and
 * places the customer screen on the 2nd monitor in fullscreen. If the window
 * is already open, it does nothing. Safe to call repeatedly.
 */
export async function openCustomerScreenAuto() {
  // already open? leave it.
  if (customerWin && !customerWin.closed) return customerWin
  const reg = getRegisterId()
  const url = window.location.origin + '/#/customer-display?reg=' + reg
  const winName = 'customer-display-' + reg

  // Try to place on the second display via Window Management API (Chrome/Edge).
  try {
    if ('getScreenDetails' in window) {
      const sd = await window.getScreenDetails()
      const other = sd.screens.find(s => s !== sd.currentScreen) || sd.screens.find(s => !s.isPrimary)
      if (other) {
        const feat = `left=${other.availLeft},top=${other.availTop},width=${other.availWidth},height=${other.availHeight},fullscreen=yes`
        const w = window.open(url, winName, feat)
        if (w) { customerWin = w; return w }
      }
    }
  } catch (e) { console.warn('auto-place fallback:', e) }

  // Fallback: open a normal window (single screen / no permission / blocked).
  const w = window.open(url, winName, 'width=1280,height=800')
  if (w) customerWin = w
  return w
}
