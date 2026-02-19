// supabase/functions/sms-reports/index.ts
// Deploy: supabase functions deploy sms-reports --no-verify-jwt
// Called by cron or manually with ?type=morning|midday|evening|weekly|monthly|lowstock
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const MNOTIFY_API_KEY = 'iIYFWWI7dFTEuxRbreXWezGDf'
const MNOTIFY_SENDER_ID = 'EverytinRM'
const SMS_RECIPIENTS = '0533547740,0203600855,0554808341'
const LOW_STOCK_THRESHOLD = 5

serve(async (req) => {
  const url = new URL(req.url)
  const type = url.searchParams.get('type') || 'evening'
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

  // Skip Sundays
  if (new Date().getDay() === 0 && type !== 'monthly') {
    return respond({ success: true, message: 'Sunday - skipped' })
  }

  try {
    let msg = ''
    switch (type) {
      case 'morning': msg = await buildMorningMsg(supabase); break
      case 'midday': msg = await buildMiddayMsg(supabase); break
      case 'evening': msg = await buildEveningMsg(supabase); break
      case 'weekly': msg = await buildWeeklyMsg(supabase); break
      case 'monthly': msg = await buildMonthlyMsg(supabase); break
      case 'lowstock': msg = await buildLowStockMsg(supabase); break
      default: return respond({ success: false, error: 'Unknown type' })
    }

    if (!msg) return respond({ success: true, message: 'Nothing to send' })

    const result = await sendSMS(SMS_RECIPIENTS, msg)
    return respond({ success: true, type, result })
  } catch (err) {
    return respond({ success: false, error: String(err) })
  }
})

function respond(data: any) {
  return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } })
}

function fmt(v: number) { return 'GHS ' + v.toFixed(2) }
function todayStr() { return new Date().toISOString().split('T')[0] }
function dayName(d: Date) { return d.toLocaleDateString('en', { weekday: 'long' }) }
function dateDisplay(d: Date) { return d.toLocaleDateString('en', { weekday: 'long', month: 'short', day: 'numeric' }) }

async function getSalesForDate(supabase: any, dateStr: string) {
  const start = dateStr + 'T00:00:00'
  const end = dateStr + 'T23:59:59'
  const { data: sales } = await supabase.from('sales')
    .select('total, profit, payment, type')
    .gte('date', start).lte('date', end).eq('voided', false)

  const r = { revenue: 0, profit: 0, cash: 0, momo: 0, paystack: 0, count: 0, retail: 0, wholesale: 0, wa: 0 }
  for (const s of (sales || [])) {
    r.revenue += Number(s.total); r.profit += Number(s.profit); r.count++
    if (s.payment === 'Cash') r.cash += Number(s.total)
    else if (s.payment === 'Momo') r.momo += Number(s.total)
    else if (s.payment === 'Paystack') r.paystack += Number(s.total)
    if (s.type === 'Wholesale') r.wholesale++
    else if (s.type === 'WhatsApp') r.wa++
    else r.retail++
  }
  return r
}

async function getExpensesForDate(supabase: any, dateStr: string) {
  const start = dateStr + 'T00:00:00'
  const end = dateStr + 'T23:59:59'
  const { data } = await supabase.from('expenses').select('amount').gte('date', start).lte('date', end)
  return (data || []).reduce((sum: number, e: any) => sum + Number(e.amount), 0)
}

async function getLowStockProducts(supabase: any) {
  const { data } = await supabase.from('products').select('name, quantity')
    .lte('quantity', LOW_STOCK_THRESHOLD).order('quantity', { ascending: true })
  return data || []
}

// ===== MORNING (8AM) =====
async function buildMorningMsg(supabase: any) {
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  if (yesterday.getDay() === 0) yesterday.setDate(yesterday.getDate() - 1) // skip Sunday

  const yStr = yesterday.toISOString().split('T')[0]
  const ySales = await getSalesForDate(supabase, yStr)
  const lowStock = await getLowStockProducts(supabase)
  const outOfStock = lowStock.filter((p: any) => p.quantity === 0)

  let msg = `Good morning Madam!\n${dateDisplay(today)}\n\n`
  if (ySales.count > 0) {
    msg += `${dayName(yesterday)}'s sales was ${fmt(ySales.revenue)} from ${ySales.count} transactions.\n\nHope we make it even better today!\n`
  } else {
    msg += `No sales recorded ${dayName(yesterday)}.\n\nLet's have a great day today!\n`
  }

  if (outOfStock.length > 0) {
    msg += `\n** ${outOfStock.length} item(s) OUT OF STOCK:\n`
    outOfStock.slice(0, 5).forEach((p: any) => { msg += `- ${p.name}\n` })
    if (outOfStock.length > 5) msg += `...+${outOfStock.length - 5} more\n`
  } else if (lowStock.length > 0) {
    msg += `\n** ${lowStock.length} item(s) running low on stock`
  }
  return msg
}

