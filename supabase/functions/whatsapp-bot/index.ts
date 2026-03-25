import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const WAWP_INSTANCE = Deno.env.get('WAWP_INSTANCE_ID') || ''
const WAWP_TOKEN = Deno.env.get('WAWP_ACCESS_TOKEN') || ''
const OPENAI_KEY = Deno.env.get('OPENAI_API_KEY') || ''
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || ''
const SUPABASE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const SHOP_NAME = 'EVERYTINROOM&BEDTIME'
const WAWP_BASE = 'https://app.wawp.net/api'

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

async function sendText(number, message) {
  try {
    await fetch(`${WAWP_BASE}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ number, type: 'text', message, instance_id: WAWP_INSTANCE, access_token: WAWP_TOKEN })
    })
  } catch (e) { console.error('Send text error:', e) }
}

async function sendImage(number, imageUrl, caption) {
  try {
    await fetch(`${WAWP_BASE}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ number, type: 'media', message: caption, media_url: imageUrl, instance_id: WAWP_INSTANCE, access_token: WAWP_TOKEN })
    })
  } catch (e) { console.error('Send image error:', e) }
}

async function transcribeAudio(audioUrl) {
  try {
    const audioResp = await fetch(audioUrl)
    const audioBlob = await audioResp.blob()
    const form = new FormData()
    form.append('file', audioBlob, 'voice.ogg')
    form.append('model', 'whisper-1')
    form.append('language', 'en')
    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST', headers: { 'Authorization': `Bearer ${OPENAI_KEY}` }, body: form
    })
    const data = await res.json()
    return data.text || ''
  } catch (e) { console.error('Whisper error:', e); return '' }
}

async function describeImage(imageUrl) {
  try {
    const imgResp = await fetch(imageUrl)
    const imgBuf = await imgResp.arrayBuffer()
    const base64 = btoa(String.fromCharCode(...new Uint8Array(imgBuf)))
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_KEY}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini', max_tokens: 200,
        messages: [{ role: 'user', content: [
          { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64}`, detail: 'low' } },
          { type: 'text', text: 'Describe what product this customer is looking for. Be brief. Focus on the product type.' }
        ]}]
      })
    })
    const data = await res.json()
    return data.choices?.[0]?.message?.content || ''
  } catch (e) { console.error('Vision error:', e); return '' }
}

async function askAI(customerMessage, products, conversationHistory) {
  const productList = products.map(p => {
    let info = `- ${p.name} (${p.category || 'General'}) — GHS ${p.price}`
    if (p.wholesale_price && p.wholesale_min_qty) info += ` | Wholesale: GHS ${p.wholesale_price} for ${p.wholesale_min_qty}+`
    if (p.quantity <= 3) info += ' [LOW STOCK]'
    return info
  }).join('\n')

  const messages = [
    { role: 'system', content: `You are the friendly WhatsApp sales assistant for ${SHOP_NAME}, a home furnishings shop in Adenta, Accra, Ghana. You sell cookware, curtains, bedding, kitchenware and more. Nationwide delivery across Ghana.

YOUR PERSONALITY:
- Warm, helpful, professional but conversational
- Reply in the same language the customer uses (English or Twi/Pidgin)
- Keep messages short — max 3-4 sentences per reply
- Use line breaks for readability, never use markdown or bold/italic

YOUR RULES:
1. When a customer asks about a product, search the product list and tell them what's available with prices
2. If multiple products match, list up to 5 with prices
3. If they want to see a product image, say "Let me show you" and include EXACTLY this tag: [SHOW_IMAGE:product_name] — replace product_name with the exact product name from the list
4. If they want to order, help them build their order list with quantities and calculate the total
5. When they confirm their order, say you'll send their invoice shortly and include this tag: [CREATE_ORDER:item1 x qty1, item2 x qty2]
6. If a product is not available, suggest similar alternatives from the list
7. Never make up products — only recommend what's in the product list
8. For delivery questions: "We deliver nationwide across Ghana. Delivery fees depend on your location."
9. For payment questions: "We accept Mobile Money (MTN, Vodafone, AirtelTigo) and card payments. You'll receive a secure payment link with your invoice."
10. Always be helpful even if the customer's message is vague — ask clarifying questions

AVAILABLE PRODUCTS:
${productList}

IMPORTANT: Keep responses natural and human. Never say "I'm an AI" or "I'm a bot". You are the ${SHOP_NAME} team.` },
    ...conversationHistory.slice(-10),
    { role: 'user', content: customerMessage }
  ]

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_KEY}` },
    body: JSON.stringify({ model: 'gpt-4o-mini', max_tokens: 500, messages })
  })
  const data = await res.json()
  return data.choices?.[0]?.message?.content || "Sorry, I couldn't process that. Please try again or call us directly."
}

async function getConversation(chatId) {
  const db = getDb()
  const { data } = await db.from('wa_conversations').select('messages').eq('chat_id', chatId).single()
  return data?.messages || []
}

