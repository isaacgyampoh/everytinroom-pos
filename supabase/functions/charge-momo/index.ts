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

      // Get session from DB
      let sess: any = null
      if (sessionId) {
        const { data } = await supabase.from('ussd_sessions').select('*').eq('session_id', sessionId).single()
        sess = data
      }

      const step = sess?.step || ''
      const isMenuChoice = userData === '1' || userData === '2'

      // === STEP: WAITING FOR OTP ===
      // If session step is 'otp', the user is entering the OTP code
      if (step === 'otp' && userData && sess?.order_code && sess?.paystack_ref) {
        const otp = userData.trim()
        console.log('Submitting OTP:', otp, 'for ref:', sess.paystack_ref)

        try {
          const otpRes = await fetch('https://api.paystack.co/charge/submit_otp', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + PAYSTACK_SECRET, 'Content-Type': 'application/json' },
            body: JSON.stringify({ otp, reference: sess.paystack_ref }),
          })
          const otpData = await otpRes.json()
          console.log('OTP result:', JSON.stringify(otpData))

          // Clean up session
          await supabase.from('ussd_sessions').delete().eq('session_id', sessionId)

          const pStatus = otpData.data?.status || ''
          if (pStatus === 'success') {
            // Update order as paid
            await supabase.from('whatsapp_orders').update({
              status: 'Paid', paid_at: new Date().toISOString()
            }).eq('paystack_ref', sess.paystack_ref)
            return ussdEnd(`Payment successful!\n\nOrder: ${sess.order_no || ''}\nThank you for shopping with ${SHOP}!`)
          }

          if (pStatus === 'pending' || pStatus === 'pay_offline') {
            return ussdEnd(`Payment processing.\n\nYou will receive confirmation shortly.\n\nOrder: ${sess.order_no || ''}\nThank you!`)
          }

          if (pStatus === 'failed') {
            return ussdEnd(`Payment failed: ${otpData.data?.gateway_response || 'Invalid OTP'}\n\nDial *920*141*${sess.order_code}# to try again.`)
          }

          return ussdEnd(`Payment processing.\nYou will receive confirmation shortly.\nThank you!`)
        } catch (e) {
          console.error('OTP error:', e)
          return ussdEnd(`Error submitting OTP.\nDial *920*141*${sess.order_code}# to try again.`)
        }
      }

      // === EXTRACT ORDER CODE ===
      let orderCode = ''
      if (!isMenuChoice && userData && step !== 'otp') {
        const parts = userData.replace(/#/g, '').split('*').filter(Boolean)
        const idx = parts.indexOf('141')
        if (idx >= 0 && parts[idx + 1] && /^\d+$/.test(parts[idx + 1])) orderCode = parts[idx + 1]
        if (!orderCode && /^\d{1,6}$/.test(userData.trim())) orderCode = userData.trim()
      }

      // Get from session
      if ((isMenuChoice || !orderCode) && sess?.order_code && sess.order_code !== 'LOG') {
        orderCode = String(sess.order_code)
      }

      if (!orderCode) return ussdCon(`Welcome to ${SHOP}\nPlease enter your Order Code:`)

      // Save session
      if (sessionId) {
        await supabase.from('ussd_sessions').upsert({
          session_id: sessionId, order_code: orderCode, phone, step: 'menu', updated_at: new Date().toISOString()
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

        const num = fp.replace('233', '')
        let provider = 'mtn'
        if (/^(20|50|24|25|53|54|55|59)/.test(num)) provider = 'mtn'
        else if (/^(27|57|26|56)/.test(num)) provider = 'vod'
        else if (/^(23|28|58)/.test(num)) provider = 'atl'

        try {
          const cr = await fetch('https://api.paystack.co/charge', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + PAYSTACK_SECRET, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              email: fp + '@everytinroom.shop',
              amount: Math.round(Number(order.total) * 100),
              currency: 'GHS',
              mobile_money: { phone: fp, provider },
              reference: ref,
              metadata: {
                source: 'ussd', order_id: order.id, order_no: order.order_no,
                ussd_code: order.ussd_code, customer_phone: phone,
                custom_fields: [{ display_name: 'Order', variable_name: 'order_no', value: order.order_no }]
              },
            }),
          })
          const cd = await cr.json()
          console.log('Paystack charge:', JSON.stringify(cd))

          await supabase.from('whatsapp_orders').update({ paystack_ref: ref, customer_phone: phone }).eq('id', order.id)

          const pStatus = cd.data?.status || ''

          // OTP required — save ref to session and ask for OTP
          if (pStatus === 'send_otp') {
            // Update session: step=otp, save paystack ref and order_no
            await supabase.from('ussd_sessions').upsert({
              session_id: sessionId, order_code: orderCode, phone,
              step: 'otp', paystack_ref: ref, order_no: order.order_no,
              updated_at: new Date().toISOString()
            }, { onConflict: 'session_id' })

            return ussdCon(`An OTP code has been sent to your phone via SMS.\n\nPlease enter the code:`)
          }

          if (pStatus === 'success') {
            if (sessionId) await supabase.from('ussd_sessions').delete().eq('session_id', sessionId)
            return ussdEnd(`Payment of GHS ${total} successful!\n\nOrder: ${order.order_no}\nThank you!`)
          }

          if (pStatus === 'pay_offline' || pStatus === 'pending') {
            if (sessionId) await supabase.from('ussd_sessions').delete().eq('session_id', sessionId)
            return ussdEnd(`GHS ${total} for ${order.order_no}\n\nPayment processing.\nYou will receive confirmation shortly.\n\nThank you!`)
          }

          if (pStatus === 'failed') {
            if (sessionId) await supabase.from('ussd_sessions').delete().eq('session_id', sessionId)
            return ussdEnd(`Payment failed: ${cd.data?.gateway_response || 'Error'}\n\nTry again or call 024 531 5581`)
          }

          if (cd.status) {
            if (sessionId) await supabase.from('ussd_sessions').delete().eq('session_id', sessionId)
            return ussdEnd(`GHS ${total} for ${order.order_no}\n\nPayment processing.\nThank you!`)
          }

          if (sessionId) await supabase.from('ussd_sessions').delete().eq('session_id', sessionId)
          return ussdEnd(`Payment error: ${cd.message || 'Failed'}\nCall 024 531 5581`)
        } catch (e) {
          console.error('Pay error:', e)
          if (sessionId) await supabase.from('ussd_sessions').delete().eq('session_id', sessionId)
          return ussdEnd(`Payment error. Call 024 531 5581`)
        }
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
      if (!d.status) return new Response(JSON.stringify({ success: false, error: d.message || 'Charge failed' }), { headers: CORS })
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
