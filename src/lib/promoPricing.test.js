import { describe, it, expect } from 'vitest'
import { promoApplies, promoPriceFor, promoPriceMap, bundleApplies } from './promoPricing'

const TODAY = '2026-11-02'
const promo = (over = {}) => ({
  id: 'p1', name: 'Test', active: true, channel: 'both',
  startDate: null, endDate: null, items: [{ productId: 'A', promoPrice: 8 }],
  ...over,
})

describe('channel separation', () => {
  it('a shop-only promotion never reaches the website', () => {
    const p = [promo({ channel: 'shop' })]
    expect(promoPriceFor(p, 'A', 'shop', TODAY)).toBe(8)
    expect(promoPriceFor(p, 'A', 'web', TODAY)).toBeNull()
  })

  it('a website-only promotion never reaches the counter', () => {
    const p = [promo({ channel: 'web' })]
    expect(promoPriceFor(p, 'A', 'web', TODAY)).toBe(8)
    expect(promoPriceFor(p, 'A', 'shop', TODAY)).toBeNull()
  })

  it('a both-channel promotion reaches both', () => {
    const p = [promo({ channel: 'both' })]
    expect(promoPriceFor(p, 'A', 'shop', TODAY)).toBe(8)
    expect(promoPriceFor(p, 'A', 'web', TODAY)).toBe(8)
  })

  // Every promotion written before migration 033 has no channel at all, and
  // every one of them applied everywhere. Absent must mean 'both' — reading it
  // as "nowhere" would silently switch off every live promotion on deploy.
  it('a promotion with no channel still applies everywhere', () => {
    const p = [{ ...promo(), channel: undefined }]
    expect(promoPriceFor(p, 'A', 'shop', TODAY)).toBe(8)
    expect(promoPriceFor(p, 'A', 'web', TODAY)).toBe(8)
  })

  it('an unknown channel value matches nothing rather than everything', () => {
    const p = [promo({ channel: 'instore' })]
    expect(promoPriceFor(p, 'A', 'shop', TODAY)).toBeNull()
    expect(promoPriceFor(p, 'A', 'web', TODAY)).toBeNull()
  })
})

describe('scheduling and expiry', () => {
  it('has not started yet', () => {
    expect(promoApplies(promo({ startDate: '2026-12-01' }), 'web', TODAY)).toBe(false)
  })

  it('starts today', () => {
    expect(promoApplies(promo({ startDate: TODAY }), 'web', TODAY)).toBe(true)
  })

  it('ends today — still live on its last day', () => {
    expect(promoApplies(promo({ endDate: TODAY }), 'web', TODAY)).toBe(true)
  })

  it('finished yesterday', () => {
    expect(promoApplies(promo({ endDate: '2026-11-01' }), 'web', TODAY)).toBe(false)
  })

  it('open-ended runs until switched off', () => {
    expect(promoApplies(promo({ startDate: null, endDate: null }), 'web', TODAY)).toBe(true)
  })

  it('inactive never applies, whatever the dates say', () => {
    expect(promoApplies(promo({ active: false }), 'web', TODAY)).toBe(false)
  })

  // Dates arrive as full timestamps from some writers and bare dates from
  // others; comparing the first ten characters is what makes both work.
  it('tolerates a timestamp where a date was expected', () => {
    expect(promoApplies(promo({ endDate: '2026-11-02T23:59:59Z' }), 'web', TODAY)).toBe(true)
  })
})

describe('overlapping promotions', () => {
  it('the cheapest wins, and they do not compound', () => {
    const p = [
      promo({ id: 'a', items: [{ productId: 'A', promoPrice: 8 }] }),
      promo({ id: 'b', items: [{ productId: 'A', promoPrice: 6 }] }),
      promo({ id: 'c', items: [{ productId: 'A', promoPrice: 9 }] }),
    ]
    // 6, not 8-6-9 stacked into something absurd.
    expect(promoPriceFor(p, 'A', 'web', TODAY)).toBe(6)
  })

  it('only counts the ones that apply to this channel', () => {
    const p = [
      promo({ id: 'a', channel: 'web', items: [{ productId: 'A', promoPrice: 6 }] }),
      promo({ id: 'b', channel: 'shop', items: [{ productId: 'A', promoPrice: 3 }] }),
    ]
    expect(promoPriceFor(p, 'web', 'web', TODAY)).toBeNull()
    expect(promoPriceFor(p, 'A', 'web', TODAY)).toBe(6)   // not the shop's 3
    expect(promoPriceFor(p, 'A', 'shop', TODAY)).toBe(3)
  })

  it('ignores an expired promotion even when it is the cheapest', () => {
    const p = [
      promo({ id: 'a', items: [{ productId: 'A', promoPrice: 8 }] }),
      promo({ id: 'b', endDate: '2026-10-01', items: [{ productId: 'A', promoPrice: 2 }] }),
    ]
    expect(promoPriceFor(p, 'A', 'web', TODAY)).toBe(8)
  })
})

