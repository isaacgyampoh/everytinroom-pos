import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const WAWP_INSTANCE = Deno.env.get('WAWP_INSTANCE_ID') || ''
const WAWP_TOKEN = Deno.env.get('WAWP_ACCESS_TOKEN') || ''
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || ''
const SUPABASE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const CATALOG = 'https://www.everytinroom.store/#/catalog'
const PHONE = '053 354 7740'
const SHOP = 'EVERYTINROOM&BEDTIME'

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Content-Type': 'application/json' }

// Try BOTH v1 and v2 API to send messages
async function sendText(chatId: string, msg: string) {
  // Try v2 API first (supports LID)
  try {
    const r1 = await fetch(`https://api.wawp.net/v2/send/text?instance_id=${WAWP_INSTANCE}&access_token=${WAWP_TOKEN}&chatId=${encodeURIComponent(chatId)}&text=${encodeURIComponent(msg)}`, { method: 'POST' })
    const t1 = await r1.text()
    console.log('v2 send result:', t1.slice(0, 100))
    if (t1.includes('true') || t1.includes('message_id') || t1.includes('success')) return
  } catch (e) { console.log('v2 failed:', e) }

  // Try v1 API
  try {
    const r2 = await fetch(`https://wawp.net/wp-json/awp/v1/send?instance_id=${WAWP_INSTANCE}&access_token=${WAWP_TOKEN}&chatId=${encodeURIComponent(chatId)}&message=${encodeURIComponent(msg)}`, { method: 'POST' })
    const t2 = await r2.text()
    console.log('v1 send result:', t2.slice(0, 100))
    if (t2.includes('true') || t2.includes('message_id') || t2.includes('success')) return
  } catch (e) { console.log('v1 failed:', e) }

  // Try with just the number (no @c.us or @lid)
  const justNumber = chatId.replace('@c.us', '').replace('@lid', '').replace('@s.whatsapp.net', '')
  try {
    const r3 = await fetch(`https://wawp.net/wp-json/awp/v1/send?instance_id=${WAWP_INSTANCE}&access_token=${WAWP_TOKEN}&chatId=${encodeURIComponent(justNumber)}&message=${encodeURIComponent(msg)}`, { method: 'POST' })
    const t3 = await r3.text()
    console.log('number-only send result:', t3.slice(0, 100))
  } catch (e) { console.log('number-only failed:', e) }
}

function timeGreet(): string {
  const h = new Date().getUTCHours()
  return h >= 5 && h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
}

const productWords = ['bedsheet','bed sheet','bed cover','bedcover','duvet','pillow','blanket','curtain','towel','cookware','pot','pan','frying','kettle','flask','rack','shelf','hanger','mat','rug','carpet','toilet','bathroom','kitchen','plate','cup','glass','bowl','spoon','fork','knife','iron','blender','dispenser','container','basket','bin','bucket','mop','broom','cloth','napkin','apron','oven','cooker']

function hasProductWord(msg: string): string | null {
  const l = msg.toLowerCase()
  for (const w of productWords) if (l.includes(w)) return w
  return null
}

