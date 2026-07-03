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

// Optional manual override: if a specific machine's driver reports screens
// oddly, the installer can pin which screen index is the customer display.
// Stored per-device. Value is the screen index (0-based) or '' for auto.
export function setCustomerScreenIndex(i) {
  try { if (i === '' || i == null) localStorage.removeItem('customer-screen-index'); else localStorage.setItem('customer-screen-index', String(i)) } catch {}
}
export function getCustomerScreenIndex() {
  try { const v = localStorage.getItem('customer-screen-index'); return v == null || v === '' ? null : parseInt(v) } catch { return null }
}

/**
 * Decide WHICH physical screen is the customer display — the single source of
 * truth used everywhere. Deterministic so the two screens can never swap:
 *   0) manual override index if the installer set one, else
 *   1) the non-primary screen (cashier keeps the primary), else
 *   2) the physically smaller screen.
 * Returns the ScreenDetailed for the customer, or null if only one screen.
 */
async function pickCustomerScreen() {
  if (!('getScreenDetails' in window)) return null
  const sd = await window.getScreenDetails()
  if (!sd || sd.screens.length < 2) return null

  const override = getCustomerScreenIndex()
  if (override != null && sd.screens[override]) return sd.screens[override]

  const primary = sd.screens.find(s => s.isPrimary) || sd.currentScreen
  let customer = sd.screens.find(s => !s.isPrimary && s !== primary)
  if (!customer) {
    const sorted = [...sd.screens].sort((a, b) => (a.width * a.height) - (b.width * b.height))
    customer = sorted[0] !== primary ? sorted[0] : sorted[1]
  }
  return customer || null
}

// Shared opener. Places the customer window on the customer screen, fullscreen,
// and nudges it there again on load in case the browser ignored placement.
async function openOnCustomerScreen({ requireSecondScreen, fallbackPopup }) {
  if (customerWin && !customerWin.closed) { try { customerWin.focus() } catch {}; return customerWin }

  const reg = getRegisterId()
  const url = window.location.origin + '/#/customer-display?reg=' + reg
  const winName = 'customer-display-' + reg

  try {
    const customer = await pickCustomerScreen()
    if (customer) {
      // Fill the ENTIRE screen (use full width/height, not availWidth which
      // excludes the taskbar) and strip chrome. left/top = screen origin.
      const L = customer.left, T = customer.top, W = customer.width, H = customer.height
      const feat = `left=${L},top=${T},width=${W},height=${H},fullscreen=yes,menubar=no,toolbar=no,location=no,status=no,resizable=yes`
      const w = window.open(url, winName, feat)
      if (w) {
        customerWin = w
        // Re-assert placement + try true fullscreen once loaded. The customer
        // window was opened during the login gesture, so this fullscreen request
        // is still allowed by the browser for a short window.
        const place = () => {
          try { w.moveTo(L, T); w.resizeTo(W, H) } catch {}
          try {
            const el = w.document && w.document.documentElement
            if (el && el.requestFullscreen && !w.document.fullscreenElement) {
              // Prefer placing fullscreen on the specific customer screen.
              if ('getScreenDetails' in w) { el.requestFullscreen({ navigationUI: 'hide' }).catch(() => {}) }
              else el.requestFullscreen({ navigationUI: 'hide' }).catch(() => {})
            }
          } catch {}
        }
        try { w.addEventListener('load', place) } catch {}
        setTimeout(place, 800)
        return w
      }
    } else if (requireSecondScreen) {
      return null // no 2nd screen -> auto-open does nothing (phones/laptops)
    }
  } catch (e) { console.warn('customer screen placement:', e) }

  // Manual fallback: a normal popup (single-screen laptop / unsupported browser).
  if (fallbackPopup) {
    const w = window.open(url, winName, 'width=1280,height=800')
    if (w) customerWin = w
    return w
  }
  return null
}

/**
 * AUTO open — fires after login on the POS. Only opens when a genuine 2nd
 * physical display exists (so phones/single-screen laptops never spawn a
 * customer window). Safe to call repeatedly.
 */
export async function openCustomerScreenAuto() {
  if (customerWin && !customerWin.closed) return customerWin
  // Touch-only devices (phones/tablets) never auto-open.
  const isTouchOnly = (navigator.maxTouchPoints || 0) > 0 && !window.matchMedia('(pointer: fine)').matches
  if (isTouchOnly) return null
  return openOnCustomerScreen({ requireSecondScreen: true, fallbackPopup: false })
}

/**
 * MANUAL open — the sidebar "Customer Screen" button. Works anywhere: uses the
 * 2nd screen if present, otherwise opens a normal window so it can still be
 * used/tested on a single-screen laptop.
 */
export async function openCustomerScreenManual() {
  return openOnCustomerScreen({ requireSecondScreen: false, fallbackPopup: true })
}
