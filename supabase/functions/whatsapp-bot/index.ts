import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const WHATSAPP_TOKEN = Deno.env.get('WHATSAPP_TOKEN') || ''
const WHATSAPP_PHONE_ID = Deno.env.get('WHATSAPP_PHONE_ID') || ''
const VERIFY_TOKEN = Deno.env.get('WHATSAPP_VERIFY_TOKEN') || 'everytinroom_verify_2025'
const PAYSTACK_SECRET = Deno.env.get('PAYSTACK_SECRET_KEY') || ''
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || 'https://noiiuwkovoojkcwzupye.supabase.co'
const SUPABASE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''

const SHOP_NAME = 'Everytin Room'
const SHOP_PHONE = '054 920 7471'
const CURRENCY = 'GHS'

// Delivery zones and fees
const DELIVERY_ZONES = [
  { zone: 'Adenta', fee: 0, keywords: ['adenta', 'frafraha', 'lakeside', 'ogbojo', 'ashongman'] },
  { zone: 'Madina / Legon', fee: 15, keywords: ['madina', 'legon', 'haatso', 'agbogba', 'dome', 'taifa'] },
  { zone: 'East Legon / Spintex', fee: 20, keywords: ['east legon', 'spintex', 'baatsonaa', 'nmai dzorn', 'teshie', 'nungua'] },
  { zone: 'Tema', fee: 25, keywords: ['tema', 'community', 'sakumono', 'lashibi', 'devtraco'] },
  { zone: 'Accra Central / Osu', fee: 25, keywords: ['accra', 'osu', 'labone', 'cantonments', 'airport', 'dzorwulu', 'abelemkpe', 'ridge'] },
  { zone: 'Kasoa / Weija', fee: 30, keywords: ['kasoa', 'weija', 'gbawe', 'mallam', 'dansoman', 'kaneshie'] },
  { zone: 'Achimota / Lapaz', fee: 20, keywords: ['achimota', 'lapaz', 'abeka', 'tesano', 'kokomlemle', 'circle'] },
  { zone: 'Ashaiman / Kpone', fee: 30, keywords: ['ashaiman', 'kpone', 'prampram'] },
]

const getDeliveryFee = (location) => {
  const loc = location.toLowerCase()
  for (const zone of DELIVERY_ZONES) {
    if (zone.keywords.some(k => loc.includes(k))) return { zone: zone.zone, fee: zone.fee }
  }
  return null // Unknown location
}

const sb = createClient(SUPABASE_URL, SUPABASE_KEY)

// Session store (in-memory, resets on cold start — fine for flow)
const sessions = new Map()

const getSession = (phone) => {
  if (!sessions.has(phone)) sessions.set(phone, { step: 'welcome', cart: [], name: '', address: '', location: '', orderRef: '' })
  return sessions.get(phone)
}

// Send WhatsApp message
const sendMessage = async (to, text) => {
  await fetch(`https://graph.facebook.com/v18.0/${WHATSAPP_PHONE_ID}/messages`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body: text } })
  })
}

// Send interactive buttons
const sendButtons = async (to, body, buttons) => {
  await fetch(`https://graph.facebook.com/v18.0/${WHATSAPP_PHONE_ID}/messages`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp', to, type: 'interactive',
      interactive: {
        type: 'button', body: { text: body },
        action: { buttons: buttons.map((b, i) => ({ type: 'reply', reply: { id: b.id || `btn_${i}`, title: b.title.slice(0, 20) } })) }
      }
    })
  })
}

// Send list
const sendList = async (to, body, buttonText, sections) => {
  await fetch(`https://graph.facebook.com/v18.0/${WHATSAPP_PHONE_ID}/messages`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp', to, type: 'interactive',
      interactive: {
        type: 'list', body: { text: body },
        action: { button: buttonText, sections }
      }
    })
  })
}

// Get products from DB
const getProducts = async () => {
  const { data } = await sb.from('products').select('*').gt('quantity', 0).order('name')
  return data || []
}

// Get categories
const getCategories = async () => {
  const products = await getProducts()
  const cats = [...new Set(products.filter(p => p.category).map(p => p.category))]
  return cats
}

// Search products
const searchProducts = async (query) => {
  const products = await getProducts()
  const q = query.toLowerCase()
  return products.filter(p => p.name.toLowerCase().includes(q) || (p.category || '').toLowerCase().includes(q))
}

