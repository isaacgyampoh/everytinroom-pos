import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const WAWP_INSTANCE = Deno.env.get('WAWP_INSTANCE_ID') || ''
const WAWP_TOKEN = Deno.env.get('WAWP_ACCESS_TOKEN') || ''
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || ''
const SUPABASE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const WAWP_API = 'https://wawp.net/wp-json/awp/v1'
const CATALOG_LINK = 'https://www.everytinroom.store/#/catalog'
const SHOP_PHONE = '024 531 5581'

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Content-Type': 'application/json' }

function getDb() { return createClient(SUPABASE_URL, SUPABASE_KEY) }

async function sendText(chatId: string, message: string) {
  try {
    await fetch(`${WAWP_API}/send?instance_id=${WAWP_INSTANCE}&access_token=${WAWP_TOKEN}&chatId=${encodeURIComponent(chatId)}&message=${encodeURIComponent(message)}`, { method: 'POST' })
  } catch (e) { console.error('Send error:', e) }
}

function getGreeting(): string {
  // Ghana is UTC+0
  const hour = new Date().getUTCHours()
  if (hour >= 5 && hour < 12) return 'Good morning'
  if (hour >= 12 && hour < 17) return 'Good afternoon'
  return 'Good evening'
}

// Track last reply time per customer to avoid spamming
const lastReply = new Map<string, number>()

// Check if message is asking about order status
function isOrderQuery(msg: string): boolean {
  const lower = msg.toLowerCase()
  return lower.includes('order') || lower.includes('delivery') || lower.includes('where is') || 
         lower.includes('my package') || lower.includes('tracking') || lower.includes('status') ||
         lower.includes('when will') || lower.includes('not delivered') || lower.includes('still waiting') ||
         lower.includes('order number') || lower.includes('order id')
}

// Check if message is a greeting
function isGreeting(msg: string): boolean {
  const lower = msg.toLowerCase().trim()
  return /^(hi|hello|hey|good morning|good afternoon|good evening|yo|sup|hii+|helo+|greetings|howdy|hy)[\s!.,?]*$/i.test(lower) ||
         lower.startsWith('hi ') || lower.startsWith('hello ') || lower.startsWith('hey ') ||
         lower.startsWith('good morning') || lower.startsWith('good afternoon') || lower.startsWith('good evening')
}

// Check if asking about products
function isProductQuery(msg: string): boolean {
  const lower = msg.toLowerCase()
  return lower.includes('product') || lower.includes('bedsheet') || lower.includes('bed sheet') ||
         lower.includes('cookware') || lower.includes('curtain') || lower.includes('pillow') ||
         lower.includes('bed cover') || lower.includes('duvet') || lower.includes('blanket') ||
         lower.includes('pot') || lower.includes('pan') || lower.includes('kitchen') ||
         lower.includes('what do you sell') || lower.includes('what do you have') ||
         lower.includes('available') || lower.includes('price') || lower.includes('how much') ||
         lower.includes('catalog') || lower.includes('catalogue') || lower.includes('show me') ||
         lower.includes('i want') || lower.includes('i need') || lower.includes('looking for') ||
         lower.includes('do you have') || lower.includes('can i get') || lower.includes('sell')
}

