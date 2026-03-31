// supabase/functions/ussd-handler/index.ts
// Nalo Solutions USSD callback handler
// Deploy: paste into Supabase Edge Functions → ussd-handler (Verify JWT OFF)
// Endpoint: https://noiiuwkovoojkcwzupye.supabase.co/functions/v1/ussd-handler
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || 'https://noiiuwkovoojkcwzupye.supabase.co'
const SUPABASE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const PAYSTACK_SECRET = Deno.env.get('PAYSTACK_SECRET_KEY') || ''
const USSD_CODE = '*920*141'
const SHOP = 'EVERYTINROOM&BEDTIME'

const db = () => createClient(SUPABASE_URL, SUPABASE_KEY)

serve(async (req) => {
  // Nalo sends GET requests with query params
  const url = new URL(req.url)
  const sessionId = url.searchParams.get('SESSIONID') || url.searchParams.get('sessionId') || url.searchParams.get('sessionid') || ''
  const msisdn = url.searchParams.get('MSISDN') || url.searchParams.get('msisdn') || url.searchParams.get('MOBILENO') || ''
  const ussdCode = url.searchParams.get('USSDCODE') || url.searchParams.get('ussdcode') || url.searchParams.get('USERDATA') || ''
  const input = url.searchParams.get('INPUT') || url.searchParams.get('input') || url.searchParams.get('USSDSTRING') || ''

  // Also support POST (some providers use POST)
  let postData: any = {}
  if (req.method === 'POST') {
    try {
      const ct = req.headers.get('content-type') || ''
      if (ct.includes('json')) {
        postData = await req.json()
      } else {
        const text = await req.text()
        const params = new URLSearchParams(text)
        for (const [k, v] of params) postData[k.toUpperCase()] = v
      }
    } catch {}
  }

  const session = sessionId || postData.SESSIONID || ''
  const phone = msisdn || postData.MSISDN || postData.MOBILENO || ''
  const code = ussdCode || postData.USSDCODE || postData.USERDATA || ''
  const userInput = input || postData.INPUT || postData.USSDSTRING || ''

  console.log(`USSD: session=${session} phone=${phone} code=${code} input=${userInput}`)

  // Extract order code from the dialed USSD string
  // If customer dials *920*141*50001#, the code/input will contain 50001
  let orderCode = ''

  // Try to extract from the full USSD code string
  const codeMatch = code.match(/\*920\*141\*(\d+)/)
  if (codeMatch) {
    orderCode = codeMatch[1]
  }

  // Also check if it's in the input field (some providers send it there)
  if (!orderCode && userInput && /^\d{4,6}$/.test(userInput.trim())) {
    orderCode = userInput.trim()
  }

  // Also try the full input/userdata for just the extension
  if (!orderCode) {
    const parts = (code || '').replace(/[*#]/g, ' ').trim().split(/\s+/)
    // Find the part after 141
    const idx141 = parts.indexOf('141')
    if (idx141 >= 0 && parts[idx141 + 1]) {
      orderCode = parts[idx141 + 1]
    }
  }

  const respond = (text: string) => {
    return new Response(text, {
      headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-cache' }
    })
  }

  // --- NO ORDER CODE: Customer dialed *920*141# without an order number ---
  if (!orderCode) {
    // Check if user typed an order code as input
    if (userInput && /^\d{4,6}$/.test(userInput.trim())) {
      orderCode = userInput.trim()
      // Fall through to order lookup below
    } else if (!userInput) {
      // First interaction — ask for order code
      return respond(`CON Welcome to ${SHOP}\nPlease enter your Order Code:`)
    } else {
      return respond(`END Invalid order code.\nPlease dial ${USSD_CODE}*YOUR_ORDER_CODE# to pay.`)
    }
  }

  // --- LOOK UP ORDER ---
  try {
    const supabase = db()
    const { data: order, error } = await supabase
      .from('whatsapp_orders')
      .select('id,order_no,total,status,customer_name,customer_phone,ussd_code,paystack_ref')
      .eq('ussd_code', parseInt(orderCode))
      .single()

    if (error || !order) {
      return respond(`END Order ${orderCode} not found.\nPlease check your code and try again.`)
    }

    // Already paid
    if (order.status === 'Paid' || order.status === 'Completed') {
      return respond(`END Order ${order.order_no} has already been paid.\nThank you!`)
    }

    // Cancelled
    if (order.status === 'Cancelled') {
      return respond(`END Order ${order.order_no} has been cancelled.\nPlease contact the shop.`)
    }

    const total = Number(order.total).toFixed(2)

    // --- PAYMENT CONFIRMATION STEP ---
    // If input is "1" → initiate payment
    // If input is "2" → cancel
    // Otherwise show the order details
    const lastInput = userInput.trim().split('*').pop() || ''

    if (lastInput === '1') {
      // Initiate Paystack mobile money charge
      let formattedPhone = phone.replace(/\s+/g, '').replace(/^0/, '233').replace(/^\+/, '')
      if (!formattedPhone.startsWith('233')) formattedPhone = '233' + formattedPhone

      const ref = `USSD-${order.ussd_code}-${Date.now().toString(36).toUpperCase()}`
      const email = formattedPhone + '@everytinroom.shop'

      try {
        const chargeRes = await fetch('https://api.paystack.co/charge', {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer ' + PAYSTACK_SECRET,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            email,
            amount: Math.round(Number(order.total) * 100),
            currency: 'GHS',
            mobile_money: { phone: formattedPhone, provider: 'mtn' },
            reference: ref,
            metadata: {
              source: 'ussd',
              order_id: order.id,
              order_no: order.order_no,
              ussd_code: order.ussd_code,
              customer_phone: phone,
              custom_fields: [
                { display_name: 'Order', variable_name: 'order_no', value: order.order_no },
                { display_name: 'Phone', variable_name: 'phone', value: phone }
              ]
            },
          }),
        })

        const chargeData = await chargeRes.json()
        console.log('Paystack charge response:', JSON.stringify(chargeData).slice(0, 300))

        if (chargeData.status && (chargeData.data?.status === 'pay_offline' || chargeData.data?.status === 'send_otp' || chargeData.data?.status === 'pending')) {
          // Save the reference
          await supabase.from('whatsapp_orders').update({
            paystack_ref: ref,
            customer_phone: phone
          }).eq('id', order.id)

          return respond(`END Payment of GHS ${total} initiated!\n\nCheck your phone for the MoMo payment prompt and approve it.\n\nOrder: ${order.order_no}\n\nThank you for shopping with ${SHOP}!`)
        } else {
          // Try initialize transaction as fallback
          const initRes = await fetch('https://api.paystack.co/transaction/initialize', {
            method: 'POST',
            headers: {
              'Authorization': 'Bearer ' + PAYSTACK_SECRET,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              email,
              amount: Math.round(Number(order.total) * 100),
              currency: 'GHS',
              reference: ref,
              channels: ['mobile_money'],
              metadata: {
                source: 'ussd',
                order_id: order.id,
                order_no: order.order_no,
                ussd_code: order.ussd_code,
                customer_phone: phone,
              },
            }),
          })

          const initData = await initRes.json()
          console.log('Paystack init response:', JSON.stringify(initData).slice(0, 300))

          if (initData.status) {
            await supabase.from('whatsapp_orders').update({
              paystack_ref: initData.data?.reference || ref,
              customer_phone: phone
            }).eq('id', order.id)

            return respond(`END Payment link sent!\n\nGHS ${total} for order ${order.order_no}\n\nIf you did not receive a MoMo prompt, please use this link to pay:\n${initData.data?.authorization_url || ''}\n\nThank you!`)
          }

          return respond(`END Sorry, payment could not be initiated.\nPlease try again or contact the shop.\n\nCall: 024 531 5581`)
        }
      } catch (e) {
        console.error('Payment error:', e)
        return respond(`END Payment error. Please try again.\nCall: 024 531 5581`)
      }
    }

    if (lastInput === '2') {
      return respond(`END Payment cancelled.\nDial ${USSD_CODE}*${orderCode}# anytime to pay.\n\nThank you!`)
    }

    // Show order details — first screen
    const customerName = order.customer_name ? `\nCustomer: ${order.customer_name}` : ''
    return respond(`CON ${SHOP}\nOrder: ${order.order_no}${customerName}\n\nTotal: GHS ${total}\n\n1. Pay Now\n2. Cancel`)

  } catch (e) {
    console.error('USSD error:', e)
    return respond(`END An error occurred.\nPlease try again later.`)
  }
})
