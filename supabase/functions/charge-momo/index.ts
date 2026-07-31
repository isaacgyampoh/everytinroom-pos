import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const PAYSTACK_SECRET = Deno.env.get('PAYSTACK_SECRET_KEY') || ''
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || 'https://noiiuwkovoojkcwzupye.supabase.co'
const SUPABASE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const SHOP = 'EVERYTINROOM'

// NaloPay credentials — read from Supabase secrets (fallbacks are EVERYTINROOM's
// own live keys, so nothing can route through another account).
const NALOPAY_MERCHANT_ID = Deno.env.get('NALOPAY_MERCHANT_ID') || 'TimA4kiLJWoQ5cTXLf8EKh'
const NALOPAY_API_KEY = Deno.env.get('NALOPAY_API_KEY') || '3b3c6f0e30ae457904167129b84d4595268e684921a930caa38695c2a3e28304'
const NALOPAY_AUTH = Deno.env.get('NALOPAY_AUTH_HEADER') || 'Basic 2503ad8373e7fd5faea6fd18c9deb3d282e20c6b822d690465be37a23cf3396286092e17bdd86c0a7a0a8c1117542e5a2d751c4dc0f739597d59f8272871b171'
const NALOPAY_TOKEN_URL = 'https://api.nalopay.com/clientapi/generate-payment-token/'
const NALOPAY_COLLECTION_URL = 'https://api.nalopay.com/clientapi/collection/'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Content-Type': 'application/json',
}

// Nalo SMS credentials
const NALO_SMS_USERNAME = 'ISAAC'
const NALO_SMS_PASSWORD = 'Isaac@1024'
const NALO_SMS_SENDER = 'EverytinRm'

