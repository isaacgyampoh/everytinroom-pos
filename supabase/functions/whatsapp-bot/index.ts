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
    console.log('Sent:', (await res.text()).slice(0, 80))
  } catch (e) { console.error('Send error:', e) }
}

async function sendImage(chatId: string, imageUrl: string, caption: string) {
  try {
    // Use POST body instead of URL params for image
    const res = await fetch(`${WAWP_API}/sendImage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        instance_id: WAWP_INSTANCE,
        access_token: WAWP_TOKEN,
        chatId: chatId,
        file: { url: imageUrl, filename: 'product.jpg', mimetype: 'image/jpeg' },
        caption: caption
      })
    })
    const r = await res.text()
    console.log('Image result:', r.slice(0, 100))
    // If JSON body didn't work, try URL params
    if (r.includes('error') || r.includes('false')) {
      const url2 = `${WAWP_API}/sendImage?instance_id=${WAWP_INSTANCE}&access_token=${WAWP_TOKEN}&chatId=${encodeURIComponent(chatId)}&file%5Burl%5D=${encodeURIComponent(imageUrl)}&file%5Bfilename%5D=product.jpg&file%5Bmimetype%5D=image/jpeg&caption=${encodeURIComponent(caption)}`
      const res2 = await fetch(url2, { method: 'POST' })
      console.log('Image fallback:', (await res2.text()).slice(0, 100))
    }
  } catch (e) { console.error('Image error:', e) }
}

// Describe image using OpenAI Vision
async function describeImage(imageUrl: string) {
  try {
    const imgResp = await fetch(imageUrl)
    const imgBuf = await imgResp.arrayBuffer()
    const bytes = new Uint8Array(imgBuf)
    // Convert to base64 in chunks to avoid stack overflow
    let binary = ''
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
    const base64 = btoa(binary)

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_KEY}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini', max_tokens: 150,
        messages: [{ role: 'user', content: [
          { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64}`, detail: 'low' } },
          { type: 'text', text: 'What product is in this image? Describe it briefly - type of product, color, material. Example: "blue bedsheet set", "stainless steel pot", "white curtain". Keep it to 5-10 words.' }
        ]}]
      })
    })
    const data = await res.json()
    return data.choices?.[0]?.message?.content || ''
  } catch (e) { console.error('Vision error:', e); return '' }
}

async function askAI(msg: string, products: any[], history: any[]) {
  // Build product list with IDs for exact matching
  const list = products.map((p, i) => {
    let s = `[${i}] ${p.name} | GHS ${p.price}`
    if (p.category) s += ` | ${p.category}`
    if (p.wholesale_price && p.wholesale_min_qty) s += ` | Buy ${p.wholesale_min_qty}+ for GHS ${p.wholesale_price} each`
    return s
  }).join('\n')

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_KEY}` },
    body: JSON.stringify({ model: 'gpt-4o-mini', max_tokens: 600, temperature: 0.6, messages: [
      { role: 'system', content: `You are a human sales assistant for ${SHOP_NAME}, a home furnishings shop at Adenta Aviation Road, Accra, Ghana. Phone: 024 531 5581.

PERSONALITY: Warm, friendly, professional. You are a real person. NEVER mention AI or bot.
FORMAT: Plain text only. Max 3 sentences. No markdown, no bold, no bullets.
LANGUAGE: Reply in whatever language the customer uses.

WHEN CUSTOMER ASKS ABOUT PRODUCTS:
- Search the product list and mention ONLY products that exist
- Always include the GHS price
- If no match, suggest closest alternatives

SHOWING PRODUCT IMAGES:
When customer wants to see a product, put this on its own line:
[IMG:NUMBER]
where NUMBER is the product number from the list. Example: [IMG:5]
You can show multiple: [IMG:3] [IMG:7]

CREATING ORDERS:
When customer confirms they want to buy, put this on its own line:
[ORDER:NUMBER x QUANTITY]
Multiple items: [ORDER:5 x 2, 12 x 1]
Use the product NUMBER from the list, not the name.

DELIVERY: Nationwide across Ghana. Fees depend on location.
PAYMENT: Mobile Money or card. Secure payment link sent with invoice.

