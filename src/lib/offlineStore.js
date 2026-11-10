// ============================================================================
// OFFLINE TRADING
//
// The app could already QUEUE a sale made offline. It could not MAKE one.
// Nothing about the catalogue survived a cold start, and verify_pin needs the
// network, so a till that rebooted with the internet down showed a login
// screen nobody could get past and, behind it, an empty product grid. The
// queue was a write path with no read path.
//
// This is the read path: a snapshot of what the till needs to trade, written
// on every successful load and restored when the network is gone.
//
// WHY NOT THE SERVICE WORKER
//     The service worker deliberately never caches API responses — a till
//     showing yesterday's stock with no way to tell is worse than showing
//     nothing. That rule stands. This is different: an explicit, timestamped
//     snapshot the app knows is a snapshot, shown with its age on screen, used
//     only when the live source cannot be reached.
//
// WHAT IS NOT CACHED
//     Sales, customers, orders, reports. None of it is needed to serve
//     somebody at the counter, and all of it goes stale in ways that mislead.
// ============================================================================

const CAT_KEY = 'pos-offline-catalogue'
const CRED_KEY = 'pos-offline-credentials'
const MAX_AGE_DAYS = 14

// ---------------------------------------------------------------- catalogue
export function saveCatalogue({ products, bundles, promos }) {
  try {
    // Strip what a till does not need to ring up a sale. Keeps the snapshot
    // small enough for localStorage and keeps cost prices off the disk of a
    // machine that may not be allowed to see them.
    const slim = (products || []).map(p => ({
      id: p.id, name: p.name, category: p.category, price: p.price,
      wholesalePrice: p.wholesalePrice, wholesaleMinQty: p.wholesaleMinQty,
      quantity: p.quantity, image: p.image, groupTag: p.groupTag, barcode: p.barcode,
    }))
    localStorage.setItem(CAT_KEY, JSON.stringify({
      at: Date.now(),
      products: slim,
      bundles: bundles || [],
      promos: promos || [],
    }))
    return true
  } catch (e) {
    // Quota exceeded on a big catalogue — better to trade online-only than to
    // throw during a load.
    console.warn('Could not save the offline catalogue:', e)
    return false
  }
}

export function loadCatalogue() {
  try {
    const raw = localStorage.getItem(CAT_KEY)
    if (!raw) return null
    const snap = JSON.parse(raw)
    if (!snap?.products?.length) return null
    const ageDays = (Date.now() - snap.at) / 86400000
    // A fortnight-old catalogue is worse than an honest failure — prices move.
    if (ageDays > MAX_AGE_DAYS) return null
    return snap
  } catch { return null }
}

export function catalogueAge() {
  const s = loadCatalogue()
  return s ? s.at : null
}

// ---------------------------------------------------------------- sign-in
//
// Offline, verify_pin is unreachable. Rather than lock the shop out of its own
// till, remember — per machine — who has signed in here before, so they can
// sign in again without the server.
//
// The PIN itself is never stored. What is stored is SHA-256 over a random
// per-device salt plus the PIN, which is enough to check a PIN typed at this
// till and useless anywhere else. It is weaker than the server's bcrypt, and
// it is scoped to people who have ALREADY authenticated on this machine — the
// alternative being a till that cannot open.

async function hashPin(pin, salt) {
  const data = new TextEncoder().encode(salt + ':' + pin)
  const buf = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}

function readCreds() {
  try { return JSON.parse(localStorage.getItem(CRED_KEY) || '{"salt":"","users":[]}') }
  catch { return { salt: '', users: [] } }
}

function deviceSalt() {
  const c = readCreds()
  if (c.salt) return c.salt
  const salt = (crypto.randomUUID?.() || String(Math.random())).replace(/-/g, '')
  localStorage.setItem(CRED_KEY, JSON.stringify({ ...c, salt }))
  return salt
}

// Called after a SUCCESSFUL online sign-in, so the same person can get back in
// if the connection is gone next time.
export async function rememberSignIn(pin, user) {
  try {
    const salt = deviceSalt()
    const c = readCreds()
    const hash = await hashPin(pin, salt)
    const users = (c.users || []).filter(u => u.id !== user.id)
    users.push({
      id: user.id, name: user.name, role: user.role,
      permissions: user.permissions || [], hash, at: Date.now(),
    })
    localStorage.setItem(CRED_KEY, JSON.stringify({ salt, users }))
  } catch (e) { console.warn('Could not remember this sign-in:', e) }
}

// Returns the user if this PIN has signed in on this machine before.
export async function offlineSignIn(pin) {
  try {
    const c = readCreds()
    if (!c.salt || !c.users?.length) return null
    const hash = await hashPin(pin, c.salt)
    const hit = c.users.find(u => u.hash === hash)
    if (!hit) return null
    return { id: hit.id, name: hit.name, role: hit.role, permissions: hit.permissions || [] }
  } catch { return null }
}

export function knownOfflineUsers() {
  return (readCreds().users || []).map(u => u.name)
}

// Signing out of the shop entirely — forget the device's cached logins.
export function forgetOfflineCredentials() {
  try { localStorage.removeItem(CRED_KEY) } catch {}
}
