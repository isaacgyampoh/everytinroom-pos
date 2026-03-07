import { useState, useMemo } from 'react'
import { useStore } from '../hooks/useStore'
import { money, num, today, thumb } from '../lib/utils'
import toast from 'react-hot-toast'

export default function POS() {
  const { products, bundles, promos, mode, setMode, selectedCat, setCat, addToCart } = useStore()
  const [query, setQuery] = useState('')

  const categories = useMemo(() => ['all', ...new Set(products.filter(p => p.category).map(p => p.category))], [products])

  const promoPriceMap = useMemo(() => {
    const map = {}
    const t = today()
    for (const p of promos) {
      if (!p.active || p.startDate > t || p.endDate < t) continue
      for (const item of p.items) {
        const price = num(item.promoPrice)
        const existing = map[item.productId]
        if (!existing || price < existing) map[item.productId] = price
      }
    }
    return map
  }, [promos])

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

  const promoCount = Object.keys(promoPriceMap).length

  return (
    <div className="animate-fade">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight">Point of Sale</h1>
        <p className="text-gray-400 text-[15px] mt-1">Search, select and sell</p>
      </div>

      {/* Promo Banner */}
      {promoCount > 0 && (
        <div className="bg-gradient-to-r from-orange-500 to-amber-400 rounded-2xl px-5 py-3.5 mb-5 flex items-center gap-3 shadow-lg shadow-orange-500/10">
          <span className="text-2xl">🏷️</span>
          <span className="text-sm font-bold text-white">{promoCount} product{promoCount > 1 ? 's' : ''} on promo right now!</span>
        </div>
      )}

      {/* Search */}
      <div className="relative mb-5">
        <svg className="absolute left-4.5 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
        <input className="w-full h-13 md:h-14 pl-13 pr-5 bg-white border-0 rounded-2xl text-[15px] md:text-base font-medium focus:outline-none focus:ring-2 focus:ring-brand-500/20 transition shadow-sm shadow-gray-200/50" placeholder="Search or scan barcode..." value={query}
          onChange={e => {
            setQuery(e.target.value)
            const val = e.target.value.trim()
            if (val.length > 3) {
              const exact = products.find(p => p.name.toLowerCase() === val.toLowerCase())
              if (exact && exact.quantity > 0) { if (addFromSearch(exact)) setQuery('') }
            }
          }}
          onKeyDown={e => {
            if (e.key === 'Enter' && query.trim()) {
              const match = filtered[0]
              if (match && mode !== 'bundle') { if (addFromSearch(match)) setQuery('') }
            }
          }}
        />
      </div>

      {/* Mode Switcher */}
      <div className="flex gap-2 mb-5">
        {[
          { id: 'retail', icon: '🛍️', label: 'Retail' },
          { id: 'wholesale', icon: '🏭', label: 'Wholesale' },
          { id: 'bundle', icon: '🎁', label: 'Bundle' },
        ].map(m => (
          <button key={m.id} onClick={() => setMode(m.id)}
            className={`h-11 md:h-12 px-4 md:px-6 rounded-2xl text-[13px] md:text-sm font-semibold flex items-center gap-2 transition-all duration-200 ${mode === m.id ? 'bg-gray-900 text-white shadow-lg shadow-gray-900/20' : 'bg-white text-gray-500 hover:bg-gray-50 shadow-sm'}`}>
            <span className="text-base md:text-lg">{m.icon}</span>{m.label}
          </button>
        ))}
      </div>

      {/* Categories */}
      {mode !== 'bundle' && (
        <div className="flex gap-2 overflow-x-auto mb-5 pb-1 scrollbar-hide -mx-1 px-1">
          {categories.map(c => (
            <button key={c} onClick={() => setCat(c)}
              className={`h-10 px-4.5 md:px-5 rounded-full text-[13px] md:text-sm font-semibold whitespace-nowrap transition-all duration-200 ${selectedCat === c ? 'bg-brand-500 text-white shadow-md shadow-brand-500/20' : 'bg-white text-gray-500 hover:text-gray-700 shadow-sm'}`}>
              {c === 'all' ? 'All Items' : c}
            </button>
          ))}
        </div>
      )}

      {/* Product Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3.5 md:gap-4">
        {filtered.length === 0 && (
          <div className="col-span-full text-center py-20">
            <span className="text-6xl block mb-4 opacity-20">📦</span>
            <p className="text-gray-400 font-medium">No products found</p>
          </div>
        )}
        {filtered.map(item => {
          if (mode === 'bundle') return (
            <button key={item.id} onClick={() => handleAdd(item)} className="card card-hover p-4 text-left active:scale-[.97]">
              <div className="w-full aspect-[4/3] bg-gradient-to-br from-gray-50 to-gray-100 rounded-xl mb-3 flex items-center justify-center text-4xl">🎁</div>
              <div className="text-sm md:text-[15px] font-bold text-gray-800">{item.name}</div>
              <div className="text-lg font-extrabold text-brand-500 mt-1.5">{money(item.bundlePrice)}</div>
            </button>
          )
          const effectivePrice = getEffectivePrice(item)
          const hasPromo = !!promoPriceMap[item.id]
          const qty = item.quantity
          return (
            <button key={item.id} onClick={() => handleAdd(item)} disabled={qty === 0}
              className={`bg-white rounded-[20px] overflow-hidden transition-all duration-200 text-left active:scale-[.97] ${hasPromo ? 'ring-2 ring-orange-300 shadow-lg shadow-orange-500/10' : 'shadow-sm shadow-gray-200/50 hover:shadow-md hover:shadow-gray-200/80 hover:-translate-y-0.5'} ${qty === 0 ? 'opacity-35 pointer-events-none' : ''}`}>
              {/* Promo Badge */}
              {hasPromo && (
                <div className="bg-gradient-to-r from-orange-500 to-amber-400 text-white text-[10px] md:text-[11px] font-bold text-center py-1.5 tracking-wider">🏷️ PROMO</div>
              )}
              {/* Image */}
              <div className="w-full aspect-[4/3] bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center overflow-hidden">
                {item.image ? <img src={thumb(item.image)} alt="" className="w-full h-full object-cover" loading="lazy" decoding="async" /> : <span className="text-4xl opacity-15">📦</span>}
              </div>
              {/* Info */}
              <div className="p-3.5 md:p-4">
                <div className="text-[13px] md:text-sm font-bold text-gray-800 leading-snug">{item.name}</div>
                {item.category && <div className="text-[11px] md:text-xs text-gray-400 mt-1 font-medium">{item.category}</div>}
                <div className="flex items-end justify-between mt-2.5">
                  <div>
                    {hasPromo ? (
                      <>
                        <div className="text-[11px] text-gray-300 line-through font-medium">{money(item.price)}</div>
                        <div className="text-lg md:text-xl font-extrabold text-orange-500 leading-none">{money(effectivePrice)}</div>
                      </>
                    ) : (
                      <div className="text-lg md:text-xl font-extrabold text-gray-800 leading-none">{money(effectivePrice)}</div>
                    )}
                  </div>
                  <span className={`px-2.5 py-1 rounded-lg text-[10px] md:text-[11px] font-bold ${qty === 0 ? 'bg-red-50 text-red-500' : qty <= 5 ? 'bg-amber-50 text-amber-600' : 'bg-emerald-50 text-emerald-600'}`}>
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