// Create Paystack payment link
const createPaymentLink = async (amount, email, reference, customerName) => {
  const res = await fetch('https://api.paystack.co/transaction/initialize', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${PAYSTACK_SECRET}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      amount: Math.round(amount * 100), // Paystack uses pesewas
      email: email || 'customer@everytinroom.shop',
      reference,
      currency: 'GHS',
      channels: ['mobile_money'],
      metadata: { customer_name: customerName, source: 'whatsapp_bot' },
      callback_url: `${SUPABASE_URL}/functions/v1/whatsapp-bot?action=payment_callback&ref=${reference}`
    })
  })
  const data = await res.json()
  return data?.data?.authorization_url || null
}

// Format money
const fmt = (n) => `${CURRENCY} ${Number(n).toFixed(2)}`

// Generate order number
const genOrderNo = () => 'WA' + new Date().toISOString().slice(0, 10).replace(/-/g, '') + '-' + String(Math.floor(Math.random() * 900) + 100)

// Process incoming message
const processMessage = async (from, messageText, messageType, buttonId) => {
  const session = getSession(from)
  const text = (messageText || '').trim()
  const textLower = text.toLowerCase()

  // Reset commands
  if (['hi', 'hello', 'hey', 'start', 'menu', 'restart', '0'].includes(textLower)) {
    session.step = 'welcome'; session.cart = []; session.name = ''; session.address = ''; session.location = ''
  }

  switch (session.step) {
    case 'welcome': {
      session.step = 'main_menu'
      await sendMessage(from,
        `👋 Welcome to *${SHOP_NAME}*!\n` +
        `Your One Stop Shop 🏠\n\n` +
        `How can I help you today?\n\n` +
        `1️⃣ *Browse Categories* - See what we have\n` +
        `2️⃣ *Search Product* - Find something specific\n` +
        `3️⃣ *View Cart* - Check your cart\n` +
        `4️⃣ *Track Order* - Check order status\n` +
        `5️⃣ *Delivery Zones* - See delivery fees\n` +
        `6️⃣ *Talk to Staff* - Need help?\n\n` +
        `_Just type a number or the option name!_`
      )
      break
    }

    case 'main_menu': {
      if (textLower.includes('1') || textLower.includes('browse') || textLower.includes('categor')) {
        const cats = await getCategories()
        if (cats.length === 0) {
          await sendMessage(from, '😕 No products available right now. Please check back later!')
          break
        }
        let msg = `📂 *Product Categories*\n\n`
        cats.forEach((c, i) => { msg += `${i + 1}. ${c}\n` })
        msg += `\n_Type the category name or number to see products._\n_Or type a product name to search directly!_`
        session.step = 'browse_category'
        session.categories = cats
        await sendMessage(from, msg)
      }
      else if (textLower.includes('2') || textLower.includes('search') || textLower.includes('find')) {
        session.step = 'search'
        await sendMessage(from, '🔍 *Search Products*\n\nWhat are you looking for? Type the product name:')
      }
      else if (textLower.includes('3') || textLower.includes('cart')) {
        await showCart(from, session)
      }
      else if (textLower.includes('4') || textLower.includes('track')) {
        session.step = 'track_order'
        await sendMessage(from, '📦 *Track Order*\n\nPlease enter your order number (e.g. WA20250228-123):')
      }
      else if (textLower.includes('5') || textLower.includes('deliver') || textLower.includes('zone')) {
        let msg = `🚚 *Delivery Zones & Fees*\n\n`
        DELIVERY_ZONES.forEach(z => { msg += `📍 *${z.zone}* — ${z.fee === 0 ? 'FREE 🎉' : fmt(z.fee)}\n` })
        msg += `\n_Location not listed? Send us your area and we'll quote you._\n\nType *menu* to go back.`
        await sendMessage(from, msg)
      }
      else if (textLower.includes('6') || textLower.includes('staff') || textLower.includes('help') || textLower.includes('talk')) {
        await sendMessage(from, `📞 *Contact Us*\n\nCall/WhatsApp: ${SHOP_PHONE}\n📍 Adenta Aviation Road\n🌐 Erbliving.shop\n\nA team member will respond shortly!\n\nType *menu* to go back.`)
      }
      else {
        // Try searching if they typed a product name
        const results = await searchProducts(text)
        if (results.length > 0) {
          await showSearchResults(from, session, results, text)
        } else {
          await sendMessage(from, `I didn't understand that. Please type a number (1-6) or type *menu* to see options again.`)
        }
      }
      break
    }

    case 'browse_category': {
      const cats = session.categories || []
      let selectedCat = null

      // Check if they typed a number
      const num = parseInt(text)
      if (num >= 1 && num <= cats.length) selectedCat = cats[num - 1]
      // Or category name
      if (!selectedCat) selectedCat = cats.find(c => c.toLowerCase().includes(textLower))
      // Or maybe they're searching a product directly
      if (!selectedCat) {
        const results = await searchProducts(text)
        if (results.length > 0) { await showSearchResults(from, session, results, text); break }
        await sendMessage(from, `Category not found. Please type a valid category number or name.\n\nType *menu* to go back.`)
        break
      }

      const products = (await getProducts()).filter(p => p.category === selectedCat)
      if (products.length === 0) {
        await sendMessage(from, `No products in *${selectedCat}* right now.\n\nType *menu* to go back.`)
        break
      }

      let msg = `📦 *${selectedCat}*\n\n`
      products.forEach((p, i) => {
        msg += `*${i + 1}. ${p.name}*\n`
        msg += `   💰 ${fmt(p.price)} • ${p.quantity} in stock\n\n`
      })
      msg += `_To add to cart, type the product number and quantity._\n_Example: *1 x 2* (adds 2 of item 1)_\n_Or just type the number to add 1._\n\nType *menu* for main menu.`

      session.step = 'select_product'
      session.currentProducts = products
      await sendMessage(from, msg)
      break
    }

    case 'search': {
      if (text.length < 2) { await sendMessage(from, 'Please type at least 2 characters to search.'); break }
      const results = await searchProducts(text)
      await showSearchResults(from, session, results, text)
      break
    }

    case 'select_product': {
      const products = session.currentProducts || []

      // Parse "1 x 2" or "1x2" or just "1"
      const match = text.match(/^(\d+)\s*[xX×*]?\s*(\d+)?$/)
      if (!match) {
        // Maybe they're searching
        if (textLower === 'cart' || textLower === '3') { await showCart(from, session); break }
        const results = await searchProducts(text)
        if (results.length > 0) { await showSearchResults(from, session, results, text); break }
        await sendMessage(from, `Invalid selection. Type a product number (e.g. *1*) or *1 x 3* for quantity.\n\nType *cart* to view cart or *menu* for main menu.`)
        break
      }

      const idx = parseInt(match[1]) - 1
      const qty = parseInt(match[2]) || 1

      if (idx < 0 || idx >= products.length) {
        await sendMessage(from, `Product number ${idx + 1} not found. Please choose from the list.`)
        break
      }

      const product = products[idx]
      if (qty > product.quantity) {
        await sendMessage(from, `Sorry, only *${product.quantity}* of *${product.name}* available.`)
        break
      }

      // Add to cart
      const existing = session.cart.find(c => c.id === product.id)
      if (existing) {
        if (existing.qty + qty > product.quantity) {
          await sendMessage(from, `Sorry, only *${product.quantity}* available. You already have ${existing.qty} in cart.`)
          break
        }
        existing.qty += qty
      } else {
        session.cart.push({ id: product.id, name: product.name, price: Number(product.price), qty, maxQty: product.quantity })
      }

      const cartTotal = session.cart.reduce((a, c) => a + c.price * c.qty, 0)
      await sendMessage(from,
        `✅ Added to cart!\n\n` +
        `*${product.name}* x ${qty} — ${fmt(product.price * qty)}\n\n` +
        `🛒 Cart: ${session.cart.length} items • ${fmt(cartTotal)}\n\n` +
        `_Continue shopping or type *cart* to checkout._`
      )
      break
    }

    case 'track_order': {
      const { data: order } = await sb.from('whatsapp_orders').select('*').eq('order_no', text.toUpperCase()).single()
      if (!order) {
        await sendMessage(from, `❌ Order *${text}* not found.\n\nPlease check the order number and try again.\nType *menu* to go back.`)
      } else {
        const statusEmoji = { 'Pending': '⏳', 'Confirmed': '✅', 'Processing': '📦', 'Shipped': '🚚', 'Delivered': '✅', 'Cancelled': '❌' }
        await sendMessage(from,
          `📦 *Order ${order.order_no}*\n\n` +
          `Status: ${statusEmoji[order.status] || '📋'} *${order.status}*\n` +
          `Date: ${new Date(order.date).toLocaleDateString('en-GB')}\n` +
          `Total: *${fmt(order.total)}*\n` +
          `Payment: ${order.paid_at ? '✅ Paid' : '⏳ Pending'}\n\n` +
          `Type *menu* to go back.`
        )
      }
      session.step = 'main_menu'
      break
    }

    case 'checkout_name': {
      if (text.length < 2) { await sendMessage(from, 'Please enter your full name:'); break }
      session.name = text
      session.step = 'checkout_location'
      await sendMessage(from, `Thanks, *${text}*! 😊\n\n📍 What area/location should we deliver to?\n\n_Example: Adenta, Madina, East Legon, Tema, etc._`)
      break
    }

    case 'checkout_location': {
      session.location = text
      const zone = getDeliveryFee(text)

      if (!zone) {
        session.step = 'checkout_location_confirm'
        await sendMessage(from,
          `📍 *${text}*\n\n` +
          `This area is not in our standard delivery zones.\n` +
          `We'll need to confirm the delivery fee with you.\n\n` +
          `Would you like to:\n` +
          `1. *Proceed* — We'll call you to confirm fee\n` +
          `2. *Change location*\n` +
          `3. *Cancel order*`
        )
        break
      }

      session.deliveryFee = zone.fee
      session.deliveryZone = zone.zone
      session.step = 'checkout_address'
      await sendMessage(from,
        `📍 *${zone.zone}*\n` +
        `Delivery fee: ${zone.fee === 0 ? 'FREE! 🎉' : fmt(zone.fee)}\n\n` +
        `Please enter your *full delivery address*:\n_Example: House No. 5, Otano St, Adenta_`
      )
      break
    }

    case 'checkout_location_confirm': {
      if (textLower.includes('1') || textLower.includes('proceed')) {
        session.deliveryFee = 0
        session.deliveryZone = session.location
        session.step = 'checkout_address'
        await sendMessage(from, `Okay! We'll confirm the delivery fee when we call.\n\nPlease enter your *full delivery address*:`)
      } else if (textLower.includes('2') || textLower.includes('change')) {
        session.step = 'checkout_location'
        await sendMessage(from, '📍 What area should we deliver to?')
      } else {
        session.step = 'main_menu'; session.cart = []
        await sendMessage(from, 'Order cancelled. Type *menu* to start again.')
      }
      break
    }

    case 'checkout_address': {
      if (text.length < 5) { await sendMessage(from, 'Please enter a more detailed address:'); break }
      session.address = text

      const subtotal = session.cart.reduce((a, c) => a + c.price * c.qty, 0)
      const deliveryFee = session.deliveryFee || 0
      const total = subtotal + deliveryFee

      let summary = `📋 *Order Summary*\n\n`
      summary += `👤 ${session.name}\n📍 ${session.address}\n🚚 ${session.deliveryZone || session.location}\n\n`
      summary += `*Items:*\n`
      session.cart.forEach(c => { summary += `  • ${c.name} x${c.qty} — ${fmt(c.price * c.qty)}\n` })
      summary += `\nSubtotal: ${fmt(subtotal)}\n`
      summary += `Delivery: ${deliveryFee === 0 ? 'FREE 🎉' : fmt(deliveryFee)}\n`
      summary += `*Total: ${fmt(total)}*\n\n`
      summary += `Type *confirm* to proceed to payment\nType *cancel* to cancel`

      session.step = 'checkout_confirm'
      session.subtotal = subtotal
      session.total = total
      await sendMessage(from, summary)
      break
    }

    case 'checkout_confirm': {
      if (textLower.includes('confirm') || textLower === 'yes' || textLower === 'y') {
        // Generate order
        const orderNo = genOrderNo()
        session.orderRef = orderNo

        // Create Paystack payment link
        const paymentUrl = await createPaymentLink(
          session.total,
          `${from}@whatsapp.everytinroom.shop`,
          orderNo,
          session.name
        )

        // Save order to DB
        const items = session.cart.map(c => ({ productId: c.id, name: c.name, price: c.price, qty: c.qty }))
        await sb.from('whatsapp_orders').insert({
          order_no: orderNo,
          date: new Date().toISOString(),
          customer_name: session.name,
          customer_phone: from,
          items,
          subtotal: session.subtotal,
          delivery_fee: session.deliveryFee || 0,
          total: session.total,
          address: `${session.address}, ${session.deliveryZone || session.location}`,
          notes: '',
          status: 'Pending',
          paystack_ref: orderNo,
        })

        if (paymentUrl) {
          await sendMessage(from,
            `✅ *Order ${orderNo} Created!*\n\n` +
            `💰 Total: *${fmt(session.total)}*\n\n` +
            `📱 *Click to pay via Mobile Money:*\n${paymentUrl}\n\n` +
            `⏳ Payment link expires in 30 minutes.\n\n` +
            `After payment, you'll receive confirmation automatically.\n\n` +
            `Need help? Call ${SHOP_PHONE}`
          )
        } else {
          await sendMessage(from,
            `✅ *Order ${orderNo} Created!*\n\n` +
            `💰 Total: *${fmt(session.total)}*\n\n` +
            `⚠️ Payment link could not be generated.\n` +
            `Please call ${SHOP_PHONE} to make payment.\n\n` +
            `Your order has been saved and our team will contact you shortly.`
          )
        }

        // Reset session
        session.step = 'main_menu'
        session.cart = []
        session.name = ''
        session.address = ''
        session.location = ''
      }
      else if (textLower.includes('cancel') || textLower === 'no' || textLower === 'n') {
        session.step = 'main_menu'; session.cart = []
        await sendMessage(from, '❌ Order cancelled.\n\nType *menu* to start again.')
      }
      else {
        await sendMessage(from, 'Type *confirm* to proceed to payment or *cancel* to cancel.')
      }
      break
    }

    default: {
      session.step = 'welcome'
      await processMessage(from, text, messageType, buttonId)
    }
  }
}

