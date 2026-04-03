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

    // ==================== USSD (Nalo Solutions) ====================
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

      // Nalo params (now we know the exact names):
      // USERID, MSISDN, USERDATA, MSGTYPE, NETWORK, SESSIONID
      const sessionId = allParams.SESSIONID || allParams.sessionid || allParams.SessionId || ''
      const phone = allParams.MSISDN || allParams.msisdn || ''
      const userData = allParams.USERDATA || allParams.userdata || allParams.UserData || ''
      const msgType = allParams.MSGTYPE || allParams.msgtype || ''

      console.log(`session=${sessionId} phone=${phone} userData=${userData} msgType=${msgType}`)

      // USERDATA contains:
      // First request: "*920*141*50032" (full dial string with order code)
      // Second request: "1" or "2" (just the user's menu selection)
      // If user dials *920*141# without order: "" or "*920*141"

      // Check if USERDATA is a menu selection (1 or 2)
      const isMenuChoice = userData === '1' || userData === '2'

      // Extract order code from USERDATA if it contains the full dial string
      let orderCode = ''
      if (!isMenuChoice && userData) {
        const parts = userData.replace(/#/g, '').split('*').filter(Boolean)
        const idx = parts.indexOf('141')
        if (idx >= 0 && parts[idx + 1] && /^\d+$/.test(parts[idx + 1])) {
          orderCode = parts[idx + 1]
        }
        // Also check if userData itself is a 4-6 digit order code
        if (!orderCode && /^\d{4,6}$/.test(userData.trim())) {
          orderCode = userData.trim()
        }
      }

      // If this is a menu choice (1 or 2), get order code from DB session
      if (isMenuChoice && sessionId) {
        const { data: sess } = await supabase.from('ussd_sessions').select('order_code').eq('session_id', sessionId).single()
        if (sess?.order_code && sess.order_code !== 'LOG') {
          orderCode = String(sess.order_code)
          console.log('Session found, order:', orderCode, 'choice:', userData)
        }
      }

      // If we still don't have order code, check session anyway
      if (!orderCode && sessionId) {
        const { data: sess } = await supabase.from('ussd_sessions').select('order_code').eq('session_id', sessionId).single()
        if (sess?.order_code && sess.order_code !== 'LOG') orderCode = String(sess.order_code)
      }

      // No order code — ask for it
      if (!orderCode) {
        return ussdCon(`Welcome to ${SHOP}\nPlease enter your Order Code:`)
      }

      // Save session
      if (sessionId && orderCode) {
        await supabase.from('ussd_sessions').upsert({
          session_id: sessionId, order_code: orderCode, phone, updated_at: new Date().toISOString()
        }, { onConflict: 'session_id' })
      }

      // Look up order
      const { data: order } = await supabase.from('whatsapp_orders')
        .select('id,order_no,total,status,customer_name,customer_phone,ussd_code')
        .eq('ussd_code', parseInt(orderCode)).single()

      if (!order) return ussdEnd(`Order ${orderCode} not found.\nCheck and try again.`)
      if (order.status === 'Paid' || order.status === 'Completed') return ussdEnd(`Order ${order.order_no} already paid.\nThank you!`)
      if (order.status === 'Cancelled') return ussdEnd(`Order ${order.order_no} cancelled.\nCall: 024 531 5581`)

      const total = Number(order.total).toFixed(2)

      // === PAY NOW ===
      if (userData === '1') {
        let fp = phone.replace(/\s+/g, '').replace(/^0/, '233').replace(/^\+/, '')
        if (!fp.startsWith('233')) fp = '233' + fp
        const ref = `USSD-${order.ussd_code}-${Date.now().toString(36).toUpperCase()}`

        try {
          const cr = await fetch('https://api.paystack.co/charge', {
            method: 'POST', headers: { 'Authorization': 'Bearer ' + PAYSTACK_SECRET, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              email: fp + '@everytinroom.shop', amount: Math.round(Number(order.total) * 100), currency: 'GHS',
              mobile_money: { phone: fp, provider: 'mtn' }, reference: ref,
              metadata: { source: 'ussd', order_id: order.id, order_no: order.order_no, ussd_code: order.ussd_code, customer_phone: phone,
                custom_fields: [{ display_name: 'Order', variable_name: 'order_no', value: order.order_no }] },
            }),
          })
          const cd = await cr.json()
          console.log('Paystack:', JSON.stringify(cd).slice(0, 300))

          await supabase.from('whatsapp_orders').update({ paystack_ref: ref, customer_phone: phone }).eq('id', order.id)
          if (sessionId) await supabase.from('ussd_sessions').delete().eq('session_id', sessionId)

          if (cd.status) return ussdEnd(`Payment of GHS ${total} initiated!\n\nCheck your phone for MoMo prompt.\n\nOrder: ${order.order_no}\nThank you!`)

          // Fallback
          const ir = await fetch('https://api.paystack.co/transaction/initialize', {
            method: 'POST', headers: { 'Authorization': 'Bearer ' + PAYSTACK_SECRET, 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: fp + '@everytinroom.shop', amount: Math.round(Number(order.total) * 100), currency: 'GHS', reference: ref, channels: ['mobile_money'],
              metadata: { source: 'ussd', order_id: order.id, order_no: order.order_no, ussd_code: order.ussd_code, customer_phone: phone } }),
          })
          const id = await ir.json()
          if (id.status) return ussdEnd(`GHS ${total} for ${order.order_no}\nPayment link sent.\nThank you!`)
          return ussdEnd(`Payment failed. Call 024 531 5581`)
        } catch (e) { console.error('Pay error:', e); return ussdEnd(`Payment error. Call 024 531 5581`) }
      }

      // === CANCEL ===
      if (userData === '2') {
        if (sessionId) await supabase.from('ussd_sessions').delete().eq('session_id', sessionId)
        return ussdEnd(`Cancelled.\nDial *920*141*${orderCode}# anytime.`)
      }

      // === SHOW ORDER ===
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

    return new Response(JSON.stringify({ error: 'Use ?action=initialize, charge, verify, or ussd' }), { headers: CORS })
  } catch (e) {
    return new Response(JSON.stringify({ success: false, error: e.message }), { status: 500, headers: CORS })
  }
})
