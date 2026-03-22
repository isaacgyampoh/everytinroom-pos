import { useState, useEffect, useMemo } from 'react'
import { getSupabase } from '../lib/supabase'
import { SHOP } from '../lib/utils'

const money = v => 'GHS ' + Number(v || 0).toFixed(2)
const thumb = (url, w = 200) => {
  if (!url) return ''
  if (url.includes('supabase')) return url + (url.includes('?') ? '&' : '?') + `width=${w}&quality=40`
  return url
}
const SHOP_WHATSAPP = '233245315581'

const C = {
  dark: '#166534',
  mid: '#15803d',
  bright: '#22c55e',
  lime: '#4ade80',
  lightLime: '#bbf7d0',
  paleLime: '#dcfce7',
  ghostGreen: '#f0fdf4',
  white: '#ffffff',
  black: '#111827',
  gray: '#6b7280',
  lightGray: '#f9fafb',
  border: '#e5e7eb',
}

function Toast({ msg, onDone }) {
  useEffect(() => { const t = setTimeout(onDone, 2000); return () => clearTimeout(t) }, [])
  return <div style={{ position:'fixed',top:20,left:'50%',transform:'translateX(-50%)',background:C.dark,color:'#fff',padding:'10px 24px',borderRadius:12,fontSize:14,fontWeight:600,zIndex:500,boxShadow:'0 8px 30px rgba(22,101,52,0.3)' }}>{msg}</div>
}

