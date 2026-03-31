import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const ARKESEL_API_KEY = Deno.env.get('ARKESEL_API_KEY') || ''
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || 'https://noiiuwkovoojkcwzupye.supabase.co'
const SUPABASE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const SENDER_ID = 'EverytnRm'

const ADMIN_PHONES = ['0533547740', '0548124978', '0554808341']

const sb = createClient(SUPABASE_URL, SUPABASE_KEY)

const formatPhone = (p) => {
  const clean = p.replace(/\D/g, '')
  if (clean.startsWith('0')) return '233' + clean.slice(1)
  if (clean.startsWith('233')) return clean
  return '233' + clean
}

const fmt = (n) => 'GHS ' + Number(n || 0).toFixed(2)
const dateStr = (d) => d.toISOString().slice(0, 10)

const sendSMS = async (phones, message) => {
  const recipients = phones.map(formatPhone)
  try {
    const res = await fetch('https://sms.arkesel.com/api/v2/sms/send', {
      method: 'POST',
      headers: { 'api-key': ARKESEL_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sender: SENDER_ID, message, recipients })
    })
    const data = await res.json()
    console.log('SMS sent:', data)
    return data
  } catch (e) {
    console.error('SMS error:', e)
    return { error: e.message }
  }
}

const getSalesData = async (fromDate, toDate) => {
  const { data: sales } = await sb.from('sales').select('*').gte('date', fromDate + 'T00:00:00').lte('date', toDate + 'T23:59:59').eq('voided', false)
  const s = sales || []
  return {
    revenue: s.reduce((a, x) => a + Number(x.total || 0), 0),
    profit: s.reduce((a, x) => a + Number(x.profit || 0), 0),
    cash: s.filter(x => x.payment === 'Cash').reduce((a, x) => a + Number(x.total || 0), 0),
    momo: s.filter(x => x.payment === 'Momo' || x.payment === 'Paystack').reduce((a, x) => a + Number(x.total || 0), 0),
    split: s.filter(x => x.payment === 'Split').reduce((a, x) => a + Number(x.total || 0), 0),
    count: s.length, sales: s
  }
}

const getExpenses = async (fromDate, toDate) => {
  const { data } = await sb.from('expenses').select('*').gte('date', fromDate + 'T00:00:00').lte('date', toDate + 'T23:59:59')
  const exps = data || []
  return { total: exps.reduce((a, x) => a + Number(x.amount || 0), 0), count: exps.length }
}

const getLowStock = async () => {
  const { data } = await sb.from('products').select('name, quantity').lte('quantity', 5).order('quantity', { ascending: true }).limit(10)
  return data || []
}

const getTopSellers = (sales) => {
  const map = {}
  for (const s of sales) {
    const items = typeof s.items === 'string' ? JSON.parse(s.items) : (s.items || [])
    for (const it of items) {
      const name = it.name || 'Unknown'
      if (!map[name]) map[name] = { qty: 0, rev: 0 }
      map[name].qty += Number(it.qty || 1)
      map[name].rev += Number(it.price || 0) * Number(it.qty || 1)
    }
  }
  return Object.entries(map).sort((a, b) => b[1].qty - a[1].qty).slice(0, 5)
}

const buildMorningReport = async () => {
  const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1)
  const yd = dateStr(yesterday)
  const dayName = yesterday.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' })
  const sales = await getSalesData(yd, yd)
  const expenses = await getExpenses(yd, yd)
  const topSellers = getTopSellers(sales.sales)
  const lowStock = await getLowStock()

  let msg = `Good Morning!\nYesterday's Report (${dayName})\n\n`
  msg += `Revenue: ${fmt(sales.revenue)}\nSales: ${sales.count}\nProfit: ${fmt(sales.profit)}\nExpenses: ${fmt(expenses.total)}\nNet: ${fmt(sales.profit - expenses.total)}\n\n`
  msg += `Cash: ${fmt(sales.cash)}\nMomo: ${fmt(sales.momo)}\n`
  if (sales.split > 0) msg += `Split: ${fmt(sales.split)}\n`
  if (topSellers.length > 0) { msg += `\nTop Sellers:\n`; topSellers.forEach(([n, d], i) => { msg += `${i + 1}. ${n} (${d.qty})\n` }) }
  if (lowStock.length > 0) { msg += `\nLow Stock:\n`; lowStock.slice(0, 5).forEach(p => { msg += `- ${p.name}: ${p.quantity} left\n` }) }
  msg += `\n- Everytin Room`
  return msg
}