// ===== MIDDAY (12PM) =====
async function buildMiddayMsg(supabase: any) {
  const s = await getSalesForDate(supabase, todayStr())
  let msg = `EVERYTINROOM Midday Update\n========================\n\n`
  if (s.count > 0) {
    msg += `Sales so far today: ${fmt(s.revenue)}\nTransactions: ${s.count}\nCash: ${fmt(s.cash)}\nMomo: ${fmt(s.momo)}\n`
    if (s.paystack > 0) msg += `Paystack: ${fmt(s.paystack)}\n`
    msg += `\nKeep it up! More sales this afternoon!`
  } else {
    msg += `No sales recorded yet today.\n\nLet's push for a strong afternoon!`
  }
  return msg
}

// ===== EVENING (7PM) =====
async function buildEveningMsg(supabase: any) {
  const ts = todayStr()
  const s = await getSalesForDate(supabase, ts)
  const exp = await getExpensesForDate(supabase, ts)
  const net = s.profit - exp

  let msg = `EVERYTINROOM End of Day\n${dateDisplay(new Date())}\n========================\n\n`
  msg += `TOTAL SALES: ${fmt(s.revenue)}\nTransactions: ${s.count}\n\n`
  msg += `BREAKDOWN:\nCash: ${fmt(s.cash)}\nMomo: ${fmt(s.momo)}\n`
  if (s.paystack > 0) msg += `Paystack: ${fmt(s.paystack)}\n`
  msg += `\nProfit: ${fmt(s.profit)}\nExpenses: ${fmt(exp)}\nNET PROFIT: ${fmt(net)}\n\n`
  if (s.count > 0) {
    msg += `Retail: ${s.retail} | Wholesale: ${s.wholesale}`
    if (s.wa > 0) msg += ` | WA: ${s.wa}`
    msg += `\n\n`
  }
  msg += `Well done today! Rest well.`
  return msg
}

// ===== WEEKLY (Saturday) =====
async function buildWeeklyMsg(supabase: any) {
  const today = new Date()
  const dow = today.getDay() || 7
  const weekStart = new Date(today)
  weekStart.setDate(today.getDate() - dow + 1)
  weekStart.setHours(0, 0, 0, 0)

  const wsStr = weekStart.toISOString().split('T')[0]
  const teStr = todayStr()

  const { data: sales } = await supabase.from('sales')
    .select('total, profit, payment, date')
    .gte('date', wsStr + 'T00:00:00').lte('date', teStr + 'T23:59:59').eq('voided', false)

  let total = 0, profit = 0, cash = 0, momo = 0, paystack = 0, txn = 0
  const daily: Record<string, number> = {}
  const dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']

  for (const s of (sales || [])) {
    total += Number(s.total); profit += Number(s.profit); txn++
    if (s.payment === 'Cash') cash += Number(s.total)
    else if (s.payment === 'Momo') momo += Number(s.total)
    else paystack += Number(s.total)
    const dn = dayNames[new Date(s.date).getDay()]
    daily[dn] = (daily[dn] || 0) + Number(s.total)
  }

  const { data: expenses } = await supabase.from('expenses')
    .select('amount').gte('date', wsStr + 'T00:00:00').lte('date', teStr + 'T23:59:59')
  const expTotal = (expenses || []).reduce((a: number, e: any) => a + Number(e.amount), 0)
  const net = profit - expTotal

  let bestDay = '', bestAmt = 0
  for (const d in daily) { if (daily[d] > bestAmt) { bestAmt = daily[d]; bestDay = d } }

  const weekLabel = weekStart.toLocaleDateString('en', { month: 'short', day: 'numeric' }) + ' - ' +
    today.toLocaleDateString('en', { month: 'short', day: 'numeric' })

  let msg = `EVERYTINROOM WEEKLY REPORT\n${weekLabel}\n========================\n\n`
  msg += `TOTAL SALES: ${fmt(total)}\nCash: ${fmt(cash)}\nMomo: ${fmt(momo)}\n`
  if (paystack > 0) msg += `Paystack: ${fmt(paystack)}\n`
  msg += `Transactions: ${txn}\n\nProfit: ${fmt(profit)}\nExpenses: ${fmt(expTotal)}\nNET: ${fmt(net)}\n\n`

  for (const d of ['Mon','Tue','Wed','Thu','Fri','Sat']) {
    if (daily[d]) msg += `${d}: ${fmt(daily[d])}\n`
  }
  if (bestDay) msg += `\nBest day: ${bestDay} (${fmt(bestAmt)})`
  msg += `\n\nEnjoy your Sunday rest!`
  return msg
}

