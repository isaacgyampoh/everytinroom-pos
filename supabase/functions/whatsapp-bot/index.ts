import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const WAWP_INSTANCE = Deno.env.get('WAWP_INSTANCE_ID') || ''
const WAWP_TOKEN = Deno.env.get('WAWP_ACCESS_TOKEN') || ''
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || ''
const SUPABASE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const WAWP_API = 'https://wawp.net/wp-json/awp/v1'
const CATALOG = 'https://www.everytinroom.store/#/catalog'
const PHONE = '053 354 7740'

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Content-Type': 'application/json' }

function getDb() { return createClient(SUPABASE_URL, SUPABASE_KEY) }

async function sendText(chatId: string, msg: string) {
  try { await fetch(`${WAWP_API}/send?instance_id=${WAWP_INSTANCE}&access_token=${WAWP_TOKEN}&chatId=${encodeURIComponent(chatId)}&message=${encodeURIComponent(msg)}`, { method: 'POST' }) } catch (e) { console.error(e) }
}

function timeGreet(): string {
  const h = new Date().getUTCHours()
  if (h >= 5 && h < 12) return 'Good morning'
  if (h >= 12 && h < 17) return 'Good afternoon'
  return 'Good evening'
}

// Search products database for keyword matches
async function findProducts(query: string): Promise<string[]> {
  const db = getDb()
  const { data } = await db.from('products').select('name,category').gt('quantity', 0)
  if (!data) return []
  const q = query.toLowerCase()
  const matches = data.filter(p => {
    const n = p.name.toLowerCase()
    const c = (p.category || '').toLowerCase()
    return n.includes(q) || c.includes(q) || q.split(' ').some(w => w.length > 3 && (n.includes(w) || c.includes(w)))
  })
  return [...new Set(matches.map(m => m.category || m.name.split(' ')[0]))]
}

// Extract product keywords from message
function getProductKeywords(msg: string): string[] {
  const words = ['bedsheet', 'bed sheet', 'bed cover', 'bedcover', 'duvet', 'pillow', 'blanket',
    'curtain', 'towel', 'cookware', 'pot', 'pan', 'frying', 'kettle', 'flask',
    'rack', 'shelf', 'hanger', 'mat', 'rug', 'carpet', 'toilet', 'bathroom',
    'kitchen', 'plate', 'cup', 'glass', 'bowl', 'spoon', 'fork', 'knife',
    'iron', 'blender', 'dispenser', 'container', 'basket', 'bin', 'bucket',
    'mop', 'broom', 'duster', 'cloth', 'napkin', 'apron', 'oven', 'cooker']
  const lower = msg.toLowerCase()
  return words.filter(w => lower.includes(w))
}

const lastReply = new Map<string, number>()

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const body = await req.json()

    // Handle payment confirmation
    if (body.action === 'send_confirmation' && body.chatId && body.message) {
      await sendText(body.chatId, body.message)
      return new Response(JSON.stringify({ ok: true }), { headers: CORS })
    }

    if (body.event !== 'message') return new Response(JSON.stringify({ ok: true }), { headers: CORS })

    const payload = body.payload || {}
    if (!payload.from || payload.fromMe) return new Response(JSON.stringify({ ok: true }), { headers: CORS })
    if (String(payload.from).includes('@g.us')) return new Response(JSON.stringify({ ok: true }), { headers: CORS })

    const sender = String(payload.from).replace('@c.us', '').replace('@s.whatsapp.net', '')
    if (!sender || sender.length < 8) return new Response(JSON.stringify({ ok: true }), { headers: CORS })

    const chatId = `${sender}@c.us`
    const msg = String(payload.body || payload.text || '').trim()
    if (!msg) return new Response(JSON.stringify({ ok: true }), { headers: CORS })

    // 5 second cooldown
    const now = Date.now()
    if (now - (lastReply.get(sender) || 0) < 5000) return new Response(JSON.stringify({ ok: true }), { headers: CORS })
    lastReply.set(sender, now)
    if (lastReply.size > 300) lastReply.clear()

    const name = payload._data?.notifyName || payload.notifyName || body.me?.pushName || ''
    const hi = name ? ` ${name}` : ''
    const lower = msg.toLowerCase().trim()

    console.log(`${name} (${sender}): ${msg}`)

    let reply = ''

    // 1. GREETING
    if (/^(hi|hello|hey|good\s?(morning|afternoon|evening)|yo|sup|hii+|helo+|howdy|hy)[\s!.,?]*$/i.test(lower) || lower === 'hi' || lower === 'hello') {
      reply = `${timeGreet()}${hi}! This is EVERYTINROOM&BEDTIME, how may we help you?`
    }

    // 2. PRODUCT INQUIRY - check if they mention a product
    else if (getProductKeywords(msg).length > 0) {
      const keywords = getProductKeywords(msg)
      const found = await findProducts(keywords[0])
      if (found.length > 0) {
        reply = `Yes${hi}, we have ${keywords[0]}s available! Please click on this link to select the exact type and design you want:\n\n${CATALOG}\n\nJust send your order and we'll prepare your invoice within the shortest possible time so you can make payment and fill in your delivery details.\n\nIf you need any help, feel free to message us or call ${PHONE}.`
      } else {
        reply = `Sorry${hi}, we don't currently have ${keywords[0]}s in stock. But please check our catalog for other available products:\n\n${CATALOG}\n\nOr call us on ${PHONE} and we'll help you find what you need.`
      }
    }

    // 3. ORDER STATUS
    else if (/order|delivery|where is|my package|tracking|status|when will|not delivered|still waiting|not come|hasn.t arrived/i.test(lower)) {
      reply = `Sure${hi}! Please share your order number so we can check the status for you.\n\nIf you have any urgent concerns, call us on ${PHONE}.`
    }

    // 4. PAYMENT / DELIVERY METHOD
    else if (/cash on delivery|pay on delivery|cod|how.*(to|do).*(pay|payment)|walk.?in|pick.?up|payment method/i.test(lower)) {
      reply = `Hi${hi}! We offer two options:\n\n1. Online Payment - pay via Mobile Money or card, then we deliver to you.\n2. Walk-in - come to our shop at Adenta Aviation Road.\n\nWe don't do cash on delivery.\n\nWould you like to browse our products? ${CATALOG}`
    }

    // 5. THANK YOU
    else if (/^(thank|thanks|thank you|God bless|appreciate)/i.test(lower)) {
      reply = `You're welcome${hi}! We're always here to help. Have a lovely ${new Date().getUTCHours() >= 17 ? 'evening' : 'day'}!`
    }

    // 6. GENERAL - anything else, assume they want products
    else {
      // Try to find products matching their message
      const found = await findProducts(msg)
      if (found.length > 0) {
        reply = `Yes${hi}, we have that! Please click this link to select exactly what you want:\n\n${CATALOG}\n\nSend your order and we'll prepare your invoice right away.\n\nNeed help? Call ${PHONE}.`
      } else {
        reply = `Hi${hi}! Thanks for messaging EVERYTINROOM&BEDTIME.\n\nPlease click here to browse our products and place your order:\n\n${CATALOG}\n\nOnce you order, we'll send your invoice so you can make payment and fill in your delivery details.\n\nNeed help? Call or message us on ${PHONE}.`
      }
    }

    if (reply) await sendText(chatId, reply)

    return new Response(JSON.stringify({ ok: true }), { headers: CORS })
  } catch (e) {
    console.error('ERROR:', e.message)
    return new Response(JSON.stringify({ error: e.message }), { headers: CORS, status: 500 })
  }
})
