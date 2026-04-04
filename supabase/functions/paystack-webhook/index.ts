// supabase/functions/paystack-webhook/index.ts
// Deploy: supabase functions deploy paystack-webhook --no-verify-jwt
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { encode as hexEncode } from 'https://deno.land/std@0.177.0/encoding/hex.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const PAYSTACK_SECRET = Deno.env.get('PAYSTACK_SECRET_KEY') || ''

// Verify Paystack webhook signature using HMAC-SHA512
async function verifySignature(rawBody: string, signature: string): Promise<boolean> {
  if (!PAYSTACK_SECRET || !signature) return false
  try {
    const key = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(PAYSTACK_SECRET),
      { name: 'HMAC', hash: 'SHA-512' }, false, ['sign']
    )
    const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody))
    const hash = new TextDecoder().decode(hexEncode(new Uint8Array(sig)))
    return hash === signature.toLowerCase()
  } catch (e) {
    console.error('Signature verification error:', e)
    return false
  }
}

serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  try {
    // Read raw body for signature verification
    const rawBody = await req.text()
    const signature = req.headers.get('x-paystack-signature') || ''

    // Verify the webhook is actually from Paystack
    if (PAYSTACK_SECRET && !await verifySignature(rawBody, signature)) {
      console.error('Invalid Paystack webhook signature — rejecting')
      return new Response(JSON.stringify({ error: 'Invalid signature' }), {
        status: 401, headers: { 'Content-Type': 'application/json' }
      })
    }

    const body = JSON.parse(rawBody)
    
    // Only handle successful charges
    if (body.event !== 'charge.success') {
      return new Response(JSON.stringify({ received: true }), {
        headers: { 'Content-Type': 'application/json' }
      })
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    const paymentData = body.data
    const metadata = paymentData.metadata || {}
    const paystackRef = paymentData.reference || ''

    // --- USSD PAYMENT: If this payment came from USSD, update the existing order ---
    if (metadata.source === 'ussd' && metadata.order_id) {
      const { error: updateErr } = await supabase.from('whatsapp_orders').update({
        status: 'Paid',
        paystack_ref: paystackRef,
        paid_at: paymentData.paid_at || new Date().toISOString(),
        customer_phone: metadata.customer_phone || paymentData.customer?.phone || ''
      }).eq('id', metadata.order_id)

      if (updateErr) console.error('USSD order update error:', updateErr)
      else console.log('USSD payment confirmed for order:', metadata.order_no)

      try {
        await sendSMS(
          '0533547740,0203600855,0554808341',
          `📱 USSD Payment!\n${metadata.order_no || ''}\nAmount: GHS ${(paymentData.amount / 100).toFixed(2)}\nCustomer: ${metadata.customer_phone || ''}\n💳 Paid via USSD MoMo\n\nPlease process ASAP!`
        )
      } catch (smsErr) { console.error('SMS failed:', smsErr) }

      return new Response(JSON.stringify({ success: true, type: 'ussd', orderNo: metadata.order_no }), {
        headers: { 'Content-Type': 'application/json' }
      })
    }

    // --- FALLBACK: Match any order by paystack reference (covers USSD + invoice payments) ---
    if (paystackRef && paystackRef.startsWith('USSD-')) {
      const { data: existingOrder } = await supabase.from('whatsapp_orders')
        .select('id,order_no').eq('paystack_ref', paystackRef).single()

      if (existingOrder) {
        await supabase.from('whatsapp_orders').update({
          status: 'Paid',
          paid_at: paymentData.paid_at || new Date().toISOString(),
        }).eq('id', existingOrder.id)

        console.log('USSD payment confirmed via ref match:', existingOrder.order_no)

        try {
          await sendSMS(
            '0533547740,0203600855,0554808341',
            `📱 USSD Payment!\n${existingOrder.order_no}\nAmount: GHS ${(paymentData.amount / 100).toFixed(2)}\n💳 Paid via MoMo\n\nPlease process ASAP!`
          )
        } catch (smsErr) { console.error('SMS failed:', smsErr) }

        return new Response(JSON.stringify({ success: true, type: 'ussd-ref', orderNo: existingOrder.order_no }), {
          headers: { 'Content-Type': 'application/json' }
        })
      }
    }

    // --- REGULAR PAYMENT: Create new whatsapp_order from webhook ---

    // Get products for price lookup
    const { data: products } = await supabase.from('products').select('*')

    const rawItems = metadata.items || []
    let subtotal = 0
    const processedItems = rawItems.map((item: any) => {
      let price = Number(item.price) || 0
      const productName = item.name || item.product || ''
      const qty = Number(item.qty) || Number(item.quantity) || 1

      if (!price && productName && products) {
        const match = products.find((p: any) =>
          p.name.toLowerCase() === productName.toLowerCase()
        )
        if (match) price = Number(match.price) || 0
      }

      const lineTotal = price * qty
      subtotal += lineTotal
      return { name: productName, qty, price, lineTotal }
    })

    const deliveryFee = Number(metadata.deliveryFee || metadata.delivery_fee) || 0
    const total = subtotal + deliveryFee

    // Generate order number
    const { data: orderNoData } = await supabase.rpc('generate_wa_order_no')
    const orderNo = orderNoData || `WA${Date.now()}`

    const { data, error } = await supabase.from('whatsapp_orders').insert({
      order_no: orderNo,
      date: new Date().toISOString(),
      customer_name: metadata.customerName || metadata.customer_name || paymentData.customer?.first_name || '',
      customer_phone: metadata.customerPhone || metadata.customer_phone || paymentData.customer?.phone || '',
      items: processedItems,
      subtotal,
      delivery_fee: deliveryFee,
      total,
      address: metadata.address || metadata.deliveryAddress || '',
      notes: metadata.notes || '',
      status: 'Pending',
      paystack_ref: paymentData.reference,
      paid_at: paymentData.paid_at || new Date().toISOString(),
      created_at: new Date().toISOString()
    }).select().single()

    if (error) throw error

    // Send SMS notification about new order
    try {
      await sendSMS(
        '0533547740,0203600855,0554808341',
        `📱 New WhatsApp Order!\n${orderNo}\nCustomer: ${data.customer_name || 'Customer'}\nTotal: GHS ${total.toFixed(2)}\n${processedItems.length} item(s)\n💳 Paystack Paid\n\nPlease process ASAP!`
      )
    } catch (smsErr) {
      console.error('SMS failed:', smsErr)
    }

    return new Response(JSON.stringify({ success: true, orderNo, total }), {
      headers: { 'Content-Type': 'application/json' }
    })
  } catch (err) {
    console.error('Webhook error:', err)
    return new Response(JSON.stringify({ success: false, error: String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    })
  }
})

