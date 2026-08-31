import { useState, useMemo, memo, useCallback } from 'react'
import { useStore } from '../hooks/useStore'
import { getSupabase } from '../lib/supabase'
import { money, num, today, thumb } from '../lib/utils'
import { useBarcodeScanner } from '../hooks/useBarcodeScanner'
import { beep } from '../lib/hardware'
import toast from 'react-hot-toast'
import { IconTag, IconSearch, IconImage, EmptyState } from '../components/Icons'

// The card a cashier taps a few hundred times a day. Priorities, in order:
// read the name at arm's length, read the price, know instantly if it's out.
// The old version set both at 12-13px and gave "OUT" a solid black badge,
// which read as emphasis rather than as a warning.
const ProductCard = memo(({ item, price, hasPromo, onAdd }) => {
  const qty = item.quantity
  const out = qty === 0
  const low = qty > 0 && qty <= 5
  return (
    <button onClick={onAdd} disabled={out}
      className={`group relative text-left bg-white rounded-[14px] overflow-hidden border transition
        ${out ? 'opacity-45 pointer-events-none border-gray-200'
              : 'border-[rgba(16,24,29,.08)] hover:border-gray-400 active:scale-[.97] active:border-gray-900'}`}>

      <div className="product-shot w-full">
        {item.image
          ? <img src={thumb(item.image, 300)} alt="" loading="lazy" decoding="async" fetchPriority="low" />
          : <div className="w-full h-full flex items-center justify-center text-stone-300"><IconImage size={26} /></div>}

        {hasPromo && (
          <span className="absolute top-1.5 left-1.5 bg-[#16181d] text-white text-[9px] font-bold tracking-[.09em] uppercase px-1.5 py-[3px] rounded">Promo</span>
        )}
        {out && (
          <span className="absolute inset-x-0 bottom-0 bg-[#16181d]/85 text-white text-[10px] font-bold tracking-wide text-center py-1">OUT OF STOCK</span>
        )}
        {low && (
          <span className="absolute top-1.5 right-1.5 bg-white/95 text-[#b3402b] text-[10px] font-bold px-1.5 py-[3px] rounded tnum">{qty} left</span>
        )}
      </div>

      <div className="px-2.5 pt-2 pb-2.5">
        <div className="text-[13px] md:text-[13.5px] font-semibold text-gray-900 leading-[1.25] line-clamp-2 min-h-[33px]">{item.name}</div>
        <div className="flex items-baseline gap-1.5 mt-1.5">
          <span className="figure text-[16px] text-gray-900">{money(price)}</span>
          {hasPromo && <span className="text-[11px] text-stone-300 line-through tnum">{money(item.price)}</span>}
        </div>
      </div>
    </button>
  )
})