// ===== MONTHLY (1st of month) =====
async function buildMonthlyMsg(supabase: any) {
  const today = new Date()
  const lastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1)
  const monthEnd = new Date(today.getFullYear(), today.getMonth(), 0)
  const msStr = lastMonth.toISOString().split('T')[0]
  const meStr = monthEnd.toISOString().split('T')[0]
  const monthName = lastMonth.toLocaleDateString('en', { month: 'long', year: 'numeric' })

  const { data: sales } = await supabase.from('sales')
    .select('total, profit, payment')
    .gte('date', msStr + 'T00:00:00').lte('date', meStr + 'T23:59:59').eq('voided', false)

  let total = 0, profit = 0, cash = 0, momo = 0, paystack = 0, txn = 0
  for (const s of (sales || [])) {
    total += Number(s.total); profit += Number(s.profit); txn++
    if (s.payment === 'Cash') cash += Number(s.total)
    else if (s.payment === 'Momo') momo += Number(s.total)
    else paystack += Number(s.total)
  }

  const { data: expenses } = await supabase.from('expenses')
    .select('amount').gte('date', msStr + 'T00:00:00').lte('date', meStr + 'T23:59:59')
  const expTotal = (expenses || []).reduce((a: number, e: any) => a + Number(e.amount), 0)
  const net = profit - expTotal
  const workDays = monthEnd.getDate() - Math.floor(monthEnd.getDate() / 7)

  let msg = `EVERYTINROOM MONTHLY REPORT\n${monthName}\n========================\n\n`
  msg += `TOTAL SALES: ${fmt(total)}\nCash: ${fmt(cash)}\nMomo: ${fmt(momo)}\n`
  if (paystack > 0) msg += `Paystack: ${fmt(paystack)}\n`
  msg += `Transactions: ${txn}\n\nGross Profit: ${fmt(profit)}\nExpenses: ${fmt(expTotal)}\nNET PROFIT: ${fmt(net)}\n\n`
  msg += `Avg/day: ${fmt(total / Math.max(1, workDays))}\n\nLet's make this new month even better!`
  return msg
}

// ===== LOW STOCK =====
async function buildLowStockMsg(supabase: any) {
  const items = await getLowStockProducts(supabase)
  if (!items.length) return ''

  const outOfStock = items.filter((p: any) => p.quantity === 0)
  const lowStock = items.filter((p: any) => p.quantity > 0)

  let msg = `EVERYTINROOM STOCK ALERT\n${items.length} items need attention\n========================\n`
  if (outOfStock.length > 0) {
    msg += `OUT OF STOCK (${outOfStock.length}):\n`
    outOfStock.slice(0, 8).forEach((p: any) => { msg += `- ${p.name}\n` })
    if (outOfStock.length > 8) msg += `...+${outOfStock.length - 8} more\n`
  }
  if (lowStock.length > 0) {
    msg += `LOW STOCK (${lowStock.length}):\n`
    lowStock.slice(0, 8).forEach((p: any) => { msg += `- ${p.name} (${p.quantity})\n` })
    if (lowStock.length > 8) msg += `...+${lowStock.length - 8} more\n`
  }
  return msg
}

// ===== SMS SENDER =====
async function sendSMS(to: string, message: string) {
  const recipients = to.split(',').map(r => r.trim().replace(/\s+/g, '').replace(/^0/, '233'))
  try {
    const res = await fetch(`https://api.mnotify.com/api/sms/quick?key=${MNOTIFY_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipient: recipients, sender: MNOTIFY_SENDER_ID, message, is_schedule: false, schedule_date: '' })
    })
    return await res.json()
  } catch {
    // Fallback
    for (const phone of recipients) {
      await fetch(`https://apps.mnotify.net/smsapi?key=${MNOTIFY_API_KEY}&to=${encodeURIComponent(phone)}&msg=${encodeURIComponent(message)}&sender_id=${encodeURIComponent(MNOTIFY_SENDER_ID)}`)
    }
  }
}