// ===== mNotify SMS Helper =====
const MNOTIFY_API_KEY = Deno.env.get('MNOTIFY_API_KEY') || ''
const MNOTIFY_SENDER_ID = Deno.env.get('MNOTIFY_SENDER_ID') || 'EverytinRM'

async function sendSMS(to: string, message: string) {
  const recipients = to.split(',').map(r => r.trim())
  
  for (const recipient of recipients) {
    const phone = recipient.replace(/\s+/g, '').replace(/^0/, '233')
    
    try {
      const res = await fetch(`https://api.mnotify.com/api/sms/quick?key=${MNOTIFY_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipient: [phone],
          sender: MNOTIFY_SENDER_ID,
          message,
          is_schedule: false,
          schedule_date: ''
        })
      })
      const data = await res.json()
      console.log(`SMS to ${phone}:`, data)
    } catch (e) {
      // Fallback to legacy API
      try {
        await fetch(`https://apps.mnotify.net/smsapi?key=${MNOTIFY_API_KEY}&to=${encodeURIComponent(phone)}&msg=${encodeURIComponent(message)}&sender_id=${encodeURIComponent(MNOTIFY_SENDER_ID)}`)
      } catch (e2) {
        console.error('All SMS methods failed for', phone)
      }
    }
  }
}
