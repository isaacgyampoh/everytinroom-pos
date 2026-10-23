import { describe, it, expect } from 'vitest'
import { publicRoute, canOpenPage, PAGE_ACCESS, PAGES_BY_ID } from './routes'

describe('publicRoute', () => {
  it('matches the customer-facing routes', () => {
    expect(publicRoute('#/catalog')).toBe('catalog')
    expect(publicRoute('#/pay')).toBe('pay')
    expect(publicRoute('#/deliver')).toBe('deliver')
    expect(publicRoute('#/details')).toBe('details')
    expect(publicRoute('#/customer-display')).toBe('customer-display')
  })

  it('keeps the trailing path and query out of it', () => {
    expect(publicRoute('#/pay/INV-123')).toBe('pay')
    expect(publicRoute('#/details/abc?token=xyz')).toBe('details')
    expect(publicRoute('#/catalog?cat=rice')).toBe('catalog')
  })

  it('sends everything else to the till', () => {
    expect(publicRoute('#/pos')).toBeNull()
    expect(publicRoute('#/dash')).toBeNull()
    expect(publicRoute('#/')).toBeNull()
    expect(publicRoute('')).toBeNull()
    expect(publicRoute(null)).toBeNull()
    expect(publicRoute(undefined)).toBeNull()
  })

  // The bug this function exists to prevent. It used to be hash.includes(),
  // so any hash CONTAINING '/catalog' rendered the storefront — which is how a
  // signed-in cashier ended up on the customer site with no way back.
  it('does not match a public route appearing elsewhere in the hash', () => {
    expect(publicRoute('#/pos?ref=/catalog-promo')).toBeNull()
    expect(publicRoute('#/receipts?from=/pay/INV-1')).toBeNull()
    expect(publicRoute('#/products?q=deliver')).toBeNull()
  })

  // ...and it must match the whole segment, not a prefix of one.
  it('does not match a route that merely starts with a public name', () => {
    expect(publicRoute('#/catalog-promo')).toBeNull()
    expect(publicRoute('#/payments')).toBeNull()
  })
})

describe('canOpenPage', () => {
  const nobody = { isAdmin: false, can: () => false }
  const admin = { isAdmin: true, can: () => false }

  it('lets an admin open everything', () => {
    for (const id of PAGES_BY_ID) expect(canOpenPage(id, admin)).toBe(true)
  })

  it('leaves the shop-floor pages open to any signed-in staff member', () => {
    for (const id of ['pos', 'receipts', 'whatsapp', 'terminal']) {
      expect(canOpenPage(id, nobody)).toBe(true)
    }
  })

  // The regression that mattered: these were only HIDDEN in the nav, so a
  // cashier who typed the hash got straight in.
  it('closes the admin-only pages to a cashier', () => {
    for (const id of ['dash', 'customers', 'bundles', 'promos', 'invoices',
                      'expenses', 'performance', 'wachats', 'wasettings', 'staff']) {
      expect(canOpenPage(id, nobody)).toBe(false)
    }
  })

  it('enforces each named permission rather than just hiding the page', () => {
    const cases = {
      products: 'product_management',
      restock: 'product_receiving',
      receiving: 'product_receiving',
      stocktakes: 'stock_taking',
      stockadjustments: 'stock_taking',
      stockinsights: 'inventory_view',
      reports: 'reports',
      refunds: 'refunds',
    }
    for (const [id, perm] of Object.entries(cases)) {
      expect(canOpenPage(id, { isAdmin: false, can: (p) => p === perm })).toBe(true)
      expect(canOpenPage(id, { isAdmin: false, can: () => false })).toBe(false)
      // Holding some other permission must not open this page.
      expect(canOpenPage(id, { isAdmin: false, can: (p) => p === 'something_else' })).toBe(false)
    }
  })

  it('denies a permissioned page when no permission checker was supplied', () => {
    expect(canOpenPage('reports', { isAdmin: false })).toBe(false)
    expect(canOpenPage('reports', {})).toBe(false)
    expect(canOpenPage('reports')).toBe(false)
  })

  it('keeps the fallback page reachable, since the guard redirects there', () => {
    expect(canOpenPage('pos', nobody)).toBe(true)
  })
})

describe('the access table and the deep-link table cannot drift apart', () => {
  it('every restricted page is a page a deep link can target', () => {
    for (const id of Object.keys(PAGE_ACCESS)) {
      expect(PAGES_BY_ID.has(id)).toBe(true)
    }
  })

  it('every requirement is either admin or a permission key', () => {
    for (const [id, needed] of Object.entries(PAGE_ACCESS)) {
      expect(typeof needed, id).toBe('string')
      expect(needed.length, id).toBeGreaterThan(0)
    }
  })
})
