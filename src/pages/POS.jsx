import { useState } from 'react'
import { useStore } from '../hooks/useStore'
import { money, num } from '../lib/utils'
import toast from 'react-hot-toast'

export default function POS() {
  const { products, bundles, mode, setMode, selectedCat, setCat, addToCart } = useStore()
  const [query, setQuery] = useState('')

  const categories = ['all', ...new Set(products.filter(p => p.category).map(p => p.category))]

  const filtered = mode === 'bundle'
    ? bundles.filter(b => b.active && b.name.toLowerCase().includes(query.toLowerCase()))
    : products.filter(p => {
        if (!p.name.toLowerCase().includes(query.toLowerCase())) return false
        if (selectedCat !== 'all' && p.category !== selectedCat) return false
        return true
      })

  const handleAdd = (item) => {
    if (mode === 'bundle') {
      const b = item; let cost = 0
      for (const bi of b.products) { const p = products.find(x => x.id === bi.productId); if (p) cost += p.costPrice * num(bi.qty) }
      if (addToCart({ bundleId: b.id, name: b.name, price: b.bundlePrice, costPrice: cost, isBundle: true, bundleItems: b.products })) toast.success('Added!')
    } else {
      if (item.quantity === 0) return
      const price = mode === 'wholesale' && item.wholesalePrice > 0 ? item.wholesalePrice : item.price
      if (addToCart({ productId: item.id, name: item.name, price, costPrice: item.costPrice, image: item.image })) toast.success('Added!')
      else toast.error('Not enough stock')
    }
  }

  return (
    <div className="animate-fade">
      <h1 className="text-2xl md:text-3xl font-extrabold mb-1 tracking-tight">Point of Sale</h1>
      <p className="text-gray-400 text-sm mb-5">Search, select and sell</p>

      {/* Search */}
      <div className="relative mb-4">
        <svg className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
        <input className="w-full h-12 md:h-13 pl-12 pr-4 bg-white border border-gray-200 rounded-2xl text-[15px] md:text-base font-medium focus:outline-none focus:border-brand-400 focus:ring-3 focus:ring-brand-50 transition shadow-sm" placeholder="Search products..." value={query} onChange={e => setQuery(e.target.value)} />
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

      {/* Product Grid - responsive: 2 cols mobile, 3 tablet, 4 desktop */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 md:gap-4">
        {filtered.length === 0 && <div className="col-span-full text-center py-16 text-gray-300"><span className="text-5xl block mb-3">📦</span>No products found</div>}
        {filtered.map(item => {
          if (mode === 'bundle') return (
            <button key={item.id} onClick={() => handleAdd(item)} className="bg-white rounded-2xl p-3 md:p-4 text-left border border-gray-100 hover:border-brand-200 hover:shadow-lg active:scale-[.97] transition-all">
              <div className="w-full aspect-[4/3] bg-gray-50 rounded-xl mb-3 flex items-center justify-center text-4xl">🎁</div>
              <div className="text-sm md:text-[15px] font-bold text-gray-800 truncate">{item.name}</div>
              <div className="text-base md:text-lg font-extrabold text-brand-500 mt-1">{money(item.bundlePrice)}</div>
            </button>
          )
          const price = mode === 'wholesale' && item.wholesalePrice > 0 ? item.wholesalePrice : item.price
          const qty = item.quantity
          return (
            <button key={item.id} onClick={() => handleAdd(item)} disabled={qty === 0}
              className={`bg-white rounded-2xl overflow-hidden border border-gray-100 hover:border-brand-200 hover:shadow-lg active:scale-[.97] transition-all text-left ${qty === 0 ? 'opacity-40 pointer-events-none' : ''}`}>
              {/* Image */}
              <div className="w-full aspect-[4/3] bg-gray-50 flex items-center justify-center overflow-hidden">
                {item.image ? <img src={item.image} alt="" className="w-full h-full object-cover" loading="lazy" /> : <span className="text-4xl opacity-25">📦</span>}
              </div>
              {/* Info */}
              <div className="p-3 md:p-3.5">
                <div className="text-[13px] md:text-sm font-bold text-gray-800 truncate leading-tight">{item.name}</div>
                {item.category && <div className="text-[11px] md:text-xs text-gray-400 mt-0.5 truncate">{item.category}</div>}
                <div className="flex items-end justify-between mt-2">
                  <div className="text-base md:text-lg font-extrabold text-brand-500 leading-none">{money(price)}</div>
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
