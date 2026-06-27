// Utility functions
export const money = n => 'GHS ' + Number(n || 0).toFixed(2)
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

export const thumb = (url, w) => {
  if (!url) return ''
  // Route through ImageKit (external origin -> res.cloudinary.com).
  // ImageKit serves the path AFTER the origin domain, so we strip the
  // Cloudinary host and append the rest to the ImageKit endpoint, then add
  // resize/compress/auto-format. Non-Cloudinary URLs are left as-is.
  if (IMAGEKIT_ENDPOINT && url.includes('res.cloudinary.com/')) {
    const ep = IMAGEKIT_ENDPOINT.replace(/\/+$/, '')
    let path = url.split('res.cloudinary.com/')[1] // e.g. dls9fai0i/image/upload/[transforms/]v123/folder/file.jpg
    // Remove any Cloudinary transform segment after /upload/ (e.g. w_300,c_fill,q_auto,f_auto/)
    // so only the clean image path remains — ImageKit applies its own ?tr= transform.
    path = path.replace(/(\/upload\/)[^/]*[,_][^/]*\//, '$1')
    return `${ep}/${path}?tr=w-${w},q-70,f-auto`
  }
  // Fallback: Cloudinary on-the-fly transform (original behaviour).
  if (url.includes('/upload/')) return url.replace(/\/upload\//, `/upload/w_${w},c_fill,q_auto,f_auto/`)
  return url
}

export const SHOP = {
  name: 'EVERYTINROOM&BEDTIME',
  tagline: '',
  phone: '024 531 5581 / 024 936 5339',
  address: 'Adenta Aviation Road, Accra',
  addressFull: 'Aviation Road J382, Adenta, Accra, Ghana',
  mapsUrl: 'https://maps.google.com/?q=Everytinroom+Adenta+Aviation+Road+Accra+Ghana',
  yango: 'Aviation Road J382',
  website: 'www.erbliving.shop',
  promoMsg: '',
}

export const ADMIN_PIN = null
