import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const WAWP_INSTANCE = Deno.env.get('WAWP_INSTANCE_ID') || ''
const WAWP_TOKEN = Deno.env.get('WAWP_ACCESS_TOKEN') || ''
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || ''
const SUPABASE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const CATALOG = 'https://www.everytinroom.store/#/catalog'
const PHONE = '024 531 5581'
const SHOP = 'EVERYTINROOM&BEDTIME'
const WAWP_V1 = 'https://wawp.net/wp-json/awp/v1'
const WAWP_V2 = 'https://api.wawp.net/v2'

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Content-Type': 'application/json' }

async function trySend(chatId: string, msg: string): Promise<boolean> {
  try {
    const r = await fetch(`${WAWP_V1}/send?instance_id=${WAWP_INSTANCE}&access_token=${WAWP_TOKEN}&chatId=${encodeURIComponent(chatId)}&message=${encodeURIComponent(msg)}`, { method: 'POST' })
    const t = await r.text()
    console.log(`Send[${chatId}]:`, t.slice(0, 80))
    return t.includes('true') || t.includes('message_id') || t.includes('"result"')
  } catch (e) { return false }
}

async function sendText(originalFrom: string, msg: string) {
  // Try original format first
  if (await trySend(originalFrom, msg)) return

  // Try with @c.us
  const num = originalFrom.replace('@c.us','').replace('@lid','').replace('@s.whatsapp.net','')
  if (await trySend(num + '@c.us', msg)) return

  // Try just the number
  if (await trySend(num, msg)) return

  // Try v2 API
  try {
    const r = await fetch(`${WAWP_V2}/send/text?instance_id=${WAWP_INSTANCE}&access_token=${WAWP_TOKEN}&chatId=${encodeURIComponent(originalFrom)}&text=${encodeURIComponent(msg)}`, { method: 'POST' })
    console.log('v2 result:', (await r.text()).slice(0, 80))
  } catch (e) { console.error('All send attempts failed') }
}

function timeGreet(): string {
  const h = new Date().getUTCHours()
  return h >= 5 && h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
}

const PW = ['bedsheet','bed sheet','bed cover','bedcover','duvet','pillow','blanket','curtain','towel','cookware','pot','pan','frying','kettle','flask','rack','shelf','hanger','mat','rug','carpet','toilet','bathroom','kitchen','plate','cup','glass','bowl','spoon','fork','knife','iron','blender','dispenser','container','basket','bin','bucket','mop','broom','cloth','napkin','apron','oven','cooker']
function prodWord(msg: string): string|null { const l=msg.toLowerCase(); for(const w of PW) if(l.includes(w)) return w; return null }

const lastReply = new Map<string, number>()

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  try {
    const body = await req.json()

    // Payment confirmation
    if (body.action === 'send_confirmation' && body.chatId && body.message) {
      await sendText(body.chatId, body.message)
      return new Response(JSON.stringify({ ok: true }), { headers: CORS })
    }

    if (body.event !== 'message') return new Response(JSON.stringify({ ok: true }), { headers: CORS })

    const p = body.payload || {}
    if (!p.from || p.fromMe) return new Response(JSON.stringify({ ok: true }), { headers: CORS })
    if (String(p.from).includes('@g.us')) return new Response(JSON.stringify({ ok: true }), { headers: CORS })

    const from = String(p.from)
    const num = from.replace('@c.us','').replace('@lid','').replace('@s.whatsapp.net','')
    if (num.length < 8) return new Response(JSON.stringify({ ok: true }), { headers: CORS })

    const msg = String(p.body || p.text || '').trim()
    if (!msg) return new Response(JSON.stringify({ ok: true }), { headers: CORS })

    // 5s cooldown
    const now = Date.now()
    if (now - (lastReply.get(num) || 0) < 5000) return new Response(JSON.stringify({ ok: true }), { headers: CORS })
    lastReply.set(num, now)
    if (lastReply.size > 300) lastReply.clear()

    const name = p._data?.notifyName || p.notifyName || body.me?.pushName || ''
    const hi = name ? ` ${name}` : ''
    const lower = msg.toLowerCase().trim()

    console.log(`${name} (${num}): ${msg}`)

    let reply = ''

    // CATALOG ORDER
    const ref = msg.match(/Order ref:\s*(\S+)/i)
    if (ref) {
      const id = ref[1].trim()
      try {
        const db = createClient(SUPABASE_URL, SUPABASE_KEY)
        await db.from('whatsapp_orders').update({ customer_phone: num, customer_name: name }).eq('id', id)
        const { data: o } = await db.from('whatsapp_orders').select('total,items').eq('id', id).single()
        if (o) {
          const lines = ((o.items||[]) as any[]).map((i:any) => `${i.qty}x ${i.name} - GHS ${Number(i.lineTotal||i.price*i.qty).toFixed(2)}`).join('\n')
          reply = `Thank you for your order${hi}!\n\n${lines}\n\nTotal: GHS ${Number(o.total).toFixed(2)}\n\nPlease click below to fill in your delivery details and make payment:\n\nhttps://www.everytinroom.store/#/pay/${id}\n\nOnce payment is confirmed, we'll package your order and our delivery team will contact you.\n\nNeed help? Call ${PHONE}.`
        } else { reply = `Thank you for your order${hi}! We're preparing your invoice and will send it shortly.` }
      } catch { reply = `Thank you for your order${hi}! We're preparing your invoice and will send it shortly.` }
    }
    // GREETING
    else if (/^(hi|hello|hey|good\s?(morning|afternoon|evening)|yo|sup|hii+|helo+|howdy|hy)[\s!.,?]*$/i.test(lower)) {
      reply = `${timeGreet()}${hi}! This is ${SHOP}, how may we help you?`
    }
    // PRODUCT
    else if (prodWord(msg)) {
      reply = `Yes${hi}, we have ${prodWord(msg)}s available! Please click on this link to select the exact type and design you want:\n\n${CATALOG}\n\nJust send your order and we'll prepare your invoice so you can make payment and fill in your delivery details.\n\nNeed help? Call ${PHONE}.`
    }
    // ORDER STATUS
    else if (/order|delivery|where is|my package|tracking|status|when will|not delivered|still waiting/i.test(lower)) {
      reply = `Sure${hi}! Please share your order number so we can check for you.\n\nFor urgent help, call ${PHONE}.`
    }
    // PAYMENT
    else if (/cash on delivery|pay on delivery|cod|how.*(to|do).*(pay|payment)|walk.?in|pick.?up|payment method/i.test(lower)) {
      reply = `Hi${hi}! We offer two options:\n\n1. Online Payment - Mobile Money or card, then we deliver.\n2. Walk-in - Adenta Aviation Road.\n\nWe don't do cash on delivery.\n\nBrowse products: ${CATALOG}`
    }
    // THANKS
    else if (/^(thank|thanks|thank you|God bless|appreciate)/i.test(lower)) {
      reply = `You're welcome${hi}! Have a lovely ${new Date().getUTCHours()>=17?'evening':'day'}!`
    }
    // GENERAL
    else {
      reply = `Hi${hi}! Thanks for messaging ${SHOP}.\n\nBrowse and order here:\n\n${CATALOG}\n\nWe'll send your invoice so you can pay and fill in delivery details.\n\nNeed help? Call ${PHONE}.`
    }

    if (reply) await sendText(from, reply)
    return new Response(JSON.stringify({ ok: true }), { headers: CORS })
  } catch (e) {
    console.error('ERROR:', e.message)
    return new Response(JSON.stringify({ error: e.message }), { headers: CORS, status: 500 })
  }
})
