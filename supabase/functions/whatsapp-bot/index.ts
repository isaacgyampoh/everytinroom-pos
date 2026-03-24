import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const WHAPI_TOKEN = Deno.env.get('WHAPI_TOKEN') || ''
const OPENAI_KEY = Deno.env.get('OPENAI_API_KEY') || ''
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || ''
const SUPABASE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const BOT_NUMBER = '233533547740'
const SHOP_NAME = 'EVERYTINROOM&BEDTIME'
const WHAPI_BASE = 'https://gate.whapi.cloud'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
}

// Get Supabase client
function getDb() {
  return createClient(SUPABASE_URL, SUPABASE_KEY)
}

// Get all products from database
async function getProducts() {
  const db = getDb()
  const { data } = await db.from('products').select('id,name,category,price,wholesale_price,wholesale_min_qty,quantity,image').gt('quantity', 0).order('name')
  return data || []
}

// Send text message via Whapi
async function sendText(to, text) {
  await fetch(`${WHAPI_BASE}/messages/text`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${WHAPI_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ to, body: text })
  })
}

// Send image with caption via Whapi
async function sendImage(to, imageUrl, caption) {
  await fetch(`${WHAPI_BASE}/messages/image`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${WHAPI_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ to, media: { url: imageUrl }, caption })
  })
}

// Transcribe voice note using OpenAI Whisper
async function transcribeAudio(audioUrl) {
  try {
    // Download audio from Whapi
    const audioResp = await fetch(audioUrl, {
      headers: { 'Authorization': `Bearer ${WHAPI_TOKEN}` }
    })
    const audioBlob = await audioResp.blob()

    // Send to OpenAI Whisper
    const form = new FormData()
    form.append('file', audioBlob, 'voice.ogg')
    form.append('model', 'whisper-1')
    form.append('language', 'en')

    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${OPENAI_KEY}` },
      body: form
    })
    const data = await res.json()
    return data.text || ''
  } catch (e) {
    console.error('Whisper error:', e)
    return ''
  }
}

// Describe image using OpenAI Vision
async function describeImage(imageUrl) {
  try {
    // Download image from Whapi
    const imgResp = await fetch(imageUrl, {
      headers: { 'Authorization': `Bearer ${WHAPI_TOKEN}` }
    })
    const imgBuf = await imgResp.arrayBuffer()
    const base64 = btoa(String.fromCharCode(...new Uint8Array(imgBuf)))

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_KEY}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        max_tokens: 200,
        messages: [{
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64}`, detail: 'low' } },
            { type: 'text', text: 'Describe what product this customer is looking for based on this image. Be brief and specific. Focus on the type of product (e.g. bedsheet, cookware, curtain, pillow).' }
          ]
        }]
      })
    })
    const data = await res.json()
    return data.choices?.[0]?.message?.content || ''
  } catch (e) {
    console.error('Vision error:', e)
    return ''
  }
}

