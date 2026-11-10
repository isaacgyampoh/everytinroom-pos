import { useMemo, useRef, useState } from 'react'
import { useStore } from '../hooks/useStore'
import { getSupabase } from '../lib/supabase'
import { money, num, pct } from '../lib/utils'
import { IconSearch, EmptyState } from '../components/Icons'
import toast from 'react-hot-toast'

// ============================================================================
// COST PRICES, IN BULK
//
// Every profit figure in this system is wrong, and the dashboard says so:
// only a sixth of the last 90 days' takings has a cost price behind it. The
// rest counts its whole selling price as profit, so margins, staff
// performance and the reports all read far higher than the truth.
//
// The cure was never complicated — somebody has to type in what the stock
// cost. The reason nobody has is that the only way to do it was the Products
// page: open a product, open its modal, past the photo upload and the barcode
// and the wholesale fields, type one number, save, close, repeat. For the 464
// products with no cost that is 464 round trips, and it will simply never
// happen.
//
// This is a list and a column of boxes. Type, press Enter, type the next one.
// Nothing is written until you save, and only what you actually changed is
// sent.
// ============================================================================

const marginOf = (price, cost) => (num(price) > 0 ? pct(num(price) - num(cost), num(price)) : 0)

export default function CostPricesPage() {
  const { products, refreshProducts, setLoading } = useStore()
  const [q, setQ] = useState('')
  const [only, setOnly] = useState('missing')   // missing | all
  const [draft, setDraft] = useState({})        // { [productId]: '12.50' }
  const [saving, setSaving] = useState(false)
  const inputs = useRef([])

  const withCost = products.filter(p => num(p.costPrice) > 0).length
  const missing = products.length - withCost

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return products
      .filter(p => (only === 'all' ? true : num(p.costPrice) <= 0))
      .filter(p => !needle
        || String(p.name || '').toLowerCase().includes(needle)
        || String(p.category || '').toLowerCase().includes(needle))
      // Most valuable stock first: getting the cost of something you hold 40 of
      // right matters more to the books than something you hold one of.
      .sort((a, b) => (num(b.price) * num(b.quantity)) - (num(a.price) * num(a.quantity)))
  }, [products, q, only])

  const changed = Object.entries(draft).filter(([id, v]) => {
    const p = products.find(x => x.id === id)
    return p && v !== '' && num(v) !== num(p.costPrice)
  })

  // Selling below cost is almost always a typo — a price typed into the cost
  // box, or a decimal point in the wrong place. Worth stopping at the door.
  const losses = changed.filter(([id, v]) => {
    const p = products.find(x => x.id === id)
    return p && num(v) >= num(p.price) && num(p.price) > 0
  })

  const onKey = (e, i) => {
    if (e.key !== 'Enter') return
    e.preventDefault()
    const next = inputs.current[i + 1]
    if (next) { next.focus(); next.select() } else e.target.blur()
  }

  const save = async () => {
    if (!changed.length) return
    if (losses.length && !confirm(
      `${losses.length} ${losses.length === 1 ? 'product costs' : 'products cost'} as much as or more than ` +
      `${losses.length === 1 ? 'it sells' : 'they sell'} for. Save anyway?`)) return

    setSaving(true); setLoading(true, 'Saving cost prices...')
    const sb = getSupabase()
    let ok = 0
    const failed = []
    // Sequentially in small batches: a few hundred parallel writes against a
    // shop's connection is how you get half of them lost with no record of
    // which half.
    for (let i = 0; i < changed.length; i += 10) {
      const slice = changed.slice(i, i + 10)
      const results = await Promise.all(slice.map(([id, v]) =>
        sb.from('products').update({ cost_price: num(v) }).eq('id', id)
          .then(r => ({ id, error: r.error }))))
      for (const r of results) { if (r.error) failed.push(r.id); else ok++ }
    }

    await refreshProducts()
    setLoading(false); setSaving(false)
    // Keep anything that failed in the boxes so the work is not lost.
    setDraft(d => Object.fromEntries(Object.entries(d).filter(([id]) => failed.includes(id))))

    if (failed.length) toast.error(`Saved ${ok}. ${failed.length} could not be saved — still on screen.`)
    else toast.success(`${ok} cost ${ok === 1 ? 'price' : 'prices'} saved`)
  }

  const coverage = products.length ? Math.round((withCost / products.length) * 100) : 0

  return (
    <div className="max-w-4xl mx-auto pb-28">
      <div className="mb-5">
        <h1 className="text-[22px] md:text-[26px] font-bold tracking-tight">Cost prices</h1>
        <p className="text-gray-400 text-sm mt-0.5">
          What the stock cost you. Without it, profit is only a guess.
        </p>
      </div>

      {/* Coverage, because the point of this screen is to move one number. */}
      <div className="panel panel-pad mb-4">
        <div className="flex items-end justify-between gap-4 mb-2">
          <div>
            <div className="panel-head">Products with a cost price</div>
            <div className="figure text-[26px] text-gray-900 mt-1">{withCost} <span className="text-stone-300 text-[18px]">/ {products.length}</span></div>
          </div>
          <div className={`text-[13px] font-bold ${coverage >= 90 ? 'text-emerald-600' : coverage >= 50 ? 'text-amber-600' : 'text-[#b3402b]'}`}>{coverage}%</div>
        </div>
        <div className="h-1.5 bg-stone-200 rounded-full overflow-hidden">
          <div className={`h-full rounded-full ${coverage >= 90 ? 'bg-emerald-500' : coverage >= 50 ? 'bg-amber-500' : 'bg-[#b3402b]'}`}
            style={{ width: `${coverage}%` }} />
        </div>
        {missing > 0 && (
          <p className="text-[12px] text-gray-400 mt-2">
            {missing} still to do. Every one of them counts its whole selling price as profit until it is filled in.
          </p>
        )}
      </div>

      <div className="flex gap-2 mb-3">
        <div className="relative flex-1">
          <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-stone-300 pointer-events-none"><IconSearch size={16} /></span>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search products"
            className="w-full h-11 pl-10 pr-3 panel text-sm focus:outline-none focus:border-gray-900" />
        </div>
        <div className="flex p-1 bg-stone-200/70 rounded-[12px] shrink-0">
          {[['missing', 'Missing'], ['all', 'All']].map(([v, l]) => (
            <button key={v} onClick={() => setOnly(v)}
              className={`h-9 px-3.5 rounded-[9px] text-[13px] font-semibold transition ${only === v ? 'bg-white text-gray-900 shadow-sm' : 'text-stone-500'}`}>
              {l}
            </button>
          ))}
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyState icon={IconSearch}
          title={only === 'missing' ? 'Every product has a cost price' : `Nothing matches “${q}”`}
          hint={only === 'missing' ? 'Profit figures across the system are now based on real numbers.' : 'Try a different search.'} />
      ) : (
        <div className="panel overflow-hidden">
          {rows.map((p, i) => {
            const val = draft[p.id] ?? (num(p.costPrice) > 0 ? String(p.costPrice) : '')
            const mg = val !== '' ? marginOf(p.price, val) : null
            const loss = val !== '' && num(val) >= num(p.price) && num(p.price) > 0
            return (
              <div key={p.id} className="flex items-center gap-3 px-4 py-2.5 border-b border-stone-100 last:border-0">
                <div className="flex-1 min-w-0">
                  <div className="text-[13.5px] font-semibold text-gray-900 truncate">{p.name}</div>
                  <div className="text-[11px] text-gray-400">
                    Sells at {money(p.price)} · {p.quantity} in stock
                  </div>
                </div>
                <input
                  ref={el => { inputs.current[i] = el }}
                  type="number" inputMode="decimal" min="0" step="0.01"
                  value={val}
                  onChange={e => setDraft(d => ({ ...d, [p.id]: e.target.value }))}
                  onKeyDown={e => onKey(e, i)}
                  placeholder="Cost"
                  className={`w-24 h-10 px-2.5 text-right tnum text-sm font-semibold rounded-xl border-2 transition focus:outline-none ${
                    loss ? 'border-[#b3402b] text-[#b3402b]' : 'border-stone-200 focus:border-gray-900'}`} />
                <div className={`w-14 text-right text-[12px] font-bold tnum ${
                  mg === null ? 'text-stone-300' : loss ? 'text-[#b3402b]' : mg >= 30 ? 'text-emerald-600' : mg >= 15 ? 'text-amber-600' : 'text-[#b3402b]'}`}>
                  {mg === null ? '—' : `${mg.toFixed(0)}%`}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Sticky, because the list is long and the save button should never be
          somewhere you have to go and find. */}
      {changed.length > 0 && (
        <div className="fixed bottom-0 inset-x-0 md:left-[var(--sidebar-w,68px)] z-[120] bg-white/95 backdrop-blur border-t border-stone-200 px-4 py-3 flex items-center gap-3 justify-end">
          {losses.length > 0 && (
            <span className="text-[12px] font-semibold text-[#b3402b] mr-auto">
              {losses.length} priced at or below cost
            </span>
          )}
          <button onClick={() => setDraft({})} disabled={saving}
            className="h-11 px-4 rounded-xl border-2 border-stone-200 text-sm font-bold text-stone-500 disabled:opacity-40">
            Discard
          </button>
          <button onClick={save} disabled={saving}
            className="h-11 px-5 rounded-xl bg-gray-900 text-white text-sm font-bold disabled:opacity-40">
            {saving ? 'Saving…' : `Save ${changed.length} ${changed.length === 1 ? 'cost' : 'costs'}`}
          </button>
        </div>
      )}
    </div>
  )
}
