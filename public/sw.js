const CACHE_NAME = 'everytinroom-v2'

self.addEventListener('install', (e) => {
  self.skipWaiting()
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((names) => Promise.all(
      names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))
    ))
  )
  self.clients.claim()
})

self.addEventListener('fetch', (e) => {
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok && e.request.method === 'GET') {
          const clone = res.clone()
          caches.open(CACHE_NAME).then((cache) => cache.put(e.request, clone))
        }
        return res
      })
      .catch(() => caches.match(e.request))
  )
})

// Periodic badge update — check for pending orders every 2 minutes
self.addEventListener('periodicsync', (e) => {
  if (e.tag === 'update-badge') {
    e.waitUntil(updateBadgeCount())
  }
})

// Also update badge when service worker receives a message
self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'UPDATE_BADGE') {
    const count = e.data.count || 0
    if (count > 0) self.registration.setAppBadge(count).catch(() => {})
    else self.registration.clearAppBadge().catch(() => {})
  }
})
