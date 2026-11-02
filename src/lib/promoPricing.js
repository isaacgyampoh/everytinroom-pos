// ============================================================================
// WHICH PROMOTION APPLIES, AND WHERE
//
// The till and the storefront are not separate systems — they read the same
// `promos` rows from the same database. Until migration 033 there was no way
// to say "this one is for the counter": a promotion run to shift stock in the
// shop silently cut the online price too, and a web campaign discounted the
// shop floor.
//
// `channel` says where a promotion applies — 'shop', 'web', or 'both'. Rows
// written before 033 default to 'both', which is exactly what they already did,
// so nothing changes for existing promotions.
//
// THIS FILE MIRRORS promo_price() IN MIGRATION 033. The database is the
// authority — a web order is priced by place_web_order() server-side and the
// browser never sends a price — but both apps need the same answer locally to
// render a shelf price without a round trip per product. Keep the two in step;
// the tests next door encode the rule either must follow.
//
// The two apps had already drifted apart before this existed: the till compared
// dates as ISO strings, the storefront built Date objects, and only one of them
// tolerated `items` arriving as a JSON string.
// ============================================================================

export const CHANNELS = ['shop', 'web', 'both']

export const isoToday = () => new Date().toISOString().slice(0, 10)

// Promotions carry dates as 'YYYY-MM-DD'. Compared as strings, which is correct
// for that format and avoids the timezone traps of parsing to Date — the shop
// trades in Accra (UTC+0) but a till can be set to anything.
const day = (v) => (typeof v === 'string' ? v.slice(0, 10) : v ? String(v).slice(0, 10) : null)

const items = (p) => {
  const raw = p?.items
  if (Array.isArray(raw)) return raw
  if (typeof raw === 'string') { try { const v = JSON.parse(raw); return Array.isArray(v) ? v : [] } catch { return [] } }
  return []
}

// A promotion with no channel is one written before 033, and those applied
// everywhere — so absent means 'both', never "nowhere".
const channelOf = (p) => p?.channel || 'both'

export function promoApplies(promo, channel, today = isoToday()) {
  if (!promo || !promo.active) return false
  const c = channelOf(promo)
  if (c !== 'both' && c !== channel) return false
  const start = day(promo.startDate ?? promo.start_date)
  const end = day(promo.endDate ?? promo.end_date)
  if (start && start > today) return false      // not started
  if (end && end < today) return false          // finished
  return true
}

// The promotional unit price for one product on one channel, or null if no
// promotion reaches it. Lowest wins where several name the same product: it is
// predictable, it is what the till already did, and it resolves in the
// customer's favour — the only direction a pricing bug may go.
export function promoPriceFor(promos, productId, channel, today = isoToday()) {
  let best = null
  for (const p of promos || []) {
    if (!promoApplies(p, channel, today)) continue
    for (const it of items(p)) {
      if (String(it?.productId ?? '') !== String(productId)) continue
      const price = Number(it?.promoPrice ?? it?.promo_price ?? it?.price)
      if (!Number.isFinite(price) || price <= 0) continue
      if (best === null || price < best) best = price
    }
  }
  return best
}

// { productId: promoPrice } for everything on promotion on this channel —
// built once per render rather than scanning the promo list per product.
export function promoPriceMap(promos, channel, today = isoToday()) {
  const map = {}
  for (const p of promos || []) {
    if (!promoApplies(p, channel, today)) continue
    for (const it of items(p)) {
      const id = it?.productId
      if (!id) continue
      const price = Number(it?.promoPrice ?? it?.promo_price ?? it?.price)
      if (!Number.isFinite(price) || price <= 0) continue
      if (map[id] === undefined || price < map[id]) map[id] = price
    }
  }
  return map
}

// Bundles carry a channel too, so a counter-only bundle does not appear online.
export function bundleApplies(bundle, channel) {
  if (!bundle || !bundle.active) return false
  const c = channelOf(bundle)
  return c === 'both' || c === channel
}
