import { format, isToday, startOfWeek, startOfMonth, parseISO } from 'date-fns'

export const num = v => parseFloat(v) || 0
export const money = v => 'GHS ' + num(v).toFixed(2)
export const fmtDate = d => { try { return format(new Date(d), 'dd/MM/yyyy') } catch { return '-' } }
export const fmtDateTime = d => { try { return format(new Date(d), 'dd/MM/yyyy HH:mm') } catch { return '-' } }
export const isoDate = d => { try { return format(new Date(d), 'yyyy-MM-dd') } catch { return '' } }
export const today = () => format(new Date(), 'yyyy-MM-dd')
export const monthStart = () => format(startOfMonth(new Date()), 'yyyy-MM-dd')
export const weekStartDate = () => format(startOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd')

export const SHOP = {
  name: 'EVERYTINROOM&BEDTIME',
  tagline: 'Your One Stop Shop',
  phone: '024 531 5581 / 024 936 5339',
  address: 'Adenta Aviation Road',
  website: 'www.Erbliving.shop',
  // Seasonal message on receipts (set to '' to remove)
  promoMsg: '',
}

export const ADMIN_PIN = null // Admin PIN verified server-side via verify_pin()

// Generate thumbnail URL - works with both Supabase and Cloudinary
export const thumb = (url, w = 300) => {
  if (!url) return ''
  // Cloudinary: use good quality transforms
  if (url.includes('cloudinary')) return url.replace('/upload/', `/upload/w_${w},c_fill,q_80,f_auto/`)
  // Supabase fallback
  if (url.includes('supabase')) return url + (url.includes('?') ? '&' : '?') + `width=${w}&quality=60`
  return url
}
