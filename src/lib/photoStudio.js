// ============================================================================
// AI PRODUCT STUDIO — the decisions, with no network in sight
//
// Everything here is pure, because everything here either spends money or
// decides whether a product's photograph gets replaced. Both deserve to be
// provable without an API key, a migration or a shop standing by.
//
// WHAT THIS CATALOGUE ACTUALLY NEEDS
//     690 products: 606 have a photograph, 362 of those have already been
//     corrected by tools/enhance_images.py, and 84 have no photograph at all.
//     So the real work is 244 images, not 690 — and the 84 are beyond any
//     amount of AI, because there is nothing to improve. Costing a run as
//     "690 images" would overstate it nearly threefold.
//
// WHY TWO MODES AND WHY 'clean' IS THE DEFAULT
//     'clean' removes the background, relights and recomposes. The product's
//     own pixels survive: it cannot invent a label, change a fabric or give a
//     cooking pot a handle it does not have.
//
//     'scene' asks a model to generate a setting around the product. It looks
//     better for furniture and it is the mode that can quietly alter the
//     thing you are selling.
//
//     The brief is emphatic that the product must not change, so 'clean' is
//     the default everywhere and 'scene' is opt-in per product. This is also
//     the order of cost: roughly $0.02 against $0.10 an image.
// ============================================================================

export const MODES = {
  clean: {
    id: 'clean',
    label: 'Studio clean-up',
    blurb: 'Removes the background, fixes the lighting, straightens the shot. The product itself is untouched.',
    generative: false,
    centsPerImage: 2,
  },
  scene: {
    id: 'scene',
    label: 'Styled setting',
    blurb: 'Places the product in a generated setting. Looks best for furniture and decor — check the result, a model can alter details.',
    generative: true,
    centsPerImage: 10,
  },
}

// Styles are presentation, not product. Each names a backdrop and a lighting
// character; none of them licenses changing the item.
export const STYLES = [
  { id: 'white',     label: 'White studio',     blurb: 'Pure white, even light. The safest listing shot.' },
  { id: 'soft-grey', label: 'Soft grey',        blurb: 'A gentle grey sweep with a natural shadow.' },
  { id: 'luxury',    label: 'Luxury',           blurb: 'Dark, directional light. Suits jewellery and premium goods.' },
  { id: 'minimal',   label: 'Minimal',          blurb: 'Plain backdrop, generous space, nothing competing.' },
  { id: 'lifestyle', label: 'Lifestyle',        blurb: 'The product in use, in a real room.' },
  { id: 'interior',  label: 'Interior',         blurb: 'A styled room. For furniture, curtains and decor.' },
  { id: 'kitchen',   label: 'Kitchen counter',  blurb: 'A clean worktop. For cookware and kitchen goods.' },
  { id: 'social',    label: 'Social',           blurb: 'Square crop, bold light. For posts and stories.' },
]

export const STYLE_IDS = STYLES.map(s => s.id)

// Mapped against the categories this shop actually uses, not a generic list.
// Anything unrecognised falls to a white studio shot, which flatters nothing
// and misrepresents nothing.
const BY_CATEGORY = {
  'bed sheets': 'interior', blankets: 'interior', pillows: 'interior',
  curtains: 'interior', carpets: 'interior', mats: 'interior',
  'cookware sets': 'kitchen', kitchenware: 'kitchen',
  'home appliances': 'white', racks: 'minimal', rods: 'minimal',
  chairs: 'interior', 'artefacts & decor': 'luxury',
}

export function recommendStyle(category) {
  const key = String(category || '').trim().toLowerCase()
  return BY_CATEGORY[key] || 'white'
}

// A styled setting is only worth its extra cost where the setting is the
// point. A cooking pot on a white sweep sells; a sofa floating on white does
// not.
export function recommendMode(category) {
  return recommendStyle(category) === 'interior' ? 'scene' : 'clean'
}

// ---------------------------------------------------------------------------
// Eligibility. The brief: do not regenerate what has already been done unless
// asked, and never pretend a product with no photograph is a candidate.
// ---------------------------------------------------------------------------
export const isEnhanced = (p) => /\/enhanced\//.test(String(p?.image || ''))
export const hasImage = (p) => !!String(p?.image || '').trim()

export function isEligible(product, { redo = false } = {}) {
  if (!hasImage(product)) return false
  if (!redo && isEnhanced(product)) return false
  return true
}

export function eligibleProducts(products, opts = {}) {
  return (products || []).filter(p => isEligible(p, opts))
}

// What a run will cost, shown before anybody is charged for anything.
//
// Counted in whole cents, never in dollars. The obvious version —
// Math.ceil(n * 0.02 * 100) / 100 — quotes seven images at $0.15 instead of
// $0.14, because 7 * 0.02 is 0.14000000000000001 in binary floating point and
// ceil dutifully rounds it up. Money is integers; the dollars are a rendering
// of them.
export function estimateCost(count, mode = 'clean') {
  const n = Math.max(0, Math.floor(Number(count) || 0))
  const cents = MODES[mode]?.centsPerImage ?? MODES.clean.centsPerImage
  const total = n * cents
  return { images: n, mode, centsPerImage: cents, usdPerImage: cents / 100, usd: total / 100 }
}

// ---------------------------------------------------------------------------
// The queue. Same shape as the offline sale queue, deliberately: that one is
// proven in this shop and the rules are the same — small batches, back off on
// failure, stop asking eventually, and survive the browser being closed.
// ---------------------------------------------------------------------------
export const BATCH_SIZE = 5          // concurrent requests, never "all of them"
export const GIVE_UP_AFTER = 3       // a paid request is not retried forever
const BACKOFF_MS = [4e3, 20e3, 90e3]

export const backoffFor = (attempts) => BACKOFF_MS[Math.min(attempts, BACKOFF_MS.length - 1)]

export function makeJob(product, { mode = 'clean', style } = {}) {
  return {
    productId: product.id,
    name: product.name,
    sourceImage: product.image,
    mode,
    style: style || recommendStyle(product.category),
    status: 'queued',          // queued | running | review | approved | failed
    attempts: 0,
    nextTryAt: 0,
    resultImage: null,
    error: null,
    at: new Date().toISOString(),
  }
}

// One product, one job. Re-adding something already in the queue must not
// queue it twice and charge twice.
export function addJobs(queue, products, opts = {}) {
  const have = new Set((queue || []).map(j => j.productId))
  return [...(queue || []), ...products.filter(p => !have.has(p.id)).map(p => makeJob(p, opts))]
}

// What may be sent right now: queued, not waiting out a backoff, capped.
export function dueJobs(queue, now = Date.now(), size = BATCH_SIZE) {
  return (queue || [])
    .filter(j => j.status === 'queued' && (j.nextTryAt || 0) <= now)
    .slice(0, size)
}

export function applyResult(job, result, now = Date.now()) {
  if (result?.ok && result.image) {
    return { ...job, status: 'review', resultImage: result.image, error: null }
  }
  const attempts = (job.attempts || 0) + 1
  const permanent = result?.permanent === true
  return {
    ...job,
    attempts,
    error: String(result?.error || 'The image could not be processed').slice(0, 200),
    status: permanent || attempts >= GIVE_UP_AFTER ? 'failed' : 'queued',
    nextTryAt: now + backoffFor(attempts),
  }
}

export function queueStats(queue) {
  const q = queue || []
  const by = (s) => q.filter(j => j.status === s).length
  return {
    total: q.length,
    queued: by('queued'),
    running: by('running'),
    review: by('review'),
    approved: by('approved'),
    failed: by('failed'),
    done: by('approved') + by('failed'),
  }
}
