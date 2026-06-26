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

  // Touch devices (phones/tablets) never auto-open — they're single-screen.
  const isTouchOnly = (navigator.maxTouchPoints || 0) > 0 && !window.matchMedia('(pointer: fine)').matches
  if (isTouchOnly) return null

  // ONLY auto-open when a genuine second physical display exists (the POS).
  // Phones and single-screen laptops have one screen -> do nothing.
  let hasSecondScreen = false
  try {
    if ('getScreenDetails' in window) {
      const sd = await window.getScreenDetails()
      hasSecondScreen = sd.screens.length > 1
    } else if (window.screen && window.screen.isExtended === true) {
      // Some browsers expose screen.isExtended without full screen details.
      hasSecondScreen = true
    }
  } catch (e) { console.warn('screen detect:', e); hasSecondScreen = false }
  if (!hasSecondScreen) return null // single screen (phone/laptop) -> never auto-open

  const reg = getRegisterId()
  const url = window.location.origin + '/#/customer-display?reg=' + reg
  const winName = 'customer-display-' + reg

  // Place it on the second display in fullscreen.
  try {
    const sd = await window.getScreenDetails()
    const other = sd.screens.find(s => s !== sd.currentScreen) || sd.screens.find(s => !s.isPrimary)
    if (other) {
      const feat = `left=${other.availLeft},top=${other.availTop},width=${other.availWidth},height=${other.availHeight},fullscreen=yes`
      const w = window.open(url, winName, feat)
      if (w) { customerWin = w; return w }
    }
  } catch (e) { console.warn('auto-place fallback:', e) }

  // Rare fallback (second screen reported but placement failed): plain window.
  const w = window.open(url, winName, 'width=1280,height=800')
  if (w) customerWin = w
  return w
}
