import { useState, useMemo, memo } from 'react'
import { useStore } from '../hooks/useStore'
import { money, num, today, thumb } from '../lib/utils'
import toast from 'react-hot-toast'

const ProductCard = memo(({ item, price, hasPromo, onAdd }) => {
  const qty = item.quantity
  return (
    <button onClick={onAdd} disabled={qty === 0}
      className={`bg-white rounded-2xl overflow-hidden text-left transition-transform active:scale-[.97] ${hasPromo ? 'ring-2 ring-gray-400' : ''} ${qty === 0 ? 'opacity-30 pointer-events-none' : ''}`}>
      {hasPromo && <div className="bg-gray-900 text-white text-[10px] font-bold text-center py-1 tracking-wider uppercase">Promo</div>}
      <div className="w-full aspect-[4/3] bg-stone-100 overflow-hidden">
        {item.image ? <img src={thumb(item.image, 300)} alt="" className="w-full h-full object-cover" loading="lazy" decoding="async" fetchPriority="low" /> : <div className="w-full h-full flex items-center justify-center text-stone-300"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg></div>}
      </div>
      <div className="p-2.5">
        <div className="text-[12px] md:text-[13px] font-semibold text-gray-900 leading-snug break-words">{item.name}</div>
        <div className="flex items-end justify-between mt-1.5">
          <div>
            {hasPromo && <div className="text-[10px] text-stone-400 line-through">{money(item.price)}</div>}
            <div className={`text-base font-bold leading-none ${hasPromo ? 'text-gray-900' : 'text-gray-900'}`}>{money(price)}</div>
          </div>
          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${qty === 0 ? 'bg-gray-900 text-white' : qty <= 5 ? 'bg-gray-200 text-gray-700' : 'bg-gray-100 text-gray-500'}`}>
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
      if (addToCart({ bundleId: item.id, name: item.name, price: item.bundlePrice, costPrice: cost, isBundle: true, bundleItems: item.products })) toast.success('Added')
    } else {
      if (item.quantity === 0) return
      const price = getPrice(item)
      if (addToCart({ productId: item.id, name: item.name, price, costPrice: item.costPrice, image: item.image, originalPrice: item.price, isPromo: !!promoPriceMap[item.id] })) toast.success('Added')
      else toast.error('Out of stock')
    }
  }

  const searchAdd = (p) => { if (!p || p.quantity === 0) return false; const pr = getPrice(p); if (addToCart({ productId: p.id, name: p.name, price: pr, costPrice: p.costPrice, image: p.image, originalPrice: p.price, isPromo: !!promoPriceMap[p.id] })) { toast.success(p.name); return true } return false }

  const promoCount = Object.keys(promoPriceMap).length

  return (
    <div >
      <h1 className="text-[19px] md:text-[22px] font-bold tracking-tight">Point of Sale</h1>

      {promoCount > 0 && (
        <div className="bg-gray-900 rounded-xl px-4 py-2.5 mt-3 flex items-center gap-3 text-white ">
          
          <span className="text-sm font-semibold ">{promoCount} product{promoCount > 1 ? 's' : ''} on promo!</span>
        </div>
      )}

      {/* Search */}
      <div className="relative mt-3.5 mb-3">
        
        <input className="w-full h-11 md:h-12 pl-4 pr-4 bg-white rounded-xl text-sm font-medium placeholder:text-stone-300 focus:outline-none focus:ring-2 focus:ring-gray-400/30" placeholder="Search or scan barcode..." value={query}
          onChange={e => { setQuery(e.target.value); const v = e.target.value.trim(); if (v.length > 3) { const ex = products.find(p => p.name.toLowerCase() === v.toLowerCase()); if (ex && searchAdd(ex)) setQuery('') } }}
          onKeyDown={e => { if (e.key === 'Enter' && query.trim() && filtered[0] && mode !== 'bundle') { if (searchAdd(filtered[0])) setQuery('') } }}
        />
      </div>

      {/* Modes */}
      <div className="flex gap-2 mb-3">
        {[{ id: 'retail', l: 'Retail' }, { id: 'wholesale', l: 'Wholesale' }, { id: 'bundle', l: 'Bundles' }].map(m => (
          <button key={m.id} onClick={() => setMode(m.id)}
            className={`h-9 px-4 rounded-full text-xs font-bold transition ${mode === m.id ? 'bg-gray-900 text-white' : 'bg-white text-stone-500 hover:text-stone-700'}`}>
            {m.l}
          </button>
        ))}
      </div>

      {mode !== 'bundle' && (
        <div className="flex gap-1.5 overflow-x-auto mb-3.5 scrollbar-hide">
          {categories.map(c => (
            <button key={c} onClick={() => setCat(c)}
              className={`h-8 px-3.5 rounded-full text-xs font-semibold whitespace-nowrap transition ${selectedCat === c ? 'bg-gray-800 text-white' : 'bg-white text-stone-400 hover:text-stone-600'}`}>
              {c === 'all' ? 'All' : c}
            </button>
          ))}
        </div>
      )}

      {/* Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 gap-2 md:gap-2.5">
        {filtered.length === 0 && <div className="col-span-full py-20 text-center text-stone-300 text-sm">No products found</div>}
        {filtered.map((item, idx) => {
          if (mode === 'bundle') return (
            <button key={item.id} onClick={() => doAdd(item)} className="bg-white rounded-2xl p-4 text-left active:scale-[.97] transition-transform">
              <div className="text-sm font-semibold">{item.name}</div>
              <div className="text-lg font-bold mt-1">{money(item.bundlePrice)}</div>
            </button>
          )
          return <ProductCard key={item.id} item={item} price={getPrice(item)} hasPromo={!!promoPriceMap[item.id]} onAdd={() => doAdd(item)} />
        })}
      </div>
    </div>
  )
}
