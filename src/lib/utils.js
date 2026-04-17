// Utility functions
export const money = n => 'GHS ' + Number(n || 0).toFixed(2)
export const num = n => Number(n) || 0
export const today = () => new Date().toISOString().slice(0, 10)
export const weekStartDate = () => { const d = new Date(); d.setDate(d.getDate() - d.getDay()); return d.toISOString().slice(0, 10) }
export const monthStart = () => new Date().toISOString().slice(0, 8) + '01'
export const isoDate = d => (d || '').slice(0, 10)
export const fmtDate = d => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }) : ''
export const fmtDateTime = d => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''
export const thumb = (url, w) => url ? url.replace(/\/upload\//, `/upload/w_${w},c_fill,q_auto,f_auto/`) : ''

export const SHOP = {
  name: 'EVERYTINROOM&BEDTIME',
  tagline: '',
  phone: '024 531 5581 / 024 936 5339',
  address: 'Adenta Aviation Road, Accra',
  addressFull: 'Aviation Road J382, Adenta, Accra, Ghana',
  mapsUrl: 'https://maps.google.com/?q=Everytinroom+Adenta+Aviation+Road+Accra+Ghana',
  yango: 'Aviation Road J382',
  website: 'www.everytinroom.store',
  promoMsg: '',
}

export const ADMIN_PIN = null
