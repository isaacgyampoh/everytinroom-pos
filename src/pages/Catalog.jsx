import { useState, useEffect, useMemo } from 'react'
import { getSupabase } from '../lib/supabase'
import { SHOP } from '../lib/utils'

const money = v => 'GHS ' + Number(v || 0).toFixed(2)
const thumb = (url, w = 500) => {
  if (!url) return ''
  if (url.includes('cloudinary')) return url.replace('/upload/', `/upload/w_${w},f_auto/`)
  if (url.includes('supabase')) return url + (url.includes('?') ? '&' : '?') + `width=${w}&quality=80`
  return url
}
const WA = '233245315581'

export default function Catalog() {
  const [products, setProducts] = useState([])
  const [promoMap, setPromoMap] = useState({})
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [cat, setCat] = useState('all')
  const [cart, setCart] = useState([])
  const [showCart, setShowCart] = useState(false)
  const [view, setView] = useState(null)
  const [toast, setToast] = useState('')
  const [faq, setFaq] = useState(null)

  useEffect(() => { load(); loadPromos() }, [])
  useEffect(() => { if (!products.length) return; const m = window.location.hash.match(/\/catalog\/(.+)$/); if (m) { const p = products.find(x => x.id === m[1]); if (p) setView(p) } }, [products])

  const open = p => { setView(p); window.location.hash = `/catalog/${p.id}` }
  const close = () => { setView(null); window.location.hash = '/catalog' }
  const share = p => { const l = `${window.location.origin}/#/catalog/${p.id}`; navigator.share ? navigator.share({ title: p.name, url: l }).catch(() => {}) : (navigator.clipboard?.writeText(l), setToast('Link copied')) }

  const load = async () => {
    const cached = sessionStorage.getItem('cat_p'), ct = sessionStorage.getItem('cat_t')
    if (cached && ct && Date.now() - Number(ct) < 300000) { setProducts(JSON.parse(cached)); setLoading(false); return }
    const sb = getSupabase(); const { data } = await sb.from('products').select('id,name,category,price,wholesale_price,wholesale_min_qty,quantity,image').order('name')
    const items = (data || []).filter(p => p.quantity > 0); setProducts(items); setLoading(false)
    try { sessionStorage.setItem('cat_p', JSON.stringify(items)); sessionStorage.setItem('cat_t', String(Date.now())) } catch {}
  }
  const loadPromos = async () => {
    const sb = getSupabase(); const { data } = await sb.from('promos').select('id,name,start_date,end_date,items,active').eq('active', true)
    if (!data?.length) return; const now = new Date(), map = {}
    for (const p of data) { if (p.start_date && new Date(p.start_date) > now) continue; if (p.end_date && new Date(p.end_date) < now) continue; let items = p.items; if (typeof items === 'string') { try { items = JSON.parse(items) } catch { continue } }; if (!Array.isArray(items)) continue; for (const it of items) { const pid = it.productId || it.product_id, pp = Number(it.promoPrice || it.promo_price || 0); if (pid && pp > 0 && (!map[pid] || pp < map[pid].price)) map[pid] = { price: pp, name: p.name } } }
    setPromoMap(map)
  }

  const cats = useMemo(() => ['all', ...[...new Set(products.filter(p => p.category).map(p => p.category))].sort()], [products])
  const counts = useMemo(() => { const c = { all: products.length }; products.forEach(p => { if (p.category) c[p.category] = (c[p.category] || 0) + 1 }); return c }, [products])
  const filtered = useMemo(() => { const q = search.toLowerCase(); return products.filter(p => (!q || p.name.toLowerCase().includes(q)) && (cat === 'all' || p.category === cat)) }, [products, search, cat])

  const add = product => {
    setCart(prev => { const ex = prev.find(c => c.id === product.id); if (ex) { const n = ex.qty + 1, wp = Number(product.wholesale_price || 0), wm = Number(product.wholesale_min_qty || 0); return prev.map(c => c.id === product.id ? { ...c, qty: n, price: (wp > 0 && wm > 0 && n >= wm) ? wp : Number(product.price), isW: wp > 0 && wm > 0 && n >= wm } : c) }; return [...prev, { id: product.id, name: product.name, price: Number(product.price), rp: Number(product.price), wp: Number(product.wholesale_price || 0), wm: Number(product.wholesale_min_qty || 0), qty: 1, img: product.image, isW: false }] })
    setToast('Added'); setTimeout(() => setToast(''), 1500)
  }
  const upd = (id, d) => setCart(prev => prev.map(c => { if (c.id !== id) return c; const n = Math.max(0, c.qty + d); if (!n) return { ...c, qty: 0 }; const iw = c.wp > 0 && c.wm > 0 && n >= c.wm; return { ...c, qty: n, price: iw ? c.wp : c.rp, isW: iw } }).filter(c => c.qty > 0))
  const cc = cart.reduce((a, c) => a + c.qty, 0), ct = cart.reduce((a, c) => a + c.price * c.qty, 0)

  const order = async () => {
    if (!cart.length) return
    setToast('Creating your order...')
    
    // Create order in database
    const sb = getSupabase()
    const orderNo = 'WA-' + Date.now().toString(36).toUpperCase()
    const orderItems = cart.map(c => ({ name: c.name, qty: c.qty, price: c.price, lineTotal: c.price * c.qty }))
    
    const { data, error } = await sb.from('whatsapp_orders').insert({
      order_no: orderNo,
      date: new Date().toISOString(),
      customer_name: '',
      customer_phone: '',
      items: orderItems,
      subtotal: ct,
      delivery_fee: 0,
      total: ct,
      status: 'Pending',
      notes: 'Order from Catalog'
    }).select('id').single()
    
    if (error || !data) {
      setToast('Order failed, please try again')
      return
    }
    
    // Store order ID so bot can find it
    const orderId = data.id
    
    // Customer message is JUST the order list — no payment link
    const lines = ['Hi, I would like to order the following from EVERYTINROOM:', '']
    cart.forEach(c => lines.push(`- ${c.qty}x ${c.name}`))
    lines.push('', `Order ref: ${orderId}`)
    const msg = lines.join('\n')
    
    // Open WhatsApp with simple order message
    if (/Android|iPhone|iPad/i.test(navigator.userAgent)) {
      window.location.href = `whatsapp://send?phone=${WA}&text=${encodeURIComponent(msg)}`
    } else {
      window.open(`https://web.whatsapp.com/send?phone=${WA}&text=${encodeURIComponent(msg)}`, '_blank')
    }
    try { navigator.clipboard.writeText(msg) } catch {}
    setToast('Send the message on WhatsApp!')
  }

  if (loading) return <div className="min-h-screen bg-white flex items-center justify-center" style={{ colorScheme: 'light' }}><div className="w-7 h-7 border-[2.5px] border-stone-200 border-t-green-700 rounded-full animate-spin" /></div>

  return (
    <div className="min-h-screen bg-white catalog-light" style={{ fontFamily: "'DM Sans', sans-serif", colorScheme: 'light', color: '#111827' }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Playfair+Display:wght@700;800&display=swap" rel="stylesheet" />
      <style>{`
        .catalog-light, .catalog-light * { color-scheme: light !important; }
        body.dark .catalog-light { background: #fff !important; color: #111827 !important; }
        body.dark .catalog-light input { color: #fff !important; }
        body.dark .catalog-light .cat-nav { background: rgba(255,255,255,0.92) !important; }
        body.dark .catalog-light .cat-footer { background: #0c0a09 !important; }
        body.dark .catalog-light .cat-hero { background: #14532d !important; }
      `}</style>

      {/* Toast */}
      {toast && <div className="fixed top-4 left-1/2 -translate-x-1/2 bg-green-800 text-white px-5 py-2 rounded-full text-sm font-medium z-[500] shadow-lg">{toast}</div>}

      {/* Navigation */}
      <nav className="sticky top-0 z-50 bg-white/80 backdrop-blur-xl border-b border-stone-100 cat-nav">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
          <span className="text-base font-bold tracking-tight text-stone-900">EVERYTINROOM&BEDTIME</span>
          <a href={`tel:${SHOP.phone.split('/')[0].trim().replace(/\s/g, '')}`} className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-full px-4 py-2 hover:bg-green-100 transition">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#166534" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
            <span className="text-xs font-semibold text-green-800">{SHOP.phone.split('/')[0].trim()}</span>
          </a>
        </div>
      </nav>

      {/* Hero */}
      <div className="bg-green-900 relative overflow-hidden cat-hero">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_40%,rgba(34,197,94,0.15),transparent_60%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_80%_80%,rgba(74,222,128,0.1),transparent_50%)]" />
        <div className="max-w-6xl mx-auto px-4 py-12 md:py-16 relative z-10">
          <p className="text-green-400 text-xs font-semibold tracking-[0.2em] uppercase mb-3">{SHOP.address}</p>
          <h1 className="text-white text-3xl md:text-5xl font-bold leading-tight mb-3" style={{ fontFamily: "'Playfair Display', serif" }}>Home essentials,<br />delivered to you.</h1>
          <p className="text-green-300/60 text-sm md:text-base max-w-md mb-6">Quality cookware, curtains, bedding and more. Nationwide delivery across Ghana.</p>
          <div className="relative max-w-lg">
            <svg className="absolute left-4 top-1/2 -translate-y-1/2 text-white/30" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" strokeLinecap="round" strokeLinejoin="round"/></svg>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="What are you looking for?" className="w-full h-12 pl-11 pr-10 bg-white/10 border border-white/10 rounded-xl text-white text-sm placeholder:text-white/30 focus:outline-none focus:border-green-400/40 focus:bg-white/15 transition" />
            {search && <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 w-6 h-6 bg-white/15 rounded-full text-white/60 text-[10px] flex items-center justify-center">✕</button>}
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-6">
        {/* Categories */}
        <div className="flex gap-2 overflow-x-auto pb-3 mb-1 scrollbar-hide -mx-4 px-4">
          {cats.map(c => <button key={c} onClick={() => setCat(c)} className={`h-8 px-4 rounded-full text-xs font-semibold whitespace-nowrap flex-shrink-0 transition ${cat === c ? 'bg-green-800 text-white' : 'bg-stone-100 text-stone-500 hover:bg-stone-200'}`}>{c === 'all' ? 'All' : c}<span className="ml-1.5 opacity-50">{counts[c] || 0}</span></button>)}
        </div>

        {/* Promo row */}
        {Object.keys(promoMap).length > 0 && <div className="my-5">
          <div className="flex items-center gap-2 mb-3"><div className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" /><span className="text-xs font-bold text-stone-800 uppercase tracking-wider">Promo</span></div>
          <div className="flex gap-3 overflow-x-auto scrollbar-hide -mx-4 px-4 pb-2">
            {products.filter(p => promoMap[p.id]).map(p => <div key={'p'+p.id} onClick={() => open(p)} className="flex-shrink-0 w-[140px] cursor-pointer group">
              <div className="w-full h-24 bg-stone-100 rounded-xl overflow-hidden relative">{p.image ? <img src={thumb(p.image, 400)} alt="" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" loading="lazy" /> : <div className="w-full h-full bg-stone-50" />}<div className="absolute top-1.5 left-1.5 bg-red-500 text-white text-[8px] font-bold px-2 py-0.5 rounded">PROMO</div></div>
              <p className="text-[11px] font-medium text-stone-700 mt-2 truncate">{p.name}</p>
              <div className="flex items-center gap-1.5"><span className="text-[10px] text-stone-400 line-through">{money(p.price)}</span><span className="text-xs font-bold text-red-600">{money(promoMap[p.id].price)}</span></div>
            </div>)}
          </div>
        </div>}

        {/* Count */}
        <p className="text-[11px] text-stone-400 font-medium mb-4 mt-2">{filtered.length} product{filtered.length !== 1 ? 's' : ''}</p>

        {/* Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 md:gap-4">
          {filtered.map(p => {
            const promo = promoMap[p.id], dp = promo ? promo.price : p.price, hw = Number(p.wholesale_price||0) > 0 && Number(p.wholesale_min_qty||0) > 0
            return <div key={p.id} className="group cursor-pointer" onClick={() => open(p)}>
              <div className="w-full aspect-square bg-stone-100 rounded-2xl overflow-hidden relative mb-2.5">
                {p.image ? <img src={thumb(p.image)} alt={p.name} className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-500" loading="lazy" /> : <div className="w-full h-full bg-stone-50" />}
                {promo && <div className="absolute top-2 left-2 bg-red-500 text-white text-[9px] font-bold px-2 py-1 rounded-lg">PROMO</div>}
              </div>
              <p className="text-xs text-stone-400 mb-0.5">{p.category}</p>
              <p className="text-sm font-semibold text-stone-900 leading-snug mb-1 line-clamp-2">{p.name}</p>
              <div className="flex items-center gap-2">
                {promo && <span className="text-xs text-stone-400 line-through">{money(p.price)}</span>}
                <span className={`text-sm font-bold ${promo ? 'text-red-600' : 'text-stone-900'}`}>{money(dp)}</span>
              </div>
              {!promo && hw && <p className="text-[10px] text-green-600 font-medium mt-0.5">Buy {p.wholesale_min_qty}+ for {money(p.wholesale_price)} each</p>}
              <button onClick={e => { e.stopPropagation(); add({ ...p, price: dp }) }} className="w-full h-9 mt-2.5 bg-stone-900 hover:bg-green-800 text-white rounded-xl text-xs font-semibold transition-colors">Add to Order</button>
            </div>
          })}
        </div>
        {filtered.length === 0 && <div className="text-center py-20"><p className="text-stone-400 text-sm">Nothing found</p>{search && <button onClick={() => setSearch('')} className="mt-2 text-green-600 text-sm font-medium">Clear search</button>}</div>}

        {/* FAQ */}
        <div className="mt-16 mb-10 max-w-2xl mx-auto">
          <h2 className="text-2xl md:text-3xl font-bold text-center text-stone-900 mb-1" style={{ fontFamily: "'Playfair Display', serif" }}>Got Questions?</h2>
          <p className="text-2xl md:text-3xl font-bold text-center text-stone-900 mb-8" style={{ fontFamily: "'Playfair Display', serif" }}>We've Got Answers.</p>
          {[
            ['How do I place an order?', 'Browse our products and tap "Add to Order" on the items you want. Tap the cart button and click "Order on WhatsApp" — this opens our official WhatsApp number where you send your order. An invoice will be sent to you immediately. Click on your invoice to fill in your delivery details and make payment. We then package and deliver your order.'],
            ['What payment methods do you accept?', 'We accept Mobile Money (MTN, Vodafone, AirtelTigo) and card payments. You will receive a secure payment link with your invoice.'],
            ['Do you offer delivery?', 'Yes. We deliver nationwide across Ghana. Delivery fees depend on your location and will be communicated after your order is confirmed.'],
            ['Do you have wholesale prices?', 'Yes. Selected products have reduced prices when you buy in bulk. The wholesale price applies automatically when you reach the minimum quantity.'],
          ].map(([q, a], i) => <div key={i} onClick={() => setFaq(faq === i ? null : i)} className={`mb-2 rounded-2xl cursor-pointer transition-all ${faq === i ? 'bg-green-50 border border-green-100' : 'bg-stone-50 border border-transparent hover:bg-stone-100'}`}>
            <div className="flex justify-between items-center px-5 py-4">
              <span className="text-sm font-semibold text-stone-900 pr-4">{q}</span>
              <span className={`text-lg text-stone-400 transition-transform ${faq === i ? 'rotate-45' : ''}`}>+</span>
            </div>
            {faq === i && <p className="px-5 pb-4 text-sm text-stone-500 leading-relaxed -mt-1">{a}</p>}
          </div>)}
        </div>
      </div>

      {/* Footer */}
      <footer className="bg-stone-950 text-white cat-footer">
        <div className="max-w-6xl mx-auto px-4 py-10">
          <div className="flex flex-wrap gap-10 mb-8">
            <div className="flex-1 min-w-[200px]">
              <h3 className="text-lg font-bold mb-2 text-white">EVERYTINROOM&BEDTIME</h3>
              <p className="text-xs text-stone-500 leading-relaxed max-w-xs">Quality home furnishings — cookware, curtains, bedding, kitchenware and more. Nationwide delivery across Ghana.</p>
            </div>
            <div>
              <h4 className="text-[11px] font-semibold text-stone-500 uppercase tracking-wider mb-3">Contact</h4>
              <div className="flex flex-col gap-2 text-xs text-stone-400">
                <span>{SHOP.phone}</span>
                <span>{SHOP.address}</span>
              </div>
            </div>
          </div>
          <div className="border-t border-stone-800 pt-5 text-center">
            <p className="text-[11px] text-stone-600">&copy; {new Date().getFullYear()} {SHOP.name}</p>
          </div>
        </div>
      </footer>

      {/* Cart FAB */}
      {cc > 0 && <button onClick={() => setShowCart(true)} className="fixed bottom-5 right-5 h-14 pl-5 pr-6 bg-green-600 hover:bg-green-700 text-white rounded-2xl flex items-center gap-3 font-bold text-sm z-50 shadow-xl shadow-green-600/25 transition-colors">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>
        {cc} · {money(ct)}
      </button>}

      {/* Cart drawer */}
      {showCart && <div onClick={() => setShowCart(false)} className="fixed inset-0 bg-black/40 z-[200]" />}
      <div className={`fixed bottom-0 left-0 right-0 md:right-0 md:left-auto md:top-0 md:w-[400px] bg-white z-[201] flex flex-col rounded-t-3xl md:rounded-none max-h-[85vh] md:max-h-full shadow-2xl transition-transform duration-300 ${showCart ? 'translate-y-0 md:translate-x-0' : 'translate-y-full md:translate-x-full'}`}>
        <div className="md:hidden flex justify-center pt-3 pb-1"><div className="w-10 h-1 bg-stone-200 rounded-full" /></div>
        <div className="flex items-center justify-between px-5 py-3 border-b border-stone-100">
          <h3 className="text-base font-bold">Your Order <span className="text-stone-400 font-normal text-sm">({cc})</span></h3>
          <button onClick={() => setShowCart(false)} className="w-8 h-8 bg-stone-100 rounded-lg flex items-center justify-center text-stone-400 text-sm">✕</button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">
          {!cart.length ? <p className="text-center py-16 text-stone-400 text-sm">Empty</p> : <div className="space-y-2.5">
            {cart.map(c => <div key={c.id} className="flex items-center gap-3 p-3 bg-stone-50 rounded-xl">
              <div className="w-11 h-11 bg-stone-200 rounded-lg overflow-hidden flex-shrink-0">{c.img ? <img src={thumb(c.img, 200)} alt="" className="w-full h-full object-cover" /> : null}</div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold truncate">{c.name}</p>
                <p className="text-[11px] text-stone-400">{money(c.price)} each</p>
                {c.isW && <p className="text-[10px] text-green-600 font-semibold">Wholesale</p>}
              </div>
              <div className="flex items-center gap-1.5">
                <button onClick={() => upd(c.id, -1)} className="w-7 h-7 border border-stone-200 rounded-lg text-xs font-bold flex items-center justify-center">−</button>
                <span className="w-5 text-center text-xs font-bold">{c.qty}</span>
                <button onClick={() => upd(c.id, 1)} className="w-7 h-7 border border-stone-200 rounded-lg text-xs font-bold flex items-center justify-center">+</button>
              </div>
            </div>)}
          </div>}
        </div>
        {cart.length > 0 && <div className="p-5 border-t border-stone-100">
          <div className="flex justify-between items-center mb-4"><span className="text-sm text-stone-400">{cc} item{cc !== 1 ? 's' : ''}</span><span className="text-xl font-bold">{money(ct)}</span></div>
          <button onClick={() => { order(); setShowCart(false); setCart([]) }} className="w-full h-14 bg-green-600 hover:bg-green-700 text-white rounded-2xl font-bold flex items-center justify-center gap-2.5 transition-colors">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 0C5.373 0 0 5.373 0 12c0 2.625.846 5.059 2.284 7.034L.789 23.492l4.612-1.21A11.95 11.95 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.75c-2.115 0-4.142-.588-5.904-1.699l-.424-.252-2.732.717.73-2.667-.276-.44A9.72 9.72 0 012.25 12C2.25 6.624 6.624 2.25 12 2.25S21.75 6.624 21.75 12 17.376 21.75 12 21.75z"/></svg>
            Order on WhatsApp
          </button>
          <button onClick={() => setCart([])} className="w-full h-8 text-stone-400 text-xs mt-2">Clear</button>
        </div>}
      </div>

      {/* Product modal */}
      {view && (() => {
        const rel = products.filter(p => p.id !== view.id && p.category && view.category && p.category === view.category && p.image).slice(0, 4)
        const pr = promoMap[view.id], dp = pr ? pr.price : view.price
        return <>
          <div onClick={close} className="fixed inset-0 bg-black/50 z-[300]" />
          <div className="fixed inset-3 md:inset-auto md:top-1/2 md:left-1/2 md:-translate-x-1/2 md:-translate-y-1/2 md:w-[460px] md:max-h-[85vh] bg-white rounded-3xl z-[301] overflow-hidden flex flex-col shadow-2xl">
            <div className="flex-1 overflow-y-auto">
              <div className="w-full aspect-square bg-stone-100 relative">
                {view.image ? <img src={thumb(view.image, 800)} alt="" className="w-full h-full object-cover" /> : <div className="w-full h-full bg-stone-50" />}
                <button onClick={close} className="absolute top-3 right-3 w-9 h-9 bg-white/90 backdrop-blur rounded-xl flex items-center justify-center text-stone-500 text-sm shadow">✕</button>
                <button onClick={() => share(view)} className="absolute top-3 left-3 w-9 h-9 bg-white/90 backdrop-blur rounded-xl flex items-center justify-center shadow">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#666" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.59 13.51l6.83 3.98M15.41 6.51l-6.82 3.98"/></svg>
                </button>
                {pr && <div className="absolute bottom-3 left-3 bg-red-500 text-white text-[11px] font-bold px-3 py-1.5 rounded-xl">{pr.name}</div>}
              </div>
              <div className="p-5">
                {view.category && <p className="text-xs text-stone-400 mb-1">{view.category}</p>}
                <h2 className="text-lg font-bold text-stone-900 mb-2">{view.name}</h2>
                {pr && <p className="text-sm text-stone-400 line-through">{money(view.price)}</p>}
                <p className={`text-2xl font-bold ${pr ? 'text-red-600' : 'text-stone-900'}`}>{money(dp)}</p>
                {pr && <div className="mt-2 bg-red-50 rounded-xl px-3 py-2 text-xs text-red-600 font-medium">Save {money(view.price - pr.price)}</div>}
                {!pr && Number(view.wholesale_price || 0) > 0 && Number(view.wholesale_min_qty || 0) > 0 && <div className="mt-2 bg-green-50 rounded-xl px-3 py-2"><p className="text-xs text-green-700 font-semibold">Wholesale: {money(view.wholesale_price)} each</p><p className="text-[11px] text-green-600">Buy {view.wholesale_min_qty}+ pieces</p></div>}
                <button onClick={() => share(view)} className="flex items-center gap-1.5 mt-3 text-xs text-green-700 font-medium">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.59 13.51l6.83 3.98M15.41 6.51l-6.82 3.98"/></svg>Share
                </button>
                {rel.length > 0 && <div className="mt-5 pt-4 border-t border-stone-100">
                  <h4 className="text-xs font-bold text-stone-800 mb-3 uppercase tracking-wider">You may also like</h4>
                  <div className="flex gap-2.5 overflow-x-auto scrollbar-hide">
                    {rel.map(r => <div key={r.id} onClick={() => open(r)} className="flex-shrink-0 w-24 cursor-pointer">
                      <div className="w-24 h-20 bg-stone-100 rounded-lg overflow-hidden"><img src={thumb(r.image, 300)} alt="" className="w-full h-full object-cover" loading="lazy" /></div>
                      <p className="text-[10px] font-medium text-stone-700 mt-1.5 line-clamp-2">{r.name}</p>
                      <p className="text-[10px] font-bold text-stone-900">{money(r.price)}</p>
                    </div>)}
                  </div>
                </div>}
              </div>
            </div>
            <div className="p-4 border-t border-stone-100">
              <button onClick={() => { add({ ...view, price: dp }); close() }} className="w-full h-12 bg-stone-900 hover:bg-green-800 text-white rounded-xl text-sm font-semibold transition-colors">Add to Order</button>
            </div>
          </div>
        </>
      })()}
    </div>
  )
}
