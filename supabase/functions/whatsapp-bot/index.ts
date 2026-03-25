import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const WAWP_INSTANCE = Deno.env.get('WAWP_INSTANCE_ID') || ''
const WAWP_TOKEN = Deno.env.get('WAWP_ACCESS_TOKEN') || ''
const OPENAI_KEY = Deno.env.get('OPENAI_API_KEY') || ''
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || ''
const SUPABASE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const SHOP_NAME = 'EVERYTINROOM&BEDTIME'
const WAWP_API = 'https://wawp.net/wp-json/awp/v1'

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Content-Type': 'application/json' }

function getDb() { return createClient(SUPABASE_URL, SUPABASE_KEY) }

async function getProducts() {
  const db = getDb()
  const { data } = await db.from('products').select('id,name,category,price,wholesale_price,wholesale_min_qty,quantity,image').gt('quantity', 0).order('name')
  return data || []
}

// Fetch latest messages from a chat via WAWP API
async function fetchMessages(chatId: string) {
  try {
    const url = `${WAWP_API}/chats/${chatId}/messages?instance_id=${WAWP_INSTANCE}&access_token=${WAWP_TOKEN}&limit=1&downloadMedia=false`
    console.log('Fetching messages from:', url)
    const res = await fetch(url, { method: 'POST' })
    const data = await res.json()
    console.log('Fetched messages:', JSON.stringify(data).slice(0, 500))
    return data
  } catch (e) { console.error('Fetch messages error:', e); return null }
}

async function sendText(chatId: string, message: string) {
  try {
    const url = `${WAWP_API}/send?instance_id=${WAWP_INSTANCE}&access_token=${WAWP_TOKEN}&chatId=${chatId}&message=${encodeURIComponent(message)}`
    const res = await fetch(url, { method: 'POST' })
    const r = await res.text()
    console.log('Send result:', r)
  } catch (e) { console.error('Send error:', e) }
}

async function sendImage(chatId: string, imageUrl: string, caption: string) {
  try {
    const url = `${WAWP_API}/sendImage?instance_id=${WAWP_INSTANCE}&access_token=${WAWP_TOKEN}&chatId=${chatId}&file[url]=${encodeURIComponent(imageUrl)}&file[filename]=product.jpg&file[mimetype]=image/jpeg&caption=${encodeURIComponent(caption)}`
    await fetch(url, { method: 'POST' })
  } catch (e) { console.error('Send image error:', e) }
}

async function askAI(msg: string, products: any[], history: any[]) {
  const list = products.map(p => {
    let s = `- ${p.name} (${p.category || 'General'}) — GHS ${p.price}`
    if (p.wholesale_price && p.wholesale_min_qty) s += ` | Wholesale: GHS ${p.wholesale_price} for ${p.wholesale_min_qty}+`
    return s
  }).join('\n')

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_KEY}` },
    body: JSON.stringify({ model: 'gpt-4o-mini', max_tokens: 500, messages: [
      { role: 'system', content: `You are the friendly WhatsApp sales assistant for ${SHOP_NAME}, a home furnishings shop in Adenta, Accra, Ghana. Nationwide delivery.

RULES:
- Short replies, max 3-4 sentences. No markdown.
- Search products and share what's available with prices
- To show an image: [SHOW_IMAGE:exact_product_name]
- To create order: [CREATE_ORDER:item1 x qty1, item2 x qty2]
- Never say you're AI. You are the ${SHOP_NAME} team.
- Reply in customer's language (English/Twi/Pidgin)

