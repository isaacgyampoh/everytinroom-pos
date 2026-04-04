// supabase/functions/paystack-webhook/index.ts
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  try {
    const body = await req.json()

    console.log('WEBHOOK EVENT:', body.event)
    console.log('WEBHOOK DATA:', JSON.stringify(body.data || {}).slice(0, 500))

    if (body.event !== 'charge.success') {
      return new Response(JSON.stringify({ received: true }), {
        headers: { 'Content-Type': 'application/json' }
      })
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    const paymentData = body.data
    const metadata = paymentData.metadata || {}
    const paystackRef = paymentData.reference || ''

    console.log('Payment ref:', paystackRef)
    console.log('Metadata:', JSON.stringify(metadata).slice(0, 300))

    // --- USSD PAYMENT: update by order_id from metadata ---
    if (metadata.source === 'ussd' && metadata.order_id) {
      const { error: updateErr } = await supabase.from('whatsapp_orders').update({
        status: 'Paid',
        paystack_ref: paystackRef,
        paid_at: paymentData.paid_at || new Date().toISOString(),
        customer_phone: metadata.customer_phone || paymentData.customer?.phone || ''
      }).eq('id', metadata.order_id)

      if (updateErr) console.error('USSD update error:', updateErr)
      else console.log('USSD payment OK:', metadata.order_no)

      try { await sendSMS('0533547740,0203600855,0554808341', `USSD Payment! ${metadata.order_no || ''} GHS ${(paymentData.amount / 100).toFixed(2)} Paid via MoMo`) } catch {}

      return new Response(JSON.stringify({ success: true, type: 'ussd' }), { headers: { 'Content-Type': 'application/json' } })
    }

    // --- FALLBACK: Match by USSD reference ---
    if (paystackRef && paystackRef.startsWith('USSD-')) {
      const { data: existingOrder } = await supabase.from('whatsapp_orders')
        .select('id,order_no').eq('paystack_ref', paystackRef).single()

      if (existingOrder) {
        await supabase.from('whatsapp_orders').update({
          status: 'Paid',
          paid_at: paymentData.paid_at || new Date().toISOString(),
        }).eq('id', existingOrder.id)

        console.log('USSD ref match OK:', existingOrder.order_no)
        try { await sendSMS('0533547740,0203600855,0554808341', `USSD Payment! ${existingOrder.order_no} GHS ${(paymentData.amount / 100).toFixed(2)} Paid`) } catch {}

        return new Response(JSON.stringify({ success: true, type: 'ussd-ref' }), { headers: { 'Content-Type': 'application/json' } })
      }
    }

    // --- FALLBACK 2: Match ANY order by paystack_ref ---
    if (paystackRef) {
      const { data: refOrder } = await supabase.from('whatsapp_orders')
        .select('id,order_no').eq('paystack_ref', paystackRef).single()

      if (refOrder) {
        await supabase.from('whatsapp_orders').update({
          status: 'Paid',
          paid_at: paymentData.paid_at || new Date().toISOString(),
        }).eq('id', refOrder.id)

        console.log('Ref match OK:', refOrder.order_no)
        try { await sendSMS('0533547740,0203600855,0554808341', `Payment! ${refOrder.order_no} GHS ${(paymentData.amount / 100).toFixed(2)} Paid`) } catch {}

        return new Response(JSON.stringify({ success: true, type: 'ref-match' }), { headers: { 'Content-Type': 'application/json' } })
      }
    }

    // --- REGULAR PAYMENT: Create new order ---
    const { data: products } = await supabase.from('products').select('*')

    const rawItems = metadata.items || []
    let subtotal = 0
    const processedItems = rawItems.map((item: any) => {
      let price = Number(item.price) || 0
      const productName = item.name || item.product || ''
      const qty = Number(item.qty) || Number(item.quantity) || 1
      if (!price && productName && products) {
        const match = products.find((p: any) => p.name.toLowerCase() === productName.toLowerCase())
        if (match) price = Number(match.price) || 0
      }
      const lineTotal = price * qty
      subtotal += lineTotal
      return { name: productName, qty, price, lineTotal }
    })

    const deliveryFee = Number(metadata.deliveryFee || metadata.delivery_fee) || 0
    const total = subtotal + deliveryFee

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

    try { await sendSMS('0533547740,0203600855,0554808341', `New Order! ${orderNo} GHS ${total.toFixed(2)} Paystack Paid`) } catch {}

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

const MNOTIFY_API_KEY = Deno.env.get('MNOTIFY_API_KEY') || ''
const MNOTIFY_SENDER_ID = Deno.env.get('MNOTIFY_SENDER_ID') || 'EverytinRM'

async function sendSMS(to: string, message: string) {
  if (!MNOTIFY_API_KEY) return
  const recipients = to.split(',').map(r => r.trim())
  for (const recipient of recipients) {
    const phone = recipient.replace(/\s+/g, '').replace(/^0/, '233')
    try {
      await fetch(`https://api.mnotify.com/api/sms/quick?key=${MNOTIFY_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipient: [phone], sender: MNOTIFY_SENDER_ID, message, is_schedule: false, schedule_date: '' })
      })
    } catch (e) {
      try { await fetch(`https://apps.mnotify.net/smsapi?key=${MNOTIFY_API_KEY}&to=${encodeURIComponent(phone)}&msg=${encodeURIComponent(message)}&sender_id=${encodeURIComponent(MNOTIFY_SENDER_ID)}`) } catch {}
    }
  }
}
