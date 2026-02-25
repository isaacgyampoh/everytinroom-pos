import { useState } from 'react'
import { useStore } from '../hooks/useStore'
import { money, num } from '../lib/utils'
import toast from 'react-hot-toast'

export default function POS() {
  const { products, bundles, mode, setMode, selectedCat, setCat, addToCart, user } = useStore()
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
      const b = item
      let cost = 0
      for (const bi of b.products) {
        const p = products.find(x => x.id === bi.productId)
        if (p) cost += p.costPrice * num(bi.qty)
      }
      const ok = addToCart({ bundleId: b.id, name: b.name, price: b.bundlePrice, costPrice: cost, isBundle: true, bundleItems: b.products })
      if (ok) toast.success('Added!')
    } else {
      if (item.quantity === 0) return
      const price = mode === 'wholesale' && item.wholesalePrice > 0 ? item.wholesalePrice : item.price
      const ok = addToCart({ productId: item.id, name: item.name, price, costPrice: item.costPrice, image: item.image })
      if (ok) toast.success('Added!')
      else toast.error('Not enough stock')
    }
  }

  return (
    <div className="animate-fade">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl md:text-3xl font-extrabold text-gray-900">Point of Sale</h1>
          <p className="text-sm md:text-base text-gray-400 mt-0.5">Everytin Room • Adenta Aviation Road</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2.5 bg-white px-4 py-2.5 rounded-xl border border-gray-100">
            <div className="w-9 h-9 rounded-full bg-brand-500 flex items-center justify-center text-white text-sm font-bold">{(user?.name || 'S').charAt(0)}</div>
            <div className="hidden md:block">
              <div className="text-sm font-bold text-gray-800">{user?.name || 'Staff'}</div>
              <div className="text-xs text-gray-400">{user?.role || 'Employee'}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Search Bar */}
      <div className="relative mb-5">
        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 text-lg">🔍</span>
        <input className="w-full h-13 md:h-14 pl-12 pr-4 bg-white border border-gray-200 rounded-2xl text-base md:text-lg font-medium focus:outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100 transition placeholder:text-gray-300" placeholder="Find product by name or code" value={query} onChange={e => setQuery(e.target.value)} />
      </div>

      {/* Category Pills */}
      {mode !== 'bundle' && (
        <div className="flex gap-2 overflow-x-auto mb-5 pb-1 scrollbar-hide">
          {categories.map(c => (
            <button key={c} onClick={() => setCat(c)}
              className={`h-10 md:h-11 px-5 md:px-6 rounded-full text-sm md:text-base font-semibold whitespace-nowrap transition-all ${selectedCat === c ? 'bg-red-500 text-white shadow-md shadow-red-500/20' : 'bg-white border border-gray-200 text-gray-500 hover:bg-gray-50'}`}>
              {c === 'all' ? 'All' : c}
            </button>
          ))}
        </div>
      )}

      {/* Mode Toggles */}
      <div className="flex gap-2.5 mb-6">
        {[
          { id: 'retail', icon: '🛍️', label: 'Retail' },
          { id: 'wholesale', icon: '🏭', label: 'Wholesale' },
          { id: 'bundle', icon: '🎁', label: 'Bundle' },
        ].map(m => (
          <button key={m.id} onClick={() => setMode(m.id)}
            className={`h-11 md:h-12 px-4 md:px-5 rounded-xl text-sm md:text-base font-semibold flex items-center gap-2 transition-all ${mode === m.id ? 'bg-gray-900 text-white shadow-lg' : 'bg-white border border-gray-200 text-gray-500 hover:bg-gray-50'}`}>
            <span>{m.icon}</span>{m.label}
          </button>
        ))}
      </div>

      {/* Product Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 md:gap-5">
        {filtered.length === 0 && (
          <div className="col-span-full text-center py-16 text-gray-300">
            <span className="text-6xl block mb-4">📦</span>
            <span className="text-lg">No products found</span>
          </div>
        )}
        {filtered.map(item => {
          if (mode === 'bundle') {
            return (
              <button key={item.id} onClick={() => handleAdd(item)}
                className="bg-white rounded-2xl p-4 md:p-5 text-left border border-gray-100 hover:border-brand-300 hover:shadow-xl hover:shadow-brand-500/10 active:scale-[.97] transition-all group">
                <div className="w-full aspect-square bg-gradient-to-br from-gray-50 to-gray-100 rounded-xl mb-4 flex items-center justify-center text-5xl group-hover:scale-105 transition">🎁</div>
                <div className="text-sm md:text-base font-bold text-gray-800 mb-1.5">{item.name}</div>
                <div className="text-lg md:text-xl font-extrabold text-green-600">{money(item.bundlePrice)}</div>
              </button>
            )
          }
          const price = mode === 'wholesale' && item.wholesalePrice > 0 ? item.wholesalePrice : item.price
          const qty = item.quantity
          return (
            <button key={item.id} onClick={() => handleAdd(item)} disabled={qty === 0}
              className={`bg-white rounded-2xl p-4 md:p-5 text-left border border-gray-100 hover:border-brand-300 hover:shadow-xl hover:shadow-brand-500/10 active:scale-[.97] transition-all group ${qty === 0 ? 'opacity-40 pointer-events-none grayscale' : ''}`}>
              {/* Product Image */}
              <div className="w-full aspect-square bg-gradient-to-br from-gray-50 to-gray-100 rounded-xl mb-4 flex items-center justify-center overflow-hidden group-hover:scale-105 transition">
                {item.image ? (
                  <img src={item.image} alt="" className="w-full h-full object-cover rounded-xl" />
                ) : (
                  <span className="text-5xl opacity-40">📦</span>
                )}
              </div>
              {/* Product Info */}
              <div className="text-sm md:text-base font-bold text-gray-800 mb-0.5 truncate">{item.name}</div>
              {item.category && <div className="text-xs md:text-sm text-gray-400 mb-2">{item.category}</div>}
              <div className="flex items-end justify-between">
                <div className="text-lg md:text-xl font-extrabold text-green-600">{money(price)}</div>
                <span className={`px-2.5 py-1 rounded-lg text-xs font-bold ${qty === 0 ? 'bg-red-50 text-red-500' : qty <= 5 ? 'bg-amber-50 text-amber-600' : 'bg-green-50 text-green-600'}`}>
                  {qty === 0 ? 'Out' : qty}
                </span>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
