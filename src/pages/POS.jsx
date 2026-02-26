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
      <h1 className="text-3xl font-extrabold mb-6">Point of Sale</h1>

      {/* Search */}
      <div className="relative mb-6">
        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-xl">🔍</span>
        <input className="w-full h-14 pl-12 pr-4 bg-white border-2 border-gray-200 rounded-2xl text-base font-medium focus:outline-none focus:border-brand-500" placeholder="Search products..." value={query} onChange={e => setQuery(e.target.value)} />
      </div>

      {/* Categories */}
      {mode !== 'bundle' && (
        <div className="flex gap-2.5 overflow-x-auto mb-5 pb-1">
          {categories.map(c => (
            <button key={c} onClick={() => setCat(c)}
              className={`h-10 px-4.5 rounded-full text-[13px] font-semibold whitespace-nowrap border-2 transition ${selectedCat === c ? 'bg-brand-500 text-white border-transparent' : 'bg-white border-gray-200 text-gray-500'}`}>
              {c === 'all' ? 'All' : c}
            </button>
          ))}
        </div>
      )}

      {/* Modes */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        {[
          { id: 'retail', icon: '🛍️', label: 'Retail', cls: '' },
          { id: 'wholesale', icon: '🏭', label: 'Wholesale', cls: 'wh' },
          { id: 'bundle', icon: '🎁', label: 'Bundle', cls: 'bu' },
        ].map(m => (
          <button key={m.id} onClick={() => setMode(m.id)}
            className={`h-20 bg-white border-[3px] rounded-2xl flex flex-col items-center justify-center gap-1.5 text-[13px] font-bold transition ${mode === m.id ? (m.id === 'wholesale' ? 'border-amber-500 text-amber-500' : m.id === 'bundle' ? 'border-gray-500 text-gray-500' : 'border-brand-500 text-brand-500') : 'border-gray-200 text-gray-400'}`}>
            <span className="text-3xl">{m.icon}</span>{m.label}
          </button>
        ))}
      </div>

      {/* Product Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3.5">
        {filtered.length === 0 && <div className="col-span-full text-center py-12 text-gray-400"><span className="text-5xl block mb-3 opacity-30">📦</span>No products</div>}
        {filtered.map(item => {
          if (mode === 'bundle') {
            return (
              <button key={item.id} onClick={() => handleAdd(item)} className="bg-white rounded-2xl p-3.5 text-left shadow-md shadow-brand-500/5 border-2 border-transparent hover:border-brand-500 active:scale-[.97] transition">
                <div className="w-full h-24 bg-gray-100 rounded-xl mb-3 flex items-center justify-center text-4xl">🎁</div>
                <div className="text-sm font-semibold mb-2">{item.name}</div>
                <div className="text-xl font-extrabold text-brand-500">{money(item.bundlePrice)}</div>
                <span className="inline-block mt-2 px-2.5 py-1 rounded-full text-[11px] font-bold bg-green-50 text-green-500">Bundle</span>
              </button>
            )
          }
          const price = mode === 'wholesale' && item.wholesalePrice > 0 ? item.wholesalePrice : item.price
          const qty = item.quantity
          const stockCls = qty === 0 ? 'bg-red-50 text-red-500' : qty <= 5 ? 'bg-amber-50 text-amber-500' : 'bg-green-50 text-green-500'
          return (
            <button key={item.id} onClick={() => handleAdd(item)} disabled={qty === 0}
              className={`bg-white rounded-2xl p-3.5 text-left shadow-md shadow-brand-500/5 border-2 border-transparent hover:border-brand-500 active:scale-[.97] transition ${qty === 0 ? 'opacity-40 pointer-events-none' : ''}`}>
              <div className="w-full h-24 bg-gray-100 rounded-xl mb-3 flex items-center justify-center text-4xl overflow-hidden">
                {item.image ? <img src={item.image} alt="" className="w-full h-full object-cover" /> : '📦'}
              </div>
              <div className="text-sm font-semibold mb-2">{item.name}</div>
              <div className="text-xl font-extrabold text-brand-500">{money(price)}</div>
              <span className={`inline-block mt-2 px-2.5 py-1 rounded-full text-[11px] font-bold ${stockCls}`}>{qty}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
