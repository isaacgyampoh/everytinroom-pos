import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const WAWP_INSTANCE = Deno.env.get('WAWP_INSTANCE_ID') || ''
const WAWP_TOKEN = Deno.env.get('WAWP_ACCESS_TOKEN') || ''
const OPENAI_KEY = Deno.env.get('OPENAI_API_KEY') || ''
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || ''
const SUPABASE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const SHOP_NAME = 'EVERYTINROOM&BEDTIME'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
}

function getDb() { return createClient(SUPABASE_URL, SUPABASE_KEY) }

async function getProducts() {
  const db = getDb()
  const { data } = await db.from('products').select('id,name,category,price,wholesale_price,wholesale_min_qty,quantity,image').gt('quantity', 0).order('name')
  return data || []
}

async function sendText(number: string, message: string) {
  const res = await fetch('https://app.wawp.net/api/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ number, type: 'text', message, instance_id: WAWP_INSTANCE, access_token: WAWP_TOKEN })
  })
  const r = await res.text()
  console.log('SEND RESULT:', r)
}

async function sendImage(number: string, imageUrl: string, caption: string) {
  await fetch('https://app.wawp.net/api/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ number, type: 'media', message: caption, media_url: imageUrl, instance_id: WAWP_INSTANCE, access_token: WAWP_TOKEN })
  })
}