PRODUCT LIST:
${list}` },
      ...history.slice(-8),
      { role: 'user', content: msg }
    ]})
  })
  const data = await res.json()
  if (data.error) { console.error('AI error:', data.error); return "Sorry, having trouble. Call us on 024 531 5581." }
  return data.choices?.[0]?.message?.content || "Sorry, please call us on 024 531 5581."
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

async function createOrder(phone: string, name: string, orderTag: string, products: any[]) {
  const db = getDb()
  const orderItems: any[] = []; let total = 0
  
  // Parse [ORDER:5 x 2, 12 x 1] format (using product index numbers)
  const parts = orderTag.split(',').map(s => s.trim())
  for (const part of parts) {
    const m = part.match(/(\d+)\s*x\s*(\d+)/i)
    if (!m) continue
    const idx = parseInt(m[1])
    const qty = parseInt(m[2])
    const p = products[idx]
    if (p) {
      const price = qty >= (p.wholesale_min_qty || 999) && p.wholesale_price ? p.wholesale_price : p.price
      orderItems.push({ productId: p.id, name: p.name, price, qty })
      total += price * qty
      console.log(`Order item: ${p.name} x${qty} @ GHS ${price}`)
    } else {
      console.log(`Product index ${idx} not found`)
    }
  }

  if (!orderItems.length) {
    console.log('No valid order items from:', orderTag)
    return null
  }
  
  const { data, error } = await db.from('whatsapp_orders').insert({
    customer: name || 'WhatsApp Customer',
    phone: phone,
    items: orderItems,
    total,
    status: 'Pending',
    date: new Date().toISOString()
  }).select().single()
  
  if (error) console.error('Order DB error:', error)
  console.log('Order created:', data?.id, 'Total:', total)
  return data
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const body = await req.json()
    const event = body.event || ''

    // Only process 'message' event — skip message.any, message_ack, etc.
    if (event !== 'message') return new Response(JSON.stringify({ ok: true }), { headers: CORS })

    const payload = body.payload || {}
    if (!payload.from || payload.fromMe) return new Response(JSON.stringify({ ok: true }), { headers: CORS })
    if (String(payload.from).includes('@g.us')) return new Response(JSON.stringify({ ok: true }), { headers: CORS })

    const sender = String(payload.from).replace('@c.us', '').replace('@s.whatsapp.net', '')
    if (!sender || sender.length < 8) return new Response(JSON.stringify({ ok: true }), { headers: CORS })

    const chatId = `${sender}@c.us`
    const customerName = payload._data?.notifyName || payload.notifyName || body.me?.pushName || 'Customer'
    const msgType = payload.type || 'chat'

    // Get products early — needed for everything
    const products = await getProducts()

    // Handle IMAGE messages — use Vision API
    if (msgType === 'image') {
      const mediaUrl = payload._data?.mediaUrl || payload.mediaUrl || ''
      if (mediaUrl) {
        await sendText(chatId, 'Let me check what this is...')
        const description = await describeImage(mediaUrl)
        if (description) {
          // Search products based on AI description
          const history = await getConversation(sender)
          history.push({ role: 'user', content: `Customer sent a photo. The image shows: ${description}. Do you have this or anything similar?` })
          const aiResponse = await askAI(`Customer sent a photo of a product. The image shows: ${description}. Do you have this or anything similar in stock?`, products, history)
          
          let reply = aiResponse
          // Process image tags
          for (const match of [...reply.matchAll(/\[IMG:(\d+)\]/g)]) {
            const p = products[parseInt(match[1])]
            if (p?.image) await sendImage(chatId, p.image, `${p.name}\nGHS ${p.price}`)
            reply = reply.replace(match[0], '')
          }
          reply = reply.trim()
          if (reply) await sendText(chatId, reply)
          
          history.push({ role: 'assistant', content: aiResponse })
          await saveConversation(sender, history, customerName)
        } else {
          await sendText(chatId, "I couldn't make out the product clearly. Could you describe what you're looking for?")
        }
      } else {
        await sendText(chatId, "Thanks for the photo! Could you describe what product you're looking for?")
      }
      return new Response(JSON.stringify({ ok: true }), { headers: CORS })
    }

    // Handle voice notes
    if (msgType === 'ptt' || msgType === 'audio') {
      await sendText(chatId, "Got your voice note! Please type your message so we can help you faster.")
      return new Response(JSON.stringify({ ok: true }), { headers: CORS })
    }

    // Handle text messages
    const msgBody = payload.body || payload.text || ''
    if (!msgBody) return new Response(JSON.stringify({ ok: true }), { headers: CORS })

    console.log(`MSG from ${customerName} (${sender}): ${msgBody}`)

    const history = await getConversation(sender)
    history.push({ role: 'user', content: msgBody })

    const aiResponse = await askAI(msgBody, products, history)
    console.log('AI:', aiResponse.slice(0, 300))

    let reply = aiResponse

    // Process image tags [IMG:NUMBER]
    for (const match of [...reply.matchAll(/\[IMG:(\d+)\]/g)]) {
      const idx = parseInt(match[1])
      const p = products[idx]
      if (p?.image) {
        await sendImage(chatId, p.image, `${p.name}\nGHS ${p.price}`)
        console.log('Sent image for:', p.name)
      } else {
        console.log('No image for index:', idx)
      }
      reply = reply.replace(match[0], '')
    }

    // Process order tags [ORDER:5 x 2, 12 x 1]
    const orderMatch = reply.match(/\[ORDER:(.+?)\]/s)
    if (orderMatch) {
      const order = await createOrder(sender, customerName, orderMatch[1], products)
      reply = reply.replace(orderMatch[0], '')
      if (order) {
        reply += `\n\nYour invoice is ready! Tap below to fill in your delivery details and make payment:\n\nhttps://www.everytinroom.store/#/pay/${order.id}\n\nTotal: GHS ${order.total.toFixed(2)}`
      } else {
        reply += "\n\nSorry, I couldn't process that order. Please tell me the product name and quantity again."
      }
    }

    reply = reply.replace(/\n{3,}/g, '\n\n').trim()
    if (reply) await sendText(chatId, reply)

    history.push({ role: 'assistant', content: aiResponse })
    await saveConversation(sender, history, customerName)

    return new Response(JSON.stringify({ ok: true }), { headers: CORS })
  } catch (e) {
    console.error('ERROR:', e.message)
    return new Response(JSON.stringify({ error: e.message }), { headers: CORS, status: 500 })
  }
})