const buildAfternoonReport = async () => {
  const today = dateStr(new Date())
  const sales = await getSalesData(today, today)
  const expenses = await getExpenses(today, today)

  let msg = `Afternoon Update\nToday So Far\n\n`
  msg += `Revenue: ${fmt(sales.revenue)}\nSales: ${sales.count}\nProfit: ${fmt(sales.profit)}\nExpenses: ${fmt(expenses.total)}\nNet: ${fmt(sales.profit - expenses.total)}\n\n`
  msg += `Cash: ${fmt(sales.cash)}\nMomo: ${fmt(sales.momo)}\n`
  if (sales.count === 0) msg += `\nNo sales yet. Let's push!\n`
  msg += `\n- Everytin Room`
  return msg
}

const buildEveningReport = async () => {
  const today = dateStr(new Date())
  const sales = await getSalesData(today, today)
  const expenses = await getExpenses(today, today)
  const topSellers = getTopSellers(sales.sales)

  let msg = `End of Day Report\n${new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}\n\n`
  msg += `Revenue: ${fmt(sales.revenue)}\nTotal Sales: ${sales.count}\nProfit: ${fmt(sales.profit)}\nExpenses: ${fmt(expenses.total)} (${expenses.count})\nNet Profit: ${fmt(sales.profit - expenses.total)}\n\n`
  msg += `Cash: ${fmt(sales.cash)}\nMomo: ${fmt(sales.momo)}\n`
  if (sales.split > 0) msg += `Split: ${fmt(sales.split)}\n`
  if (topSellers.length > 0) { msg += `\nBest Sellers:\n`; topSellers.forEach(([n, d], i) => { msg += `${i + 1}. ${n} x${d.qty}\n` }) }
  msg += `\nDay closed. Well done!\n- Everytin Room`
  return msg
}

const buildWeeklyReport = async () => {
  const now = new Date()
  const lastMonday = new Date(now); lastMonday.setDate(now.getDate() - 7 - ((now.getDay() + 6) % 7))
  const lastSunday = new Date(lastMonday); lastSunday.setDate(lastMonday.getDate() + 6)
  const from = dateStr(lastMonday), to = dateStr(lastSunday)
  const sales = await getSalesData(from, to)
  const expenses = await getExpenses(from, to)
  const topSellers = getTopSellers(sales.sales)
  const lowStock = await getLowStock()

  let msg = `WEEKLY REPORT\n${lastMonday.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} - ${lastSunday.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}\n\n`
  msg += `Revenue: ${fmt(sales.revenue)}\nSales: ${sales.count}\nProfit: ${fmt(sales.profit)}\nExpenses: ${fmt(expenses.total)}\nNet: ${fmt(sales.profit - expenses.total)}\nAvg/Day: ${fmt(sales.revenue / 7)}\n\n`
  msg += `Cash: ${fmt(sales.cash)}\nMomo: ${fmt(sales.momo)}\n`
  if (topSellers.length > 0) { msg += `\nTop 5:\n`; topSellers.forEach(([n, d], i) => { msg += `${i + 1}. ${n} x${d.qty}\n` }) }
  if (lowStock.length > 0) { msg += `\nRestock:\n`; lowStock.forEach(p => { msg += `- ${p.name}: ${p.quantity}\n` }) }
  msg += `\nNew week, new targets!\n- Everytin Room`
  return msg
}

serve(async (req) => {
  const url = new URL(req.url)
  const type = url.searchParams.get('type') || ''

  try {
    let message = ''
    switch (type) {
      case 'morning': message = await buildMorningReport(); break
      case 'afternoon': message = await buildAfternoonReport(); break
      case 'evening': message = await buildEveningReport(); break
      case 'weekly': message = await buildWeeklyReport(); break
      case 'test':
        message = `Everytin Room SMS Reports Active!\n\nYou will receive:\n6AM - Yesterday summary\n1PM - Today so far\n8PM - End of day\nMonday 6AM - Weekly\n\n- Everytin Room POS`
        break
      default:
        return new Response(JSON.stringify({ status: 'ok', usage: '?type=morning|afternoon|evening|weekly|test' }), { headers: { 'Content-Type': 'application/json' } })
    }

    const result = await sendSMS(ADMIN_PHONES, message)
    return new Response(JSON.stringify({ status: 'sent', type, recipients: ADMIN_PHONES, result }), { headers: { 'Content-Type': 'application/json' } })
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  }
})
