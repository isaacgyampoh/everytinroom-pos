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
    await fetch(`${WAWP_API}/send?instance_id=${WAWP_INSTANCE}&access_token=${WAWP_TOKEN}&chatId=${encodeURIComponent(chatId)}&message=${encodeURIComponent(message)}`, { method: 'POST' })
  } catch (e) { console.error('Send error:', e) }
}

async function sendImage(chatId: string, imageUrl: string, caption: string) {
  try {
    await fetch(`${WAWP_API}/sendImage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instance_id: WAWP_INSTANCE, access_token: WAWP_TOKEN, chatId, file: { url: imageUrl, filename: 'product.jpg', mimetype: 'image/jpeg' }, caption })
    })
  } catch (e) { console.error('Image error:', e) }
}

async function describeImage(imageUrl: string) {
  try {
    const imgResp = await fetch(imageUrl)
    const imgBuf = await imgResp.arrayBuffer()
    const bytes = new Uint8Array(imgBuf)
    let binary = ''; for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
    const base64 = btoa(binary)
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_KEY}` },
      body: JSON.stringify({ model: 'gpt-4o-mini', max_tokens: 150, messages: [{ role: 'user', content: [
        { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64}`, detail: 'low' } },
        { type: 'text', text: 'What product is this? Describe briefly in 5-10 words. Example: "blue queen size bedsheet", "stainless steel cooking pot set"' }
      ]}]})
    })
    const data = await res.json()
    return data.choices?.[0]?.message?.content || ''
  } catch (e) { console.error('Vision error:', e); return '' }
}

async function askAI(msg: string, products: any[], history: any[]) {
  const list = products.map((p, i) => `#${i} "${p.name}" GHS${p.price}${p.wholesale_price && p.wholesale_min_qty ? ` (${p.wholesale_min_qty}+ for GHS${p.wholesale_price})` : ''}${p.category ? ` [${p.category}]` : ''}`).join('\n')

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_KEY}` },
    body: JSON.stringify({ model: 'gpt-4o-mini', max_tokens: 600, temperature: 0.5, messages: [
      { role: 'system', content: `You are a real human sales assistant at ${SHOP_NAME}, Adenta Aviation Road, Accra. Phone: 024 531 5581. Nationwide delivery.

CONVERSATION STYLE:
- You are human. Never mention AI or bot.
- Chat naturally like a real shop attendant on WhatsApp.
- Keep replies to 2-3 sentences. Plain text, no formatting.
- Match the customer's language (English/Twi/Pidgin).
- Remember EVERYTHING from the conversation. If customer said they want yellow bed cover 180, and then says "give me the 160 one instead", you know they mean the yellow bed cover 160.
- When customer replies to a product image saying "I want this one" or "this one" or "give me this", understand they want the LAST product you showed them an image of.
- Be conversational. If customer says "the yellow one", figure out from context which yellow product they mean.

SHOWING IMAGES:
- When customer asks to see a product, show ONLY ONE image.
- Use: [IMG:NUMBER] where NUMBER is the # from the product list.
- NEVER show the same image twice. NEVER show multiple images unless customer explicitly asks for multiple products.
- After showing an image, ask if they'd like to order it.

ORDERING:
- When customer wants to order, confirm: product name, quantity, and total price.
- Ask "Should I create your invoice?" or "Ready to pay?"
- ONLY when customer confirms YES, add: [ORDER:NUMBER x QTY]
- For multiple items: [ORDER:5 x 2, 12 x 1]
- NUMBER is the # from the product list.
- After order tag, DO NOT add any other text. The system will add the payment link automatically.

ADDING TO EXISTING ORDER:
- If customer already has a pending order and wants to add items, tell them: "Let me create a new invoice with all your items together."
- Then create one order with ALL items: [ORDER:5 x 2, 12 x 1, 8 x 3]

PRODUCT MATCHING:
- Search the list carefully. Products might have similar names with different sizes/prices.
- "bed cover queen size yellow 180" means find the product with those words AND price GHS 180.
- "the 160 one" means the same product type but priced at GHS 160.
- If customer says "do you have X?" and you have it, say "Yes! We have [name] for GHS [price]. Would you like to see it?"
- If you have similar products at different prices, list all options.

PAYMENT: Mobile Money or card. Payment link sent with invoice.
DELIVERY: Nationwide Ghana. Fees depend on location.

PRODUCTS:
${list}` },
      ...history.slice(-12),
      { role: 'user', content: msg }
    ]})
  })
  const data = await res.json()
  if (data.error) { console.error('AI error:', data.error); return "Sorry, having trouble. Call us on 024 531 5581." }
  return data.choices?.[0]?.message?.content || "Sorry, call us on 024 531 5581."
}

async function getConversation(id: string) {
  const db = getDb()
  const { data } = await db.from('wa_conversations').select('messages,last_shown_product').eq('chat_id', id).single()
  return { messages: data?.messages || [], lastProduct: data?.last_shown_product || null }
}

async function saveConversation(id: string, msgs: any[], name: string, lastProduct: number | null) {
  const db = getDb()
  await db.from('wa_conversations').upsert({
    chat_id: id, customer_name: name,
    messages: msgs.slice(-20),
    last_shown_product: lastProduct,
    updated_at: new Date().toISOString()
  }, { onConflict: 'chat_id' })
}

async function createOrder(phone: string, name: string, orderTag: string, products: any[]) {
  const db = getDb()
  const orderItems: any[] = []; let total = 0
  const parts = orderTag.split(',').map(s => s.trim())
  for (const part of parts) {
    const m = part.match(/(\d+)\s*x\s*(\d+)/i)
    if (!m) continue
    const idx = parseInt(m[1]); const qty = parseInt(m[2])
    const p = products[idx]
    if (p) {
      const price = qty >= (p.wholesale_min_qty || 999) && p.wholesale_price ? p.wholesale_price : p.price
      const lineTotal = price * qty
      orderItems.push({ name: p.name, qty, price, lineTotal })
      total += lineTotal
    }
  }
  if (!orderItems.length) return null
  const orderNo = 'WA-' + Date.now().toString(36).toUpperCase()
  const { data, error } = await db.from('whatsapp_orders').insert({
    order_no: orderNo, date: new Date().toISOString(), customer_name: name || 'WhatsApp Customer',
    customer_phone: phone, items: orderItems, subtotal: total, delivery_fee: 0, total, status: 'Pending', notes: 'AI WhatsApp Bot'
  }).select('id').single()
  if (error) { console.error('Order error:', JSON.stringify(error)); return null }
  return { id: data?.id, total }
}

// Track sent images to prevent duplicates
const recentImages = new Map<string, Set<number>>()

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const body = await req.json()
    if (body.event !== 'message') return new Response(JSON.stringify({ ok: true }), { headers: CORS })

    const payload = body.payload || {}
    if (!payload.from || payload.fromMe) return new Response(JSON.stringify({ ok: true }), { headers: CORS })
    if (String(payload.from).includes('@g.us')) return new Response(JSON.stringify({ ok: true }), { headers: CORS })

    const sender = String(payload.from).replace('@c.us', '').replace('@s.whatsapp.net', '')
    if (!sender || sender.length < 8) return new Response(JSON.stringify({ ok: true }), { headers: CORS })

    const chatId = `${sender}@c.us`
    const customerName = payload._data?.notifyName || payload.notifyName || body.me?.pushName || 'Customer'
    const msgType = payload.type || 'chat'
    const products = await getProducts()
    const conv = await getConversation(sender)
    let history = conv.messages
    let lastShownProduct = conv.lastProduct

    // Handle IMAGE messages
    if (msgType === 'image') {
      const mediaUrl = payload._data?.mediaUrl || payload.mediaUrl || ''
      if (mediaUrl) {
        await sendText(chatId, 'Let me check what this is...')
        const desc = await describeImage(mediaUrl)
        if (desc) {
          const userMsg = `[Customer sent a photo of: ${desc}] Do you have this or something similar?`
          history.push({ role: 'user', content: userMsg })
          const ai = await askAI(userMsg, products, history)
          let reply = ai
          for (const match of [...reply.matchAll(/\[IMG:(\d+)\]/g)]) {
            const idx = parseInt(match[1])
            const p = products[idx]
            if (p?.image) { await sendImage(chatId, p.image, `${p.name}\nGHS ${p.price}`); lastShownProduct = idx }
            reply = reply.replace(match[0], '')
          }
          reply = reply.trim()
          if (reply) await sendText(chatId, reply)
          history.push({ role: 'assistant', content: ai })
          await saveConversation(sender, history, customerName, lastShownProduct)
        } else {
          await sendText(chatId, "Couldn't make out the product clearly. Could you describe what you're looking for?")
        }
      }
      return new Response(JSON.stringify({ ok: true }), { headers: CORS })
    }

    // Handle voice
    if (msgType === 'ptt' || msgType === 'audio') {
      await sendText(chatId, "Got your voice note! Please type your message so we can help you faster.")
      return new Response(JSON.stringify({ ok: true }), { headers: CORS })
    }

    // Handle text
    let msgBody = payload.body || payload.text || ''
    if (!msgBody) return new Response(JSON.stringify({ ok: true }), { headers: CORS })

    // If customer replies with "this one", "I want this", etc. and we showed them a product
    const wantsLastShown = /^(this one|i want this|give me this|i('ll| will) take (this|it)|yes.{0,10}this|that one|send me this)/i.test(msgBody.trim())
    if (wantsLastShown && lastShownProduct !== null) {
      const p = products[lastShownProduct]
      if (p) {
        msgBody = `I want to order the "${p.name}" which costs GHS ${p.price}`
      }
    }

    // If message is a reply to an image (quoted message), try to identify the product
    if (payload._data?.quotedMsg?.type === 'image' && payload._data?.quotedMsg?.caption) {
      const caption = payload._data.quotedMsg.caption
      const productFromCaption = products.find(p => caption.includes(p.name))
      if (productFromCaption) {
        msgBody = `Regarding the "${productFromCaption.name}" (GHS ${productFromCaption.price}): ${msgBody}`
      }
    }

    console.log(`MSG: ${customerName} (${sender}): ${msgBody}`)

    history.push({ role: 'user', content: msgBody })
    const aiResponse = await askAI(msgBody, products, history)
    console.log('AI:', aiResponse.slice(0, 300))

    let reply = aiResponse

    // Process images - only send each image ONCE per conversation
    if (!recentImages.has(sender)) recentImages.set(sender, new Set())
    const sentImages = recentImages.get(sender)!

    for (const match of [...reply.matchAll(/\[IMG:(\d+)\]/g)]) {
      const idx = parseInt(match[1])
      if (!sentImages.has(idx)) {
        const p = products[idx]
        if (p?.image) {
          await sendImage(chatId, p.image, `${p.name}\nGHS ${p.price}`)
          sentImages.add(idx)
          lastShownProduct = idx
        }
      }
      reply = reply.replace(match[0], '')
    }
    // Clear old tracking after 50 images
    if (sentImages.size > 50) sentImages.clear()

    // Process orders
    const orderMatch = reply.match(/\[ORDER:(.+?)\]/s)
    if (orderMatch) {
      const order = await createOrder(sender, customerName, orderMatch[1], products)
      reply = reply.replace(orderMatch[0], '')
      if (order) {
        reply = reply.trim()
        if (reply) reply += '\n\n'
        reply += `Your invoice is ready! Tap the link to fill in your delivery details and make payment:\n\nhttps://www.everytinroom.store/#/pay/${order.id}\n\nTotal: GHS ${order.total.toFixed(2)}`
        // Clear image tracking for this customer after order
        sentImages.clear()
      } else {
        reply += "\n\nSorry, couldn't process that. Please tell me the exact product and quantity."
      }
    }

    reply = reply.replace(/\n{3,}/g, '\n\n').trim()
    if (reply) await sendText(chatId, reply)

    history.push({ role: 'assistant', content: aiResponse })
    await saveConversation(sender, history, customerName, lastShownProduct)

    return new Response(JSON.stringify({ ok: true }), { headers: CORS })
  } catch (e) {
    console.error('ERROR:', e.message)
    return new Response(JSON.stringify({ error: e.message }), { headers: CORS, status: 500 })
  }
})
