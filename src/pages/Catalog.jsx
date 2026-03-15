import { useState, useEffect, useMemo } from 'react'
import { getSupabase } from '../lib/supabase'
import { SHOP } from '../lib/utils'

const money = v => 'GHS ' + Number(v || 0).toFixed(2)
const thumb = (url, w = 300) => {
  if (!url) return ''
  if (url.includes('supabase')) return url + (url.includes('?') ? '&' : '?') + `width=${w}&quality=70`
  return url
}

const SHOP_WHATSAPP = '233245315581' // Main WhatsApp number for orders

export default function Catalog() {
  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [selectedCat, setSelectedCat] = useState('all')
  const [cart, setCart] = useState([]) // { id, name, price, qty, image }
  const [showCart, setShowCart] = useState(false)
  const [viewProduct, setViewProduct] = useState(null)
  const [orderSent, setOrderSent] = useState(false)

  useEffect(() => { loadProducts() }, [])

  const loadProducts = async () => {
    const sb = getSupabase()
    const { data } = await sb.from('products').select('id,name,category,price,wholesale_price,wholesale_min_qty,quantity,image').order('name', { ascending: true })
    setProducts((data || []).filter(p => p.quantity > 0))
    setLoading(false)
  }

  const categories = useMemo(() => ['all', ...new Set(products.filter(p => p.category).map(p => p.category))], [products])

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return products.filter(p => (!q || p.name.toLowerCase().includes(q)) && (selectedCat === 'all' || p.category === selectedCat))
  }, [products, search, selectedCat])

  const addToCart = (product) => {
    setCart(prev => {
      const existing = prev.find(c => c.id === product.id)
      if (existing) {
        const newQty = existing.qty + 1
        const wp = Number(product.wholesale_price || 0)
        const wm = Number(product.wholesale_min_qty || 0)
        const price = (wp > 0 && wm > 0 && newQty >= wm) ? wp : Number(product.price)
        return prev.map(c => c.id === product.id ? { ...c, qty: newQty, price, isWholesale: wp > 0 && wm > 0 && newQty >= wm } : c)
      }
      return [...prev, { id: product.id, name: product.name, price: Number(product.price), retailPrice: Number(product.price), wholesalePrice: Number(product.wholesale_price || 0), wholesaleMinQty: Number(product.wholesale_min_qty || 0), qty: 1, image: product.image, isWholesale: false }]
    })
  }

  const updateQty = (id, delta) => {
    setCart(prev => prev.map(c => {
      if (c.id !== id) return c
      const newQty = Math.max(0, c.qty + delta)
      if (newQty === 0) return { ...c, qty: 0 }
      const isWholesale = c.wholesalePrice > 0 && c.wholesaleMinQty > 0 && newQty >= c.wholesaleMinQty
      const price = isWholesale ? c.wholesalePrice : c.retailPrice
      return { ...c, qty: newQty, price, isWholesale }
    }).filter(c => c.qty > 0))
  }

  const cartCount = cart.reduce((a, c) => a + c.qty, 0)
  const cartTotal = cart.reduce((a, c) => a + c.price * c.qty, 0)

  const orderViaWhatsApp = () => {
    if (cart.length === 0) return
    const lines = [`Hi, I'd like to order from EVERYTINROOM:`]
    lines.push('')
    cart.forEach(c => {
      lines.push(`${c.qty}x ${c.name} - ${money(c.price * c.qty)}${c.isWholesale ? ' (wholesale)' : ''}`)
    })
    lines.push('')
    lines.push(`Total: ${money(cartTotal)}`)
    lines.push('')
    lines.push('Please send me an invoice. Thank you.')
    const msg = lines.join('\n')
    const isMobile = /Android|iPhone|iPad/i.test(navigator.userAgent)
    if (isMobile) window.location.href = `whatsapp://send?phone=${SHOP_WHATSAPP}&text=${encodeURIComponent(msg)}`
    else window.open(`https://web.whatsapp.com/send?phone=${SHOP_WHATSAPP}&text=${encodeURIComponent(msg)}`, '_blank')
    try { navigator.clipboard.writeText(msg) } catch {}
  }

  if (loading) return (
    <div className="min-h-screen bg-[#f6f4ef] flex items-center justify-center">
      <div className="w-8 h-8 border-3 border-[#d4dbd0] border-t-[#3d8b6a] rounded-full animate-spin" />
    </div>
  )

  return (
    <div className="min-h-screen bg-[#f6f4ef]">
      {/* Header */}
      <div className="bg-[#1a3d30] text-white relative overflow-hidden">
        <div className="absolute -right-10 -top-10 w-40 h-40 rounded-full border border-white/5" />
        <div className="absolute -right-4 -top-4 w-24 h-24 rounded-full border border-white/5" />
        <div className="absolute -left-8 -bottom-8 w-32 h-32 rounded-full border border-white/5" />
        <div className="absolute left-1/3 top-2 w-12 h-12 rounded-full bg-white/3" />

        <div className="max-w-5xl mx-auto px-4 md:px-8 py-6 md:py-8 relative z-10">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight" style={{ fontFamily: 'Outfit, sans-serif' }}>{SHOP.name}</h1>
              <p className="text-white/40 text-sm mt-0.5">{SHOP.tagline} · {SHOP.address}</p>
            </div>
            <a href={`tel:${SHOP.phone.split('/')[0].trim().replace(/\s/g, '')}`} className="hidden md:flex h-10 px-5 bg-white/10 rounded-xl text-sm font-medium items-center gap-2 hover:bg-white/15 transition">
              Call us · {SHOP.phone.split('/')[0].trim()}
            </a>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 md:px-8 py-5">
        {/* Search */}
        <div className="relative mb-4">
          <svg className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" strokeLinecap="round" strokeLinejoin="round"/></svg>
          <input className="w-full h-12 pl-11 pr-4 bg-white rounded-2xl text-sm font-medium placeholder:text-stone-300 focus:outline-none focus:ring-2 focus:ring-[#3d8b6a]/20 border border-stone-200/50"
            placeholder="Search products..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>

        {/* Categories */}
        <div className="flex gap-1.5 overflow-x-auto mb-5 scrollbar-hide pb-1">
          {categories.map(c => (
            <button key={c} onClick={() => setSelectedCat(c)}
              className={`h-9 px-4 rounded-full text-xs font-semibold whitespace-nowrap transition ${selectedCat === c ? 'bg-[#1a3d30] text-white' : 'bg-white text-stone-400 hover:text-stone-600 border border-stone-200/50'}`}>
              {c === 'all' ? 'All Products' : c}
            </button>
          ))}
        </div>

        {/* Product count */}
        <p className="text-xs text-stone-400 mb-4 font-medium">{filtered.length} product{filtered.length !== 1 ? 's' : ''}</p>

        {/* Products Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 md:gap-4">
          {filtered.map(p => {
            const hasWholesale = Number(p.wholesale_price || 0) > 0 && Number(p.wholesale_min_qty || 0) > 0
            return (
            <div key={p.id} className="bg-white rounded-2xl overflow-hidden group">
              <div onClick={() => setViewProduct(p)} className="cursor-pointer">
                <div className="w-full aspect-[4/3] bg-stone-100 overflow-hidden">
                  {p.image ? <img src={thumb(p.image)} alt={p.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" loading="lazy" /> : <div className="w-full h-full flex items-center justify-center text-stone-200 text-2xl">□</div>}
                </div>
                <div className="p-3">
                  <div className="text-[13px] font-semibold text-stone-800 leading-snug">{p.name}</div>
                  {p.category && <div className="text-[11px] text-stone-400 mt-0.5">{p.category}</div>}
                  <div className="text-base font-extrabold text-[#1a3d30] mt-1.5">{money(p.price)}</div>
                  {hasWholesale && <div className="text-[10px] text-emerald-600 font-semibold mt-0.5">Buy {p.wholesale_min_qty}+ for {money(p.wholesale_price)} each</div>}
                </div>
              </div>
              <div className="px-3 pb-3">
                <button onClick={() => { addToCart(p); }} className="w-full h-9 bg-[#1a3d30] text-white rounded-xl text-xs font-semibold hover:bg-[#265a44] active:scale-[.97] transition">
                  Add to Order
                </button>
              </div>
            </div>
            )
          })}
        </div>

        {filtered.length === 0 && (
          <div className="text-center py-20">
            <p className="text-stone-400 text-sm">No products found</p>
          </div>
        )}
      </div>

      {/* Floating Cart Button */}
      {cartCount > 0 && (
        <button onClick={() => setShowCart(true)} className="fixed bottom-5 right-5 h-16 px-7 bg-[#f97316] text-white rounded-2xl shadow-lg shadow-orange-500/30 flex items-center gap-3 font-extrabold text-base active:scale-95 transition z-50">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>
          {cartCount} item{cartCount !== 1 ? 's' : ''} · {money(cartTotal)}
        </button>
      )}

      {/* Cart Drawer */}
      {showCart && <div className="fixed inset-0 bg-black/40 z-[200]" onClick={() => setShowCart(false)} />}
      <div className={`fixed bottom-0 left-0 right-0 md:left-auto md:right-0 md:top-0 md:w-[400px] bg-white z-[201] flex flex-col transition-transform duration-300 rounded-t-3xl md:rounded-none max-h-[85vh] md:max-h-full shadow-2xl ${showCart ? 'translate-y-0 md:translate-x-0' : 'translate-y-full md:translate-y-0 md:translate-x-full'}`}>
        <div className="flex items-center justify-between p-5 border-b border-stone-100">
          <h3 className="text-lg font-bold">Your Order</h3>
          <button onClick={() => setShowCart(false)} className="w-8 h-8 bg-stone-100 rounded-lg flex items-center justify-center">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {cart.length === 0 ? (
            <div className="text-center py-12 text-stone-400 text-sm">Your order is empty</div>
          ) : (
            <div className="space-y-3">
              {cart.map(c => (
                <div key={c.id} className="flex items-center gap-3 p-3 bg-stone-50 rounded-xl">
                  <div className="w-12 h-12 bg-stone-100 rounded-lg overflow-hidden flex-shrink-0">
                    {c.image ? <img src={thumb(c.image, 100)} alt="" className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center text-stone-300 text-sm">□</div>}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold truncate">{c.name}</div>
                    <div className="text-xs text-stone-400">{money(c.price)} each</div>
                    {c.isWholesale && <div className="text-[10px] font-bold text-emerald-600 mt-0.5">Wholesale price applied</div>}
                    {!c.isWholesale && c.wholesaleMinQty > 0 && c.qty < c.wholesaleMinQty && <div className="text-[10px] text-stone-400 mt-0.5">Buy {c.wholesaleMinQty}+ for {money(c.wholesalePrice)} each</div>}
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => updateQty(c.id, -1)} className="w-8 h-8 border border-stone-300 rounded-lg text-sm font-bold flex items-center justify-center text-stone-600 hover:bg-stone-100 transition">−</button>
                    <span className="text-sm font-bold w-6 text-center">{c.qty}</span>
                    <button onClick={() => updateQty(c.id, 1)} className="w-8 h-8 border border-stone-300 rounded-lg text-sm font-bold flex items-center justify-center text-stone-600 hover:bg-stone-100 transition">+</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {cart.length > 0 && (
          <div className="p-5 border-t border-stone-100 safe-bottom">
            <div className="flex justify-between items-center mb-5">
              <span className="text-sm text-stone-500">Total ({cartCount} item{cartCount !== 1 ? 's' : ''})</span>
              <span className="text-2xl font-extrabold">{money(cartTotal)}</span>
            </div>
            <button onClick={() => { orderViaWhatsApp(); setShowCart(false); setCart([]); setOrderSent(true); setTimeout(() => setOrderSent(false), 8000) }}
              className="w-full h-16 bg-[#25d366] text-white rounded-2xl text-lg font-extrabold flex items-center justify-center gap-3 active:scale-[.98] transition shadow-lg shadow-green-500/20">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 0C5.373 0 0 5.373 0 12c0 2.625.846 5.059 2.284 7.034L.789 23.492l4.612-1.21A11.95 11.95 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.75c-2.115 0-4.142-.588-5.904-1.699l-.424-.252-2.732.717.73-2.667-.276-.44A9.72 9.72 0 012.25 12C2.25 6.624 6.624 2.25 12 2.25S21.75 6.624 21.75 12 17.376 21.75 12 21.75z"/></svg>
              Order on WhatsApp
            </button>
            <button onClick={() => setCart([])} className="w-full h-9 text-stone-400 text-xs font-medium mt-3 hover:text-stone-600 transition">Clear order</button>
          </div>
        )}
      </div>

      {/* Product Detail Modal */}
      {viewProduct && (
        <>
          <div className="fixed inset-0 bg-black/50 z-[300]" onClick={() => setViewProduct(null)} />
          <div className="fixed inset-4 md:inset-auto md:top-1/2 md:left-1/2 md:-translate-x-1/2 md:-translate-y-1/2 md:w-[480px] md:max-h-[85vh] bg-white rounded-3xl z-[301] overflow-hidden flex flex-col">
            <div className="w-full aspect-[4/3] bg-stone-100 overflow-hidden relative">
              {viewProduct.image ? <img src={thumb(viewProduct.image, 500)} alt="" className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center text-stone-200 text-4xl">□</div>}
              <button onClick={() => setViewProduct(null)} className="absolute top-4 right-4 w-9 h-9 bg-white/90 backdrop-blur rounded-xl flex items-center justify-center shadow-md">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
              </button>
            </div>
            <div className="p-5 flex-1">
              {viewProduct.category && <div className="text-xs text-stone-400 font-medium mb-1">{viewProduct.category}</div>}
              <h2 className="text-xl font-extrabold text-stone-900">{viewProduct.name}</h2>
              <div className="text-2xl font-extrabold text-[#1a3d30] mt-2">{money(viewProduct.price)}</div>
              {Number(viewProduct.wholesale_price || 0) > 0 && Number(viewProduct.wholesale_min_qty || 0) > 0 && (
                <div className="mt-2 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2">
                  <div className="text-sm font-semibold text-emerald-700">Wholesale: {money(viewProduct.wholesale_price)} each</div>
                  <div className="text-xs text-emerald-600">When you buy {viewProduct.wholesale_min_qty} or more pieces</div>
                </div>
              )}
              <div className="text-xs text-stone-400 mt-2">{viewProduct.quantity > 0 ? 'In stock' : 'Out of stock'}</div>
            </div>
            <div className="p-5 pt-0">
              <button onClick={() => { addToCart(viewProduct); setViewProduct(null) }}
                className="w-full h-12 bg-[#1a3d30] text-white rounded-2xl text-sm font-bold hover:bg-[#265a44] active:scale-[.98] transition">
                Add to Order
              </button>
            </div>
          </div>
        </>
      )}

      {/* Order Sent Confirmation */}
      {orderSent && (
        <>
          <div className="fixed inset-0 bg-black/50 z-[400]" onClick={() => setOrderSent(false)} />
          <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[90%] max-w-[380px] bg-white rounded-3xl p-8 z-[401] text-center shadow-2xl">
            <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5"/></svg>
            </div>
            <h3 className="text-xl font-extrabold text-stone-900 mb-2">Order Received</h3>
            <p className="text-sm text-stone-500 leading-relaxed">Thank you for your order. Your invoice will be sent to you shortly for you to proceed with payment.</p>
            <button onClick={() => setOrderSent(false)} className="w-full h-12 bg-[#1a3d30] text-white rounded-2xl text-sm font-bold mt-6 active:scale-[.98] transition">Continue Browsing</button>
          </div>
        </>
      )}

      {/* Footer */}
      <div className="bg-[#1a3d30] text-white mt-10">
        <div className="max-w-5xl mx-auto px-4 md:px-8 py-8 text-center">
          <h3 className="font-bold text-lg" style={{ fontFamily: 'Outfit, sans-serif' }}>{SHOP.name}</h3>
          <p className="text-white/40 text-sm mt-1">{SHOP.address}</p>
          <p className="text-white/40 text-sm">{SHOP.phone}</p>
          <p className="text-white/40 text-sm">{SHOP.website}</p>
          <div className="flex justify-center gap-3 mt-4">
            <a href={`https://wa.me/${SHOP_WHATSAPP}`} className="h-10 px-5 bg-white/10 rounded-xl text-sm font-medium flex items-center gap-2 hover:bg-white/15 transition">WhatsApp Us</a>
            <a href={`tel:${SHOP.phone.split('/')[0].trim().replace(/\s/g, '')}`} className="h-10 px-5 bg-white/10 rounded-xl text-sm font-medium flex items-center gap-2 hover:bg-white/15 transition">Call Us</a>
          </div>
        </div>
      </div>
    </div>
  )
}