async function askAI(customerMessage: string, products: any[], history: any[]) {
  const productList = products.map(p => {
    let info = `- ${p.name} (${p.category || 'General'}) — GHS ${p.price}`
    if (p.wholesale_price && p.wholesale_min_qty) info += ` | Wholesale: GHS ${p.wholesale_price} for ${p.wholesale_min_qty}+`
    return info
  }).join('\n')

  const msgs = [
    { role: 'system', content: `You are the friendly WhatsApp sales assistant for ${SHOP_NAME}, a home furnishings shop in Adenta, Accra, Ghana. Nationwide delivery across Ghana.

RULES:
- Keep replies short, max 3-4 sentences
- Never use markdown, bold, or italic
- Search the product list and tell customers what's available with prices
- If they want images, include [SHOW_IMAGE:exact_product_name]
- If they confirm an order, include [CREATE_ORDER:item1 x qty1, item2 x qty2]
- Never say you're AI or a bot
- Reply in the customer's language

PRODUCTS:
${productList}` },
    ...history.slice(-10),
    { role: 'user', content: customerMessage }
  ]

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_KEY}` },
    body: JSON.stringify({ model: 'gpt-4o-mini', max_tokens: 500, messages: msgs })
  })
  const data = await res.json()
  return data.choices?.[0]?.message?.content || "Sorry, please try again or call us."
}

async function getConversation(chatId: string) {
  const db = getDb()
  const { data } = await db.from('wa_conversations').select('messages').eq('chat_id', chatId).single()
  return data?.messages || []
}

async function saveConversation(chatId: string, messages: any[], name: string) {
  const db = getDb()
  await db.from('wa_conversations').upsert({ chat_id: chatId, customer_name: name, messages: messages.slice(-20), updated_at: new Date().toISOString() }, { onConflict: 'chat_id' })
}

async function createOrder(chatId: string, name: string, items: string[], products: any[]) {
  const db = getDb()
  const orderItems: any[] = []; let total = 0
  for (const item of items) {
    const m = item.match(/(.+)\s*x\s*(\d+)/i)
    if (!m) continue
    const product = products.find(p => p.name.toLowerCase().includes(m[1].trim().toLowerCase()))
    if (product) {
      const qty = parseInt(m[2])
      const price = qty >= (product.wholesale_min_qty || 999) && product.wholesale_price ? product.wholesale_price : product.price
      orderItems.push({ productId: product.id, name: product.name, price, qty })
      total += price * qty
    }
  }
  if (!orderItems.length) return null
  const { data } = await db.from('whatsapp_orders').insert({ customer: name, phone: chatId, items: orderItems, total, status: 'Pending', date: new Date().toISOString() }).select().single()
  return data
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const body = await req.json()
    
    // LOG EVERYTHING to debug
    console.log('=== FULL WEBHOOK BODY ===')
    console.log(JSON.stringify(body))
    
    // Try to extract event type
    const event = body.event || body.type || ''
    console.log('Event type:', event)
    
    // Skip non-message events (ack, status, etc)
    if (event && !event.includes('message') && event !== 'chat') {
      console.log('Skipping non-message event:', event)
      return new Response(JSON.stringify({ ok: true }), { headers: CORS })
    }
    
    // Skip message_ack events
    if (event === 'message_ack' || event === 'message.ack') {
      console.log('Skipping ack event')
      return new Response(JSON.stringify({ ok: true }), { headers: CORS })
    }

    // Extract data - WAWP might nest it differently
    const data = body.data || body.message || body
    console.log('Extracted data:', JSON.stringify(data).slice(0, 300))

    // Skip if from us
    const fromMe = data.fromMe ?? data.from_me ?? body.fromMe ?? false
    if (fromMe) { console.log('Skipping: from me'); return new Response(JSON.stringify({ ok: true }), { headers: CORS }) }

    // Get sender number - try multiple fields
    let sender = data.from || data.chatId || data.sender || data.number || data.phone || body.from || body.chatId || body.sender || ''
    sender = String(sender).replace('@c.us', '').replace('@s.whatsapp.net', '').replace('+', '').replace(/\D/g, '')
    console.log('Sender:', sender)
    
    if (!sender || sender.length < 8) { console.log('No valid sender'); return new Response(JSON.stringify({ ok: true }), { headers: CORS }) }

    // Skip groups
    const chatCheck = data.chatId || data.from || body.chatId || ''
    if (String(chatCheck).includes('@g.us')) { console.log('Skipping group'); return new Response(JSON.stringify({ ok: true }), { headers: CORS }) }

    // Get message body - try multiple fields
    const msgBody = data.body || data.message || data.text || body.body || body.message || body.text || ''
    const customerMessage = typeof msgBody === 'object' ? (msgBody.body || msgBody.text || msgBody.message || '') : String(msgBody)
    console.log('Message:', customerMessage)

    if (!customerMessage || customerMessage.length === 0) { console.log('No message content'); return new Response(JSON.stringify({ ok: true }), { headers: CORS }) }

    const customerName = data.pushName || data.notifyName || data.senderName || data.displayName || body.pushName || body.notifyName || 'Customer'
    console.log('Customer:', customerName, '| Sender:', sender, '| Message:', customerMessage)

    // Process with AI
    const products = await getProducts()
    const history = await getConversation(sender)
    history.push({ role: 'user', content: customerMessage })

    const aiResponse = await askAI(customerMessage, products, history)
    console.log('AI Response:', aiResponse.slice(0, 200))

    // Handle image tags
    let clean = aiResponse
    for (const match of [...aiResponse.matchAll(/\[SHOW_IMAGE:(.+?)\]/g)]) {
      const product = products.find(p => p.name.toLowerCase().includes(match[1].trim().toLowerCase()))
      if (product?.image) await sendImage(sender, product.image, `${product.name}\nGHS ${product.price}`)
      clean = clean.replace(match[0], '')
    }

    // Handle order creation
    const orderMatch = clean.match(/\[CREATE_ORDER:(.+?)\]/s)
    if (orderMatch) {
      const items = orderMatch[1].split(',').map(i => i.trim())
      const order = await createOrder(sender, customerName, items, products)
      clean = clean.replace(orderMatch[0], '')
      if (order) clean += `\n\nYour invoice is ready! Click to pay:\nhttps://www.everytinroom.store/#/pay/${order.id}\n\nTotal: GHS ${order.total.toFixed(2)}`
    }

    clean = clean.trim()
    if (clean) {
      console.log('Sending reply to:', sender)
      await sendText(sender, clean)
    }

    history.push({ role: 'assistant', content: aiResponse })
    await saveConversation(sender, history, customerName)

    return new Response(JSON.stringify({ ok: true }), { headers: CORS })
  } catch (e) {
    console.error('BOT ERROR:', e.message, e.stack)
    return new Response(JSON.stringify({ error: e.message }), { headers: CORS, status: 500 })
  }
})