// Show cart
const showCart = async (from, session) => {
  if (session.cart.length === 0) {
    session.step = 'main_menu'
    await sendMessage(from, '🛒 Your cart is empty!\n\nType *1* to browse products or *2* to search.')
    return
  }

  let msg = `🛒 *Your Cart*\n\n`
  const total = session.cart.reduce((a, c) => a + c.price * c.qty, 0)
  session.cart.forEach((c, i) => { msg += `${i + 1}. *${c.name}* x${c.qty} — ${fmt(c.price * c.qty)}\n` })
  msg += `\n*Subtotal: ${fmt(total)}*\n_(Delivery fee added at checkout)_\n\n`
  msg += `Type *checkout* to proceed\n`
  msg += `Type *clear* to empty cart\n`
  msg += `Type *remove 1* to remove item 1\n`
  msg += `Type *menu* to continue shopping`

  session.step = 'cart_action'
  await sendMessage(from, msg)
}

// Show search results
const showSearchResults = async (from, session, results, query) => {
  if (results.length === 0) {
    await sendMessage(from, `🔍 No results for "${query}"\n\nTry a different search term or type *1* to browse categories.`)
    session.step = 'main_menu'
    return
  }

  const shown = results.slice(0, 10)
  let msg = `🔍 *Results for "${query}"*\n\n`
  shown.forEach((p, i) => {
    msg += `*${i + 1}. ${p.name}*\n`
    msg += `   💰 ${fmt(p.price)} • ${p.quantity} in stock\n\n`
  })
  if (results.length > 10) msg += `_...and ${results.length - 10} more results_\n\n`
  msg += `_Type the number and quantity to add._\n_Example: *1 x 2*_\n\nType *menu* for main menu.`

  session.step = 'select_product'
  session.currentProducts = shown
  await sendMessage(from, msg)
}

