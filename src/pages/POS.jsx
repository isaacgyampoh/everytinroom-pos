import { useState, useMemo, memo } from 'react'
import { useStore } from '../hooks/useStore'
import { money, num, today, thumb } from '../lib/utils'
import toast from 'react-hot-toast'

const ProductCard = memo(({ item, price, hasPromo, onAdd }) => {
  const qty = item.quantity
  return (
    <button onClick={onAdd} disabled={qty === 0}
      className={`bg-white rounded-3xl overflow-hidden text-left transition-transform active:scale-[.97] ${hasPromo ? 'ring-2 ring-brand-300' : ''} ${qty === 0 ? 'opacity-30 pointer-events-none' : ''}`}>
      {hasPromo && <div className="bg-brand-600 text-white text-[10px] font-bold text-center py-1 tracking-wider uppercase">Promo</div>}
      <div className="w-full aspect-[4/3] bg-sage-50 flex items-center justify-center overflow-hidden relative">
        <div className="absolute -right-3 -top-3 w-16 h-16 rounded-full border-[2px] border-brand-400/10" />
        <div className="absolute -right-1 -top-1 w-9 h-9 rounded-full border-[2px] border-brand-400/10" />
        <div className="absolute -left-4 -bottom-4 w-14 h-14 rounded-full bg-brand-400/5" />
        {item.image ? <img src={thumb(item.image)} alt="" className="w-full h-full object-cover relative z-10" loading="lazy" decoding="async" /> : <span className="text-3xl opacity-10 relative z-10">📦</span>}
      </div>
      <div className="p-3 md:p-3.5 relative overflow-hidden">
        <div className="absolute -right-2 -bottom-2 w-10 h-10 rounded-full bg-brand-400/[0.04]" />
        <div className="text-[13px] md:text-sm font-semibold text-gray-900 leading-snug truncate">{item.name}</div>
        <div className="flex items-end justify-between mt-2">
          <div>
            {hasPromo && <div className="text-[11px] text-stone-400 line-through">{money(item.price)}</div>}
            <div className={`text-lg font-extrabold leading-none ${hasPromo ? 'text-brand-600' : 'text-gray-900'}`}>{money(price)}</div>
          </div>
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${qty === 0 ? 'bg-red-100 text-red-600' : qty <= 5 ? 'bg-amber-100 text-amber-700' : 'bg-brand-50 text-brand-700'}`}>
            {qty === 0 ? 'OUT' : qty}
          </span>
        </div>
      </div>
    </button>
  )
})

export default function POS() {
  const { products, bundles, promos, mode, setMode, selectedCat, setCat, addToCart } = useStore()
  const [query, setQuery] = useState('')

  const categories = useMemo(() => ['all', ...new Set(products.filter(p => p.category).map(p => p.category))], [products])

  const promoPriceMap = useMemo(() => {
    const map = {}; const t = today()
    for (const p of promos) {
      if (!p.active || p.startDate > t || p.endDate < t) continue
      for (const it of p.items) { const pr = num(it.promoPrice); if (pr > 0 && (!map[it.productId] || pr < map[it.productId])) map[it.productId] = pr }
    }
    return map
  }, [promos])

  const getPrice = (p) => promoPriceMap[p.id] || (mode === 'wholesale' && p.wholesalePrice > 0 ? p.wholesalePrice : p.price)

  const filtered = useMemo(() => {
    const q = query.toLowerCase()
    if (mode === 'bundle') return bundles.filter(b => b.active && (!q || b.name.toLowerCase().includes(q)))
    return products.filter(p => (!q || p.name.toLowerCase().includes(q)) && (selectedCat === 'all' || p.category === selectedCat))
  }, [products, bundles, mode, query, selectedCat])

  const doAdd = (item) => {
    if (mode === 'bundle') {
      let cost = 0; for (const bi of item.products) { const p = products.find(x => x.id === bi.productId); if (p) cost += p.costPrice * num(bi.qty) }
      if (addToCart({ bundleId: item.id, name: item.name, price: item.bundlePrice, costPrice: cost, isBundle: true, bundleItems: item.products })) toast.success('Added!')
    } else {
      if (item.quantity === 0) return
      const price = getPrice(item)
      if (addToCart({ productId: item.id, name: item.name, price, costPrice: item.costPrice, image: item.image, originalPrice: item.price, isPromo: !!promoPriceMap[item.id] })) toast.success('Added!')
      else toast.error('Out of stock')
    }
  }

  const searchAdd = (p) => { if (!p || p.quantity === 0) return false; const pr = getPrice(p); if (addToCart({ productId: p.id, name: p.name, price: pr, costPrice: p.costPrice, image: p.image, originalPrice: p.price, isPromo: !!promoPriceMap[p.id] })) { toast.success(p.name); return true } return false }

  const promoCount = Object.keys(promoPriceMap).length

  return (
    <div className="animate-fade">
      <h1 className="text-3xl md:text-[40px] font-extrabold tracking-tight leading-none">Point of Sale</h1>

      {promoCount > 0 && (
        <div className="bg-brand-600 rounded-2xl px-5 py-3 mt-4 flex items-center gap-3 text-white relative overflow-hidden">
          <div className="absolute -right-4 -top-4 w-20 h-20 rounded-full border-[2px] border-white/10" />
          <div className="absolute -right-1 -top-1 w-10 h-10 rounded-full border-[2px] border-white/10" />
          <span className="text-xl relative z-10">🏷️</span>
          <span className="text-sm font-bold relative z-10">{promoCount} product{promoCount > 1 ? 's' : ''} on promo!</span>
        </div>
      )}

      {/* Search */}
      <div className="relative mt-5 mb-4">
        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-stone-400 text-lg">⌕</span>
        <input className="w-full h-12 md:h-13 pl-12 pr-4 bg-white rounded-2xl text-sm font-medium placeholder:text-stone-300 focus:outline-none focus:ring-2 focus:ring-brand-400/30" placeholder="Search or scan barcode..." value={query}
          onChange={e => { setQuery(e.target.value); const v = e.target.value.trim(); if (v.length > 3) { const ex = products.find(p => p.name.toLowerCase() === v.toLowerCase()); if (ex && searchAdd(ex)) setQuery('') } }}
          onKeyDown={e => { if (e.key === 'Enter' && query.trim() && filtered[0] && mode !== 'bundle') { if (searchAdd(filtered[0])) setQuery('') } }}
        />
      </div>

      {/* Modes */}
      <div className="flex gap-2 mb-3">
        {[{ id: 'retail', l: 'Retail' }, { id: 'wholesale', l: 'Wholesale' }, { id: 'bundle', l: 'Bundles' }].map(m => (
          <button key={m.id} onClick={() => setMode(m.id)}
            className={`h-9 px-4 rounded-full text-xs font-bold transition ${mode === m.id ? 'bg-brand-700 text-white' : 'bg-white text-stone-500 hover:text-stone-700'}`}>
            {m.l}
          </button>
        ))}
      </div>

      {mode !== 'bundle' && (
        <div className="flex gap-1.5 overflow-x-auto mb-5 scrollbar-hide">
          {categories.map(c => (
            <button key={c} onClick={() => setCat(c)}
              className={`h-8 px-3.5 rounded-full text-xs font-semibold whitespace-nowrap transition ${selectedCat === c ? 'bg-brand-500 text-white' : 'bg-white text-stone-400 hover:text-stone-600'}`}>
              {c === 'all' ? 'All' : c}
            </button>
          ))}
        </div>
      )}

      {/* Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
        {filtered.length === 0 && <div className="col-span-full py-20 text-center text-stone-300 text-sm">No products found</div>}
        {filtered.map(item => {
          if (mode === 'bundle') return (
            <button key={item.id} onClick={() => doAdd(item)} className="bg-white rounded-3xl p-4 text-left active:scale-[.97] transition-transform">
              <div className="w-full aspect-[4/3] bg-sage-50 rounded-2xl mb-3 flex items-center justify-center text-3xl opacity-20">🎁</div>
              <div className="text-sm font-semibold">{item.name}</div>
              <div className="text-lg font-extrabold mt-1">{money(item.bundlePrice)}</div>
            </button>
          )
          return <ProductCard key={item.id} item={item} price={getPrice(item)} hasPromo={!!promoPriceMap[item.id]} onAdd={() => doAdd(item)} />
        })}
      </div>
    </div>
  )
}
