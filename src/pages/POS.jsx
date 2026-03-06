import { useState, useMemo } from 'react'
import { useStore } from '../hooks/useStore'
import { money, num, today, thumb } from '../lib/utils'
import toast from 'react-hot-toast'

export default function POS() {
  const { products, bundles, promos, mode, setMode, selectedCat, setCat, addToCart } = useStore()
  const [query, setQuery] = useState('')

  const categories = useMemo(() => ['all', ...new Set(products.filter(p => p.category).map(p => p.category))], [products])

  // Build a map of active promo prices: productId -> promoPrice
  const promoPriceMap = useMemo(() => {
    const map = {}
    const t = today()
    for (const p of promos) {
      if (!p.active || p.startDate > t || p.endDate < t) continue
      for (const item of p.items) {
        // Use lowest promo price if multiple promos on same product
        const existing = map[item.productId]
        const price = num(item.promoPrice)
        if (!existing || price < existing) {
          map[item.productId] = price
        }
      }
    }
    return map
  }, [promos])

  // Get the effective price for a product
  const getEffectivePrice = (product) => {
    const promoPrice = promoPriceMap[product.id]
    if (promoPrice && promoPrice > 0) return promoPrice
    if (mode === 'wholesale' && product.wholesalePrice > 0) return product.wholesalePrice
    return product.price
  }

  const filtered = useMemo(() => {
    const q = query.toLowerCase()
    if (mode === 'bundle') return bundles.filter(b => b.active && b.name.toLowerCase().includes(q))
    return products.filter(p => {
      if (q && !p.name.toLowerCase().includes(q)) return false
      if (selectedCat !== 'all' && p.category !== selectedCat) return false
      return true
    })
  }, [products, bundles, mode, query, selectedCat])

  const handleAdd = (item) => {
    if (mode === 'bundle') {
      const b = item; let cost = 0
      for (const bi of b.products) { const p = products.find(x => x.id === bi.productId); if (p) cost += p.costPrice * num(bi.qty) }
      if (addToCart({ bundleId: b.id, name: b.name, price: b.bundlePrice, costPrice: cost, isBundle: true, bundleItems: b.products })) toast.success('Added!')
    } else {
      if (item.quantity === 0) return
      const price = getEffectivePrice(item)
      const hasPromo = !!promoPriceMap[item.id]
      if (addToCart({ productId: item.id, name: item.name, price, costPrice: item.costPrice, image: item.image, originalPrice: item.price, isPromo: hasPromo })) toast.success('Added!')
      else toast.error('Not enough stock')
    }
  }

  const addFromSearch = (product) => {
    if (product.quantity === 0) return false
    const price = getEffectivePrice(product)
    const hasPromo = !!promoPriceMap[product.id]
    if (addToCart({ productId: product.id, name: product.name, price, costPrice: product.costPrice, image: product.image, originalPrice: product.price, isPromo: hasPromo })) {
      toast.success('Added: ' + product.name)
      return true
    }
    return false
  }

  return (
    <div className="animate-fade">
      <h1 className="text-2xl md:text-3xl font-extrabold mb-1 tracking-tight">Point of Sale</h1>
      <p className="text-gray-400 text-sm mb-5">Search, select and sell</p>

      {/* Active promos banner */}
      {Object.keys(promoPriceMap).length > 0 && (
        <div className="bg-orange-50 border border-orange-200 rounded-2xl px-4 py-3 mb-4 flex items-center gap-2">
          <span className="text-xl">🏷️</span>
          <span className="text-sm font-semibold text-orange-700">{Object.keys(promoPriceMap).length} product{Object.keys(promoPriceMap).length > 1 ? 's' : ''} on promo right now!</span>
        </div>
      )}

      {/* Search */}
      <div className="relative mb-4">
        <svg className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
        <input className="w-full h-12 md:h-13 pl-12 pr-4 bg-white border border-gray-200 rounded-2xl text-[15px] md:text-base font-medium focus:outline-none focus:border-brand-400 focus:ring-3 focus:ring-brand-50 transition shadow-sm" placeholder="Search or scan barcode..." value={query}
          onChange={e => {
            setQuery(e.target.value)
            const val = e.target.value.trim()
            if (val.length > 3) {
              const exact = products.find(p => p.name.toLowerCase() === val.toLowerCase())
              if (exact && exact.quantity > 0) {
                if (addFromSearch(exact)) setQuery('')
              }
            }
          }}
          onKeyDown={e => {
            if (e.key === 'Enter' && query.trim()) {
              const match = filtered[0]
              if (match && mode !== 'bundle') {
                if (addFromSearch(match)) setQuery('')
              }
            }
          }}
        />
      </div>

      {/* Categories */}
      {mode !== 'bundle' && (
        <div className="flex gap-2 overflow-x-auto mb-4 pb-1 scrollbar-hide -mx-1 px-1">
          {categories.map(c => (
            <button key={c} onClick={() => setCat(c)}
              className={`h-9 md:h-10 px-4 md:px-5 rounded-full text-[13px] md:text-sm font-semibold whitespace-nowrap transition-all ${selectedCat === c ? 'bg-brand-500 text-white shadow-sm' : 'bg-white border border-gray-200 text-gray-500 hover:border-brand-300 hover:text-brand-500'}`}>
              {c === 'all' ? 'All Items' : c}
            </button>
          ))}
        </div>
      )}

      {/* Modes */}
      <div className="flex gap-2 mb-5">
        {[
          { id: 'retail', icon: '🛍️', label: 'Retail' },
          { id: 'wholesale', icon: '🏭', label: 'Wholesale' },
          { id: 'bundle', icon: '🎁', label: 'Bundle' },
        ].map(m => (
          <button key={m.id} onClick={() => setMode(m.id)}
            className={`h-10 md:h-11 px-3.5 md:px-5 rounded-xl text-[13px] md:text-sm font-semibold flex items-center gap-1.5 md:gap-2 transition-all ${mode === m.id ? 'bg-brand-500 text-white shadow-md shadow-brand-500/20' : 'bg-white border border-gray-200 text-gray-500 hover:border-brand-200'}`}>
            <span className="text-base md:text-lg">{m.icon}</span>{m.label}
          </button>
        ))}
      </div>

      {/* Product Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 md:gap-4">
        {filtered.length === 0 && <div className="col-span-full text-center py-16 text-gray-300"><span className="text-5xl block mb-3">📦</span>No products found</div>}
        {filtered.map(item => {
          if (mode === 'bundle') return (
            <button key={item.id} onClick={() => handleAdd(item)} className="bg-white rounded-2xl p-3 md:p-4 text-left border border-gray-100 hover:border-brand-200 hover:shadow-lg active:scale-[.97] transition-all">
              <div className="w-full aspect-[4/3] bg-gray-50 rounded-xl mb-3 flex items-center justify-center text-4xl">🎁</div>
              <div className="text-sm md:text-[15px] font-bold text-gray-800">{item.name}</div>
              <div className="text-base md:text-lg font-extrabold text-brand-500 mt-1">{money(item.bundlePrice)}</div>
            </button>
          )
          const effectivePrice = getEffectivePrice(item)
          const hasPromo = !!promoPriceMap[item.id]
          const qty = item.quantity
          return (
            <button key={item.id} onClick={() => handleAdd(item)} disabled={qty === 0}
              className={`bg-white rounded-2xl overflow-hidden border transition-all text-left ${hasPromo ? 'border-orange-300 ring-1 ring-orange-200' : 'border-gray-100 hover:border-brand-200'} hover:shadow-lg active:scale-[.97] ${qty === 0 ? 'opacity-40 pointer-events-none' : ''}`}>
              {/* Promo Badge */}
              {hasPromo && (
                <div className="bg-orange-500 text-white text-[10px] md:text-xs font-bold text-center py-1 tracking-wide">🏷️ PROMO</div>
              )}
              {/* Image */}
              <div className="w-full aspect-[4/3] bg-gray-50 flex items-center justify-center overflow-hidden relative">
                {item.image ? <img src={thumb(item.image)} alt="" className="w-full h-full object-cover" loading="lazy" decoding="async" /> : <span className="text-4xl opacity-25">📦</span>}
              </div>
              {/* Info */}
              <div className="p-3 md:p-3.5">
                <div className="text-[13px] md:text-sm font-bold text-gray-800 leading-tight">{item.name}</div>
                {item.category && <div className="text-[11px] md:text-xs text-gray-400 mt-0.5">{item.category}</div>}
                <div className="flex items-end justify-between mt-2">
                  <div>
                    {hasPromo ? (
                      <div>
                        <div className="text-[11px] text-gray-400 line-through">{money(item.price)}</div>
                        <div className="text-base md:text-lg font-extrabold text-orange-500 leading-none">{money(effectivePrice)}</div>
                      </div>
                    ) : (
                      <div className="text-base md:text-lg font-extrabold text-brand-500 leading-none">{money(effectivePrice)}</div>
                    )}
                  </div>
                  <span className={`px-2 py-0.5 rounded-md text-[10px] md:text-[11px] font-bold leading-tight ${qty === 0 ? 'bg-red-50 text-red-500' : qty <= 5 ? 'bg-amber-50 text-amber-600' : 'bg-green-50 text-green-600'}`}>
                    {qty === 0 ? 'OUT' : qty + ' left'}
                  </span>
                </div>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
