import { describe, it, expect } from 'vitest'
import {
  MODES, STYLES, STYLE_IDS, recommendStyle, recommendMode,
  isEnhanced, isEligible, eligibleProducts, estimateCost,
  makeJob, addJobs, dueJobs, applyResult, queueStats,
  BATCH_SIZE, GIVE_UP_AFTER, backoffFor,
} from './photoStudio'

const prod = (o = {}) => ({ id: 'p1', name: 'Thing', category: 'Other', image: 'https://x/storage/v1/object/public/product-images/products/a.jpg', quantity: 3, ...o })
const enhanced = (o = {}) => prod({ image: 'https://x/storage/v1/object/public/product-images/enhanced/a.jpg', ...o })

describe('what may be enhanced', () => {
  it('a product with a plain photograph is a candidate', () => {
    expect(isEligible(prod())).toBe(true)
  })

  // 84 of this shop's products have no photograph. They are not candidates:
  // there is nothing for a model to improve, and counting them would inflate
  // the quoted cost of a run by a third.
  it('a product with no photograph is never a candidate', () => {
    for (const img of ['', '   ', null, undefined]) {
      expect(isEligible(prod({ image: img }))).toBe(false)
    }
  })

  // The brief: do not regenerate what has already been done unless asked.
  // 362 images have already been corrected once; paying to redo them silently
  // is the expensive mistake here.
  it('skips an image that has already been enhanced', () => {
    expect(isEnhanced(enhanced())).toBe(true)
    expect(isEligible(enhanced())).toBe(false)
  })

  it('redoes an enhanced image only when explicitly asked', () => {
    expect(isEligible(enhanced(), { redo: true })).toBe(true)
  })

  it('redo still cannot conjure a candidate out of nothing', () => {
    expect(isEligible(prod({ image: '' }), { redo: true })).toBe(false)
  })

  it('filters a mixed catalogue down to the real work', () => {
    const list = [prod({ id: 'a' }), enhanced({ id: 'b' }), prod({ id: 'c', image: '' }), prod({ id: 'd' })]
    expect(eligibleProducts(list).map(p => p.id)).toEqual(['a', 'd'])
    expect(eligibleProducts(list, { redo: true }).map(p => p.id)).toEqual(['a', 'b', 'd'])
  })
})

describe('what a run will cost', () => {
  it('quotes the real catalogue honestly', () => {
    expect(estimateCost(244, 'clean')).toMatchObject({ images: 244, usd: 4.88 })
    expect(estimateCost(244, 'scene')).toMatchObject({ images: 244, usd: 24.4 })
  })

  // A quote that reads low is worse than one that reads high: the shop finds
  // out the difference on the invoice.
  it('rounds up to the cent, never down', () => {
    expect(estimateCost(1, 'clean').usd).toBe(0.02)
    expect(estimateCost(7, 'clean').usd).toBe(0.14)
    expect(estimateCost(3, 'scene').usd).toBe(0.3)
  })

  // Floating point is why this is counted in cents: 7 * 0.02 is
  // 0.14000000000000001, and the obvious ceil() quoted it as $0.15.
  it('does not drift on amounts that are exact in cents', () => {
    for (const n of [1, 3, 7, 13, 49, 244, 1001]) {
      expect(estimateCost(n, 'clean').usd).toBeCloseTo(n * 2 / 100, 10)
      expect(estimateCost(n, 'scene').usd).toBeCloseTo(n * 10 / 100, 10)
    }
  })

  it('a styled setting costs more than a clean-up, so the default is the cheap one', () => {
    expect(MODES.scene.centsPerImage).toBeGreaterThan(MODES.clean.centsPerImage)
    expect(MODES.clean.generative).toBe(false)
    expect(MODES.scene.generative).toBe(true)
  })

  it('nothing selected costs nothing', () => {
    for (const n of [0, -5, null, undefined, 'abc']) expect(estimateCost(n).usd).toBe(0)
  })
})

describe('choosing a look', () => {
  it('matches the categories this shop actually uses', () => {
    expect(recommendStyle('Bed Sheets')).toBe('interior')
    expect(recommendStyle('Cookware Sets')).toBe('kitchen')
    expect(recommendStyle('Artefacts & Decor')).toBe('luxury')
    expect(recommendStyle('Home Appliances')).toBe('white')
  })

  it('is not fussy about how the category was typed', () => {
    expect(recommendStyle('  bed sheets ')).toBe('interior')
    expect(recommendStyle('BED SHEETS')).toBe('interior')
  })

  // A category nobody anticipated must still get a usable shot. White
  // flatters nothing and misrepresents nothing.
  it('falls back to a white studio shot for anything unknown', () => {
    for (const c of ['Nail polish', '', null, undefined, 42]) {
      expect(recommendStyle(c)).toBe('white')
    }
  })

  it('every recommendation names a style that exists', () => {
    const cats = ['Bed Sheets','Curtains','Carpets','Mats','Pillows','Blankets','Cookware Sets',
                  'Kitchenware','Home Appliances','Racks','Rods','Chairs','Artefacts & Decor','Other','']
    for (const c of cats) expect(STYLE_IDS).toContain(recommendStyle(c))
  })

  // Generative is reserved for the cases where the setting is the point. A
  // cooking pot on a white sweep sells; it does not need an invented kitchen.
  it('only reaches for the generative mode where a room is the point', () => {
    expect(recommendMode('Bed Sheets')).toBe('scene')
    expect(recommendMode('Curtains')).toBe('scene')
    expect(recommendMode('Cookware Sets')).toBe('clean')
    expect(recommendMode('Home Appliances')).toBe('clean')
    expect(recommendMode('Anything else')).toBe('clean')
  })

  it('every style is presentable to a shopkeeper', () => {
    for (const s of STYLES) {
      expect(s.label.length).toBeGreaterThan(0)
      expect(s.blurb.length).toBeGreaterThan(10)
    }
  })
})

