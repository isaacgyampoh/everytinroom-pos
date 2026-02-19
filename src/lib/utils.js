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
  name: 'Everytin Room',
  tagline: 'Your One Stop Shop',
  phone: '054 920 7471 / 024 531 5581',
  address: 'Adenta Aviation Road',
  website: 'www.Erbliving.shop',
}

export const ADMIN_PIN = '1024'
