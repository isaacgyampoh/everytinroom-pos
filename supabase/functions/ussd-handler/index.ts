import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || 'https://noiiuwkovoojkcwzupye.supabase.co'
const SUPABASE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const PAYSTACK_SECRET = Deno.env.get('PAYSTACK_SECRET_KEY') || ''
const SHOP = 'EVERYTINROOM&BEDTIME'

const db = () => createClient(SUPABASE_URL, SUPABASE_KEY)

// Nalo expects JSON: { "MSGTYPE": true, "MSG": "text" } for continue
// and { "MSGTYPE": false, "MSG": "text" } for end session
const con = (msg: string) => new Response(JSON.stringify({ MSGTYPE: true, MSG: msg, USSDMSG: msg }), {
  headers: { 'Content-Type': 'application/json' }
})

const end = (msg: string) => new Response(JSON.stringify({ MSGTYPE: false, MSG: msg, USSDMSG: msg }), {
  headers: { 'Content-Type': 'application/json' }
})

// Simple session store to track which order a session is viewing
const sessions = new Map<string, { orderCode: string, step: string }>()

serve(async (req) => {
  // Support both GET and POST
  let params: Record<string, string> = {}

  // GET params
  const url = new URL(req.url)
  for (const [k, v] of url.searchParams) params[k.toUpperCase()] = v

  // POST body (Nalo sends POST with JSON or form data)
  if (req.method === 'POST') {
    try {
      const ct = req.headers.get('content-type') || ''
      if (ct.includes('json')) {
        const j = await req.json()
        for (const [k, v] of Object.entries(j)) params[String(k).toUpperCase()] = String(v)
      } else {
        const text = await req.text()
        // Try JSON parse first
        try {
          const j = JSON.parse(text)
          for (const [k, v] of Object.entries(j)) params[String(k).toUpperCase()] = String(v)
        } catch {
          // Form data
          for (const [k, v] of new URLSearchParams(text)) params[k.toUpperCase()] = v
        }
      }
    } catch {}
  }

  const sessionId = params.SESSIONID || params.SESSION_ID || ''
  const phone = params.MSISDN || params.MOBILENO || params.MOBILE || ''
  const ussdCode = params.USSDCODE || params.USERDATA || params.SERVICESCODE || params.SERVICECODE || ''
  const userInput = params.USSDSTRING || params.INPUT || params.MSG || params.MESSAGE || params.TEXT || ''
  const msgType = params.MSGTYPE || ''

  console.log(`USSD: session=${sessionId} phone=${phone} code=${ussdCode} input=${userInput} msgtype=${msgType}`)
  console.log('All params:', JSON.stringify(params))

  // Extract order code from the dialed USSD string
  let orderCode = ''

  // From USSDCODE: *920*141*50001# → 50001
  if (ussdCode) {
    const parts = ussdCode.replace(/#/g, '').split('*').filter(Boolean)
    const idx = parts.indexOf('141')
    if (idx >= 0 && parts[idx + 1]) {
      orderCode = parts[idx + 1]
    }
    // Also try regex
    if (!orderCode) {
      const m = ussdCode.match(/141\*(\d+)/)
      if (m) orderCode = m[1]
    }
  }

  // Check if userInput is the order code (Nalo sends only most recent input)
  if (!orderCode && userInput && /^\d{4,6}$/.test(userInput.trim())) {
    // Check if we have a session waiting for order code
    const sess = sessions.get(sessionId)
    if (!sess || sess.step === 'ask_code') {
      orderCode = userInput.trim()
    }
  }

  // Check session for stored order code
  if (!orderCode && sessionId) {
    const sess = sessions.get(sessionId)
    if (sess?.orderCode) {
      orderCode = sess.orderCode
    }
  }

  // No order code — ask for it
  if (!orderCode) {
    if (sessionId) sessions.set(sessionId, { orderCode: '', step: 'ask_code' })
    // Clean up old sessions
    if (sessions.size > 500) sessions.clear()
    return con(`Welcome to ${SHOP}\nPlease enter your Order Code:`)
  }

  // Store order code in session
  if (sessionId) {
    const sess = sessions.get(sessionId)
    if (sess) {
      sess.orderCode = orderCode
    } else {
      sessions.set(sessionId, { orderCode, step: 'show_order' })
    }
  }

  // Look up order
  try {
    const supabase = db()
    const { data: order, error } = await supabase
      .from('whatsapp_orders')
      .select('id,order_no,total,status,customer_name,customer_phone,ussd_code,paystack_ref')
      .eq('ussd_code', parseInt(orderCode))
      .single()

    if (error || !order) {
      return end(`Order ${orderCode} not found.\nCheck the code and try again.`)
    }

    if (order.status === 'Paid' || order.status === 'Completed') {
      return end(`Order ${order.order_no} already paid.\nThank you!`)
    }

    if (order.status === 'Cancelled') {
      return end(`Order ${order.order_no} cancelled.\nContact: 024 531 5581`)
    }

    const total = Number(order.total).toFixed(2)

    // Nalo sends only the MOST RECENT input, not the full string
    // So "1" means user pressed 1
    const lastInput = userInput.trim()

    // User pressed 1 = Pay Now
    if (lastInput === '1') {
      let fp = phone.replace(/\s+/g, '').replace(/^0/, '233').replace(/^\+/, '')
      if (!fp.startsWith('233')) fp = '233' + fp

      const ref = `USSD-${order.ussd_code}-${Date.now().toString(36).toUpperCase()}`

      try {
        const chargeRes = await fetch('https://api.paystack.co/charge', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + PAYSTACK_SECRET, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: fp + '@everytinroom.shop',
            amount: Math.round(Number(order.total) * 100),
            currency: 'GHS',
            mobile_money: { phone: fp, provider: 'mtn' },
            reference: ref,
            metadata: {
              source: 'ussd', order_id: order.id, order_no: order.order_no,
              ussd_code: order.ussd_code, customer_phone: phone,
              custom_fields: [
                { display_name: 'Order', variable_name: 'order_no', value: order.order_no },
                { display_name: 'Phone', variable_name: 'phone', value: phone }
              ]
            },
          }),
        })

        const cd = await chargeRes.json()
        console.log('Paystack:', JSON.stringify(cd).slice(0, 300))

        if (cd.status) {
          await supabase.from('whatsapp_orders').update({ paystack_ref: ref, customer_phone: phone }).eq('id', order.id)
          return end(`Payment of GHS ${total} initiated!\n\nCheck your phone for MoMo prompt.\n\nOrder: ${order.order_no}\nThank you!`)
        }

        // Fallback to initialize
        const initRes = await fetch('https://api.paystack.co/transaction/initialize', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + PAYSTACK_SECRET, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: fp + '@everytinroom.shop',
            amount: Math.round(Number(order.total) * 100),
            currency: 'GHS', reference: ref, channels: ['mobile_money'],
            metadata: { source: 'ussd', order_id: order.id, order_no: order.order_no, ussd_code: order.ussd_code, customer_phone: phone },
          }),
        })
        const id = await initRes.json()
        if (id.status) {
          await supabase.from('whatsapp_orders').update({ paystack_ref: id.data?.reference || ref, customer_phone: phone }).eq('id', order.id)
          return end(`GHS ${total} for ${order.order_no}\nPayment link sent to your phone.\nThank you!`)
        }

        return end(`Payment failed. Try again or call 024 531 5581`)
      } catch (e) {
        console.error('Payment error:', e)
        return end(`Payment error. Try again or call 024 531 5581`)
      }
    }

    // User pressed 2 = Cancel
    if (lastInput === '2') {
      if (sessionId) sessions.delete(sessionId)
      return end(`Cancelled.\nDial *920*141*${orderCode}# anytime to pay.`)
    }

    // Show order details (first screen or after entering order code)
    const name = order.customer_name ? `\n${order.customer_name}` : ''
    if (sessionId) {
      const sess = sessions.get(sessionId)
      if (sess) sess.step = 'confirm'
    }
    return con(`${SHOP}${name}\nOrder: ${order.order_no}\n\nTotal: GHS ${total}\n\n1. Pay Now\n2. Cancel`)

  } catch (e) {
    console.error('USSD error:', e)
    return end(`Error. Please try again.`)
  }
})