async function sendSMS(to: string, message: string) {
  const recipients = to.split(',').map(r => r.trim())
  for (const recipient of recipients) {
    const phone = recipient.replace(/\s+/g, '').replace(/^0/, '233')
    try {
      const smsUrl = `https://sms.nalosolutions.com/smsbackend/Aboroye_Standard/compose_sms.php?username=${encodeURIComponent(NALO_SMS_USERNAME)}&password=${encodeURIComponent(NALO_SMS_PASSWORD)}&type=0&dlr=1&destination=${encodeURIComponent(phone)}&source=${encodeURIComponent(NALO_SMS_SENDER)}&message=${encodeURIComponent(message)}`
      const res = await fetch(smsUrl)
      const data = await res.text()
      console.log(`SMS to ${phone}: status=${res.status} response=${data.substring(0, 100)}`)
    } catch (e) {
      console.log(`SMS failed for ${phone}: ${e}`)
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

      // Extract order code
      let orderCode = ''
      if (!isMenuChoice && userData) {
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
      console.log('Looking up order with ussd_code:', orderCode, 'parsed as:', parseInt(orderCode))
      
      // Query without .single() to avoid "cannot coerce" error
      const { data: orders, error: orderError } = await supabase.from('whatsapp_orders')
        .select('id,order_no,total,status,customer_name,customer_phone,ussd_code')
        .eq('ussd_code', parseInt(orderCode))
        .order('date', { ascending: false })
        .limit(1)

      const order = orders?.[0] || null
      console.log('Order lookup result:', order ? order.order_no : 'NULL', 'error:', orderError?.message || 'none', 'count:', orders?.length || 0)

      if (!order) return ussdEnd(`Order ${orderCode} not found.\nCall 024 531 5581`)
      if (order.status === 'Paid' || order.status === 'Completed') return ussdEnd(`Order ${order.order_no} already paid.\nThank you!`)
      if (order.status === 'Cancelled') return ussdEnd(`Order ${order.order_no} cancelled.\nCall: 024 531 5581`)

      const total = Number(order.total).toFixed(2)

      // Pay Now — using NaloPay MoMo (direct prompt, no OTP, no proxy)
      if (userData === '1') {
        let fp = phone.replace(/\s+/g, '').replace(/^0/, '233').replace(/^\+/, '')
        if (!fp.startsWith('233')) fp = '233' + fp
        const ref = `USSD-${order.ussd_code}-${Date.now().toString(36).toUpperCase()}`

        // NaloPay needs phone as 0XXXXXXXXX
        const num = fp.replace('233', '')
        const naloPhone = '0' + num

        // Detect network
        let network = 'MTN'
        if (/^(20|50|24|25|53|54|55|59)/.test(num)) network = 'MTN'
        else if (/^(27|57|26|56)/.test(num)) network = 'VODAFONE'
        else if (/^(23|28|58)/.test(num)) network = 'AIRTELTIGO'

        const chargeAmount = Number((Number(order.total) * 1.015).toFixed(2)) // 1.5% processing fee (invisible to customer)
        const callbackUrl = `https://noiiuwkovoojkcwzupye.supabase.co/functions/v1/charge-momo?action=nalopay-callback`

        try {
          console.log(`NaloPay charge: phone=${naloPhone} amount=${chargeAmount} network=${network} ref=${ref}`)

          // Step 1: Generate payment token
          const tokenRes = await fetch(NALOPAY_TOKEN_URL, {
            method: 'POST',
            headers: {
              'Authorization': NALOPAY_AUTH,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              merchant_id: NALOPAY_MERCHANT_ID,
              api_key: NALOPAY_CLIENT_SECRET,
            }),
          })
          const tokenData = await tokenRes.json()
          console.log('NaloPay token response:', JSON.stringify(tokenData))

          const token = tokenData.token || tokenData.data?.token || tokenData.access_token
          if (!token) {
            console.error('NaloPay token failed:', JSON.stringify(tokenData))
            return ussdEnd(`Payment service error.\nDial *920*141*${orderCode}# to retry.\nCall 024 531 5581`)
          }

          // Step 2: Charge MoMo
          // Generate trans_hash (SHA256 of merchant_id + amount + reference)
          const hashInput = NALOPAY_MERCHANT_ID + chargeAmount + ref
          const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(hashInput))
          const transHash = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('')

          const chargeBody = {
            merchant_id: NALOPAY_MERCHANT_ID,
            service_name: 'MOMO_TRANSACTION',
            trans_hash: transHash,
            token: token,
            account_number: naloPhone,
            account_name: order.customer_name || 'Customer',
            description: `Order ${order.order_no}`,
            reference: ref,
            network: network,
            amount: chargeAmount,
            callback: callbackUrl,
          }

          console.log('NaloPay charge body:', JSON.stringify(chargeBody))

          const chargeRes = await fetch(NALOPAY_COLLECTION_URL, {
            method: 'POST',
            headers: {
              'Authorization': NALOPAY_AUTH,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(chargeBody),
          })
          const chargeData = await chargeRes.json()
          console.log('NaloPay charge response:', JSON.stringify(chargeData))

          // Save reference to order
          await supabase.from('whatsapp_orders').update({ paystack_ref: ref, customer_phone: phone }).eq('id', order.id)
          if (sessionId) await supabase.from('ussd_sessions').delete().eq('session_id', sessionId)

          // Check if charge was successful
          if (chargeRes.status === 200 || chargeRes.status === 201 || chargeData.status === 'success' || chargeData.success) {
            return ussdEnd(`GHS ${total} for ${order.order_no}\n\nA payment prompt has been sent to your phone.\n\nApprove with your MoMo PIN.\n\nThank you!`)
          }

          const errMsg = chargeData.message || chargeData.error || chargeData.detail || 'Payment failed'
          console.error('NaloPay error:', errMsg)
          return ussdEnd(`Payment error.\nDial *920*141*${orderCode}# to retry.\nCall 024 531 5581`)
        } catch (e) {
          console.error('NaloPay exception:', e)
          if (sessionId) await supabase.from('ussd_sessions').delete().eq('session_id', sessionId)
          return ussdEnd(`Payment error.\nDial *920*141*${orderCode}# to retry.\nCall 024 531 5581`)
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

    // ==================== NALOPAY CALLBACK ====================
    if (action === 'nalopay-callback') {
      const body = await req.json()
      console.log('NALOPAY CALLBACK FULL:', JSON.stringify(body))

      const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)
      const ADMIN_PHONES = '0533547740,0548124978,0554808341'

      // Try multiple fields NaloPay might use for reference
      const ref = body.reference || body.transaction_reference || body.client_reference || body.external_reference || body.order_reference || ''
      const status = (body.status || body.transaction_status || body.payment_status || '').toLowerCase()
      const naloRef = body.transaction_id || body.nalopay_reference || body.id || ''

      console.log(`NaloPay callback: ref=${ref} naloRef=${naloRef} status=${status}`)

      if ((status === 'success' || status === 'successful' || status === 'completed' || status === 'paid' || status === 'approved') && ref) {
        // Try finding order by our reference
        let order: any = null
        const { data: o1 } = await supabase.from('whatsapp_orders')
          .select('id,order_no,total,customer_phone,customer_name')
          .eq('paystack_ref', ref).limit(1)
        order = o1?.[0]

        // Fallback: try matching by USSD code extracted from reference (USSD-132-xxx → 132)
        if (!order && ref.startsWith('USSD-')) {
          const ussdCode = ref.split('-')[1]
          if (ussdCode) {
            const { data: o2 } = await supabase.from('whatsapp_orders')
              .select('id,order_no,total,customer_phone,customer_name')
              .eq('ussd_code', parseInt(ussdCode)).eq('status', 'Pending').limit(1)
            order = o2?.[0]
          }
        }

        if (order) {
          await supabase.from('whatsapp_orders').update({
            status: 'Paid',
            paid_at: new Date().toISOString(),
          }).eq('id', order.id)

          console.log('NaloPay payment confirmed:', order.order_no)
          const amount = Number(order.total).toFixed(2)
          const firstName = (order.customer_name || 'Customer').split(' ')[0]
          const isPOS = order.order_no.startsWith('POS-') || order.order_no.startsWith('WA-')
          const isWeb = order.order_no.startsWith('WEB-')

          // SMS to admin
          try { 
            const adminMsg = isPOS 
              ? `POS Payment! ${order.order_no} GHS ${amount}. ${order.customer_name || ''} ${order.customer_phone || ''}.`
              : `Online Payment! ${order.order_no} GHS ${amount}. ${order.customer_name || ''} ${order.customer_phone || ''}. Process & deliver ASAP.`
            await sendSMS(ADMIN_PHONES, adminMsg) 
          } catch (smsErr) { console.error('Admin SMS failed:', smsErr) }
          
          // SMS to customer
          if (order.customer_phone) {
            try { 
              let custMsg = ''
              if (isPOS) {
                // Walk-in customer — short and sweet
                custMsg = `Thank you for shopping with us, ${firstName}!\n\nYour payment of GHS ${amount} has been received.\n\nWe appreciate your patronage.\n\nEVERYTINROOM\nAviation Road J382, Adenta\n024 531 5581\nwww.erbliving.shop`
              } else {
                // Online customer — include order details and delivery info
                custMsg = `Hi ${firstName}, thank you for your purchase of GHS ${amount}!\n\nOrder: ${order.order_no}\n\nYour order has been confirmed and is being processed. Our delivery team will contact you shortly.\n\nTrack your order: erbliving.shop/#/track\n\nEVERYTINROOM\n024 531 5581\nwww.erbliving.shop`
              }
              await sendSMS(order.customer_phone, custMsg)
              console.log('Customer SMS sent to:', order.customer_phone) 
            } catch (smsErr) { console.error('Customer SMS failed:', smsErr) }
          } else {
            console.log('No customer phone — skipping SMS')
          }
        } else {
          console.error('NaloPay callback: order not found for ref:', ref)
        }
      } else {
        console.log('NaloPay callback — not successful or no ref:', status, ref)
      }

      return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } })
    }

    // ==================== HUBTEL CALLBACK ====================
    if (action === 'hubtel-callback') {
      const body = await req.json()
      console.log('HUBTEL CALLBACK:', JSON.stringify(body))

      const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)
      const ADMIN_PHONES = '0533547740,0548124978,0554808341'

      const ref = body.ClientReference || body.Data?.ClientReference || ''
      const status = body.ResponseCode || body.Data?.ResponseCode || ''
      const desc = body.Data?.Description || body.Description || ''

      console.log(`Hubtel callback: ref=${ref} status=${status} desc=${desc}`)

      if (status === '0000' && ref) {
        // Payment successful — find and update order
        const { data: o } = await supabase.from('whatsapp_orders')
          .select('id,order_no,total,customer_phone,customer_name')
          .eq('paystack_ref', ref).single()

        if (o) {
          await supabase.from('whatsapp_orders').update({
            status: 'Paid',
            paid_at: new Date().toISOString(),
          }).eq('id', o.id)

          console.log('Hubtel payment confirmed:', o.order_no)
          const amount = Number(o.total).toFixed(2)

          // SMS to admin
          try { await sendSMS(ADMIN_PHONES, `Payment received. ${o.order_no} GHS ${amount}. Process ASAP.`) } catch {}
          // SMS to customer
          if (o.customer_phone) {
            try { await sendSMS(o.customer_phone, `Hi ${o.customer_name || 'Customer'}, your payment of GHS ${amount} has been received.\n\nOrder: ${o.order_no}\n\nYour order will be processed and delivered shortly.\n\nEVERYTINROOM\n024 531 5581`) } catch {}
          }
        }
      } else {
        console.log('Hubtel callback - not successful:', status, desc)
      }

      return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } })
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

    // ==================== PAYMENT REMINDERS ====================
    if (action === 'remind') {
      const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)
      const now = Date.now()
      
      // Find all pending orders
      const { data: unpaid } = await supabase
        .from('whatsapp_orders')
        .select('id,order_no,customer_name,customer_phone,total,ussd_code,date,notes')
        .eq('status', 'Pending')
        .order('date', { ascending: false })
        .limit(50)

      if (!unpaid?.length) {
        return new Response(JSON.stringify({ status: 'no_pending_orders' }), { headers: CORS })
      }

      let sent = 0
      for (const o of unpaid) {
        if (!o.customer_phone || !o.ussd_code) continue
        
        const orderAge = now - new Date(o.date).getTime()
        const mins = Math.floor(orderAge / 60000)
        const notes = o.notes || ''
        const name = o.customer_name || 'Customer'
        const firstName = name.split(' ')[0]
        const amount = `GHS ${Number(o.total).toFixed(2)}`
        const code = `*920*141*${o.ussd_code}#`

        let msg = ''

        // 5 min reminder
        if (mins >= 5 && mins < 25 && !notes.includes('[R1]')) {
          msg = `Hi ${firstName}, you're almost done! Complete your order of ${amount}.\n\nDial ${code} to pay now.\n\nEVERYTINROOM\n024 531 5581`
          await supabase.from('whatsapp_orders').update({ notes: notes + ' [R1]' }).eq('id', o.id)
        }
        // 30 min reminder
        else if (mins >= 30 && mins < 55 && !notes.includes('[R2]')) {
          msg = `Hi ${firstName}, your order ${o.order_no} (${amount}) is still waiting for payment.\n\nDial ${code} to pay via MoMo.\n\nDon't miss out — we'll process your order right away!\n\nEVERYTINROOM\n024 531 5581`
          await supabase.from('whatsapp_orders').update({ notes: notes + ' [R2]' }).eq('id', o.id)
        }
        // 1 hour reminder
        else if (mins >= 60 && mins < 120 && !notes.includes('[R3]')) {
          msg = `Hi ${firstName}, just a friendly reminder. Your order ${o.order_no} (${amount}) is waiting.\n\nDial ${code} to complete payment.\n\nWe're ready to process and deliver!\n\nEVERYTINROOM\n024 531 5581`
          await supabase.from('whatsapp_orders').update({ notes: notes + ' [R3]' }).eq('id', o.id)
        }
        // 24 hour reminder (final)
        else if (mins >= 1440 && !notes.includes('[R4]')) {
          msg = `Hi ${firstName}, this is your final reminder. Your order ${o.order_no} (${amount}) will be cancelled soon.\n\nDial ${code} to pay now and secure your items.\n\nEVERYTINROOM\n024 531 5581`
          await supabase.from('whatsapp_orders').update({ notes: notes + ' [R4]' }).eq('id', o.id)
        }

        if (msg) {
          try { await sendSMS(o.customer_phone, msg); sent++ } catch {}
        }
      }

      return new Response(JSON.stringify({ status: 'sent', reminders: sent, total_pending: unpaid.length }), { headers: CORS })
    }

    // ==================== SEND USSD CODE TO CUSTOMER (isolated, additive) ====================
    // Texts the customer the USSD shortcode the moment the cashier generates it.
    // Does NOT initiate or alter any charge — payment still happens when the
    // customer dials the code (handled by ?action=ussd). Reuses sendSMS().
    if (action === 'send-ussd-code') {
      const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)
      let payload: any = {}
      try { payload = await req.json() } catch {}
      const orderId = payload.orderId || payload.order_id || ''
      const orderNoIn = payload.orderNo || payload.order_no || ''
      if (!orderId && !orderNoIn) return new Response(JSON.stringify({ success: false, error: 'orderId or orderNo required' }), { headers: CORS })

      let q = supabase.from('whatsapp_orders').select('id,order_no,total,customer_name,customer_phone,ussd_code,status')
      q = orderId ? q.eq('id', orderId) : q.eq('order_no', orderNoIn)
      const { data: rows } = await q.limit(1)
      const order = rows?.[0]
      if (!order) return new Response(JSON.stringify({ success: false, error: 'Order not found' }), { headers: CORS })
      if (!order.customer_phone) return new Response(JSON.stringify({ success: false, error: 'No customer phone on order' }), { headers: CORS })
      if (!order.ussd_code) return new Response(JSON.stringify({ success: false, error: 'Order has no USSD code' }), { headers: CORS })

      const firstName = (order.customer_name || 'Customer').split(' ')[0]
      const amount = Number(order.total).toFixed(2)
      const code = `*920*141*${order.ussd_code}#`
      const msg = `Hi ${firstName}, complete your ${SHOP} payment of GHS ${amount}.\n\nDial ${code} on this phone, then approve with your MoMo PIN.\n\nOrder: ${order.order_no}\n024 531 5581`
      try { await sendSMS(order.customer_phone, msg) } catch (e) { return new Response(JSON.stringify({ success: false, error: 'SMS failed: ' + (e as Error).message }), { headers: CORS }) }
      return new Response(JSON.stringify({ success: true, order: order.order_no, phone: order.customer_phone, code }), { headers: CORS })
    }

    return new Response(JSON.stringify({ error: 'Use ?action=initialize, charge, verify, ussd, webhook, report, or remind' }), { headers: CORS })
  } catch (e) {
    console.error('Error:', e)
    return new Response(JSON.stringify({ success: false, error: e.message }), { status: 500, headers: CORS })
  }
})
