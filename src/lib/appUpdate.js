// ============================================================================
// APPLYING A NEW VERSION WITHOUT LOSING A SALE
//
// The service worker used to call skipWaiting() during install, so a deploy
// swapped the JavaScript under whoever was mid-sale: the page reloaded and the
// cart went with it. It now waits, and this decides when the moment is safe.
//
// Safe means no cart, no payment sheet open, nothing queued mid-flight. A till
// standing idle updates silently; a till serving somebody is left alone until
// it is not.
// ============================================================================

let waitingWorker = null
let listeners = new Set()

export function onUpdateReady(fn) {
  listeners.add(fn)
  if (waitingWorker) fn()
  return () => listeners.delete(fn)
}

export function updateAvailable() {
  return !!waitingWorker
}

// Swap to the new version. Only ever called when the caller has decided the
// till is idle.
export function applyUpdate() {
  if (!waitingWorker) return false
  waitingWorker.postMessage({ type: 'SKIP_WAITING' })
  return true
}

export function watchForUpdates() {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return

  navigator.serviceWorker.ready.then((reg) => {
    const note = (w) => {
      if (!w) return
      if (w.state === 'installed' && navigator.serviceWorker.controller) {
        waitingWorker = w
        listeners.forEach((fn) => { try { fn() } catch {} })
      }
    }
    note(reg.waiting)
    reg.addEventListener('updatefound', () => {
      const w = reg.installing
      w && w.addEventListener('statechange', () => note(w))
    })
    // A till runs for days without a reload, so check rather than wait for one.
    setInterval(() => { reg.update().catch(() => {}) }, 30 * 60 * 1000)
  }).catch(() => {})

  // When the new worker takes over, reload once to pick it up. This only fires
  // after applyUpdate(), which only runs when the till is idle.
  let reloaded = false
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloaded) return
    reloaded = true
    window.location.reload()
  })
}
