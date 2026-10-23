import { describe, it, expect } from 'vitest'
import { money, moneyShort, pct, num, thumb, isoDate } from './utils'

describe('money', () => {
  it('formats Ghana cedi to two places', () => {
    expect(money(10)).toBe('GHS 10.00')
    expect(money(10.5)).toBe('GHS 10.50')
    expect(money(0)).toBe('GHS 0.00')
  })

  it('does not blow up on nothing', () => {
    expect(money(null)).toBe('GHS 0.00')
    expect(money(undefined)).toBe('GHS 0.00')
    expect(money('')).toBe('GHS 0.00')
  })
})

describe('moneyShort', () => {
  it('leaves small figures readable in full', () => {
    expect(moneyShort(0)).toBe('0')
    expect(moneyShort(999)).toBe('999')
    expect(moneyShort(9999)).toBe('9,999')
  })

  it('shortens thousands', () => {
    expect(moneyShort(10000)).toBe('10k')
    expect(moneyShort(15500)).toBe('15.5k')
    expect(moneyShort(148320)).toBe('148k')
  })

  it('shortens millions', () => {
    expect(moneyShort(1500000)).toBe('1.5m')
    expect(moneyShort(12000000)).toBe('12m')
  })

  it('keeps the sign on a negative figure', () => {
    expect(moneyShort(-25000)).toBe('-25k')
  })
})

describe('pct', () => {
  it('is a percentage of the whole', () => {
    expect(pct(25, 100)).toBe(25)
    expect(pct(1, 3)).toBeCloseTo(33.333, 2)
  })

  it('is zero rather than Infinity when there is no whole', () => {
    expect(pct(5, 0)).toBe(0)
    expect(pct(5, null)).toBe(0)
  })
})

describe('num', () => {
  it('coerces anything unusable to zero', () => {
    expect(num('12.5')).toBe(12.5)
    expect(num('abc')).toBe(0)
    expect(num(null)).toBe(0)
    expect(num(NaN)).toBe(0)
  })
})

describe('isoDate', () => {
  it('takes the date half of a timestamp', () => {
    expect(isoDate('2026-10-23T14:33:00.000Z')).toBe('2026-10-23')
    expect(isoDate('')).toBe('')
    expect(isoDate(null)).toBe('')
  })
})

describe('thumb', () => {
  const PUBLIC = 'https://x.supabase.co/storage/v1/object/public/product-images/rice.jpg'

  it('is empty for no image', () => {
    expect(thumb('')).toBe('')
    expect(thumb(null)).toBe('')
    expect(thumb(undefined)).toBe('')
  })

  // One screen of the POS grid used to pull ~58MB of full-resolution camera
  // photos. Every Supabase image must go through the resizing endpoint.
  it('routes a Supabase object through the image transform', () => {
    const t = thumb(PUBLIC, 320)
    expect(t).toContain('/storage/v1/render/image/public/')
    expect(t).not.toContain('/storage/v1/object/public/')
    expect(t).toContain('quality=72')
  })

  // resize=contain is not optional: width alone returned a 9px sliver for any
  // photo carrying EXIF orientation, which hit 242 of 534 photos.
  it('always asks for width AND height AND contain', () => {
    const t = thumb(PUBLIC, 320)
    expect(t).toContain('width=320')
    expect(t).toContain('height=320')
    expect(t).toContain('resize=contain')
  })

  it('snaps to a short ladder of widths so the CDN caches well', () => {
    expect(thumb(PUBLIC, 50)).toContain('width=96')
    expect(thumb(PUBLIC, 100)).toContain('width=200')
    expect(thumb(PUBLIC, 200)).toContain('width=200')
    expect(thumb(PUBLIC, 400)).toContain('width=480')
    expect(thumb(PUBLIC, 5000)).toContain('width=800')   // clamped to the top
  })

  it('defaults to a sensible width when none is given', () => {
    expect(thumb(PUBLIC)).toContain('width=320')
  })

  it('does not transform an already-transformed URL twice', () => {
    const once = thumb(PUBLIC, 320)
    expect(thumb(once, 320)).toBe(once)
  })

  it('leaves an unrecognised URL alone', () => {
    const other = 'https://example.com/photo.jpg'
    expect(thumb(other, 320)).toBe(other)
  })
})