PRODUCTS:\n${list}` },
      ...history.slice(-10),
      { role: 'user', content: msg }
    ]})
  })
  const data = await res.json()
  return data.choices?.[0]?.message?.content || "Sorry, please try again or call us."
}

async function getConversation(id: string) {
  const db = getDb()
  const { data } = await db.from('wa_conversations').select('messages').eq('chat_id', id).single()
  return data?.messages || []
}

async function saveConversation(id: string, msgs: any[], name: string) {
  const db = getDb()
  await db.from('wa_conversations').upsert({ chat_id: id, customer_name: name, messages: msgs.slice(-20), updated_at: new Date().toISOString() }, { onConflict: 'chat_id' })
}

async function createOrder(id: string, name: string, items: string[], products: any[]) {
  const db = getDb()
  const oi: any[] = []; let total = 0
  for (const item of items) {
    const m = item.match(/(.+)\s*x\s*(\d+)/i); if (!m) continue
    const p = products.find(x => x.name.toLowerCase().includes(m[1].trim().toLowerCase()))
    if (p) { const q = parseInt(m[2]); const pr = q >= (p.wholesale_min_qty||999) && p.wholesale_price ? p.wholesale_price : p.price; oi.push({ productId: p.id, name: p.name, price: pr, qty: q }); total += pr * q }
  }
  if (!oi.length) return null
  const { data } = await db.from('whatsapp_orders').insert({ customer: name, phone: id.replace('@c.us',''), items: oi, total, status: 'Pending', date: new Date().toISOString() }).select().single()
  return data
}

// Track processed message IDs to avoid duplicates
const processed = new Set<string>()

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const body = await req.json()
    const event = body.event || ''
    console.log('Event:', event)

    // Only process actual message events
    if (event !== 'message' && event !== 'message.any') {
      return new Response(JSON.stringify({ ok: true }), { headers: CORS })
    }

    // Check if payload has message data directly
    const payload = body.payload || {}
    console.log('Payload:', JSON.stringify(payload).slice(0, 500))

    let sender = ''
    let msgBody = ''
    let msgType = ''
    let fromMe = false
    let customerName = ''
    let mediaUrl = ''

    if (payload.from) {
      // WAWP sends payload with message details
      sender = String(payload.from).replace('@c.us', '').replace('@s.whatsapp.net', '')
      fromMe = payload.fromMe || false
      customerName = payload._data?.notifyName || payload.notifyName || body.me?.pushName || 'Customer'
      msgType = payload.type || 'chat'

      if (msgType === 'chat' || msgType === 'text') {
        msgBody = payload.body || payload.text || ''
      } else if (msgType === 'ptt' || msgType === 'audio') {
        mediaUrl = payload.mediaUrl || payload._data?.mediaUrl || ''
      } else if (msgType === 'image') {
        mediaUrl = payload.mediaUrl || payload._data?.mediaUrl || ''
      }

      console.log('From payload - Sender:', sender, 'Body:', msgBody, 'Type:', msgType, 'FromMe:', fromMe)
    }

    // If no sender from payload, try fetching latest messages
    if (!sender && !fromMe) {
      console.log('No sender in payload, checking if we can extract from webhook')
      // The webhook might just be a notification - skip if no data
      return new Response(JSON.stringify({ ok: true }), { headers: CORS })
    }

    if (fromMe || !sender || sender.length < 8) {
      console.log('Skipping: fromMe or no sender')
      return new Response(JSON.stringify({ ok: true }), { headers: CORS })
    }

    // Skip groups
    if (String(payload.from || '').includes('@g.us')) {
      return new Response(JSON.stringify({ ok: true }), { headers: CORS })
    }

    // Skip duplicate messages
    const msgId = payload.id || body.id || ''
    if (msgId && processed.has(msgId)) {
      console.log('Duplicate, skipping:', msgId)
      return new Response(JSON.stringify({ ok: true }), { headers: CORS })
    }
    if (msgId) processed.add(msgId)
    // Keep set small
    if (processed.size > 100) processed.clear()

    const chatId = `${sender}@c.us`

    // Handle voice/image (skip for now if no direct URL)
    if (!msgBody && (msgType === 'ptt' || msgType === 'audio')) {
      await sendText(chatId, "Got your voice note! For now, please type your message so I can help you faster.")
      return new Response(JSON.stringify({ ok: true }), { headers: CORS })
    }
    if (!msgBody && msgType === 'image') {
      await sendText(chatId, "Thanks for the image! Could you also describe what product you're looking for?")
      return new Response(JSON.stringify({ ok: true }), { headers: CORS })
    }

    if (!msgBody) {
      console.log('No message body, skipping')
      return new Response(JSON.stringify({ ok: true }), { headers: CORS })
    }

    console.log('Processing:', sender, msgBody)

    const products = await getProducts()
    const history = await getConversation(sender)
    history.push({ role: 'user', content: msgBody })

    const aiResponse = await askAI(msgBody, products, history)
    console.log('AI:', aiResponse.slice(0, 200))

    // Handle images
    let clean = aiResponse
    for (const match of [...aiResponse.matchAll(/\[SHOW_IMAGE:(.+?)\]/g)]) {
      const p = products.find(x => x.name.toLowerCase().includes(match[1].trim().toLowerCase()))
      if (p?.image) await sendImage(chatId, p.image, `${p.name}\nGHS ${p.price}`)
      clean = clean.replace(match[0], '')
    }

    // Handle orders
    const om = clean.match(/\[CREATE_ORDER:(.+?)\]/s)
    if (om) {
      const items = om[1].split(',').map(i => i.trim())
      const order = await createOrder(sender, customerName, items, products)
      clean = clean.replace(om[0], '')
      if (order) clean += `\n\nYour invoice is ready! Click to pay:\nhttps://www.everytinroom.store/#/pay/${order.id}\n\nTotal: GHS ${order.total.toFixed(2)}`
    }

    clean = clean.trim()
    if (clean) await sendText(chatId, clean)

    history.push({ role: 'assistant', content: aiResponse })
    await saveConversation(sender, history, customerName)

    return new Response(JSON.stringify({ ok: true }), { headers: CORS })
  } catch (e) {
    console.error('ERROR:', e.message, e.stack)
    return new Response(JSON.stringify({ error: e.message }), { headers: CORS, status: 500 })
  }
})
