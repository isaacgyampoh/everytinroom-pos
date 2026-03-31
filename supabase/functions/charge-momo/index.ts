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
      // Collect ALL params from everywhere
      const allParams: Record<string, string> = {}
      
      // From URL query
      for (const [k, v] of url.searchParams) allParams[k] = v

      // From POST body
      let rawBody = ''
      if (req.method === 'POST') {
        rawBody = await req.text()
        try {
          const j = JSON.parse(rawBody)
          for (const [k, v] of Object.entries(j)) allParams[String(k)] = String(v)
        } catch {
          for (const [k, v] of new URLSearchParams(rawBody)) allParams[k] = v
        }
      }

      // LOG EVERYTHING - this will show in Supabase Edge Function logs
      console.log('========= NALO REQUEST =========')
      console.log('METHOD:', req.method)
      console.log('ALL PARAMS:', JSON.stringify(allParams))
      console.log('RAW BODY:', rawBody)
      console.log('================================')

      // Save the full log to database for easy viewing
      const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)
      await supabase.from('ussd_sessions').upsert({
        session_id: 'debug_' + Date.now(),
        order_code: 'LOG',
        phone: JSON.stringify(allParams),
        updated_at: new Date().toISOString()
      }, { onConflict: 'session_id' })

      // Find values case-insensitively
      const find = (...keys: string[]) => {
        for (const k of keys) {
          for (const [pk, pv] of Object.entries(allParams)) {
            if (pk.toLowerCase() === k.toLowerCase() && pv) return pv
          }
        }
        return ''
      }

      const sessionId = find('SESSIONID', 'SESSION_ID', 'sessionId', 'session_id')
      const phone = find('MSISDN', 'msisdn', 'MOBILENO', 'mobileno', 'MOBILE', 'mobile')
      const ussdCode = find('USSDCODE', 'ussdcode', 'USERDATA', 'userdata', 'SERVICECODE', 'servicecode')
      const userInput = find('USSDSTRING', 'ussdstring', 'INPUT', 'input', 'MSG', 'msg', 'MESSAGE', 'message', 'TEXT', 'text')
      const msgType = find('MSGTYPE', 'msgtype')

      console.log(`Parsed: session=${sessionId} phone=${phone} code=${ussdCode} input=${userInput} msgtype=${msgType}`)

      const ussdCon = (msg: string) => new Response(JSON.stringify({ MSGTYPE: true, MSG: msg, USSDMSG: msg }), { headers: { 'Content-Type': 'application/json' } })
      const ussdEnd = (msg: string) => new Response(JSON.stringify({ MSGTYPE: false, MSG: msg, USSDMSG: msg }), { headers: { 'Content-Type': 'application/json' } })

      // Extract order code from USSDCODE: *920*141*50001# -> 50001
      let orderCode = ''
      if (ussdCode) {
        const parts = ussdCode.replace(/#/g, '').split('*').filter(Boolean)
        const idx = parts.indexOf('141')
        if (idx >= 0 && parts[idx + 1] && /^\d+$/.test(parts[idx + 1])) orderCode = parts[idx + 1]
      }

      // Check DB session FIRST (before checking userInput)
      let dbSession: any = null
      if (sessionId) {
        const { data } = await supabase.from('ussd_sessions').select('*').eq('session_id', sessionId).single()
        dbSession = data
        if (data?.order_code && data.order_code !== 'LOG') {
          orderCode = String(data.order_code)
          console.log('Found session in DB, orderCode:', orderCode)
        }
      }

      // If we have an order code from session, and user typed 1 or 2, handle it
      if (orderCode && (userInput === '1' || userInput === '2')) {
        // Look up order
        const { data: order } = await supabase.from('whatsapp_orders')
          .select('id,order_no,total,status,customer_name,customer_phone,ussd_code')
          .eq('ussd_code', parseInt(orderCode)).single()

        if (!order) return ussdEnd(`Order not found.`)
        if (order.status === 'Paid' || order.status === 'Completed') return ussdEnd(`Order ${order.order_no} already paid.\nThank you!`)
        if (order.status === 'Cancelled') return ussdEnd(`Order ${order.order_no} cancelled.`)

        const total = Number(order.total).toFixed(2)

        if (userInput === '1') {
          // PAY NOW
          let fp = phone.replace(/\s+/g, '').replace(/^0/, '233').replace(/^\+/, '')
          if (!fp.startsWith('233')) fp = '233' + fp
          const ref = `USSD-${order.ussd_code}-${Date.now().toString(36).toUpperCase()}`

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

          await supabase.from('whatsapp_orders').update({ paystack_ref: ref, customer_phone: phone }).eq('id', order.id)
          if (sessionId) await supabase.from('ussd_sessions').delete().eq('session_id', sessionId)

          if (cd.status) {
            return ussdEnd(`Payment of GHS ${total} initiated!\n\nCheck your phone for MoMo prompt.\n\nOrder: ${order.order_no}\nThank you!`)
          }

          // Fallback
          const initRes = await fetch('https://api.paystack.co/transaction/initialize', {
            method: 'POST', headers: { 'Authorization': 'Bearer ' + PAYSTACK_SECRET, 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: fp + '@everytinroom.shop', amount: Math.round(Number(order.total) * 100), currency: 'GHS', reference: ref, channels: ['mobile_money'],
              metadata: { source: 'ussd', order_id: order.id, order_no: order.order_no, ussd_code: order.ussd_code, customer_phone: phone } }),
          })
          const id = await initRes.json()
          if (id.status) return ussdEnd(`GHS ${total} for ${order.order_no}\nPayment link sent.\nThank you!`)
          return ussdEnd(`Payment failed. Call 024 531 5581`)
        }

        if (userInput === '2') {
          if (sessionId) await supabase.from('ussd_sessions').delete().eq('session_id', sessionId)
          return ussdEnd(`Cancelled.\nDial *920*141*${orderCode}# anytime.`)
        }
      }

      // If no order code yet, check if userInput is a 4-6 digit order code
      if (!orderCode && userInput && /^\d{4,6}$/.test(userInput.trim())) {
        orderCode = userInput.trim()
      }

      // Still no order code — ask
      if (!orderCode) {
        return ussdCon(`Welcome to ${SHOP}\nPlease enter your Order Code:`)
      }

      // Save to DB session
      if (sessionId) {
        await supabase.from('ussd_sessions').upsert({
          session_id: sessionId, order_code: orderCode, phone: phone, updated_at: new Date().toISOString()
        }, { onConflict: 'session_id' })
        console.log('Saved session:', sessionId, '->', orderCode)
      }

      // Look up and show order
      const { data: order } = await supabase.from('whatsapp_orders')
        .select('id,order_no,total,status,customer_name,ussd_code')
        .eq('ussd_code', parseInt(orderCode)).single()

      if (!order) return ussdEnd(`Order ${orderCode} not found.\nCheck the code and try again.`)
      if (order.status === 'Paid' || order.status === 'Completed') return ussdEnd(`Order ${order.order_no} already paid.\nThank you!`)
      if (order.status === 'Cancelled') return ussdEnd(`Order ${order.order_no} cancelled.\nContact: 024 531 5581`)

      const total = Number(order.total).toFixed(2)
      const name = order.customer_name ? `\n${order.customer_name}` : ''
      return ussdCon(`${SHOP}${name}\nOrder: ${order.order_no}\n\nTotal: GHS ${total}\n\n1. Pay Now\n2. Cancel`)
    }

    // ==================== ACTION: Initialize ====================
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

    // ==================== ACTION: Charge ====================
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

    // ==================== ACTION: Verify ====================
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
