// ============================================================================
// WHO MAY OPEN WHAT
//
// This lived in App.jsx, where the same rule was written out twice — once for
// deep links arriving as a hash, once for the guard that watches the current
// page. Two copies of a permission rule is how `reports`, `receiving`, `dash`,
// `customers`, `expenses` and `performance` ended up merely HIDDEN
// in the nav while staying perfectly reachable, and why the `reports`
// permission went unenforced. There is one copy now, and it is tested.
// ============================================================================

// The customer-facing routes, matched on the FIRST PATH SEGMENT rather than by
// substring.
//
// This used to be a hash.includes() check, which is why the till could open on
// the shop's website instead of the POS: any hash CONTAINING '/catalog' won, so
// '#/pos?ref=/catalog-promo' rendered the storefront, and an installed app
// relaunched on a stale '#/catalog' showed a signed-in cashier the customer
// site with no route back to the till.
const PUBLIC_ROUTES = ['customer-display', 'pay', 'deliver', 'details', 'catalog']

export function publicRoute(hash) {
  const path = String(hash || '').replace(/^#\/?/, '').split('?')[0]
  const head = path.split('/').filter(Boolean)[0] || ''
  return PUBLIC_ROUTES.includes(head) ? head : null
}

// Every internal page id that a deep link may target. Kept next to PAGE_ACCESS
// so the two cannot drift apart.
export const PAGES_BY_ID = new Set([
  'dash','pos','whatsapp','receiving','receipts','products',
  'staff','expenses','customers','bundles','performance','refunds','reports',
  'promos','invoices','stocktakes','stockadjustments','restock','terminal','stockinsights','costs','studio',
])

// What each restricted page requires. 'admin' means admin only; anything else
// is a permission key a cashier can be granted. Pages absent from this map are
// open to any signed-in staff member (pos, receipts, refunds, whatsapp).
export const PAGE_ACCESS = {
  dash: 'admin',
  customers: 'admin',
  bundles: 'admin',
  promos: 'admin',
  invoices: 'admin',
  expenses: 'admin',
  performance: 'admin',
  staff: 'admin',
  products: 'product_management',
  costs: 'product_management',
  studio: 'product_management',
  restock: 'product_receiving',
  receiving: 'product_receiving',
  stocktakes: 'stock_taking',
  stockinsights: 'inventory_view',
  stockadjustments: 'stock_taking',
  reports: 'reports',
  refunds: 'refunds',
}

// The single rule. An admin passes everything; an unlisted page is open to any
// signed-in staff member; 'admin' pages are closed to cashiers outright; the
// rest need the named permission.
//
// This decides what a cashier can REACH in the browser, and it is not the only
// thing standing between them and the data — the privileged RPCs check the
// session token server-side (migrations 015-021). This keeps the UI honest; the
// database is what keeps it safe.
export function canOpenPage(id, { isAdmin = false, can } = {}) {
  // An id that is not a page cannot be opened by anybody, admin included.
  // This used to fall through to "no permission needed, let them in", so a
  // link to a page that had been REMOVED counted as allowed and then rendered
  // nothing. PAGES_BY_ID is generated from the same list App.jsx renders from,
  // so fail-closed here cannot lock staff out of a page that exists.
  if (!PAGES_BY_ID.has(id)) return false
  const needed = PAGE_ACCESS[id]
  if (!needed) return true
  if (isAdmin) return true
  if (needed === 'admin') return false
  return typeof can === 'function' && !!can(needed)
}
