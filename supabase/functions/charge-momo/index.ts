import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const PAYSTACK_SECRET = Deno.env.get('PAYSTACK_SECRET_KEY') || ''
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || 'https://noiiuwkovoojkcwzupye.supabase.co'
const SUPABASE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const MNOTIFY_API_KEY = Deno.env.get('MNOTIFY_API_KEY') || ''
const MNOTIFY_SENDER_ID = Deno.env.get('MNOTIFY_SENDER_ID') || 'EverytinRM'
const SHOP = 'EVERYTINROOM&BEDTIME'

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

      // Match by metadata order_id (USSD payments)
      if (meta.source === 'ussd' && meta.order_id) {
        await supabase.from('whatsapp_orders').update({
          status: 'Paid', paystack_ref: ref,
          paid_at: pd.paid_at || new Date().toISOString(),
          customer_phone: meta.customer_phone || pd.customer?.phone || ''
        }).eq('id', meta.order_id)
        console.log('USSD payment OK:', meta.order_no)
        try { await sendSMS('0533547740,0203600855,0554808341', `USSD Payment! ${meta.order_no} GHS ${(pd.amount/100).toFixed(2)} Paid`) } catch {}
        return new Response(JSON.stringify({ success: true, type: 'ussd' }), { headers: { 'Content-Type': 'application/json' } })
      }

      // Match by USSD reference prefix
      if (ref.startsWith('USSD-')) {
        const { data: o } = await supabase.from('whatsapp_orders').select('id,order_no').eq('paystack_ref', ref).single()
        if (o) {
          await supabase.from('whatsapp_orders').update({ status: 'Paid', paid_at: pd.paid_at || new Date().toISOString() }).eq('id', o.id)
          console.log('USSD ref match:', o.order_no)
          try { await sendSMS('0533547740,0203600855,0554808341', `USSD Payment! ${o.order_no} GHS ${(pd.amount/100).toFixed(2)} Paid`) } catch {}
          return new Response(JSON.stringify({ success: true, type: 'ussd-ref' }), { headers: { 'Content-Type': 'application/json' } })
        }
      }

      // Match any order by ref
      if (ref) {
        const { data: o } = await supabase.from('whatsapp_orders').select('id,order_no').eq('paystack_ref', ref).single()
        if (o) {
          await supabase.from('whatsapp_orders').update({ status: 'Paid', paid_at: pd.paid_at || new Date().toISOString() }).eq('id', o.id)
          console.log('Ref match:', o.order_no)
          try { await sendSMS('0533547740,0203600855,0554808341', `Payment! ${o.order_no} GHS ${(pd.amount/100).toFixed(2)} Paid`) } catch {}
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
      try { await sendSMS('0533547740,0203600855,0554808341', `New Order! ${orderNo} GHS ${total.toFixed(2)} Paid`) } catch {}
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

        try {
          const cr = await fetch('https://api.paystack.co/charge', {
            method: 'POST', headers: { 'Authorization': 'Bearer ' + PAYSTACK_SECRET, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              email: fp + '@everytinroom.shop', amount: Math.round(Number(order.total) * 100), currency: 'GHS',
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

    return new Response(JSON.stringify({ error: 'Use ?action=initialize, charge, verify, ussd, or webhook' }), { headers: CORS })
  } catch (e) {
    console.error('Error:', e)
    return new Response(JSON.stringify({ success: false, error: e.message }), { status: 500, headers: CORS })
  }
})
