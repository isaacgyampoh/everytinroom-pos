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

async function sendText(chatId: string, message: string) {
  try {
    const res = await fetch(`${WAWP_API}/send?instance_id=${WAWP_INSTANCE}&access_token=${WAWP_TOKEN}&chatId=${encodeURIComponent(chatId)}&message=${encodeURIComponent(message)}`, { method: 'POST' })
    console.log('Sent to', chatId, ':', (await res.text()).slice(0, 100))
  } catch (e) { console.error('Send error:', e) }
}

async function sendImage(chatId: string, imageUrl: string, caption: string) {
  try {
    const url = `${WAWP_API}/sendImage?instance_id=${WAWP_INSTANCE}&access_token=${WAWP_TOKEN}&chatId=${encodeURIComponent(chatId)}&file%5Burl%5D=${encodeURIComponent(imageUrl)}&file%5Bfilename%5D=product.jpg&file%5Bmimetype%5D=image/jpeg&caption=${encodeURIComponent(caption)}`
    const res = await fetch(url, { method: 'POST' })
    console.log('Image sent:', (await res.text()).slice(0, 100))
  } catch (e) { console.error('Image error:', e) }
}

async function askAI(msg: string, products: any[], history: any[]) {
  const list = products.map(p => {
    let s = `${p.name} | Category: ${p.category || 'General'} | Price: GHS ${p.price}`
    if (p.wholesale_price && p.wholesale_min_qty) s += ` | Buy ${p.wholesale_min_qty}+ for GHS ${p.wholesale_price} each`
    if (p.quantity <= 3) s += ' | LOW STOCK'
    return s
  }).join('\n')

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_KEY}` },
    body: JSON.stringify({ model: 'gpt-4o-mini', max_tokens: 600, temperature: 0.7, messages: [
      { role: 'system', content: `You are a human sales assistant for ${SHOP_NAME}, a home furnishings and bedding shop located at Adenta Aviation Road, Accra, Ghana. Phone: 024 531 5581 / 024 936 5339. We do nationwide delivery across Ghana.

HOW TO BEHAVE:
- You are a real person, part of the ${SHOP_NAME} team. NEVER say you are AI or a bot.
- Be warm, friendly, and professional. Like chatting with a helpful shop assistant.
- Keep messages SHORT - 2 to 4 sentences max. This is WhatsApp, not email.
- Use plain text only. No bold, no italic, no bullet points, no markdown.
- Reply in whatever language the customer uses (English, Twi, Pidgin).
- If a customer greets you (hi, hello, etc), greet them back warmly and ask how you can help.

WHEN CUSTOMER ASKS ABOUT PRODUCTS:
- Search the product list below carefully
- Only mention products that ACTUALLY exist in the list
- Include the exact price for each product
- If you find matching products, list them naturally like: "We have the [name] for GHS [price]"
- If no exact match, suggest the closest alternatives
- NEVER invent or make up product names or prices

WHEN CUSTOMER WANTS TO SEE A PRODUCT PHOTO:
- Say something like "Here's what it looks like" or "Let me show you"
- Then add this exact tag on its own line: [IMG:exact product name from list]
- Example: [IMG:3-in-1 Bedsheet Set Blue]
- ONLY use product names exactly as they appear in the list below

WHEN CUSTOMER WANTS TO ORDER:
- Confirm what they want and the quantity
- Calculate the total
- Ask them to confirm
- When they say YES or confirm, create the order by adding this tag on its own line:
  [ORDER:Product Name x Quantity, Another Product x Quantity]
- Example: [ORDER:3-in-1 Bedsheet Set Blue x 2, Pillow Case White x 4]

ABOUT DELIVERY:
- We deliver nationwide across Ghana
- Delivery fees depend on location and will be communicated after order confirmation

ABOUT PAYMENT:
- We accept Mobile Money (MTN, Vodafone, AirtelTigo) and card payments
- Customer will receive a secure payment link with their invoice

HERE ARE ALL OUR AVAILABLE PRODUCTS:
${list}