export default function Catalog() {
  const [products, setProducts] = useState([])
  const [promoMap, setPromoMap] = useState({})
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [selectedCat, setSelectedCat] = useState('all')
  const [cart, setCart] = useState([])
  const [showCart, setShowCart] = useState(false)
  const [viewProduct, setViewProduct] = useState(null)
  const [toast, setToast] = useState('')
  const [faqOpen, setFaqOpen] = useState(null)

  useEffect(() => { loadProducts(); loadPromos() }, [])
  useEffect(() => {
    if (!products.length) return
    const m = window.location.hash.match(/\/catalog\/(.+)$/)
    if (m) { const p = products.find(pr => pr.id === m[1]); if (p) setViewProduct(p) }
  }, [products])

  const openProduct = p => { setViewProduct(p); window.location.hash = `/catalog/${p.id}` }
  const closeProduct = () => { setViewProduct(null); window.location.hash = '/catalog' }
  const shareProduct = p => {
    const link = `${window.location.origin}/#/catalog/${p.id}`
    if (navigator.share) navigator.share({ title: p.name, text: `${p.name} - ${money(p.price)}`, url: link }).catch(() => {})
    else { navigator.clipboard?.writeText(link); setToast('Link copied') }
  }

  const loadProducts = async () => {
    const sb = getSupabase()
    const { data } = await sb.from('products').select('id,name,category,price,wholesale_price,wholesale_min_qty,quantity,image').order('name', { ascending: true })
    setProducts((data || []).filter(p => p.quantity > 0)); setLoading(false)
  }
  const loadPromos = async () => {
    const sb = getSupabase()
    const { data } = await sb.from('promos').select('id,name,start_date,end_date,items,active').eq('active', true)
    if (!data?.length) return
    const now = new Date(), map = {}
    for (const p of data) {
      if (p.start_date && new Date(p.start_date) > now) continue
      if (p.end_date && new Date(p.end_date) < now) continue
      let items = p.items
      if (typeof items === 'string') { try { items = JSON.parse(items) } catch { continue } }
      if (!Array.isArray(items)) continue
      for (const it of items) {
        const pid = it.productId || it.product_id, pp = Number(it.promoPrice || it.promo_price || 0)
        if (pid && pp > 0 && (!map[pid] || pp < map[pid].price)) map[pid] = { price: pp, promoName: p.name }
      }
    }
    setPromoMap(map)
  }

  const categories = useMemo(() => ['all', ...[...new Set(products.filter(p => p.category).map(p => p.category))].sort()], [products])
  const catCounts = useMemo(() => { const c = { all: products.length }; products.forEach(p => { if (p.category) c[p.category] = (c[p.category] || 0) + 1 }); return c }, [products])
  const filtered = useMemo(() => { const q = search.toLowerCase(); return products.filter(p => (!q || p.name.toLowerCase().includes(q)) && (selectedCat === 'all' || p.category === selectedCat)) }, [products, search, selectedCat])

  const addToCart = product => {
    setCart(prev => {
      const ex = prev.find(c => c.id === product.id)
      if (ex) {
        const nq = ex.qty + 1, wp = Number(product.wholesale_price||0), wm = Number(product.wholesale_min_qty||0)
        return prev.map(c => c.id === product.id ? { ...c, qty: nq, price: (wp > 0 && wm > 0 && nq >= wm) ? wp : Number(product.price), isWholesale: wp > 0 && wm > 0 && nq >= wm } : c)
      }
      return [...prev, { id: product.id, name: product.name, price: Number(product.price), retailPrice: Number(product.price), wholesalePrice: Number(product.wholesale_price||0), wholesaleMinQty: Number(product.wholesale_min_qty||0), qty: 1, image: product.image, isWholesale: false }]
    }); setToast('Added to order')
  }
  const updateQty = (id, d) => {
    setCart(prev => prev.map(c => {
      if (c.id !== id) return c
      const nq = Math.max(0, c.qty + d)
      if (!nq) return { ...c, qty: 0 }
      const iw = c.wholesalePrice > 0 && c.wholesaleMinQty > 0 && nq >= c.wholesaleMinQty
      return { ...c, qty: nq, price: iw ? c.wholesalePrice : c.retailPrice, isWholesale: iw }
    }).filter(c => c.qty > 0))
  }

  const cc = cart.reduce((a, c) => a + c.qty, 0)
  const ct = cart.reduce((a, c) => a + c.price * c.qty, 0)

  const orderViaWhatsApp = () => {
    if (!cart.length) return
    const lines = ['Hi, I would like to order the following from EVERYTINROOM:', '']
    cart.forEach(c => lines.push(`- ${c.qty}x ${c.name}`))
    lines.push('', 'Your invoice will be sent to you shortly. Thank you.')
    const msg = lines.join('\n')
    if (/Android|iPhone|iPad/i.test(navigator.userAgent)) window.location.href = `whatsapp://send?phone=${SHOP_WHATSAPP}&text=${encodeURIComponent(msg)}`
    else window.open(`https://web.whatsapp.com/send?phone=${SHOP_WHATSAPP}&text=${encodeURIComponent(msg)}`, '_blank')
    try { navigator.clipboard.writeText(msg) } catch {}
  }

  const faqs = [
    { q: 'How do I place an order?', a: 'Browse our products, tap "Add to Order" on the items you want, then tap the cart button and click "Order on WhatsApp". Your invoice will be sent to you shortly.' },
    { q: 'What payment methods do you accept?', a: 'We accept Mobile Money (MTN, Vodafone, AirtelTigo) and card payments via a secure payment link.' },
    { q: 'Do you offer delivery?', a: 'Yes, we deliver across Accra and surrounding areas. Delivery fees depend on your location.' },
    { q: 'Do you have wholesale prices?', a: 'Yes. Selected products have wholesale pricing when you buy in bulk. Look for the green text on products.' },
  ]

  const s = { page: { minHeight: '100vh', background: C.white, fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif', color: C.black } }

  if (loading) return <div style={{ ...s.page, display:'flex',alignItems:'center',justifyContent:'center' }}><div style={{ width:32,height:32,border:`3px solid ${C.border}`,borderTopColor:C.dark,borderRadius:'50%',animation:'spin 1s linear infinite' }} /><style>{`@keyframes spin{to{transform:rotate(360deg)}} @keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}`}</style></div>

  return (
    <div style={s.page}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}} @keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}} *{box-sizing:border-box} ::placeholder{color:rgba(255,255,255,0.5)}`}</style>
      {toast && <Toast msg={toast} onDone={() => setToast('')} />}

      {/* HERO */}
      <div style={{ background:`linear-gradient(135deg, ${C.dark} 0%, ${C.mid} 60%, ${C.bright} 100%)`, color:'#fff', padding:'36px 20px 44px', position:'relative', overflow:'hidden' }}>
        <div style={{ position:'absolute',right:-60,top:-60,width:240,height:240,borderRadius:'50%',background:'rgba(255,255,255,0.04)' }} />
        <div style={{ position:'absolute',left:-40,bottom:-40,width:180,height:180,borderRadius:'50%',background:'rgba(255,255,255,0.03)' }} />
        <div style={{ position:'absolute',right:80,bottom:20,width:60,height:60,borderRadius:'50%',background:'rgba(74,222,128,0.1)' }} />
        <div style={{ maxWidth:1100,margin:'0 auto',position:'relative',zIndex:1 }}>
          <div style={{ display:'flex',alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',gap:12 }}>
            <div>
              <h1 style={{ fontSize:26,fontWeight:800,margin:0,letterSpacing:-0.5 }}>{SHOP.name}</h1>
              <p style={{ margin:'4px 0 0',opacity:0.6,fontSize:13 }}>{SHOP.tagline} · {SHOP.address}</p>
            </div>
            <a href={`tel:${SHOP.phone.split('/')[0].trim().replace(/\s/g,'')}`} style={{ display:'flex',alignItems:'center',gap:6,background:'rgba(255,255,255,0.12)',padding:'10px 20px',borderRadius:50,color:'#fff',textDecoration:'none',fontSize:13,fontWeight:600,border:'1px solid rgba(255,255,255,0.15)' }}>Call Us</a>
          </div>
          <div style={{ marginTop:20,position:'relative' }}>
            <svg style={{ position:'absolute',left:16,top:'50%',transform:'translateY(-50%)',opacity:0.5 }} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2"><path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" strokeLinecap="round" strokeLinejoin="round"/></svg>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search products..." style={{ width:'100%',height:50,paddingLeft:46,paddingRight:search?42:16,background:'rgba(255,255,255,0.12)',border:'1px solid rgba(255,255,255,0.15)',borderRadius:14,color:'#fff',fontSize:14,fontWeight:500,outline:'none' }} />
            {search && <button onClick={() => setSearch('')} style={{ position:'absolute',right:12,top:'50%',transform:'translateY(-50%)',background:'rgba(255,255,255,0.2)',border:'none',width:26,height:26,borderRadius:'50%',color:'#fff',fontSize:11,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center' }}>✕</button>}
          </div>
        </div>
      </div>

      <div style={{ maxWidth:1100,margin:'0 auto',padding:'20px 16px 0' }}>
        {/* CATEGORIES */}
        <div style={{ display:'flex',gap:6,overflowX:'auto',paddingBottom:8,marginBottom:20 }}>
          {categories.map(c => (
            <button key={c} onClick={() => setSelectedCat(c)} style={{ height:36,padding:'0 16px',borderRadius:50,fontSize:12,fontWeight:600,whiteSpace:'nowrap',border:'none',cursor:'pointer',background:selectedCat===c?C.dark:C.ghostGreen,color:selectedCat===c?'#fff':C.dark,flexShrink:0,transition:'all .2s' }}>
              {c==='all'?'All':c} <span style={{ opacity:0.5,marginLeft:3,fontSize:10 }}>{catCounts[c]||0}</span>
            </button>
          ))}
        </div>

        {/* PROMO BANNER */}
        {Object.keys(promoMap).length > 0 && (
          <div style={{ marginBottom:24 }}>
            <div style={{ display:'flex',alignItems:'center',gap:8,marginBottom:10 }}>
              <div style={{ width:8,height:8,background:'#dc2626',borderRadius:'50%',animation:'pulse 2s infinite' }} />
              <h2 style={{ fontSize:15,fontWeight:700,color:C.black,margin:0 }}>Promo</h2>
            </div>
            <div style={{ display:'flex',gap:12,overflowX:'auto',paddingBottom:4 }}>
              {products.filter(p => promoMap[p.id]).map(p => {
                const promo = promoMap[p.id]
                return (
                  <div key={'pr-'+p.id} onClick={() => openProduct(p)} style={{ flexShrink:0,width:150,background:C.white,borderRadius:16,overflow:'hidden',cursor:'pointer',border:`1px solid ${C.border}` }}>
                    <div style={{ width:'100%',height:100,background:C.lightGray,overflow:'hidden',position:'relative' }}>
                      {p.image ? <img src={thumb(p.image,150)} alt="" style={{ width:'100%',height:'100%',objectFit:'cover' }} loading="lazy" /> : <div style={{ width:'100%',height:'100%',background:C.ghostGreen }} />}
                      <div style={{ position:'absolute',top:6,left:6,background:'#dc2626',color:'#fff',fontSize:9,fontWeight:700,padding:'3px 8px',borderRadius:6 }}>PROMO</div>
                    </div>
                    <div style={{ padding:10 }}>
                      <div style={{ fontSize:11,fontWeight:600,color:C.black,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis' }}>{p.name}</div>
                      <div style={{ display:'flex',alignItems:'center',gap:6,marginTop:4 }}>
                        <span style={{ fontSize:10,color:C.gray,textDecoration:'line-through' }}>{money(p.price)}</span>
                        <span style={{ fontSize:13,fontWeight:800,color:'#dc2626' }}>{money(promo.price)}</span>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* PRODUCT COUNT */}
        <p style={{ fontSize:12,color:C.gray,marginBottom:16,fontWeight:500 }}>{filtered.length} product{filtered.length!==1?'s':''}</p>

        {/* PRODUCT GRID */}
        <div style={{ display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(160px,1fr))',gap:14 }}>
          {filtered.map(p => {
            const hw = Number(p.wholesale_price||0) > 0 && Number(p.wholesale_min_qty||0) > 0
            const promo = promoMap[p.id]
            const dp = promo ? promo.price : p.price
            return (
              <div key={p.id} style={{ background:C.white,borderRadius:16,overflow:'hidden',border:`1px solid ${C.border}`,transition:'box-shadow .2s' }} onMouseEnter={e => e.currentTarget.style.boxShadow='0 4px 20px rgba(0,0,0,0.08)'} onMouseLeave={e => e.currentTarget.style.boxShadow='none'}>
                <div onClick={() => openProduct(p)} style={{ cursor:'pointer' }}>
                  <div style={{ width:'100%',aspectRatio:'4/3',background:C.lightGray,overflow:'hidden',position:'relative' }}>
                    {p.image ? <img src={thumb(p.image)} alt={p.name} style={{ width:'100%',height:'100%',objectFit:'cover' }} loading="lazy" /> : <div style={{ width:'100%',height:'100%',background:C.ghostGreen }} />}
                    {promo && <div style={{ position:'absolute',top:8,left:8,background:'#dc2626',color:'#fff',fontSize:10,fontWeight:700,padding:'4px 10px',borderRadius:8 }}>PROMO</div>}
                  </div>
                  <div style={{ padding:12 }}>
                    <div style={{ fontSize:13,fontWeight:600,color:C.black,lineHeight:1.3,display:'-webkit-box',WebkitLineClamp:2,WebkitBoxOrient:'vertical',overflow:'hidden' }}>{p.name}</div>
                    {p.category && <div style={{ fontSize:11,color:C.gray,marginTop:3 }}>{p.category}</div>}
                    <div style={{ marginTop:8 }}>
                      {promo && <div style={{ fontSize:11,color:C.gray,textDecoration:'line-through' }}>{money(p.price)}</div>}
                      <div style={{ fontSize:17,fontWeight:800,color:promo?'#dc2626':C.dark }}>{money(dp)}</div>
                    </div>
                    {promo && <div style={{ fontSize:10,color:'#dc2626',fontWeight:600,marginTop:2 }}>{promo.promoName}</div>}
                    {!promo && hw && <div style={{ fontSize:10,color:C.bright,fontWeight:600,marginTop:2 }}>Buy {p.wholesale_min_qty}+ for {money(p.wholesale_price)} each</div>}
                  </div>
                </div>
                <div style={{ padding:'0 12px 12px' }}>
                  <button onClick={() => addToCart({ ...p, price: dp, originalPrice: p.price, isPromo: !!promo })} style={{ width:'100%',height:40,background:C.dark,color:'#fff',borderRadius:12,fontSize:12,fontWeight:600,border:'none',cursor:'pointer',transition:'background .2s' }} onMouseEnter={e => e.currentTarget.style.background=C.mid} onMouseLeave={e => e.currentTarget.style.background=C.dark}>
                    Add to Order
                  </button>
                </div>
              </div>
            )
          })}
        </div>

        {filtered.length === 0 && <div style={{ textAlign:'center',padding:'60px 0' }}><p style={{ color:C.gray,fontSize:14 }}>No products found</p>{search && <button onClick={() => setSearch('')} style={{ marginTop:10,color:C.bright,fontWeight:600,fontSize:13,background:'none',border:'none',cursor:'pointer' }}>Clear search</button>}</div>}

        {/* FAQ SECTION */}
        <div style={{ marginTop:60,marginBottom:40 }}>
          <h2 style={{ fontSize:28,fontWeight:800,textAlign:'center',color:C.black,margin:'0 0 8px' }}>Got Questions?</h2>
          <p style={{ fontSize:28,fontWeight:800,textAlign:'center',color:C.black,margin:'0 0 32px' }}>We've Got Answers.</p>
          <div style={{ maxWidth:700,margin:'0 auto' }}>
            {[
              { q:'How do I place an order?', a:'Browse our products, tap "Add to Order" on the items you want, then tap the cart button and click "Order on WhatsApp". Your invoice will be sent to you shortly.' },
              { q:'What payment methods do you accept?', a:'We accept Mobile Money (MTN, Vodafone, AirtelTigo) and card payments via a secure payment link.' },
              { q:'Do you offer delivery?', a:'Yes, we deliver across Accra and surrounding areas. Delivery fees depend on your location.' },
              { q:'Do you have wholesale prices?', a:'Yes. Selected products have wholesale pricing when you buy in bulk. Look for the green text on products.' },
            ].map((f, i) => (
              <div key={i} onClick={() => setFaqOpen(faqOpen===i?null:i)} style={{ background:C.ghostGreen,borderRadius:14,padding:'18px 24px',marginBottom:10,cursor:'pointer',transition:'all .2s',border:faqOpen===i?`1px solid ${C.lightLime}`:'1px solid transparent' }}>
                <div style={{ display:'flex',justifyContent:'space-between',alignItems:'center' }}>
                  <span style={{ fontSize:15,fontWeight:600,color:C.black }}>{f.q}</span>
                  <span style={{ fontSize:18,color:C.dark,fontWeight:300,transform:faqOpen===i?'rotate(45deg)':'none',transition:'transform .2s' }}>+</span>
                </div>
                {faqOpen===i && <p style={{ margin:'12px 0 0',fontSize:13,color:C.gray,lineHeight:1.7 }}>{f.a}</p>}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* CTA BANNER */}
      <div style={{ background:`linear-gradient(135deg, ${C.bright} 0%, ${C.lime} 50%, ${C.lightLime} 100%)`,padding:'48px 20px',textAlign:'center',position:'relative',overflow:'hidden' }}>
        <div style={{ position:'absolute',right:-30,top:-30,width:120,height:120,borderRadius:'50%',background:'rgba(255,255,255,0.15)' }} />
        <div style={{ position:'absolute',left:-20,bottom:-20,width:100,height:100,borderRadius:'50%',background:'rgba(22,101,52,0.08)' }} />
        <div style={{ position:'relative',zIndex:1 }}>
          <h2 style={{ fontSize:28,fontWeight:800,color:C.dark,margin:'0 0 8px' }}>Your One Stop Shop</h2>
          <p style={{ fontSize:14,color:C.mid,margin:'0 0 24px' }}>Quality home furnishings at the best prices</p>
          <a href={`tel:${SHOP.phone.split('/')[0].trim().replace(/\s/g,'')}`} style={{ display:'inline-flex',alignItems:'center',gap:8,background:C.dark,color:'#fff',padding:'14px 32px',borderRadius:50,fontSize:14,fontWeight:700,textDecoration:'none',boxShadow:'0 4px 15px rgba(22,101,52,0.3)' }}>Call to Order</a>
        </div>
      </div>

      {/* FOOTER */}
      <div style={{ background:C.dark,color:'#fff',padding:'40px 20px 32px' }}>
        <div style={{ maxWidth:1100,margin:'0 auto' }}>
          <div style={{ display:'flex',flexWrap:'wrap',gap:40,marginBottom:32 }}>
            <div style={{ flex:'1 1 250px' }}>
              <h3 style={{ fontSize:18,fontWeight:800,margin:'0 0 8px' }}>{SHOP.name}</h3>
              <p style={{ fontSize:13,opacity:0.6,lineHeight:1.7,margin:0 }}>Your trusted destination for quality home furnishings, cookware, curtains, and more. Serving Accra and beyond.</p>
            </div>
            <div style={{ flex:'0 0 auto' }}>
              <h4 style={{ fontSize:13,fontWeight:700,margin:'0 0 12px',opacity:0.5,textTransform:'uppercase',letterSpacing:1 }}>Quick Links</h4>
              <div style={{ display:'flex',flexDirection:'column',gap:8 }}>
                <span style={{ fontSize:13,opacity:0.7 }}>Home</span>
                <span style={{ fontSize:13,opacity:0.7 }}>Products</span>
                <span style={{ fontSize:13,opacity:0.7 }}>Wholesale</span>
              </div>
            </div>
            <div style={{ flex:'0 0 auto' }}>
              <h4 style={{ fontSize:13,fontWeight:700,margin:'0 0 12px',opacity:0.5,textTransform:'uppercase',letterSpacing:1 }}>Contact</h4>
              <div style={{ display:'flex',flexDirection:'column',gap:8 }}>
                <span style={{ fontSize:13,opacity:0.7 }}>{SHOP.phone}</span>
                <span style={{ fontSize:13,opacity:0.7 }}>{SHOP.address}</span>
                <span style={{ fontSize:13,opacity:0.7 }}>{SHOP.website}</span>
              </div>
            </div>
          </div>
          <div style={{ borderTop:'1px solid rgba(255,255,255,0.1)',paddingTop:20,textAlign:'center' }}>
            <p style={{ fontSize:12,opacity:0.4,margin:0 }}>© {new Date().getFullYear()} {SHOP.name}. All rights reserved.</p>
          </div>
        </div>
      </div>

      {/* FLOATING CART */}
      {cc > 0 && <button onClick={() => setShowCart(true)} style={{ position:'fixed',bottom:20,right:20,height:56,padding:'0 24px',background:C.bright,color:C.dark,borderRadius:16,boxShadow:`0 6px 24px rgba(34,197,94,0.4)`,display:'flex',alignItems:'center',gap:10,fontWeight:800,fontSize:15,border:'none',cursor:'pointer',zIndex:50 }}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>
        {cc} · {money(ct)}
      </button>}

      {/* CART DRAWER */}
      {showCart && <div onClick={() => setShowCart(false)} style={{ position:'fixed',inset:0,background:'rgba(0,0,0,0.4)',zIndex:200 }} />}
      <div style={{ position:'fixed',bottom:0,left:0,right:0,maxHeight:'85vh',background:C.white,zIndex:201,display:'flex',flexDirection:'column',borderRadius:'24px 24px 0 0',boxShadow:'0 -10px 40px rgba(0,0,0,0.15)',transform:showCart?'translateY(0)':'translateY(100%)',transition:'transform .3s ease' }}>
        <div style={{ display:'flex',justifyContent:'center',padding:'10px 0 4px' }}><div style={{ width:40,height:4,background:C.border,borderRadius:2 }} /></div>
        <div style={{ display:'flex',alignItems:'center',justifyContent:'space-between',padding:'0 20px 12px',borderBottom:`1px solid ${C.border}` }}>
          <h3 style={{ fontSize:18,fontWeight:700,margin:0 }}>Your Order <span style={{ fontSize:14,fontWeight:400,color:C.gray }}>({cc})</span></h3>
          <button onClick={() => setShowCart(false)} style={{ width:32,height:32,background:C.lightGray,borderRadius:10,border:'none',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',fontSize:14,color:C.gray }}>✕</button>
        </div>
        <div style={{ flex:1,overflowY:'auto',padding:20 }}>
          {!cart.length ? <div style={{ textAlign:'center',padding:'40px 0',color:C.gray,fontSize:14 }}>Your order is empty</div> : (
            <div style={{ display:'flex',flexDirection:'column',gap:10 }}>
              {cart.map(c => (
                <div key={c.id} style={{ display:'flex',alignItems:'center',gap:12,padding:12,background:C.lightGray,borderRadius:14 }}>
                  <div style={{ width:48,height:48,background:C.border,borderRadius:10,overflow:'hidden',flexShrink:0 }}>
                    {c.image ? <img src={thumb(c.image,80)} alt="" style={{ width:'100%',height:'100%',objectFit:'cover' }} /> : null}
                  </div>
                  <div style={{ flex:1,minWidth:0 }}>
                    <div style={{ fontSize:13,fontWeight:600,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis' }}>{c.name}</div>
                    <div style={{ fontSize:11,color:C.gray }}>{money(c.price)} each</div>
                    {c.isWholesale && <div style={{ fontSize:10,fontWeight:700,color:C.bright,marginTop:2 }}>Wholesale price</div>}
                    {!c.isWholesale && c.wholesaleMinQty > 0 && c.qty < c.wholesaleMinQty && <div style={{ fontSize:10,color:C.gray,marginTop:2 }}>Buy {c.wholesaleMinQty}+ for {money(c.wholesalePrice)} each</div>}
                  </div>
                  <div style={{ display:'flex',alignItems:'center',gap:6 }}>
                    <button onClick={() => updateQty(c.id,-1)} style={{ width:32,height:32,border:`1px solid ${C.border}`,borderRadius:8,background:C.white,fontSize:14,fontWeight:700,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',color:C.black }}>−</button>
                    <span style={{ width:24,textAlign:'center',fontSize:14,fontWeight:700 }}>{c.qty}</span>
                    <button onClick={() => updateQty(c.id,1)} style={{ width:32,height:32,border:`1px solid ${C.border}`,borderRadius:8,background:C.white,fontSize:14,fontWeight:700,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',color:C.black }}>+</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        {cart.length > 0 && (
          <div style={{ padding:20,borderTop:`1px solid ${C.border}` }}>
            <div style={{ display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16 }}>
              <span style={{ fontSize:14,color:C.gray }}>Total ({cc} item{cc!==1?'s':''})</span>
              <span style={{ fontSize:24,fontWeight:800,color:C.dark }}>{money(ct)}</span>
            </div>
            <button onClick={() => { orderViaWhatsApp(); setShowCart(false); setCart([]) }} style={{ width:'100%',height:56,background:C.bright,color:C.dark,borderRadius:16,fontSize:16,fontWeight:800,border:'none',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',gap:10,boxShadow:`0 4px 15px rgba(34,197,94,0.3)` }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 0C5.373 0 0 5.373 0 12c0 2.625.846 5.059 2.284 7.034L.789 23.492l4.612-1.21A11.95 11.95 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.75c-2.115 0-4.142-.588-5.904-1.699l-.424-.252-2.732.717.73-2.667-.276-.44A9.72 9.72 0 012.25 12C2.25 6.624 6.624 2.25 12 2.25S21.75 6.624 21.75 12 17.376 21.75 12 21.75z"/></svg>
              Order on WhatsApp
            </button>
            <button onClick={() => setCart([])} style={{ width:'100%',height:36,color:C.gray,fontSize:12,fontWeight:500,background:'none',border:'none',cursor:'pointer',marginTop:8 }}>Clear order</button>
          </div>
        )}
      </div>

      {/* PRODUCT DETAIL MODAL */}
      {viewProduct && (() => {
        const related = products.filter(p => p.id !== viewProduct.id && p.category && viewProduct.category && p.category === viewProduct.category && p.image).slice(0,4)
        if (related.length < 4) { const words = viewProduct.name.toLowerCase().split(/\s+/).filter(w => w.length > 3); const sim = products.filter(p => p.id !== viewProduct.id && p.image && !related.find(r => r.id === p.id) && words.some(w => p.name.toLowerCase().includes(w))); related.push(...sim.slice(0, 4 - related.length)) }
        const promo = promoMap[viewProduct.id], dp = promo ? promo.price : viewProduct.price
        return <>
          <div onClick={closeProduct} style={{ position:'fixed',inset:0,background:'rgba(0,0,0,0.5)',zIndex:300 }} />
          <div style={{ position:'fixed',inset:16,maxWidth:480,maxHeight:'85vh',margin:'auto',background:C.white,borderRadius:24,zIndex:301,overflow:'hidden',display:'flex',flexDirection:'column',boxShadow:'0 20px 60px rgba(0,0,0,0.2)' }}>
            <div style={{ flex:1,overflowY:'auto' }}>
              <div style={{ width:'100%',aspectRatio:'4/3',background:C.lightGray,overflow:'hidden',position:'relative' }}>
                {viewProduct.image ? <img src={thumb(viewProduct.image,400)} alt="" style={{ width:'100%',height:'100%',objectFit:'cover' }} /> : <div style={{ width:'100%',height:'100%',background:C.ghostGreen }} />}
                <button onClick={closeProduct} style={{ position:'absolute',top:12,right:12,width:36,height:36,background:'rgba(255,255,255,0.9)',backdropFilter:'blur(8px)',borderRadius:12,border:'none',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',fontSize:14,color:C.gray,boxShadow:'0 2px 10px rgba(0,0,0,0.1)' }}>✕</button>
                <button onClick={() => shareProduct(viewProduct)} style={{ position:'absolute',top:12,left:12,width:36,height:36,background:'rgba(255,255,255,0.9)',backdropFilter:'blur(8px)',borderRadius:12,border:'none',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',boxShadow:'0 2px 10px rgba(0,0,0,0.1)' }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={C.gray} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.59 13.51l6.83 3.98M15.41 6.51l-6.82 3.98"/></svg>
                </button>
                {promo && <div style={{ position:'absolute',bottom:12,left:12,background:'#dc2626',color:'#fff',fontSize:12,fontWeight:700,padding:'6px 14px',borderRadius:10 }}>PROMO</div>}
              </div>
              <div style={{ padding:20 }}>
                {viewProduct.category && <div style={{ fontSize:12,color:C.gray,fontWeight:500,marginBottom:4 }}>{viewProduct.category}</div>}
                <h2 style={{ fontSize:20,fontWeight:800,color:C.black,margin:'0 0 8px' }}>{viewProduct.name}</h2>
                {promo && <div style={{ fontSize:14,color:C.gray,textDecoration:'line-through' }}>{money(viewProduct.price)}</div>}
                <div style={{ fontSize:26,fontWeight:800,color:promo?'#dc2626':C.dark }}>{money(dp)}</div>
                {promo && <div style={{ marginTop:8,background:'#fef2f2',border:'1px solid #fecaca',borderRadius:12,padding:'8px 14px' }}><div style={{ fontSize:13,fontWeight:600,color:'#dc2626' }}>{promo.promoName}</div><div style={{ fontSize:12,color:'#ef4444' }}>Save {money(viewProduct.price - promo.price)}</div></div>}
                {!promo && Number(viewProduct.wholesale_price||0) > 0 && Number(viewProduct.wholesale_min_qty||0) > 0 && <div style={{ marginTop:8,background:C.ghostGreen,border:`1px solid ${C.paleLime}`,borderRadius:12,padding:'8px 14px' }}><div style={{ fontSize:13,fontWeight:600,color:C.dark }}>Wholesale: {money(viewProduct.wholesale_price)} each</div><div style={{ fontSize:12,color:C.mid }}>When you buy {viewProduct.wholesale_min_qty} or more</div></div>}
                <button onClick={() => shareProduct(viewProduct)} style={{ display:'flex',alignItems:'center',gap:6,marginTop:12,fontSize:13,fontWeight:600,color:C.bright,background:'none',border:'none',cursor:'pointer',padding:0 }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.59 13.51l6.83 3.98M15.41 6.51l-6.82 3.98"/></svg>
                  Share this product
                </button>
                {related.length > 0 && <div style={{ marginTop:20,paddingTop:16,borderTop:`1px solid ${C.border}` }}>
                  <h4 style={{ fontSize:14,fontWeight:700,color:C.black,margin:'0 0 12px' }}>You may also like</h4>
                  <div style={{ display:'flex',gap:10,overflowX:'auto' }}>
                    {related.map(r => <div key={r.id} onClick={() => openProduct(r)} style={{ flexShrink:0,width:110,cursor:'pointer' }}>
                      <div style={{ width:110,height:80,background:C.lightGray,borderRadius:10,overflow:'hidden' }}><img src={thumb(r.image,120)} alt="" style={{ width:'100%',height:'100%',objectFit:'cover' }} loading="lazy" /></div>
                      <div style={{ fontSize:11,fontWeight:600,color:C.black,marginTop:6,lineHeight:1.3,display:'-webkit-box',WebkitLineClamp:2,WebkitBoxOrient:'vertical',overflow:'hidden' }}>{r.name}</div>
                      <div style={{ fontSize:11,fontWeight:800,color:C.dark }}>{money(r.price)}</div>
                    </div>)}
                  </div>
                </div>}
              </div>
            </div>
            <div style={{ padding:'12px 20px 20px',borderTop:`1px solid ${C.border}` }}>
              <button onClick={() => { addToCart({ ...viewProduct, price: dp, originalPrice: viewProduct.price, isPromo: !!promo }); closeProduct() }} style={{ width:'100%',height:50,background:C.dark,color:'#fff',borderRadius:14,fontSize:14,fontWeight:700,border:'none',cursor:'pointer' }}>Add to Order</button>
            </div>
          </div>
        </>
      })()}
    </div>
  )
}
