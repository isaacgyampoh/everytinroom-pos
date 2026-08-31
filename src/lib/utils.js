// Utility functions
export const money = n => 'GHS ' + Number(n || 0).toFixed(2)
// Compact form for headline figures, where "GHS 148,320.00" is noise and
// "148.3k" is the number you actually read across the room.
export const moneyShort = n => {
  const v = Number(n || 0)
  const a = Math.abs(v)
  if (a >= 1_000_000) return (v / 1_000_000).toFixed(a >= 10_000_000 ? 0 : 1).replace(/\.0$/, '') + 'm'
  if (a >= 10_000) return (v / 1000).toFixed(a >= 100_000 ? 0 : 1).replace(/\.0$/, '') + 'k'
  return v.toLocaleString('en-GB', { maximumFractionDigits: 0 })
}
export const pct = (part, whole) => whole > 0 ? (part / whole) * 100 : 0
export const num = n => Number(n) || 0
export const today = () => new Date().toISOString().slice(0, 10)
export const weekStartDate = () => { const d = new Date(); d.setDate(d.getDate() - d.getDay()); return d.toISOString().slice(0, 10) }
export const monthStart = () => new Date().toISOString().slice(0, 8) + '01'
export const isoDate = d => (d || '').slice(0, 10)
export const fmtDate = d => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }) : ''
export const fmtDateTime = d => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''
// ImageKit free CDN endpoint — set this to your endpoint to route ALL images
// through ImageKit (faster, auto WebP/AVIF, 20GB/mo free). Leave '' to keep
// using the raw image URLs / Cloudinary transforms as before.
// Example: 'https://ik.imagekit.io/everytinroom'
export const IMAGEKIT_ENDPOINT = 'https://ik.imagekit.io/bqikvsp59'

// Snap to a short ladder of widths. Every distinct width is a separate
// transform the CDN has to generate and store, so a handful of shared sizes
// caches far better than eight arbitrary ones.
const WIDTHS = [96, 200, 320, 480, 800]
const snap = (w) => WIDTHS.find(x => x >= w) || WIDTHS[WIDTHS.length - 1]

export const thumb = (url, w) => {
  if (!url) return ''
  // Supabase Storage: go through the image transformation endpoint.
  //
  // These used to be returned untouched, at full camera resolution. The
  // catalogue is 492MB across 534 photos (944KB average, worst 5.7MB), so ONE
  // screen of the POS grid pulled ~58MB. On a shop connection most of those
  // never finished, and a failed <img> gets swapped for a grey placeholder —
  // which is why "images aren't showing". Resized, the same screen is ~2.5MB.
  if (url.includes('/storage/v1/object/public/')) {
    return url.replace('/storage/v1/object/public/', '/storage/v1/render/image/public/')
      + `?width=${snap(w)}&quality=70`
  }
  // Already a render URL (defensive — don't double-transform).
  if (url.includes('/storage/v1/render/image/public/')) return url
  // Cloudinary images route through ImageKit for optimization + because
  // Cloudinary's free tier is unreliable. If ImageKit ever fails, these are
  // being migrated to Supabase anyway.
  if (IMAGEKIT_ENDPOINT && url.includes('res.cloudinary.com/')) {
    const ep = IMAGEKIT_ENDPOINT.replace(/\/+$/, '')
    let path = url.split('res.cloudinary.com/')[1]
    path = path.replace(/(\/upload\/)[^/]*[,_][^/]*\//, '$1')
    return `${ep}/${path}?tr=w-${snap(w)},q-70,f-auto`
  }
  // Fallback: Cloudinary on-the-fly transform.
  if (url.includes('/upload/')) return url.replace(/\/upload\//, `/upload/w_${snap(w)},c_fill,q_auto,f_auto/`)
  return url
}

export const SHOP = {
  name: 'EVERYTINROOM',
  tagline: '',
  phone: '054 920 7471 / 024 531 5581',
  address: 'Adenta Aviation Road, Accra',
  addressFull: 'Aviation Road J382, Adenta, Accra, Ghana',
  mapsUrl: 'https://maps.google.com/?q=Everytinroom+Adenta+Aviation+Road+Accra+Ghana',
  yango: 'Aviation Road J382',
  website: 'www.erbliving.shop',
  promoMsg: '',
}

export const ADMIN_PIN = null