// Check if asking about payment/delivery methods
function isPaymentQuery(msg: string): boolean {
  const lower = msg.toLowerCase()
  return lower.includes('payment') || lower.includes('pay on delivery') || lower.includes('cash on delivery') ||
         lower.includes('cod') || lower.includes('momo') || lower.includes('mobile money') ||
         lower.includes('how to pay') || lower.includes('walk in') || lower.includes('pick up') ||
         lower.includes('walk-in') || lower.includes('pickup')
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const body = await req.json()
    
    // Handle payment confirmation sending
    if (body.action === 'send_confirmation' && body.chatId && body.message) {
      await sendText(body.chatId, body.message)
      console.log('Confirmation sent to:', body.chatId)
      return new Response(JSON.stringify({ ok: true }), { headers: CORS })
    }
    
    if (body.event !== 'message') return new Response(JSON.stringify({ ok: true }), { headers: CORS })

    const payload = body.payload || {}
    if (!payload.from || payload.fromMe) return new Response(JSON.stringify({ ok: true }), { headers: CORS })
    if (String(payload.from).includes('@g.us')) return new Response(JSON.stringify({ ok: true }), { headers: CORS })

    const sender = String(payload.from).replace('@c.us', '').replace('@s.whatsapp.net', '')
    if (!sender || sender.length < 8) return new Response(JSON.stringify({ ok: true }), { headers: CORS })

    const chatId = `${sender}@c.us`
    const msgBody = String(payload.body || payload.text || '').trim()
    if (!msgBody) return new Response(JSON.stringify({ ok: true }), { headers: CORS })

    const customerName = payload._data?.notifyName || payload.notifyName || body.me?.pushName || ''
    const nameGreet = customerName ? ` ${customerName}` : ''
    const greeting = getGreeting()

    // Prevent replying too fast (minimum 3 seconds between replies to same person)
    const now = Date.now()
    const lastTime = lastReply.get(sender) || 0
    if (now - lastTime < 3000) return new Response(JSON.stringify({ ok: true }), { headers: CORS })
    lastReply.set(sender, now)
    // Clean old entries
    if (lastReply.size > 200) lastReply.clear()

    console.log(`MSG from${nameGreet} (${sender}): ${msgBody}`)

    let reply = ''

    if (isGreeting(msgBody)) {
      // GREETING
      reply = `${greeting}${nameGreet}! This is EVERYTINROOM&BEDTIME. How may we help you today?`

    } else if (isOrderQuery(msgBody)) {
      // ORDER STATUS
      reply = `We'd be happy to help with your order${nameGreet}! Please share your order number or the phone number you used during payment, and we'll check the status for you right away.\n\nIf you have any urgent concerns, please call us directly on ${SHOP_PHONE}.`

    } else if (isPaymentQuery(msgBody)) {
      // PAYMENT/DELIVERY INFO
      reply = `Thank you for your interest${nameGreet}!\n\nWe offer two options:\n\n1. Online Payment - You'll receive a secure payment link to pay via Mobile Money (MTN, Vodafone, AirtelTigo) or card. Your order will then be delivered to your location.\n\n2. Walk-in - Visit our shop at Adenta Aviation Road to buy directly.\n\nPlease note: We do not offer cash on delivery.\n\nWould you like to browse our products? Click here:\n${CATALOG_LINK}`

    } else if (isProductQuery(msgBody)) {
      // PRODUCT INQUIRY
      reply = `Thank you for reaching out${nameGreet}! We have a wide variety of home furnishings including bedsheets, bed covers, cookware, curtains, pillows and more.\n\nPlease click the link below to browse our full catalog and select the products you want:\n\n${CATALOG_LINK}\n\nOnce you select your items and place your order, your invoice will be sent to you so you can fill in your delivery details and make payment.\n\nIf you need any help, feel free to message us or call ${SHOP_PHONE}.`

    } else {
      // GENERAL / ANYTHING ELSE
      reply = `${greeting}${nameGreet}! Thank you for messaging EVERYTINROOM&BEDTIME.\n\nTo browse and order our products, please click the link below:\n\n${CATALOG_LINK}\n\nYou can select the items you want, place your order via WhatsApp, and we'll send you an invoice with a payment link.\n\nFor any questions, reply here or call us on ${SHOP_PHONE}. We're here to help!`
    }

    if (reply) await sendText(chatId, reply)

    return new Response(JSON.stringify({ ok: true }), { headers: CORS })
  } catch (e) {
    console.error('ERROR:', e.message)
    return new Response(JSON.stringify({ error: e.message }), { headers: CORS, status: 500 })
  }
})
