import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const PAYSTACK_SECRET = Deno.env.get('PAYSTACK_SECRET_KEY') || ''
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || 'https://noiiuwkovoojkcwzupye.supabase.co'
const SUPABASE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const SHOP = 'EVERYTINROOM&BEDTIME'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Content-Type': 'application/json',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const url = new URL(req.url)
    const action = url.searchParams.get('action')

    // ==================== ACTION: USSD ====================
    if (action === 'ussd') {
      let params: Record<string, string> = {}
      for (const [k, v] of url.searchParams) params[k.toUpperCase()] = v

      if (req.method === 'POST') {
        try {
          const ct = req.headers.get('content-type') || ''
          if (ct.includes('json')) {
            const j = await req.json()
            for (const [k, v] of Object.entries(j)) params[String(k).toUpperCase()] = String(v)
          } else {
            const text = await req.text()
            try { const j = JSON.parse(text); for (const [k, v] of Object.entries(j)) params[String(k).toUpperCase()] = String(v) }
            catch { for (const [k, v] of new URLSearchParams(text)) params[k.toUpperCase()] = v }
          }
        } catch {}
      }

      const sessionId = params.SESSIONID || params.SESSION_ID || ''
      const phone = params.MSISDN || params.MOBILENO || params.MOBILE || ''
      const ussdCode = params.USSDCODE || params.USERDATA || params.SERVICESCODE || params.SERVICECODE || ''
      const userInput = params.USSDSTRING || params.INPUT || params.MSG || params.MESSAGE || params.TEXT || ''

      console.log(`USSD: session=${sessionId} phone=${phone} code=${ussdCode} input=${userInput}`)

      const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

      const ussdCon = (msg: string) => new Response(JSON.stringify({ MSGTYPE: true, MSG: msg, USSDMSG: msg }), { headers: { 'Content-Type': 'application/json' } })
      const ussdEnd = (msg: string) => new Response(JSON.stringify({ MSGTYPE: false, MSG: msg, USSDMSG: msg }), { headers: { 'Content-Type': 'application/json' } })

      // STEP 1: Extract order code from dialed string *920*141*50001#
      let orderCode = ''
      if (ussdCode) {
        const parts = ussdCode.replace(/#/g, '').split('*').filter(Boolean)
        const idx = parts.indexOf('141')
        if (idx >= 0 && parts[idx + 1] && /^\d+$/.test(parts[idx + 1])) orderCode = parts[idx + 1]
        if (!orderCode) { const m = ussdCode.match(/141\*(\d+)/); if (m) orderCode = m[1] }
      }

      // STEP 2: Check DB for saved session (edge functions are stateless!)
      if (!orderCode && sessionId) {
        const { data: sess } = await supabase.from('ussd_sessions').select('order_code').eq('session_id', sessionId).single()
        if (sess?.order_code) orderCode = String(sess.order_code)
      }

      // STEP 3: If user typed a 4-6 digit number, treat as order code
      if (!orderCode && userInput && /^\d{4,6}$/.test(userInput.trim())) {
        orderCode = userInput.trim()
      }

      // STEP 4: No order code at all — ask for it
      if (!orderCode) {
        return ussdCon(`Welcome to ${SHOP}\nPlease enter your Order Code:`)
      }

      // STEP 5: Save session to DB so we remember on next request
      if (sessionId) {
        await supabase.from('ussd_sessions').upsert({ session_id: sessionId, order_code: orderCode, phone: phone, updated_at: new Date().toISOString() }, { onConflict: 'session_id' })
      }

      // STEP 6: Look up order
      const { data: order, error: dbErr } = await supabase.from('whatsapp_orders')
        .select('id,order_no,total,status,customer_name,customer_phone,ussd_code,paystack_ref')
        .eq('ussd_code', parseInt(orderCode)).single()

      if (dbErr || !order) return ussdEnd(`Order ${orderCode} not found.\nCheck the code and try again.`)
      if (order.status === 'Paid' || order.status === 'Completed') return ussdEnd(`Order ${order.order_no} already paid.\nThank you!`)
      if (order.status === 'Cancelled') return ussdEnd(`Order ${order.order_no} cancelled.\nContact: 024 531 5581`)

      const total = Number(order.total).toFixed(2)
      const lastInput = userInput.trim()

      // User pressed 1 = Pay Now
      if (lastInput === '1') {
        let fp = phone.replace(/\s+/g, '').replace(/^0/, '233').replace(/^\+/, '')
        if (!fp.startsWith('233')) fp = '233' + fp
        const ref = `USSD-${order.ussd_code}-${Date.now().toString(36).toUpperCase()}`
        try {
          const chargeRes = await fetch('https://api.paystack.co/charge', {
            method: 'POST', headers: { 'Authorization': 'Bearer ' + PAYSTACK_SECRET, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              email: fp + '@everytinroom.shop', amount: Math.round(Number(order.total) * 100), currency: 'GHS',
              mobile_money: { phone: fp, provider: 'mtn' }, reference: ref,
              metadata: { source: 'ussd', order_id: order.id, order_no: order.order_no, ussd_code: order.ussd_code, customer_phone: phone,
                custom_fields: [{ display_name: 'Order', variable_name: 'order_no', value: order.order_no }] },
            }),
          })
          const cd = await chargeRes.json()
          console.log('Paystack:', JSON.stringify(cd).slice(0, 300))
          if (cd.status) {
            await supabase.from('whatsapp_orders').update({ paystack_ref: ref, customer_phone: phone }).eq('id', order.id)
            if (sessionId) await supabase.from('ussd_sessions').delete().eq('session_id', sessionId)
            return ussdEnd(`Payment of GHS ${total} initiated!\n\nCheck your phone for MoMo prompt.\n\nOrder: ${order.order_no}\nThank you!`)
          }
          const initRes = await fetch('https://api.paystack.co/transaction/initialize', {
            method: 'POST', headers: { 'Authorization': 'Bearer ' + PAYSTACK_SECRET, 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: fp + '@everytinroom.shop', amount: Math.round(Number(order.total) * 100), currency: 'GHS', reference: ref, channels: ['mobile_money'],
              metadata: { source: 'ussd', order_id: order.id, order_no: order.order_no, ussd_code: order.ussd_code, customer_phone: phone } }),
          })
          const id = await initRes.json()
          if (id.status) {
            await supabase.from('whatsapp_orders').update({ paystack_ref: id.data?.reference || ref, customer_phone: phone }).eq('id', order.id)
            if (sessionId) await supabase.from('ussd_sessions').delete().eq('session_id', sessionId)
            return ussdEnd(`GHS ${total} for ${order.order_no}\nPayment link sent.\nThank you!`)
          }
          return ussdEnd(`Payment failed. Call 024 531 5581`)
        } catch (e) { console.error('USSD pay error:', e); return ussdEnd(`Payment error. Call 024 531 5581`) }
      }

      // User pressed 2 = Cancel
      if (lastInput === '2') {
        if (sessionId) await supabase.from('ussd_sessions').delete().eq('session_id', sessionId)
        return ussdEnd(`Cancelled.\nDial *920*141*${orderCode}# anytime to pay.`)
      }

      // Show order details
      const name = order.customer_name ? `\n${order.customer_name}` : ''
      return ussdCon(`${SHOP}${name}\nOrder: ${order.order_no}\n\nTotal: GHS ${total}\n\n1. Pay Now\n2. Cancel`)
    }

    // ==================== ACTION: Initialize ====================
    if (action === 'initialize') {
      const { phone, amount, email, reference, callbackUrl } = await req.json()
      if (!phone || !amount) return new Response(JSON.stringify({ success: false, error: 'Phone and amount required' }), { headers: CORS })
      let formattedPhone = phone.replace(/\s+/g, '').replace(/^0/, '233').replace(/^\+/, '')
      if (!formattedPhone.startsWith('233')) formattedPhone = '233' + formattedPhone
      const ref = reference || 'ETR-MOMO-' + Date.now().toString(36).toUpperCase()
      const customerEmail = email || formattedPhone + '@everytinroom.shop'
      const initRes = await fetch('https://api.paystack.co/transaction/initialize', { method: 'POST', headers: { 'Authorization': 'Bearer ' + PAYSTACK_SECRET, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: customerEmail, amount: Math.round(amount * 100), currency: 'GHS', reference: ref, channels: ['mobile_money'], callback_url: callbackUrl || 'https://everytinroom-pos.vercel.app',
          metadata: { source: 'everytinroom-pos', phone, custom_fields: [{ display_name: 'Phone', variable_name: 'phone', value: phone }] } }) })
      const initData = await initRes.json()
      if (!initData.status) return new Response(JSON.stringify({ success: false, error: initData.message || 'Init failed' }), { headers: CORS })
      return new Response(JSON.stringify({ success: true, authorizationUrl: initData.data?.authorization_url, accessCode: initData.data?.access_code, reference: initData.data?.reference || ref }), { headers: CORS })
    }

    // ==================== ACTION: Charge ====================
    if (action === 'charge') {
      const { phone, amount, email, reference } = await req.json()
      if (!phone || !amount) return new Response(JSON.stringify({ success: false, error: 'Phone and amount required' }), { headers: CORS })
      let formattedPhone = phone.replace(/\s+/g, '').replace(/^0/, '233').replace(/^\+/, '')
      if (!formattedPhone.startsWith('233')) formattedPhone = '233' + formattedPhone
      const ref = reference || 'ETR-MOMO-' + Date.now().toString(36).toUpperCase()
      const customerEmail = email || formattedPhone + '@everytinroom.shop'
      const chargeRes = await fetch('https://api.paystack.co/charge', { method: 'POST', headers: { 'Authorization': 'Bearer ' + PAYSTACK_SECRET, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: customerEmail, amount: Math.round(amount * 100), currency: 'GHS', mobile_money: { phone: formattedPhone, provider: 'mtn' }, reference: ref, metadata: { source: 'everytinroom-pos', phone } }) })
      const chargeData = await chargeRes.json()
      if (!chargeData.status) return new Response(JSON.stringify({ success: false, error: chargeData.message || 'Charge failed' }), { headers: CORS })
      return new Response(JSON.stringify({ success: true, reference: chargeData.data?.reference || ref, status: chargeData.data?.status, displayText: chargeData.data?.display_text || 'Check your phone' }), { headers: CORS })
    }

    // ==================== ACTION: Verify ====================
    if (action === 'verify') {
      const { reference } = await req.json()
      if (!reference) return new Response(JSON.stringify({ success: false, error: 'Reference required' }), { headers: CORS })
      const verifyRes = await fetch('https://api.paystack.co/transaction/verify/' + encodeURIComponent(reference), { headers: { 'Authorization': 'Bearer ' + PAYSTACK_SECRET } })
      const verifyData = await verifyRes.json()
      return new Response(JSON.stringify({ success: verifyData.status || false, paymentStatus: verifyData.data?.status || 'unknown', amount: (verifyData.data?.amount || 0) / 100, reference: verifyData.data?.reference, paidAt: verifyData.data?.paid_at, message: verifyData.message }), { headers: CORS })
    }

    return new Response(JSON.stringify({ error: 'Use ?action=initialize, charge, verify, or ussd' }), { headers: CORS })
  } catch (e) {
    return new Response(JSON.stringify({ success: false, error: e.message }), { status: 500, headers: CORS })
  }
})