CRITICAL RULES:
- Only recommend products from the list above
- Never make up products that don't exist
- Keep every response under 4 sentences
- Be human and natural` },
      ...history.slice(-8),
      { role: 'user', content: msg }
    ]})
  })
  const data = await res.json()
  if (data.error) { console.error('OpenAI error:', data.error); return "Sorry, I'm having trouble right now. Please call us on 024 531 5581." }
  return data.choices?.[0]?.message?.content || "Sorry, please try again or call us on 024 531 5581."
}

async function getConversation(id: string) {
  const db = getDb()
  const { data } = await db.from('wa_conversations').select('messages').eq('chat_id', id).single()
  return data?.messages || []
}

async function saveConversation(id: string, msgs: any[], name: string) {
  const db = getDb()
  await db.from('wa_conversations').upsert({ chat_id: id, customer_name: name, messages: msgs.slice(-16), updated_at: new Date().toISOString() }, { onConflict: 'chat_id' })
}

async function createOrder(phone: string, name: string, items: string[], products: any[]) {
  const db = getDb()
  const orderItems: any[] = []; let total = 0
  for (const item of items) {
    const m = item.match(/(.+?)\s*x\s*(\d+)/i)
    if (!m) continue
    const searchName = m[1].trim().toLowerCase()
    const p = products.find(x => x.name.toLowerCase() === searchName || x.name.toLowerCase().includes(searchName))
    if (p) {
      const qty = parseInt(m[2])
      const price = qty >= (p.wholesale_min_qty || 999) && p.wholesale_price ? p.wholesale_price : p.price
      orderItems.push({ productId: p.id, name: p.name, price, qty })
      total += price * qty
    }
  }
  if (!orderItems.length) return null
  const { data } = await db.from('whatsapp_orders').insert({
    customer: name || 'WhatsApp Customer',
    phone: phone,
    items: orderItems,
    total,
    status: 'Pending',
    date: new Date().toISOString()
  }).select().single()
  return data
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const body = await req.json()
    const event = body.event || ''

    // FIX DOUBLE MESSAGES: Only process 'message' event, ignore 'message.any'
    if (event !== 'message') {
      return new Response(JSON.stringify({ ok: true }), { headers: CORS })
    }

    const payload = body.payload || {}
    if (!payload.from) return new Response(JSON.stringify({ ok: true }), { headers: CORS })

    // Skip our own messages
    if (payload.fromMe) return new Response(JSON.stringify({ ok: true }), { headers: CORS })

    // Skip groups
    if (String(payload.from).includes('@g.us')) return new Response(JSON.stringify({ ok: true }), { headers: CORS })

    const sender = String(payload.from).replace('@c.us', '').replace('@s.whatsapp.net', '')
    if (!sender || sender.length < 8) return new Response(JSON.stringify({ ok: true }), { headers: CORS })

    // Get message content
    const msgType = payload.type || 'chat'
    let msgBody = ''

    if (msgType === 'chat' || msgType === 'text') {
      msgBody = payload.body || payload.text || ''
    } else if (msgType === 'ptt' || msgType === 'audio') {
      const chatId = `${sender}@c.us`
      await sendText(chatId, "Got your voice note! Please type your message so we can help you faster.")
      return new Response(JSON.stringify({ ok: true }), { headers: CORS })
    } else if (msgType === 'image') {
      const chatId = `${sender}@c.us`
      await sendText(chatId, "Thanks for the photo! Could you describe what product you're looking for?")
      return new Response(JSON.stringify({ ok: true }), { headers: CORS })
    }

    if (!msgBody) return new Response(JSON.stringify({ ok: true }), { headers: CORS })

    const chatId = `${sender}@c.us`
    const customerName = payload._data?.notifyName || payload.notifyName || body.me?.pushName || 'Customer'
    console.log(`MSG from ${customerName} (${sender}): ${msgBody}`)

    // Get products and conversation
    const products = await getProducts()
    const history = await getConversation(sender)
    history.push({ role: 'user', content: msgBody })

    // Get AI response
    const aiResponse = await askAI(msgBody, products, history)
    console.log('AI:', aiResponse.slice(0, 300))

    let reply = aiResponse

    // Process image tags [IMG:product name]
    const imgMatches = [...reply.matchAll(/\[IMG:(.+?)\]/g)]
    for (const match of imgMatches) {
      const name = match[1].trim()
      const product = products.find(p =>
        p.name.toLowerCase() === name.toLowerCase() ||
        p.name.toLowerCase().includes(name.toLowerCase()) ||
        name.toLowerCase().includes(p.name.toLowerCase())
      )
      if (product?.image) {
        await sendImage(chatId, product.image, `${product.name}\nGHS ${product.price}`)
      }
      reply = reply.replace(match[0], '')
    }

    // Process order tags [ORDER:items]
    const orderMatch = reply.match(/\[ORDER:(.+?)\]/s)
    if (orderMatch) {
      const itemsRaw = orderMatch[1]
      const items = itemsRaw.split(',').map(i => i.trim()).filter(Boolean)
      const order = await createOrder(sender, customerName, items, products)
      reply = reply.replace(orderMatch[0], '')
      if (order) {
        reply += `\n\nYour invoice is ready! Tap the link below to fill in your delivery details and make payment:\n\nhttps://www.everytinroom.store/#/pay/${order.id}\n\nTotal: GHS ${order.total.toFixed(2)}`
      } else {
        reply += "\n\nSorry, I couldn't create the order. Could you tell me the exact product name and quantity again?"
      }
    }

    // Clean up and send
    reply = reply.replace(/\n{3,}/g, '\n\n').trim()
    if (reply) await sendText(chatId, reply)

    // Save conversation
    history.push({ role: 'assistant', content: aiResponse })
    await saveConversation(sender, history, customerName)

    return new Response(JSON.stringify({ ok: true }), { headers: CORS })
  } catch (e) {
    console.error('ERROR:', e.message)
    return new Response(JSON.stringify({ error: e.message }), { headers: CORS, status: 500 })
  }
})
