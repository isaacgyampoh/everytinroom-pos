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

export const ADMIN_PIN = '1024'

// Generate thumbnail URL for Supabase images
export const thumb = (url, w = 200) => {
  if (!url) return ''
  if (url.includes('supabase')) return url + (url.includes('?') ? '&' : '?') + `width=${w}&quality=60`
  return url
}