describe('the queue', () => {
  it('builds a job carrying the source image and a recommended style', () => {
    const j = makeJob(prod({ category: 'Curtains' }))
    expect(j).toMatchObject({ productId: 'p1', status: 'queued', attempts: 0, mode: 'clean', style: 'interior' })
    expect(j.sourceImage).toContain('product-images')
    expect(j.resultImage).toBeNull()
  })

  // Queueing the same product twice is paying for it twice.
  it('never queues the same product twice', () => {
    let q = addJobs([], [prod({ id: 'a' }), prod({ id: 'b' })])
    q = addJobs(q, [prod({ id: 'b' }), prod({ id: 'c' })])
    expect(q.map(j => j.productId)).toEqual(['a', 'b', 'c'])
  })

  // "Do not launch hundreds of AI requests simultaneously."
  it('hands out a bounded batch however much is waiting', () => {
    const q = addJobs([], Array.from({ length: 200 }, (_, i) => prod({ id: 'p' + i })))
    expect(dueJobs(q)).toHaveLength(BATCH_SIZE)
    expect(BATCH_SIZE).toBeLessThanOrEqual(10)
  })

  it('does not hand out a job still waiting out its backoff', () => {
    const now = 1_000_000
    const q = [{ ...makeJob(prod()), nextTryAt: now + 60_000 }]
    expect(dueJobs(q, now)).toHaveLength(0)
    expect(dueJobs(q, now + 61_000)).toHaveLength(1)
  })

  it('only hands out queued work, not what is already in flight or reviewed', () => {
    const q = [
      { ...makeJob(prod({ id: 'a' })), status: 'running' },
      { ...makeJob(prod({ id: 'b' })), status: 'review' },
      { ...makeJob(prod({ id: 'c' })), status: 'approved' },
      { ...makeJob(prod({ id: 'd' })), status: 'failed' },
      makeJob(prod({ id: 'e' })),
    ]
    expect(dueJobs(q).map(j => j.productId)).toEqual(['e'])
  })

  it('a success goes to review, never straight to the product', () => {
    const j = applyResult(makeJob(prod()), { ok: true, image: 'https://x/enhanced/new.jpg' })
    // 'approved' is a human act. Nothing here may set it.
    expect(j.status).toBe('review')
    expect(j.resultImage).toBe('https://x/enhanced/new.jpg')
    expect(j.error).toBeNull()
  })

  it('a failure backs off and is retried', () => {
    const now = 1_000_000
    const j = applyResult(makeJob(prod()), { ok: false, error: 'timeout' }, now)
    expect(j.status).toBe('queued')
    expect(j.attempts).toBe(1)
    expect(j.nextTryAt).toBeGreaterThan(now)
  })

  // Each retry costs money. This is not the offline sale queue, where
  // retrying forever is right because the sale already happened.
  it('stops paying to retry after a few goes', () => {
    let j = makeJob(prod())
    for (let i = 0; i < GIVE_UP_AFTER; i++) j = applyResult(j, { ok: false, error: 'boom' })
    expect(j.status).toBe('failed')
    expect(GIVE_UP_AFTER).toBeLessThanOrEqual(3)
  })

  it('does not retry at all when the provider says the request itself was wrong', () => {
    const j = applyResult(makeJob(prod()), { ok: false, permanent: true, error: 'unsupported format' })
    expect(j.status).toBe('failed')
    expect(j.attempts).toBe(1)
  })

  it('waits longer each time rather than hammering a provider that is struggling', () => {
    expect(backoffFor(1)).toBeGreaterThan(backoffFor(0))
    expect(backoffFor(99)).toBe(backoffFor(GIVE_UP_AFTER - 1))
  })

  it('reports progress a shopkeeper can read', () => {
    const q = [
      { ...makeJob(prod({ id: 'a' })), status: 'approved' },
      { ...makeJob(prod({ id: 'b' })), status: 'failed' },
      { ...makeJob(prod({ id: 'c' })), status: 'review' },
      makeJob(prod({ id: 'd' })),
    ]
    expect(queueStats(q)).toMatchObject({ total: 4, approved: 1, failed: 1, review: 1, queued: 1, done: 2 })
  })

  // The queue is plain data precisely so it can be written to storage and
  // picked up again — the brief asks that closing the browser not lose a run.
  it('survives a round trip through storage', () => {
    const q = addJobs([], [prod({ id: 'a' }), prod({ id: 'b' })])
    const back = JSON.parse(JSON.stringify(q))
    expect(dueJobs(back)).toHaveLength(2)
    expect(queueStats(back).total).toBe(2)
  })
})