export default function POS() {
  const { products, bundles, promos, mode, setMode, selectedCat, setCat, addToCart, refreshProducts } = useStore()
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
    return products.filter(p => (!q || p.name.toLowerCase().includes(q) || (p.barcode && p.barcode.includes(q))) && (selectedCat === 'all' || p.category === selectedCat))
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

  // A scanned barcode adds straight to the cart, from any screen position and
  // without the cashier having to click into the search box first.
  const onScan = useCallback(async (code) => {
    const hit = products.find(p => p.barcode && p.barcode === code)
    if (hit) {
      if (hit.quantity === 0) { beep(false); toast.error(`${hit.name} — out of stock`); return }
      if (searchAdd(hit)) { beep(true); setQuery('') }
      else { beep(false); toast.error('Not enough stock') }
      return
    }
    // Not in the loaded list — ask the server directly rather than telling the
    // cashier the product doesn't exist. Matters on a till that just started,
    // or when another terminal added the product a minute ago.
    try {
      const { data, error } = await getSupabase().rpc('find_by_barcode', { p_code: code })
      if (error) console.warn('find_by_barcode unavailable — run migration 020:', error.message)
      if (data?.found && data.product) {
        const raw = data.product
        const prod = { id: raw.id, name: raw.name, price: num(raw.price), costPrice: 0, image: raw.image || '', quantity: num(raw.quantity), wholesalePrice: num(raw.wholesale_price) }
        if (prod.quantity === 0) { beep(false); toast.error(`${prod.name} — out of stock`); return }
        if (searchAdd(prod)) { beep(true); setQuery(''); refreshProducts() }
        return
      }
    } catch {}
    beep(false)
    toast.error('Unknown barcode: ' + code)
  }, [products, mode, promoPriceMap]) // eslint-disable-line

  useBarcodeScanner(onScan)

  const promoCount = Object.keys(promoPriceMap).length

  return (
    <div>
      {/* One toolbar instead of a title, a banner, a search row and two pill
          rows stacked on top of each other. On a 1024x768 till those ate a
          third of the screen before a single product appeared — and the page
          title told the cashier something they already knew. */}
      <div className="flex flex-col lg:flex-row lg:items-center gap-2.5 mb-3">
        <div className="relative flex-1 min-w-0">
          <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-stone-300 pointer-events-none"><IconSearch size={18} /></span>
          <input
            className="w-full h-12 pl-11 pr-4 panel text-[15px] font-medium placeholder:text-stone-300 focus:outline-none focus:border-gray-900 transition"
            placeholder="Search or scan a barcode" value={query}
            onChange={e => { setQuery(e.target.value); const v = e.target.value.trim(); if (v.length > 3) { const ex = products.find(p => p.name.toLowerCase() === v.toLowerCase()); if (ex && searchAdd(ex)) setQuery('') } }}
            onKeyDown={e => { if (e.key === 'Enter' && query.trim() && filtered[0] && mode !== 'bundle') { if (searchAdd(filtered[0])) setQuery('') } }}
          />
          {query && (
            <button onClick={() => setQuery('')} aria-label="Clear search"
              className="absolute right-3 top-1/2 -translate-y-1/2 w-7 h-7 rounded-lg text-stone-400 hover:bg-stone-100 flex items-center justify-center text-sm">✕</button>
          )}
        </div>

        {/* Segmented control. Modes change what you are selling, so they read
            as one switch — not as three loose pills identical to the category
            chips underneath, which is what they looked like before. */}
        <div className="flex p-1 bg-stone-200/70 rounded-[12px] shrink-0 w-full lg:w-auto">
          {[{ id: 'retail', l: 'Retail' }, { id: 'wholesale', l: 'Wholesale' }, { id: 'bundle', l: 'Bundles' }].map(m => (
            <button key={m.id} onClick={() => setMode(m.id)}
              className={`flex-1 lg:flex-none h-10 lg:h-9 px-4 rounded-[9px] text-[13px] font-semibold transition ${mode === m.id ? 'bg-white text-gray-900 shadow-sm' : 'text-stone-500 hover:text-stone-700'}`}>
              {m.l}
            </button>
          ))}
        </div>
      </div>

      {mode !== 'bundle' && (
        <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-hide mb-3.5 -mx-1 px-1">
          {categories.map(c => (
            <button key={c} onClick={() => setCat(c)}
              className={`h-8 px-3.5 rounded-full text-[12px] font-semibold whitespace-nowrap border transition ${selectedCat === c ? 'bg-[#16181d] text-white border-[#16181d]' : 'bg-transparent text-stone-500 border-stone-300 hover:border-stone-400 hover:text-stone-700'}`}>
              {c === 'all' ? 'All' : c}
            </button>
          ))}
          {promoCount > 0 && (
            <span className="ml-auto shrink-0 flex items-center gap-1.5 text-[12px] font-semibold text-gray-500 pl-3">
              <IconTag size={13} /> {promoCount} on promo
            </span>
          )}
        </div>
      )}

      {/* Grid */}
      <div className="grid grid-cols-2 min-[420px]:grid-cols-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 gap-2 sm:gap-2.5">
        {filtered.length === 0 && <div className="col-span-full"><EmptyState icon={IconSearch} title={query ? `Nothing matches "${query}"` : 'No products yet'} hint={query ? 'Check the spelling, or scan the barcode' : 'Add products from the Products page'} /></div>}
        {filtered.map((item, idx) => {
          if (mode === 'bundle') return (
            // Bundles have no photo, so the card is typographic. It still needs
            // the same footprint as a product card or the grid breaks rhythm.
            <button key={item.id} onClick={() => doAdd(item)}
              className="bg-white rounded-[14px] border border-[rgba(16,24,29,.08)] p-4 text-left flex flex-col justify-between min-h-[140px] hover:border-gray-400 active:scale-[.97] active:border-gray-900 transition">
              <div>
                <span className="text-[9px] font-bold tracking-[.09em] uppercase text-stone-400">Bundle</span>
                <div className="text-[13.5px] font-semibold text-gray-900 leading-[1.25] mt-1.5 line-clamp-3">{item.name}</div>
              </div>
              <div className="figure text-[17px] text-gray-900 mt-3">{money(item.bundlePrice)}</div>
            </button>
          )
          return <ProductCard key={item.id} item={item} price={getPrice(item)} hasPromo={!!promoPriceMap[item.id]} onAdd={() => doAdd(item)} />
        })}
      </div>
    </div>
  )
}