async function saveConversation(chatId, messages, customerName) {
  const db = getDb()
  await db.from('wa_conversations').upsert({
    chat_id: chatId, customer_name: customerName,
    messages: messages.slice(-20), updated_at: new Date().toISOString()
  }, { onConflict: 'chat_id' })
}

async function createOrder(chatId, customerName, items, products) {
  const db = getDb()
  const orderItems = []; let total = 0
  for (const item of items) {
    const match = item.match(/(.+)\s*x\s*(\d+)/i)
    if (!match) continue
    const name = match[1].trim(), qty = parseInt(match[2])
    const product = products.find(p => p.name.toLowerCase().includes(name.toLowerCase()))
    if (product) {
      const price = qty >= (product.wholesale_min_qty || 999) && product.wholesale_price ? product.wholesale_price : product.price
      orderItems.push({ productId: product.id, name: product.name, price, qty })
      total += price * qty
    }
  }
  if (!orderItems.length) return null
  const { data } = await db.from('whatsapp_orders').insert({
    customer: customerName || 'WhatsApp Customer', phone: chatId,
    items: orderItems, total, status: 'Pending', date: new Date().toISOString()
  }).select().single()
  return data
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const body = await req.json()
    console.log('Webhook:', JSON.stringify(body).slice(0, 500))

    const data = body.data || body

    // Skip outgoing messages
    if (data.fromMe || data.from_me) return new Response(JSON.stringify({ ok: true }), { headers: CORS })

    // Extract sender number
    let sender = data.from || data.chatId || data.sender || data.number || ''
    sender = sender.replace('@c.us', '').replace('@s.whatsapp.net', '').replace('+', '')
    if (!sender) return new Response(JSON.stringify({ ok: true }), { headers: CORS })

    // Skip groups
    if ((data.chatId || data.from || '').includes('@g.us')) return new Response(JSON.stringify({ ok: true }), { headers: CORS })

    const customerName = data.pushName || data.notifyName || data.senderName || 'Customer'
    const products = await getProducts()
    const history = await getConversation(sender)
    let customerMessage = ''

    const msgType = data.type || data.messageType || ''
    const msgBody = data.body || data.message || data.text || ''

    if (msgType === 'chat' || msgType === 'text' || (!msgType && typeof msgBody === 'string' && msgBody)) {
      customerMessage = typeof msgBody === 'string' ? msgBody : (msgBody.body || msgBody.text || '')
    } else if (msgType === 'ptt' || msgType === 'audio') {
      const audioUrl = data.mediaUrl || data.media_url || ''
      if (audioUrl) {
        await sendText(sender, 'Got your voice note, one moment...')
        customerMessage = await transcribeAudio(audioUrl)
        if (!customerMessage) { await sendText(sender, "Sorry, I couldn't understand that. Could you type instead?"); return new Response(JSON.stringify({ ok: true }), { headers: CORS }) }
      }
    } else if (msgType === 'image') {
      const imageUrl = data.mediaUrl || data.media_url || ''
      if (imageUrl) {
        await sendText(sender, 'Let me check what product this is...')
        customerMessage = `I'm looking for: ${await describeImage(imageUrl)}`
      }
    }

    if (!customerMessage) return new Response(JSON.stringify({ ok: true }), { headers: CORS })

    history.push({ role: 'user', content: customerMessage })
    const aiResponse = await askAI(customerMessage, products, history)

    // Process image tags
    let cleanResponse = aiResponse
    for (const match of [...aiResponse.matchAll(/\[SHOW_IMAGE:(.+?)\]/g)]) {
      const product = products.find(p => p.name.toLowerCase().includes(match[1].trim().toLowerCase()))
      if (product?.image) await sendImage(sender, product.image, `${product.name}\nGHS ${product.price}`)
      cleanResponse = cleanResponse.replace(match[0], '')
    }

    // Process order
    const orderMatch = cleanResponse.match(/\[CREATE_ORDER:(.+?)\]/s)
    if (orderMatch) {
      const items = orderMatch[1].split(',').map(i => i.trim())
      const order = await createOrder(sender, customerName, items, products)
      cleanResponse = cleanResponse.replace(orderMatch[0], '')
      if (order) cleanResponse += `\n\nYour invoice is ready! Click here to fill in your delivery details and make payment:\nhttps://www.everytinroom.store/#/pay/${order.id}\n\nTotal: GHS ${order.total.toFixed(2)}`
    }

    cleanResponse = cleanResponse.trim()
    if (cleanResponse) await sendText(sender, cleanResponse)

    history.push({ role: 'assistant', content: aiResponse })
    await saveConversation(sender, history, customerName)

    return new Response(JSON.stringify({ ok: true }), { headers: CORS })
  } catch (e) {
    console.error('Bot error:', e)
    return new Response(JSON.stringify({ error: e.message }), { headers: CORS, status: 500 })
  }
})