const lastReply = new Map<string, number>()

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const body = await req.json()

    if (body.action === 'send_confirmation' && body.chatId && body.message) {
      await sendText(body.chatId, body.message)
      return new Response(JSON.stringify({ ok: true }), { headers: CORS })
    }

    if (body.event !== 'message') return new Response(JSON.stringify({ ok: true }), { headers: CORS })

    const payload = body.payload || {}
    console.log('PAYLOAD:', JSON.stringify(payload).slice(0, 800))

    if (!payload.from || payload.fromMe) return new Response(JSON.stringify({ ok: true }), { headers: CORS })
    if (String(payload.from).includes('@g.us')) return new Response(JSON.stringify({ ok: true }), { headers: CORS })

    // Get chatId — try multiple sources
    const chatId = payload._data?.chat?._serialized || payload._data?.from || payload.from || ''
    const sender = String(chatId).replace('@c.us', '').replace('@lid', '').replace('@s.whatsapp.net', '')
    if (!sender || sender.length < 8) return new Response(JSON.stringify({ ok: true }), { headers: CORS })

    console.log('Using chatId:', chatId, '| sender:', sender)

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

    console.log(`MSG: ${name} (${sender}): ${msg}`)

    let reply = ''

    // 0. CATALOG ORDER
    const refMatch = msg.match(/Order ref:\s*(\S+)/i)
    if (refMatch) {
      const orderId = refMatch[1].trim()
      try {
        const db = createClient(SUPABASE_URL, SUPABASE_KEY)
        await db.from('whatsapp_orders').update({ customer_phone: sender, customer_name: name || '' }).eq('id', orderId)
        const { data: ord } = await db.from('whatsapp_orders').select('total,order_no,items').eq('id', orderId).single()
        if (ord) {
          const items = (ord.items || []) as any[]
          const itemLines = items.map((i: any) => `${i.qty}x ${i.name} - GHS ${Number(i.lineTotal || i.price * i.qty).toFixed(2)}`).join('\n')
          reply = `Thank you for your order${hi}!\n\n${itemLines}\n\nTotal: GHS ${Number(ord.total).toFixed(2)}\n\nPlease click the link below to fill in your delivery details and make payment:\n\nhttps://www.everytinroom.store/#/pay/${orderId}\n\nOnce payment is confirmed, we'll package your order and our delivery team will contact you.\n\nNeed help? Call ${PHONE}.`
        } else {
          reply = `Thank you for your order${hi}! We're preparing your invoice and will send it shortly.`
        }
      } catch (e) {
        console.error('Order error:', e)
        reply = `Thank you for your order${hi}! We're preparing your invoice and will send it shortly.`
      }
    }
    else if (/^(hi|hello|hey|good\s?(morning|afternoon|evening)|yo|sup|hii+|helo+|howdy|hy)[\s!.,?]*$/i.test(lower)) {
      reply = `${timeGreet()}${hi}! This is ${SHOP}, how may we help you?`
    }
    else if (hasProductWord(msg)) {
      const word = hasProductWord(msg)
      reply = `Yes${hi}, we have ${word}s available! Please click on this link to select the exact type and design you want:\n\n${CATALOG}\n\nJust send your order and we'll prepare your invoice so you can make payment and fill in your delivery details.\n\nNeed help? Call ${PHONE}.`
    }
    else if (/order|delivery|where is|my package|tracking|status|when will|not delivered|still waiting/i.test(lower)) {
      reply = `Sure${hi}! Please share your order number so we can check the status for you.\n\nFor urgent help, call ${PHONE}.`
    }
    else if (/cash on delivery|pay on delivery|cod|how.*(to|do).*(pay|payment)|walk.?in|pick.?up|payment method/i.test(lower)) {
      reply = `Hi${hi}! We offer two options:\n\n1. Online Payment - pay via Mobile Money or card, then we deliver to you.\n2. Walk-in - visit our shop at Adenta Aviation Road.\n\nWe don't do cash on delivery.\n\nBrowse our products: ${CATALOG}`
    }
    else if (/^(thank|thanks|thank you|God bless|appreciate)/i.test(lower)) {
      reply = `You're welcome${hi}! Have a lovely ${new Date().getUTCHours() >= 17 ? 'evening' : 'day'}!`
    }
    else {
      reply = `Hi${hi}! Thanks for messaging ${SHOP}.\n\nPlease click here to browse our products and place your order:\n\n${CATALOG}\n\nOnce you order, we'll send your invoice so you can make payment and fill in your delivery details.\n\nNeed help? Call ${PHONE}.`
    }

    console.log('Reply:', reply.slice(0, 80))
    if (reply) await sendText(chatId, reply)

    return new Response(JSON.stringify({ ok: true }), { headers: CORS })
  } catch (e) {
    console.error('BOT ERROR:', e.message, e.stack)
    return new Response(JSON.stringify({ error: e.message }), { headers: CORS, status: 500 })
  }
})
