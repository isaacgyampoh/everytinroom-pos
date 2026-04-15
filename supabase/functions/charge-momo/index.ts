import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const PAYSTACK_SECRET = Deno.env.get('PAYSTACK_SECRET_KEY') || ''
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || 'https://noiiuwkovoojkcwzupye.supabase.co'
const SUPABASE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const MNOTIFY_API_KEY = Deno.env.get('MNOTIFY_API_KEY') || 'WjANNXLuG7PTy8WsK6Wuwa2AG'
const MNOTIFY_SENDER_ID = Deno.env.get('MNOTIFY_SENDER_ID') || 'EverytinRM'
const SHOP = 'EVERYTINROOM'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Content-Type': 'application/json',
}

async function sendSMS(to: string, message: string) {
  if (!MNOTIFY_API_KEY) return
  const recipients = to.split(',').map(r => r.trim())
  for (const recipient of recipients) {
    const phone = recipient.replace(/\s+/g, '').replace(/^0/, '233')
    try {
      await fetch(`https://api.mnotify.com/api/sms/quick?key=${MNOTIFY_API_KEY}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipient: [phone], sender: MNOTIFY_SENDER_ID, message, is_schedule: false, schedule_date: '' })
      })
    } catch {
      try { await fetch(`https://apps.mnotify.net/smsapi?key=${MNOTIFY_API_KEY}&to=${encodeURIComponent(phone)}&msg=${encodeURIComponent(message)}&sender_id=${encodeURIComponent(MNOTIFY_SENDER_ID)}`) } catch {}
    }
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const url = new URL(req.url)
    const action = url.searchParams.get('action')

    // ==================== PAYSTACK WEBHOOK ====================
    if (action === 'webhook') {
      const body = await req.json()
      console.log('WEBHOOK:', body.event, JSON.stringify(body.data || {}).slice(0, 500))

      if (body.event !== 'charge.success') {
        return new Response(JSON.stringify({ received: true }), { headers: { 'Content-Type': 'application/json' } })
      }

      const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)
      const pd = body.data
      const meta = pd.metadata || {}
      const ref = pd.reference || ''

      const ADMIN_PHONES = '0533547740,0548124978,0554808341'

      // Match by metadata order_id (USSD payments)
      if (meta.source === 'ussd' && meta.order_id) {
        const { data: paidOrder } = await supabase.from('whatsapp_orders').select('id,order_no,total,customer_phone,customer_name').eq('id', meta.order_id).single()
        await supabase.from('whatsapp_orders').update({
          status: 'Paid', paystack_ref: ref,
          paid_at: pd.paid_at || new Date().toISOString(),
          customer_phone: meta.customer_phone || pd.customer?.phone || ''
        }).eq('id', meta.order_id)
        console.log('USSD payment OK:', meta.order_no)
        const orderNo = meta.order_no || paidOrder?.order_no || ''
        const amount = (pd.amount/100).toFixed(2)
        const custPhone = meta.customer_phone || paidOrder?.customer_phone || pd.customer?.phone || ''
        // Admin: short payment notification
        try { await sendSMS(ADMIN_PHONES, `Payment received. ${orderNo} GHS ${amount}. Process ASAP.`) } catch {}
        // Customer: thank you message
        if (custPhone) {
          try { await sendSMS(custPhone, `Hi ${paidOrder?.customer_name || 'Customer'}, your payment of GHS ${amount} has been received.\n\nOrder: ${orderNo}\n\nYour order will be processed and delivered shortly.\n\nEVERYTINROOM\n024 531 5581`) } catch {}
        }
        return new Response(JSON.stringify({ success: true, type: 'ussd' }), { headers: { 'Content-Type': 'application/json' } })
      }

      // Match by USSD reference prefix
      if (ref.startsWith('USSD-')) {
        const { data: o } = await supabase.from('whatsapp_orders').select('id,order_no,total,customer_phone,customer_name').eq('paystack_ref', ref).single()
        if (o) {
          await supabase.from('whatsapp_orders').update({ status: 'Paid', paid_at: pd.paid_at || new Date().toISOString() }).eq('id', o.id)
          console.log('USSD ref match:', o.order_no)
          const amount = (pd.amount/100).toFixed(2)
          try { await sendSMS(ADMIN_PHONES, `Payment received. ${o.order_no} GHS ${amount}. Process ASAP.`) } catch {}
          if (o.customer_phone) {
            try { await sendSMS(o.customer_phone, `Hi ${o.customer_name || 'Customer'}, your payment of GHS ${amount} has been received.\n\nOrder: ${o.order_no}\n\nYour order will be processed and delivered shortly.\n\nEVERYTINROOM\n024 531 5581`) } catch {}
          }
          return new Response(JSON.stringify({ success: true, type: 'ussd-ref' }), { headers: { 'Content-Type': 'application/json' } })
        }
      }

      // Match any order by ref
      if (ref) {
        const { data: o } = await supabase.from('whatsapp_orders').select('id,order_no,total,customer_phone,customer_name').eq('paystack_ref', ref).single()
        if (o) {
          await supabase.from('whatsapp_orders').update({ status: 'Paid', paid_at: pd.paid_at || new Date().toISOString() }).eq('id', o.id)
          console.log('Ref match:', o.order_no)
          const amount = (pd.amount/100).toFixed(2)
          try { await sendSMS(ADMIN_PHONES, `Payment received. ${o.order_no} GHS ${amount}. Process ASAP.`) } catch {}
          if (o.customer_phone) {
            try { await sendSMS(o.customer_phone, `Hi ${o.customer_name || 'Customer'}, your payment of GHS ${amount} has been received.\n\nOrder: ${o.order_no}\n\nYour order will be processed and delivered shortly.\n\nEVERYTINROOM\n024 531 5581`) } catch {}
          }
          return new Response(JSON.stringify({ success: true, type: 'ref' }), { headers: { 'Content-Type': 'application/json' } })
        }
      }

      // No match — create new order
      const { data: products } = await supabase.from('products').select('*')
      const rawItems = meta.items || []
      let subtotal = 0
      const items = rawItems.map((it: any) => {
        let price = Number(it.price) || 0
        const name = it.name || it.product || ''
        const qty = Number(it.qty) || Number(it.quantity) || 1
        if (!price && name && products) { const m = products.find((p: any) => p.name.toLowerCase() === name.toLowerCase()); if (m) price = Number(m.price) || 0 }
        const lt = price * qty; subtotal += lt
        return { name, qty, price, lineTotal: lt }
      })
      const fee = Number(meta.deliveryFee || meta.delivery_fee) || 0
      const total = subtotal + fee
      const { data: noData } = await supabase.rpc('generate_wa_order_no')
      const orderNo = noData || `WA${Date.now()}`
      await supabase.from('whatsapp_orders').insert({
        order_no: orderNo, date: new Date().toISOString(),
        customer_name: meta.customerName || meta.customer_name || pd.customer?.first_name || '',
        customer_phone: meta.customerPhone || meta.customer_phone || pd.customer?.phone || '',
        items, subtotal, delivery_fee: fee, total,
        address: meta.address || '', notes: meta.notes || '',
        status: 'Pending', paystack_ref: ref,
        paid_at: pd.paid_at || new Date().toISOString(), created_at: new Date().toISOString()
      })
      try { await sendSMS(ADMIN_PHONES, `New order. ${orderNo} GHS ${total.toFixed(2)}. Process ASAP.`) } catch {}
      return new Response(JSON.stringify({ success: true, orderNo }), { headers: { 'Content-Type': 'application/json' } })
    }

    // ==================== USSD ====================
    if (action === 'ussd') {
      const allParams: Record<string, string> = {}
      for (const [k, v] of url.searchParams) allParams[k] = v
      if (req.method === 'POST') {
        const rawBody = await req.text()
        try { const j = JSON.parse(rawBody); for (const [k, v] of Object.entries(j)) allParams[String(k)] = String(v) }
        catch { for (const [k, v] of new URLSearchParams(rawBody)) allParams[k] = v }
      }

      console.log('NALO:', JSON.stringify(allParams))

      const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)
      const ussdCon = (msg: string) => new Response(JSON.stringify({ MSGTYPE: true, MSG: msg, USSDMSG: msg }), { headers: { 'Content-Type': 'application/json' } })
      const ussdEnd = (msg: string) => new Response(JSON.stringify({ MSGTYPE: false, MSG: msg, USSDMSG: msg }), { headers: { 'Content-Type': 'application/json' } })

      const sessionId = allParams.SESSIONID || allParams.sessionid || ''
      const phone = allParams.MSISDN || allParams.msisdn || ''
      const userData = allParams.USERDATA || allParams.userdata || ''

      // Check session from DB
      let sess: any = null
      if (sessionId) {
        const { data } = await supabase.from('ussd_sessions').select('*').eq('session_id', sessionId).single()
        sess = data
      }

      const step = sess?.step || ''
      const isMenuChoice = userData === '1' || userData === '2'

      // OTP step
      if (step === 'otp' && userData && sess?.paystack_ref) {
        console.log('OTP submit:', userData.trim(), 'ref:', sess.paystack_ref)
        try {
          const r = await fetch('https://api.paystack.co/charge/submit_otp', {
            method: 'POST', headers: { 'Authorization': 'Bearer ' + PAYSTACK_SECRET, 'Content-Type': 'application/json' },
            body: JSON.stringify({ otp: userData.trim(), reference: sess.paystack_ref }),
          })
          const d = await r.json()
          console.log('OTP result:', JSON.stringify(d))
          await supabase.from('ussd_sessions').delete().eq('session_id', sessionId)
          if (d.data?.status === 'success') {
            await supabase.from('whatsapp_orders').update({ status: 'Paid', paid_at: new Date().toISOString() }).eq('paystack_ref', sess.paystack_ref)
            return ussdEnd(`Payment successful!\nOrder: ${sess.order_no}\nThank you!`)
          }
          if (d.data?.status === 'failed') return ussdEnd(`Payment failed.\nDial *920*141*${sess.order_code}# to retry.`)
          return ussdEnd(`Payment processing.\nYou will receive confirmation.\nThank you!`)
        } catch (e) { return ussdEnd(`Error. Dial *920*141*${sess.order_code}# to retry.`) }
      }

      // Extract order code
      let orderCode = ''
      if (!isMenuChoice && userData && step !== 'otp') {
        const parts = userData.replace(/#/g, '').split('*').filter(Boolean)
        const idx = parts.indexOf('141')
        if (idx >= 0 && parts[idx + 1] && /^\d+$/.test(parts[idx + 1])) orderCode = parts[idx + 1]
        if (!orderCode && /^\d{1,6}$/.test(userData.trim())) orderCode = userData.trim()
      }
      if ((isMenuChoice || !orderCode) && sess?.order_code && sess.order_code !== 'LOG') orderCode = String(sess.order_code)
      if (!orderCode) return ussdCon(`Welcome to ${SHOP}\nPlease enter your Order Code:`)

      // Save session
      if (sessionId) {
        await supabase.from('ussd_sessions').upsert({ session_id: sessionId, order_code: orderCode, phone, step: 'menu', updated_at: new Date().toISOString() }, { onConflict: 'session_id' })
      }

      // Look up order
      const { data: order } = await supabase.from('whatsapp_orders')
        .select('id,order_no,total,status,customer_name,customer_phone,ussd_code')
        .eq('ussd_code', parseInt(orderCode)).single()

      if (!order) return ussdEnd(`Order ${orderCode} not found.`)
      if (order.status === 'Paid' || order.status === 'Completed') return ussdEnd(`Order ${order.order_no} already paid.\nThank you!`)
      if (order.status === 'Cancelled') return ussdEnd(`Order ${order.order_no} cancelled.\nCall: 024 531 5581`)

      const total = Number(order.total).toFixed(2)

      // Pay Now
      if (userData === '1') {
        let fp = phone.replace(/\s+/g, '').replace(/^0/, '233').replace(/^\+/, '')
        if (!fp.startsWith('233')) fp = '233' + fp
        const ref = `USSD-${order.ussd_code}-${Date.now().toString(36).toUpperCase()}`
        const num = fp.replace('233', '')
        let provider = 'mtn'
        if (/^(20|50|24|25|53|54|55|59)/.test(num)) provider = 'mtn'
        else if (/^(27|57|26|56)/.test(num)) provider = 'telecel'
        else if (/^(23|28|58)/.test(num)) provider = 'airteltigo'

        // Add 1% processing fee (invisible to customer)
        const chargeAmount = Math.round(Number(order.total) * 1.01 * 100)

        try {
          const cr = await fetch('https://api.paystack.co/charge', {
            method: 'POST', headers: { 'Authorization': 'Bearer ' + PAYSTACK_SECRET, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              email: fp + '@everytinroom.shop', amount: chargeAmount, currency: 'GHS',
              mobile_money: { phone: fp, provider }, reference: ref,
              metadata: { source: 'ussd', order_id: order.id, order_no: order.order_no, ussd_code: order.ussd_code, customer_phone: phone,
                custom_fields: [{ display_name: 'Order', variable_name: 'order_no', value: order.order_no }] },
            }),
          })
          const cd = await cr.json()
          console.log('Paystack charge:', JSON.stringify(cd))
          await supabase.from('whatsapp_orders').update({ paystack_ref: ref, customer_phone: phone }).eq('id', order.id)

          if (cd.data?.status === 'send_otp') {
            await supabase.from('ussd_sessions').upsert({
              session_id: sessionId, order_code: orderCode, phone, step: 'otp', paystack_ref: ref, order_no: order.order_no, updated_at: new Date().toISOString()
            }, { onConflict: 'session_id' })
            return ussdCon(`An OTP has been sent to your phone via SMS.\n\nEnter the code:`)
          }
          if (cd.data?.status === 'success') {
            await supabase.from('ussd_sessions').delete().eq('session_id', sessionId)
            await supabase.from('whatsapp_orders').update({ status: 'Paid', paid_at: new Date().toISOString() }).eq('id', order.id)
            return ussdEnd(`Payment of GHS ${total} successful!\nOrder: ${order.order_no}\nThank you!`)
          }
          if (cd.data?.status === 'pay_offline' || cd.data?.status === 'pending') {
            await supabase.from('ussd_sessions').delete().eq('session_id', sessionId)
            return ussdEnd(`GHS ${total} for ${order.order_no}\n\nApprove on your phone.\nDial *170# > Approvals.\nThank you!`)
          }
          if (cd.data?.status === 'failed') {
            await supabase.from('ussd_sessions').delete().eq('session_id', sessionId)
            return ussdEnd(`Payment failed: ${cd.data?.gateway_response || 'Error'}\nCall 024 531 5581`)
          }
          await supabase.from('ussd_sessions').delete().eq('session_id', sessionId)
          if (cd.status) return ussdEnd(`GHS ${total} for ${order.order_no}\nPayment processing.\nThank you!`)
          return ussdEnd(`Error: ${cd.message || 'Failed'}\nCall 024 531 5581`)
        } catch (e) {
          await supabase.from('ussd_sessions').delete().eq('session_id', sessionId)
          return ussdEnd(`Payment error. Call 024 531 5581`)
        }
      }

      // Cancel
      if (userData === '2') {
        if (sessionId) await supabase.from('ussd_sessions').delete().eq('session_id', sessionId)
        return ussdEnd(`Cancelled.\nDial *920*141*${orderCode}# anytime.`)
      }

      // Show order
      const name = order.customer_name ? `\n${order.customer_name}` : ''
      return ussdCon(`${SHOP}${name}\nOrder: ${order.order_no}\n\nTotal: GHS ${total}\n\n1. Pay Now\n2. Cancel`)
    }

    // ==================== Initialize ====================
    if (action === 'initialize') {
      const { phone, amount, email, reference, callbackUrl } = await req.json()
      if (!phone || !amount) return new Response(JSON.stringify({ success: false, error: 'Phone and amount required' }), { headers: CORS })
      let fp = phone.replace(/\s+/g, '').replace(/^0/, '233').replace(/^\+/, '')
      if (!fp.startsWith('233')) fp = '233' + fp
      const ref = reference || 'ETR-MOMO-' + Date.now().toString(36).toUpperCase()
      const em = email || fp + '@everytinroom.shop'
      const r = await fetch('https://api.paystack.co/transaction/initialize', { method: 'POST', headers: { 'Authorization': 'Bearer ' + PAYSTACK_SECRET, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: em, amount: Math.round(amount * 100), currency: 'GHS', reference: ref, channels: ['mobile_money'], callback_url: callbackUrl || 'https://everytinroom-pos.vercel.app',
          metadata: { source: 'everytinroom-pos', phone, custom_fields: [{ display_name: 'Phone', variable_name: 'phone', value: phone }] } }) })
      const d = await r.json()
      if (!d.status) return new Response(JSON.stringify({ success: false, error: d.message || 'Failed' }), { headers: CORS })
      return new Response(JSON.stringify({ success: true, authorizationUrl: d.data?.authorization_url, accessCode: d.data?.access_code, reference: d.data?.reference || ref }), { headers: CORS })
    }

    // ==================== Charge ====================
    if (action === 'charge') {
      const { phone, amount, email, reference } = await req.json()
      if (!phone || !amount) return new Response(JSON.stringify({ success: false, error: 'Phone and amount required' }), { headers: CORS })
      let fp = phone.replace(/\s+/g, '').replace(/^0/, '233').replace(/^\+/, '')
      if (!fp.startsWith('233')) fp = '233' + fp
      const ref = reference || 'ETR-MOMO-' + Date.now().toString(36).toUpperCase()
      const em = email || fp + '@everytinroom.shop'
      const r = await fetch('https://api.paystack.co/charge', { method: 'POST', headers: { 'Authorization': 'Bearer ' + PAYSTACK_SECRET, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: em, amount: Math.round(amount * 100), currency: 'GHS', mobile_money: { phone: fp, provider: 'mtn' }, reference: ref, metadata: { source: 'everytinroom-pos', phone } }) })
      const d = await r.json()
      if (!d.status) return new Response(JSON.stringify({ success: false, error: d.message || 'Failed' }), { headers: CORS })
      return new Response(JSON.stringify({ success: true, reference: d.data?.reference || ref, status: d.data?.status, displayText: d.data?.display_text || 'Check your phone' }), { headers: CORS })
    }

    // ==================== Verify ====================
    if (action === 'verify') {
      const { reference } = await req.json()
      if (!reference) return new Response(JSON.stringify({ success: false, error: 'Reference required' }), { headers: CORS })
      const r = await fetch('https://api.paystack.co/transaction/verify/' + encodeURIComponent(reference), { headers: { 'Authorization': 'Bearer ' + PAYSTACK_SECRET } })
      const d = await r.json()
      return new Response(JSON.stringify({ success: d.status || false, paymentStatus: d.data?.status || 'unknown', amount: (d.data?.amount || 0) / 100, reference: d.data?.reference, paidAt: d.data?.paid_at, message: d.message }), { headers: CORS })
    }

    // ==================== SMS REPORTS ====================
    if (action === 'report') {
      const reportUrl = new URL(req.url)
      const type = reportUrl.searchParams.get('type') || ''
      const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)
      const ADMIN_PHONES = ['0533547740', '0548124978', '0554808341']
      const fmt = (n: number) => 'GHS ' + Number(n || 0).toFixed(2)
      const dateStr = (d: Date) => d.toISOString().slice(0, 10)

      const getSales = async (from: string, to: string) => {
        const { data } = await supabase.from('sales').select('*').gte('date', from + 'T00:00:00').lte('date', to + 'T23:59:59').eq('voided', false)
        const s = data || []
        return {
          revenue: s.reduce((a: number, x: any) => a + Number(x.total || 0), 0),
          profit: s.reduce((a: number, x: any) => a + Number(x.profit || 0), 0),
          cash: s.filter((x: any) => x.payment === 'Cash').reduce((a: number, x: any) => a + Number(x.total || 0), 0),
          momo: s.filter((x: any) => x.payment === 'Momo' || x.payment === 'Paystack').reduce((a: number, x: any) => a + Number(x.total || 0), 0),
          split: s.filter((x: any) => x.payment === 'Split').reduce((a: number, x: any) => a + Number(x.total || 0), 0),
          count: s.length, sales: s
        }
      }

      const getExpenses = async (from: string, to: string) => {
        const { data } = await supabase.from('expenses').select('*').gte('date', from + 'T00:00:00').lte('date', to + 'T23:59:59')
        const e = data || []
        return { total: e.reduce((a: number, x: any) => a + Number(x.amount || 0), 0), count: e.length }
      }

      const getWAOrders = async (from: string, to: string) => {
        const { data } = await supabase.from('whatsapp_orders').select('status,total').gte('date', from + 'T00:00:00').lte('date', to + 'T23:59:59')
        const o = data || []
        return {
          total: o.length,
          pending: o.filter((x: any) => x.status === 'Pending').length,
          paid: o.filter((x: any) => x.status === 'Paid').length,
          completed: o.filter((x: any) => x.status === 'Completed').length,
          cancelled: o.filter((x: any) => x.status === 'Cancelled').length,
          revenue: o.filter((x: any) => x.status === 'Paid' || x.status === 'Completed').reduce((a: number, x: any) => a + Number(x.total || 0), 0),
        }
      }

      const getLowStock = async () => {
        const { data } = await supabase.from('products').select('name,quantity').lte('quantity', 5).order('quantity', { ascending: true }).limit(10)
        return data || []
      }

      const getTopSellers = (sales: any[]) => {
        const map: Record<string, { qty: number, rev: number }> = {}
        for (const s of sales) {
          const items = typeof s.items === 'string' ? JSON.parse(s.items) : (s.items || [])
          for (const it of items) {
            const n = it.name || 'Unknown'
            if (!map[n]) map[n] = { qty: 0, rev: 0 }
            map[n].qty += Number(it.qty || 1)
            map[n].rev += Number(it.price || 0) * Number(it.qty || 1)
          }
        }
        return Object.entries(map).sort((a, b) => b[1].qty - a[1].qty).slice(0, 5)
      }

      let message = ''
      const today = dateStr(new Date())

      if (type === 'daily' || type === 'morning') {
        const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1)
        const yd = dateStr(yesterday)
        const dayName = yesterday.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' })
        const sales = await getSales(yd, yd)
        const expenses = await getExpenses(yd, yd)
        const wa = await getWAOrders(yd, yd)
        const topSellers = getTopSellers(sales.sales)
        const lowStock = await getLowStock()

        message = `EVERYTINROOM\nDaily Report (${dayName})\n\n`
        message += `SALES\nRevenue: ${fmt(sales.revenue)}\nTotal Sales: ${sales.count}\nProfit: ${fmt(sales.profit)}\nNet: ${fmt(sales.profit - expenses.total)}\n\n`
        message += `PAYMENT\nCash: ${fmt(sales.cash)}\nMoMo: ${fmt(sales.momo)}\n`
        if (sales.split > 0) message += `Split: ${fmt(sales.split)}\n`
        message += `\nWHATSAPP ORDERS\nTotal: ${wa.total}\nPaid: ${wa.paid}\nPending: ${wa.pending}\nCompleted: ${wa.completed}\nOnline Revenue: ${fmt(wa.revenue)}\n`
        message += `\nEXPENSES: ${fmt(expenses.total)} (${expenses.count})\n`
        if (topSellers.length > 0) { message += `\nTOP SELLERS:\n`; topSellers.forEach(([n, d]: any, i: number) => { message += `${i+1}. ${n} (${d.qty})\n` }) }
        if (lowStock.length > 0) { message += `\nLOW STOCK:\n`; lowStock.forEach((p: any) => { message += `- ${p.name}: ${p.quantity} left\n` }) }
        message += `\n- EVERYTINROOM POS`
      }

      else if (type === 'afternoon' || type === 'today') {
        const sales = await getSales(today, today)
        const expenses = await getExpenses(today, today)
        const wa = await getWAOrders(today, today)

        message = `EVERYTINROOM\nToday So Far\n\n`
        message += `Revenue: ${fmt(sales.revenue)}\nSales: ${sales.count}\nProfit: ${fmt(sales.profit)}\n\n`
        message += `Cash: ${fmt(sales.cash)}\nMoMo: ${fmt(sales.momo)}\n`
        message += `\nWhatsApp Orders: ${wa.total}\nPaid: ${wa.paid} | Pending: ${wa.pending}\nOnline Revenue: ${fmt(wa.revenue)}\n`
        message += `\nExpenses: ${fmt(expenses.total)}\nNet: ${fmt(sales.profit - expenses.total)}\n`
        if (sales.count === 0) message += `\nNo sales yet. Let's push!\n`
        message += `\n- EVERYTINROOM POS`
      }

      else if (type === 'evening' || type === 'endofday') {
        const sales = await getSales(today, today)
        const expenses = await getExpenses(today, today)
        const wa = await getWAOrders(today, today)
        const topSellers = getTopSellers(sales.sales)
        const lowStock = await getLowStock()

        message = `EVERYTINROOM\nEnd of Day Report\n${new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}\n\n`
        message += `SALES\nRevenue: ${fmt(sales.revenue)}\nTotal Sales: ${sales.count}\nProfit: ${fmt(sales.profit)}\nExpenses: ${fmt(expenses.total)} (${expenses.count})\nNet Profit: ${fmt(sales.profit - expenses.total)}\n\n`
        message += `PAYMENT\nCash: ${fmt(sales.cash)}\nMoMo: ${fmt(sales.momo)}\n`
        if (sales.split > 0) message += `Split: ${fmt(sales.split)}\n`
        message += `\nWHATSAPP/USSD ORDERS\nTotal: ${wa.total}\nPaid: ${wa.paid} (${fmt(wa.revenue)})\nPending: ${wa.pending}\nCompleted: ${wa.completed}\n`
        if (topSellers.length > 0) { message += `\nBEST SELLERS:\n`; topSellers.forEach(([n, d]: any, i: number) => { message += `${i+1}. ${n} x${d.qty}\n` }) }
        if (lowStock.length > 0) { message += `\nLOW STOCK:\n`; lowStock.forEach((p: any) => { message += `- ${p.name}: ${p.quantity}\n` }) }
        message += `\nDay closed. Well done!\n- EVERYTINROOM POS`
      }

      else if (type === 'weekly') {
        const now = new Date()
        const mon = new Date(now); mon.setDate(now.getDate() - 7 - ((now.getDay() + 6) % 7))
        const sun = new Date(mon); sun.setDate(mon.getDate() + 6)
        const from = dateStr(mon), to = dateStr(sun)
        const sales = await getSales(from, to)
        const expenses = await getExpenses(from, to)
        const wa = await getWAOrders(from, to)
        const topSellers = getTopSellers(sales.sales)
        const lowStock = await getLowStock()

        message = `EVERYTINROOM\nWEEKLY REPORT\n${mon.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} - ${sun.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}\n\n`
        message += `Revenue: ${fmt(sales.revenue)}\nSales: ${sales.count}\nProfit: ${fmt(sales.profit)}\nExpenses: ${fmt(expenses.total)}\nNet: ${fmt(sales.profit - expenses.total)}\nAvg/Day: ${fmt(sales.revenue / 7)}\n\n`
        message += `Cash: ${fmt(sales.cash)}\nMoMo: ${fmt(sales.momo)}\n`
        message += `\nWhatsApp/USSD: ${wa.total} orders\nPaid: ${wa.paid} | Pending: ${wa.pending}\nOnline Revenue: ${fmt(wa.revenue)}\n`
        if (topSellers.length > 0) { message += `\nTOP 5:\n`; topSellers.forEach(([n, d]: any, i: number) => { message += `${i+1}. ${n} x${d.qty}\n` }) }
        if (lowStock.length > 0) { message += `\nRESTOCK:\n`; lowStock.forEach((p: any) => { message += `- ${p.name}: ${p.quantity}\n` }) }
        message += `\nNew week, new targets!\n- EVERYTINROOM POS`
      }

      else if (type === 'monthly') {
        const now = new Date()
        const firstDay = new Date(now.getFullYear(), now.getMonth() - 1, 1)
        const lastDay = new Date(now.getFullYear(), now.getMonth(), 0)
        const from = dateStr(firstDay), to = dateStr(lastDay)
        const monthName = firstDay.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
        const sales = await getSales(from, to)
        const expenses = await getExpenses(from, to)
        const wa = await getWAOrders(from, to)
        const topSellers = getTopSellers(sales.sales)
        const lowStock = await getLowStock()
        const days = lastDay.getDate()

        message = `EVERYTINROOM\nMONTHLY REPORT\n${monthName}\n\n`
        message += `SALES\nRevenue: ${fmt(sales.revenue)}\nTotal Sales: ${sales.count}\nProfit: ${fmt(sales.profit)}\nExpenses: ${fmt(expenses.total)}\nNet Profit: ${fmt(sales.profit - expenses.total)}\nAvg/Day: ${fmt(sales.revenue / days)}\n\n`
        message += `PAYMENT\nCash: ${fmt(sales.cash)}\nMoMo: ${fmt(sales.momo)}\n`
        message += `\nONLINE ORDERS\nTotal: ${wa.total}\nPaid: ${wa.paid}\nPending: ${wa.pending}\nCompleted: ${wa.completed}\nCancelled: ${wa.cancelled}\nOnline Revenue: ${fmt(wa.revenue)}\n`
        if (topSellers.length > 0) { message += `\nTOP SELLERS:\n`; topSellers.forEach(([n, d]: any, i: number) => { message += `${i+1}. ${n} x${d.qty} (${fmt(d.rev)})\n` }) }
        if (lowStock.length > 0) { message += `\nLOW STOCK:\n`; lowStock.forEach((p: any) => { message += `- ${p.name}: ${p.quantity}\n` }) }
        message += `\n- EVERYTINROOM POS`
      }

      else if (type === 'test') {
        message = `EVERYTINROOM SMS Reports Active!\n\nReports available:\n- daily (yesterday)\n- today (so far)\n- evening (end of day)\n- weekly (last week)\n- monthly (last month)\n\nSent to: ${ADMIN_PHONES.join(', ')}\n\n- EVERYTINROOM POS`
      }

      else {
        return new Response(JSON.stringify({ status: 'ok', usage: '?action=report&type=daily|today|evening|weekly|monthly|test' }), { headers: CORS })
      }

      await sendSMS(ADMIN_PHONES.join(','), message)
      return new Response(JSON.stringify({ status: 'sent', type, recipients: ADMIN_PHONES, messageLength: message.length }), { headers: CORS })
    }

    return new Response(JSON.stringify({ error: 'Use ?action=initialize, charge, verify, ussd, or webhook' }), { headers: CORS })
  } catch (e) {
    console.error('Error:', e)
    return new Response(JSON.stringify({ success: false, error: e.message }), { status: 500, headers: CORS })
  }
})