describe('rubbish in the promotion rows', () => {
  it('a product with no promotion prices normally', () => {
    expect(promoPriceFor([promo()], 'SOMETHING-ELSE', 'web', TODAY)).toBeNull()
    expect(promoPriceFor([], 'A', 'web', TODAY)).toBeNull()
    expect(promoPriceFor(null, 'A', 'web', TODAY)).toBeNull()
  })

  it('ignores zero, negative and non-numeric promotional prices', () => {
    for (const bad of [0, -5, 'free', null, undefined, NaN]) {
      expect(promoPriceFor([promo({ items: [{ productId: 'A', promoPrice: bad }] })], 'A', 'web', TODAY)).toBeNull()
    }
  })

  it('reads items that arrived as a JSON string', () => {
    const p = [promo({ items: JSON.stringify([{ productId: 'A', promoPrice: 7 }]) })]
    expect(promoPriceFor(p, 'A', 'web', TODAY)).toBe(7)
  })

  it('survives items being neither array nor valid JSON', () => {
    expect(promoPriceFor([promo({ items: 'not json' })], 'A', 'web', TODAY)).toBeNull()
    expect(promoPriceFor([promo({ items: null })], 'A', 'web', TODAY)).toBeNull()
    expect(promoPriceFor([promo({ items: { productId: 'A' } })], 'A', 'web', TODAY)).toBeNull()
  })

  it('matches a numeric product id against a string one', () => {
    const p = [promo({ items: [{ productId: 123, promoPrice: 4 }] })]
    expect(promoPriceFor(p, '123', 'web', TODAY)).toBe(4)
  })
})

describe('promoPriceMap — the automatic deals list', () => {
  it('collects every product on promotion for this channel', () => {
    const p = [
      promo({ id: 'a', channel: 'web', items: [{ productId: 'A', promoPrice: 8 }, { productId: 'B', promoPrice: 3 }] }),
      promo({ id: 'b', channel: 'shop', items: [{ productId: 'C', promoPrice: 1 }] }),
      promo({ id: 'c', channel: 'both', items: [{ productId: 'D', promoPrice: 2 }] }),
    ]
    expect(promoPriceMap(p, 'web', TODAY)).toEqual({ A: 8, B: 3, D: 2 })
    expect(promoPriceMap(p, 'shop', TODAY)).toEqual({ C: 1, D: 2 })
  })

  it('drops expired promotions, so the deals list empties itself', () => {
    const p = [promo({ channel: 'web', endDate: '2026-10-01' })]
    expect(promoPriceMap(p, 'web', TODAY)).toEqual({})
  })

  it('agrees with promoPriceFor on every product', () => {
    const p = [
      promo({ id: 'a', items: [{ productId: 'A', promoPrice: 8 }] }),
      promo({ id: 'b', items: [{ productId: 'A', promoPrice: 5 }, { productId: 'B', promoPrice: 2 }] }),
    ]
    const map = promoPriceMap(p, 'web', TODAY)
    for (const id of ['A', 'B']) expect(map[id]).toBe(promoPriceFor(p, id, 'web', TODAY))
  })
})

describe('bundles carry a channel too', () => {
  it('a counter-only bundle does not appear online', () => {
    expect(bundleApplies({ active: true, channel: 'shop' }, 'web')).toBe(false)
    expect(bundleApplies({ active: true, channel: 'shop' }, 'shop')).toBe(true)
  })

  it('an older bundle with no channel still appears in both', () => {
    expect(bundleApplies({ active: true }, 'web')).toBe(true)
    expect(bundleApplies({ active: true }, 'shop')).toBe(true)
  })

  it('an inactive bundle appears nowhere', () => {
    expect(bundleApplies({ active: false, channel: 'both' }, 'web')).toBe(false)
  })
})
