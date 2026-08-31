// ============================================================================
// EVERYTINROOM POS — service worker
//
// Two jobs: let the till open when the internet is down, and never, ever serve
// stale money data.
//
// The previous version cached EVERY successful GET, Supabase API reads
// included. That meant a till could be shown yesterday's stock levels and
// yesterday's prices from cache and have no way to tell — the worst possible
// failure for a POS. API traffic is now explicitly never cached.
// ============================================================================

const CACHE = 'everytinroom-v5'
const SHELL = ['/', '/index.html', '/manifest.json', '/logo.svg', '/logo.png']

// Live data. Stock levels, prices and orders must never come from a cache —
// a till showing yesterday's numbers with no way to tell is the worst possible
// failure. This is about the API SPECIFICALLY, not about the whole Supabase
// domain: product images are served from the same host and they ARE cacheable.
const isApi = (url) =>
  url.pathname.startsWith('/rest/') ||
  url.pathname.startsWith('/functions/') ||
  url.pathname.startsWith('/auth/') ||
  url.pathname.startsWith('/realtime/')

// Product photos in Supabase Storage. Filenames are timestamped and random, so
// a URL always means the same bytes — safe to cache hard, and worth caching:
// the shop's connection drops all day and a POS full of grey placeholder boxes
// is unusable.
const isStorageImage = (url) =>
  url.pathname.includes('/storage/v1/object/public/') ||
  url.pathname.includes('/storage/v1/render/image/public/')

// Vite emits content-hashed filenames, so an asset URL never changes meaning.
const isImmutableAsset = (url) =>
  url.pathname.startsWith('/assets/') || /\.[0-9a-f]{8,}\.(js|css|woff2?)$/i.test(url.pathname)

self.addEventListener('install', (e) => {
  // Precache the shell so a till that reboots with no connection still opens.
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(SHELL))
      .catch(() => {})       // a missing optional file must not block install
      .then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((n) => n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return

  const url = new URL(req.url)

  // Backend traffic: straight to the network, never stored. If it fails, the
  // app's own offline queue handles it — a cached reply would be a lie.
  if (isApi(url)) return

  // Product images: cache-first, fill in behind. Once a photo has been seen on
  // this till it keeps showing even when the connection is down.
  if (isStorageImage(url)) {
    e.respondWith(
      caches.match(req).then((hit) => {
        if (hit) return hit
        return fetch(req).then((res) => {
          if (res.ok) { const clone = res.clone(); caches.open(CACHE).then((c) => c.put(req, clone)) }
          return res
        }).catch(() => caches.match(req).then(h => h || Response.error()))
      })
    )
    return
  }

  // Hashed build assets: cache-first. The URL changes when the content does.
  if (isImmutableAsset(url)) {
    e.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res.ok) { const clone = res.clone(); caches.open(CACHE).then((c) => c.put(req, clone)) }
        return res
      }).catch(() => Response.error()))
    )
    return
  }

  // Navigations: network first so a deploy is picked up immediately, cache as
  // the fallback so the till still opens with no connection.
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const clone = res.clone()
          caches.open(CACHE).then((c) => c.put('/index.html', clone))
          return res
        })
        .catch(() => caches.match('/index.html').then((hit) => hit || caches.match('/')))
    )
    return
  }

  // Everything else (icons, fonts): cache with a network refresh behind it.
  e.respondWith(
    caches.match(req).then((hit) => {
      const live = fetch(req).then((res) => {
        if (res.ok) { const clone = res.clone(); caches.open(CACHE).then((c) => c.put(req, clone)) }
        return res
      // A cache miss AND a failed fetch used to resolve respondWith() to
      // undefined, which the browser reports as a network error rather than
      // just letting the request fail normally.
      }).catch(() => hit || Response.error())
      return hit || live
    })
  )
})

// Periodic badge update — check for pending orders every 2 minutes
self.addEventListener('periodicsync', (e) => {
  if (e.tag === 'update-badge') {
    e.waitUntil(updateBadgeCount())
  }
})

self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'UPDATE_BADGE') {
    const count = e.data.count || 0
    if (count > 0) self.registration.setAppBadge(count).catch(() => {})
    else self.registration.clearAppBadge().catch(() => {})
  }
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting()
})

async function updateBadgeCount() {
  try {
    const clients = await self.clients.matchAll()
    clients.forEach((c) => c.postMessage({ type: 'REQUEST_BADGE' }))
  } catch {}
}