// Ask GPT to process the customer message and match products
async function askAI(customerMessage, products, conversationHistory) {
  const productList = products.map(p => {
    let info = `- ${p.name} (${p.category || 'General'}) — GHS ${p.price}`
    if (p.wholesale_price && p.wholesale_min_qty) info += ` | Wholesale: GHS ${p.wholesale_price} for ${p.wholesale_min_qty}+`
    if (p.quantity <= 3) info += ' [LOW STOCK]'
    return info
  }).join('\n')

  const messages = [
    {
      role: 'system',
      content: `You are the friendly WhatsApp sales assistant for ${SHOP_NAME}, a home furnishings shop in Adenta, Accra, Ghana. You sell cookware, curtains, bedding, kitchenware and more. Nationwide delivery across Ghana.

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

IMPORTANT: Keep responses natural and human. Never say "I'm an AI" or "I'm a bot". You are the ${SHOP_NAME} team.`
    },
    ...conversationHistory.slice(-10), // Last 10 messages for context
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

// Store conversation in database
async function getConversation(chatId) {
  const db = getDb()
  const { data } = await db.from('wa_conversations').select('messages').eq('chat_id', chatId).single()
  return data?.messages || []
}

async function saveConversation(chatId, messages, customerName) {
  const db = getDb()
  await db.from('wa_conversations').upsert({
    chat_id: chatId,
    customer_name: customerName,
    messages: messages.slice(-20), // Keep last 20 messages
    updated_at: new Date().toISOString()
  }, { onConflict: 'chat_id' })
}

// Create WhatsApp order in database
async function createOrder(chatId, customerName, items, products) {
  const db = getDb()
  const orderItems = []
  let total = 0

  for (const item of items) {
    const match = item.match(/(.+)\s*x\s*(\d+)/i)
    if (!match) continue
    const name = match[1].trim()
    const qty = parseInt(match[2])
    const product = products.find(p => p.name.toLowerCase().includes(name.toLowerCase()))
    if (product) {
      const price = qty >= (product.wholesale_min_qty || 999) && product.wholesale_price ? product.wholesale_price : product.price
      orderItems.push({ productId: product.id, name: product.name, price, qty })
      total += price * qty
    }
  }

  if (orderItems.length === 0) return null

  const { data } = await db.from('whatsapp_orders').insert({
    customer: customerName || 'WhatsApp Customer',
    phone: chatId.replace('@s.whatsapp.net', ''),
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

    // Whapi sends messages in a messages array
    const messages = body.messages || []
    if (!messages.length) return new Response(JSON.stringify({ ok: true }), { headers: CORS })

    for (const msg of messages) {
      // Skip outgoing messages (from us)
      if (msg.from_me) continue

      // Skip group messages
      if (msg.chat_id?.includes('@g.us')) continue

      const chatId = msg.chat_id || ''
      const customerName = msg.from_name || 'Customer'
      const customerNumber = chatId.replace('@s.whatsapp.net', '')

      // Get products and conversation history
      const products = await getProducts()
      const history = await getConversation(chatId)

      let customerMessage = ''

      // Handle text messages
      if (msg.type === 'text' && msg.text?.body) {
        customerMessage = msg.text.body
      }
      // Handle voice notes
      else if (msg.type === 'audio' || msg.type === 'ptt') {
        const audioUrl = msg.audio?.link || msg.ptt?.link || ''
        if (audioUrl) {
          await sendText(chatId, '🎤 Got your voice note, one moment...')
          customerMessage = await transcribeAudio(audioUrl)
          if (!customerMessage) {
            await sendText(chatId, "Sorry, I couldn't understand that voice note. Could you type your message instead?")
            continue
          }
        }
      }
      // Handle images
      else if (msg.type === 'image') {
        const imageUrl = msg.image?.link || ''
        if (imageUrl) {
          await sendText(chatId, 'Let me check what product this is...')
          const description = await describeImage(imageUrl)
          customerMessage = `I'm looking for this product: ${description}`
        }
      }
      // Skip other message types
      else {
        continue
      }

      if (!customerMessage) continue

      // Update conversation history
      history.push({ role: 'user', content: customerMessage })

      // Get AI response
      const aiResponse = await askAI(customerMessage, products, history)

      // Check for image tags [SHOW_IMAGE:product_name]
      const imageMatches = aiResponse.matchAll(/\[SHOW_IMAGE:(.+?)\]/g)
      let cleanResponse = aiResponse

      for (const match of imageMatches) {
        const productName = match[1].trim()
        const product = products.find(p => p.name.toLowerCase().includes(productName.toLowerCase()))
        if (product?.image) {
          await sendImage(chatId, product.image, `${product.name}\nGHS ${product.price}`)
        }
        cleanResponse = cleanResponse.replace(match[0], '')
      }

      // Check for order creation [CREATE_ORDER:...]
      const orderMatch = cleanResponse.match(/\[CREATE_ORDER:(.+?)\]/s)
      if (orderMatch) {
        const itemsStr = orderMatch[1]
        const items = itemsStr.split(',').map(i => i.trim())
        const order = await createOrder(chatId, customerName, items, products)
        if (order) {
          const invoiceUrl = `https://www.everytinroom.store/#/pay/${order.id}`
          cleanResponse = cleanResponse.replace(orderMatch[0], '')
          cleanResponse += `\n\nYour invoice is ready! Click here to fill in your delivery details and make payment:\n${invoiceUrl}\n\nTotal: GHS ${order.total.toFixed(2)}`
        }
        cleanResponse = cleanResponse.replace(orderMatch[0], '')
      }

      // Send the clean response
      cleanResponse = cleanResponse.trim()
      if (cleanResponse) {
        await sendText(chatId, cleanResponse)
      }

      // Save conversation
      history.push({ role: 'assistant', content: aiResponse })
      await saveConversation(chatId, history, customerName)
    }

    return new Response(JSON.stringify({ ok: true }), { headers: CORS })
  } catch (e) {
    console.error('Bot error:', e)
    return new Response(JSON.stringify({ error: e.message }), { headers: CORS, status: 500 })
  }
})