serve(async (req) => {
  const url = new URL(req.url)

  // WhatsApp webhook verification (GET)
  if (req.method === 'GET') {
    const mode = url.searchParams.get('hub.mode')
    const token = url.searchParams.get('hub.verify_token')
    const challenge = url.searchParams.get('hub.challenge')
    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      return new Response(challenge, { status: 200 })
    }
    return new Response('Forbidden', { status: 403 })
  }

  // Payment callback from Paystack
  const action = url.searchParams.get('action')
  if (action === 'payment_callback') {
    const ref = url.searchParams.get('ref') || url.searchParams.get('reference')
    if (ref) {
      // Verify payment with Paystack
      const verifyRes = await fetch(`https://api.paystack.co/transaction/verify/${ref}`, {
        headers: { 'Authorization': `Bearer ${PAYSTACK_SECRET}` }
      })
      const verifyData = await verifyRes.json()

      if (verifyData?.data?.status === 'success') {
        // Update order as paid
        await sb.from('whatsapp_orders').update({ paid_at: new Date().toISOString(), paystack_ref: ref }).eq('order_no', ref)

        // Get order to send confirmation
        const { data: order } = await sb.from('whatsapp_orders').select('*').eq('order_no', ref).single()
        if (order?.customer_phone) {
          await sendMessage(order.customer_phone,
            `🎉 *Payment Confirmed!*\n\n` +
            `Order: *${order.order_no}*\n` +
            `Amount: *${fmt(order.total)}*\n\n` +
            `✅ Your order is now being processed.\n` +
            `📦 We'll prepare and deliver to:\n${order.address}\n\n` +
            `Thank you for shopping with ${SHOP_NAME}! 🙏`
          )
        }
      }
    }
    // Redirect customer back
    return new Response('<html><body><h2>Payment processed! Check your WhatsApp for confirmation.</h2><script>window.close()</script></body></html>', {
      headers: { 'Content-Type': 'text/html' }
    })
  }

  // Paystack webhook (payment verification)
  if (action === 'paystack_webhook') {
    try {
      const body = await req.json()
      if (body.event === 'charge.success') {
        const ref = body.data?.reference
        if (ref) {
          await sb.from('whatsapp_orders').update({ paid_at: new Date().toISOString(), paystack_ref: ref }).eq('order_no', ref)
          const { data: order } = await sb.from('whatsapp_orders').select('*').eq('order_no', ref).single()
          if (order?.customer_phone) {
            await sendMessage(order.customer_phone,
              `🎉 *Payment Confirmed!*\n\n` +
              `Order: *${order.order_no}*\nAmount: *${fmt(order.total)}*\n\n` +
              `✅ Your order is being processed.\n📦 Delivery to: ${order.address}\n\nThank you! 🙏`
            )
          }
        }
      }
    } catch {}
    return new Response(JSON.stringify({ received: true }), { headers: { 'Content-Type': 'application/json' } })
  }

  // Incoming WhatsApp message (POST)
  try {
    const body = await req.json()
    const entry = body?.entry?.[0]
    const changes = entry?.changes?.[0]
    const value = changes?.value
    const message = value?.messages?.[0]

    if (!message) return new Response(JSON.stringify({ status: 'no message' }), { headers: { 'Content-Type': 'application/json' } })

    const from = message.from
    const messageType = message.type
    let messageText = ''
    let buttonId = ''

    if (messageType === 'text') messageText = message.text?.body || ''
    else if (messageType === 'interactive') {
      if (message.interactive?.type === 'button_reply') {
        buttonId = message.interactive.button_reply?.id || ''
        messageText = message.interactive.button_reply?.title || ''
      } else if (message.interactive?.type === 'list_reply') {
        buttonId = message.interactive.list_reply?.id || ''
        messageText = message.interactive.list_reply?.title || ''
      }
    }

    // Handle cart actions before main flow
    const session = getSession(from)
    if (session.step === 'cart_action') {
      const textLower = messageText.toLowerCase().trim()
      if (textLower === 'checkout') {
        session.step = 'checkout_name'
        await sendMessage(from, '📝 *Checkout*\n\nWhat is your *full name*?')
        return new Response(JSON.stringify({ status: 'ok' }), { headers: { 'Content-Type': 'application/json' } })
      } else if (textLower === 'clear') {
        session.cart = []; session.step = 'main_menu'
        await sendMessage(from, '🗑️ Cart cleared!\n\nType *menu* to continue.')
        return new Response(JSON.stringify({ status: 'ok' }), { headers: { 'Content-Type': 'application/json' } })
      } else if (textLower.startsWith('remove')) {
        const idx = parseInt(textLower.replace('remove', '').trim()) - 1
        if (idx >= 0 && idx < session.cart.length) {
          const removed = session.cart.splice(idx, 1)[0]
          await sendMessage(from, `✅ Removed *${removed.name}* from cart.`)
          await showCart(from, session)
        } else {
          await sendMessage(from, 'Invalid item number.')
        }
        return new Response(JSON.stringify({ status: 'ok' }), { headers: { 'Content-Type': 'application/json' } })
      } else {
        session.step = 'main_menu'
      }
    }

    await processMessage(from, messageText, messageType, buttonId)
    return new Response(JSON.stringify({ status: 'ok' }), { headers: { 'Content-Type': 'application/json' } })

  } catch (err) {
    console.error('Bot error:', err)
    return new Response(JSON.stringify({ error: err.message }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
})
