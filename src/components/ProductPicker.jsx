import { useMemo, useState } from 'react'
import { money } from '../lib/utils'
import { IconSearch } from './Icons'

// ============================================================================
// PICKING PRODUCTS OUT OF A CATALOGUE OF 665
//
// This was a native <select> listing every product. With a catalogue where
// hundreds of items are called "1 bedsheet 2 pillow cases double design 11",
// that is not a control — it is a wall. No search, no way to see what you had
// already chosen, and on a long list the dropdown spills off the modal and
// covers the page behind it.
//
// Sorting matters as much as searching here. Alphabetically, "design10" comes
// before "design2", so the obvious order scatters a run of designs across the
// list. Compared numerically, design2 sits where a person expects it.
// ============================================================================

// Show a bounded number of rows. The point of a cap is not rendering cost — it
// is that a thousand rows is not a list anybody reads, and a prompt to narrow
// the search is more use than more scrolling.
const SHOW = 60

const byName = (a, b) =>
  String(a.name || '').localeCompare(String(b.name || ''), undefined, { numeric: true, sensitivity: 'base' })

export default function ProductPicker({ products, selectedIds, onToggle, onAddMany, label = 'Add products' }) {
  const [q, setQ] = useState('')
  const [cat, setCat] = useState('all')

  const categories = useMemo(
    () => ['all', ...[...new Set(products.map(p => p.category).filter(Boolean))].sort()],
    [products])

  const matches = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return products
      .filter(p => cat === 'all' || p.category === cat)
      .filter(p => !needle
        || String(p.name || '').toLowerCase().includes(needle)
        || String(p.barcode || '').includes(needle))
      .sort(byName)
  }, [products, q, cat])

  const shown = matches.slice(0, SHOW)
  const hidden = matches.length - shown.length
  const unchosen = matches.filter(p => !selectedIds.has(p.id))

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <label className="text-xs font-semibold text-gray-500">{label}</label>
        <span className="text-[11px] text-gray-400">{selectedIds.size} chosen</span>
      </div>

      <div className="flex gap-2 mb-2">
        <div className="relative flex-1">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-300 pointer-events-none"><IconSearch size={15} /></span>
          <input
            value={q} onChange={e => setQ(e.target.value)}
            placeholder="Search by name or barcode"
            className="w-full h-11 pl-9 pr-3 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-gray-900" />
        </div>
        {categories.length > 1 && (
          <select value={cat} onChange={e => setCat(e.target.value)}
            className="h-11 px-3 bg-gray-50 border border-gray-200 rounded-xl text-sm max-w-[9rem]">
            {categories.map(c => <option key={c} value={c}>{c === 'all' ? 'All categories' : c}</option>)}
          </select>
        )}
      </div>

      {/* Adding a whole run at once is the entire point of a search here:
          "design" matches sixteen bedsheets, and choosing them one at a time is
          sixteen clicks for one promotion. */}
      {unchosen.length > 1 && (
        <button type="button" onClick={() => onAddMany(unchosen)}
          className="w-full h-9 mb-2 rounded-lg border-2 border-dashed border-gray-300 text-[12px] font-bold text-gray-600 hover:border-gray-400 hover:bg-gray-50 transition">
          Add all {unchosen.length} {q.trim() || cat !== 'all' ? 'matching' : 'products'}
        </button>
      )}

      <div className="border border-gray-200 rounded-xl max-h-[220px] overflow-y-auto divide-y divide-gray-100">
        {matches.length === 0 && (
          <div className="py-8 text-center text-sm text-gray-400">Nothing matches “{q}”</div>
        )}
        {shown.map(p => {
          const on = selectedIds.has(p.id)
          const out = Number(p.quantity) <= 0
          return (
            <button key={p.id} type="button" onClick={() => onToggle(p)}
              className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-left transition ${on ? 'bg-gray-900/[.04]' : 'hover:bg-gray-50'}`}>
              <span className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 ${on ? 'bg-gray-900 border-gray-900' : 'border-gray-300'}`}>
                {on && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>}
              </span>
              <span className="flex-1 min-w-0">
                <span className="block text-[13px] font-medium text-gray-900 truncate">{p.name}</span>
                {out && <span className="block text-[11px] text-[#b3402b] font-semibold">Out of stock</span>}
              </span>
              <span className="text-[12px] font-semibold text-gray-500 tnum shrink-0">{money(p.price)}</span>
            </button>
          )
        })}
        {hidden > 0 && (
          <div className="py-2.5 text-center text-[11px] text-gray-400">
            {hidden} more — keep typing to narrow it down
          </div>
        )}
      </div>
    </div>
  )
}
