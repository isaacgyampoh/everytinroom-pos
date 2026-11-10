import { useState, useEffect, useMemo } from 'react'
import { useStore } from '../hooks/useStore'
import { getSupabase } from '../lib/supabase'
import { money, moneyShort, num } from '../lib/utils'
import { EmptyState, IconBox, IconChart, IconClipboard } from '../components/Icons'
import { rpcMessage } from '../lib/rpcError'
import toast from 'react-hot-toast'

// Two questions a shop with 665 products cannot answer by scrolling a list:
// what should I buy, and what is my cash stuck in. Both come from one
// server-side pass over 90 days of sales — the till only holds the last 150,
// so this could never have been computed in the browser.
export default function StockInsights() {
  const { token, refreshProducts } = useStore()
  const [rows, setRows] = useState(null)
  const [tab, setTab] = useState('reorder')
  const [days, setDays] = useState(90)
  const [edits, setEdits] = useState({})
  const [saving, setSaving] = useState(false)
  const [q, setQ] = useState('')

  const load = async (d = days) => {
    setRows(null)
    const { data, error } = await getSupabase().rpc('stock_insights', { p_days: d })
    if (error) { toast.error(rpcMessage(error, null, 'Could not load stock figures')); setRows([]); return }
    setRows(data || [])
  }
  useEffect(() => { load(days) }, [days]) // eslint-disable-line

  const n = (v) => Number(v || 0)

  const reorder = useMemo(() => (rows || [])
    .filter(r => n(r.sold) > 0 && n(r.quantity) <= 5)
    .sort((a, b) => (n(a.quantity) - n(b.quantity)) || (n(b.revenue) - n(a.revenue)))
  , [rows])

  const dead = useMemo(() => (rows || [])
    .filter(r => n(r.sold) === 0 && n(r.quantity) > 0)
    .sort((a, b) => n(b.tied_up) - n(a.tied_up))
  , [rows])

  const gaps = useMemo(() => (rows || [])
    .filter(r => n(r.cost_price) <= 0 || n(r.price) <= 0)
    .sort((a, b) => n(b.revenue) - n(a.revenue))
  , [rows])

  const totals = useMemo(() => ({
    lostRevenue: reorder.filter(r => n(r.quantity) === 0).reduce((a, r) => a + n(r.revenue), 0),
    emptyCount: reorder.filter(r => n(r.quantity) === 0).length,
    deadValue: dead.reduce((a, r) => a + n(r.tied_up), 0),
    deadCount: dead.length,
    gapCount: gaps.length,
  }), [reorder, dead, gaps])

  // ---- bulk repair -------------------------------------------------------
  const setEdit = (id, field, v) => setEdits(e => ({ ...e, [id]: { ...(e[id] || {}), [field]: v } }))
  const dirty = Object.keys(edits).filter(id => {
    const e = edits[id]
    return e && (e.cost_price !== undefined || e.price !== undefined || e.barcode !== undefined)
  })

  const saveEdits = async () => {
    if (!dirty.length) return
    setSaving(true)
    const payload = dirty.map(id => {
      const e = edits[id], out = { id }
      if (e.cost_price !== undefined && e.cost_price !== '') out.cost_price = num(e.cost_price)
      if (e.price !== undefined && e.price !== '') out.price = num(e.price)
      if (e.barcode !== undefined && e.barcode.trim() !== '') out.barcode = e.barcode.trim()
      return out
    })
    const { data, error } = await getSupabase().rpc('bulk_update_products', { p_token: token, p_rows: payload })
    setSaving(false)
    if (error || !data?.success) { toast.error(rpcMessage(error, data, 'Could not save')); return }
    toast.success(`${data.updated} product${data.updated === 1 ? '' : 's'} updated`)
    setEdits({}); refreshProducts(); load(days)
  }

  const filtered = (list) => {
    const s = q.trim().toLowerCase()
    return s ? list.filter(r => (r.name || '').toLowerCase().includes(s)) : list
  }

  const Figure = ({ label, value, sub, tone }) => (
    <div className="panel panel-pad">
      <div className="panel-head">{label}</div>
      <div className={`figure text-[26px] mt-2 ${tone || 'text-gray-900'}`}>{value}</div>
      <div className="text-[12px] text-gray-400 mt-1.5">{sub}</div>
    </div>
  )

  const TABS = [
    ['reorder', 'Reorder', reorder.length],
    ['dead', 'Not selling', dead.length],
    ['gaps', 'Missing data', gaps.length],
  ]

  return (
    <div className="max-w-[1180px]">
      <div className="flex items-start justify-between gap-4 flex-wrap mb-5">
        <div>
          <h1 className="text-[24px] md:text-[28px] font-bold tracking-tight leading-none">Stock</h1>
          <p className="text-[13px] text-gray-400 mt-1.5">What to buy, what is stuck, and what the books are missing.</p>
        </div>
        <div className="flex p-1 bg-stone-200/70 rounded-[12px]">
          {[30, 90, 180].map(d => (
            <button key={d} onClick={() => setDays(d)}
              className={`h-9 px-3.5 rounded-[9px] text-[13px] font-semibold transition ${days === d ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>
              {d}d
            </button>
          ))}
        </div>
      </div>

      {rows === null ? (
        <div className="panel panel-pad text-center py-16 text-gray-400 text-sm">Working out {days} days of sales…</div>
      ) : (<>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-5">
          <Figure label="Sold out, still wanted" value={totals.emptyCount}
            sub={`${money(totals.lostRevenue)} taken in ${days}d, now unbuyable`} tone="text-[#b3402b]" />
          <Figure label="Cash not moving" value={'GHS ' + moneyShort(totals.deadValue)}
            sub={`${totals.deadCount} products, no sale in ${days}d`} />
          <Figure label="Missing cost or price" value={totals.gapCount}
            sub="profit cannot be trusted until these are filled" tone={totals.gapCount ? 'text-[#b3402b]' : 'text-emerald-600'} />
        </div>

        <div className="flex items-center gap-2.5 flex-wrap mb-4">
          <div className="flex p-1 bg-stone-200/70 rounded-[12px]">
            {TABS.map(([id, label, count]) => (
              <button key={id} onClick={() => setTab(id)}
                className={`h-10 px-4 rounded-[9px] text-[13px] font-semibold transition ${tab === id ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>
                {label} <span className="tnum opacity-60">{count}</span>
              </button>
            ))}
          </div>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Filter by name…"
            className="h-10 px-3.5 panel text-[14px] flex-1 min-w-[160px]" />
        </div>

        {/* ── what to buy ─────────────────────────────────────────────── */}
        {tab === 'reorder' && (
          filtered(reorder).length === 0
            ? <EmptyState icon={IconBox} title="Nothing needs reordering" hint={`Every product that sold in the last ${days} days still has stock.`} />
            : <div className="panel overflow-x-auto rtable-wrap">
                <table className="rtable w-full min-w-[620px]">
                  <thead><tr>
                    {['Product', 'Sold', 'A week', 'In stock', 'Cover', `Took in ${days}d`].map(h =>
                      <th key={h} className="p-3 text-left text-[11px] font-bold text-gray-400 uppercase tracking-wider">{h}</th>)}
                  </tr></thead>
                  <tbody>{filtered(reorder).map(r => {
                    const out = n(r.quantity) === 0
                    return (
                      <tr key={r.id} className="border-b border-gray-50">
                        <td data-label="Product" className="p-3">
                          <div className="text-[13.5px] font-medium">{r.name}</div>
                          <div className="text-[11px] text-gray-400">{r.category || '—'}</div>
                        </td>
                        <td data-label="Sold" className="p-3 tnum text-[13px]">{r.sold}</td>
                        <td data-label="A week" className="p-3 tnum text-[13px] text-gray-500">{n(r.per_week).toFixed(1)}</td>
                        <td data-label="In stock" className="p-3">
                          <span className={`tnum text-[13px] font-bold px-2 py-0.5 rounded ${out ? 'bg-[#b3402b] text-white' : 'text-[#b3402b]'}`}>
                            {out ? 'OUT' : r.quantity}
                          </span>
                        </td>
                        <td data-label="Cover" className="p-3 tnum text-[13px] text-gray-500">
                          {out ? '—' : n(r.weeks_cover) ? n(r.weeks_cover).toFixed(1) + 'w' : '—'}
                        </td>
                        <td data-label={`Took in ${days}d`} className="p-3 tnum text-[13px] font-semibold">{money(r.revenue)}</td>
                      </tr>
                    )
                  })}</tbody>
                </table>
              </div>
        )}

        {/* ── cash sitting still ──────────────────────────────────────── */}
        {tab === 'dead' && (
          filtered(dead).length === 0
            ? <EmptyState icon={IconChart} title="Everything is moving" hint={`No product with stock has gone ${days} days without a sale.`} />
            : <>
                <p className="text-[12.5px] text-gray-500 mb-3 max-w-[70ch]">
                  Valued at cost where a cost price exists, otherwise at the selling price. These are
                  candidates for a promotion or a bundle — every cedi here is money already spent.
                </p>
                <div className="panel overflow-x-auto rtable-wrap">
                  <table className="rtable w-full min-w-[560px]">
                    <thead><tr>
                      {['Product', 'In stock', 'Each', 'Tied up'].map(h =>
                        <th key={h} className="p-3 text-left text-[11px] font-bold text-gray-400 uppercase tracking-wider">{h}</th>)}
                    </tr></thead>
                    <tbody>{filtered(dead).slice(0, 120).map(r => (
                      <tr key={r.id} className="border-b border-gray-50">
                        <td data-label="Product" className="p-3">
                          <div className="text-[13.5px] font-medium">{r.name}</div>
                          <div className="text-[11px] text-gray-400">{r.category || '—'}</div>
                        </td>
                        <td data-label="In stock" className="p-3 tnum text-[13px]">{r.quantity}</td>
                        <td data-label="Each" className="p-3 tnum text-[13px] text-gray-500">{money(r.price)}</td>
                        <td data-label="Tied up" className="p-3 tnum text-[13px] font-semibold">{money(r.tied_up)}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              </>
        )}

        {/* ── fill the gaps ───────────────────────────────────────────── */}
        {tab === 'gaps' && (
          filtered(gaps).length === 0
            ? <EmptyState icon={IconClipboard} title="Every product has a cost and a price" hint="Profit figures can be trusted." />
            : <>
                <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
                  <p className="text-[12.5px] text-gray-500 max-w-[62ch]">
                    A product with no cost price records its whole selling price as profit. Fill what you
                    know and save — you do not have to do them all at once. Scanning into a barcode box
                    works here too.
                  </p>
                  <button onClick={saveEdits} disabled={!dirty.length || saving}
                    className="h-10 px-4 rounded-[10px] bg-[#16181d] text-white text-[13px] font-semibold disabled:opacity-30 shrink-0">
                    {saving ? 'Saving…' : dirty.length ? `Save ${dirty.length}` : 'Save'}
                  </button>
                </div>
                <div className="panel divide-y" style={{ borderColor: 'var(--line)' }}>
                  {filtered(gaps).slice(0, 80).map(r => (
                    <div key={r.id} className="p-3.5 flex flex-col sm:flex-row sm:items-center gap-2.5">
                      <div className="flex-1 min-w-0">
                        <div className="text-[13.5px] font-medium truncate">{r.name}</div>
                        <div className="text-[11px] text-gray-400">
                          {n(r.sold) > 0 ? `${r.sold} sold · ${money(r.revenue)}` : 'no sales in this period'}
                          {n(r.quantity) > 0 ? ` · ${r.quantity} in stock` : ''}
                        </div>
                      </div>
                      <div className="flex gap-2 shrink-0">
                        <label className="flex flex-col">
                          <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Cost</span>
                          <input inputMode="decimal" placeholder={n(r.cost_price) ? String(r.cost_price) : '0.00'}
                            value={edits[r.id]?.cost_price ?? ''}
                            onChange={e => setEdit(r.id, 'cost_price', e.target.value.replace(/[^0-9.]/g, ''))}
                            className={`w-[86px] h-11 px-2.5 rounded-[10px] border-2 text-[14px] tnum text-right ${n(r.cost_price) <= 0 ? 'border-[#b3402b]/40 bg-[#b3402b]/5' : 'border-gray-200 bg-gray-50'}`} />
                        </label>
                        <label className="flex flex-col">
                          <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Price</span>
                          <input inputMode="decimal" placeholder={n(r.price) ? String(r.price) : '0.00'}
                            value={edits[r.id]?.price ?? ''}
                            onChange={e => setEdit(r.id, 'price', e.target.value.replace(/[^0-9.]/g, ''))}
                            className={`w-[86px] h-11 px-2.5 rounded-[10px] border-2 text-[14px] tnum text-right ${n(r.price) <= 0 ? 'border-[#b3402b]/40 bg-[#b3402b]/5' : 'border-gray-200 bg-gray-50'}`} />
                        </label>
                        <label className="flex flex-col">
                          <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Barcode</span>
                          <input data-no-scan placeholder="scan"
                            value={edits[r.id]?.barcode ?? ''}
                            onChange={e => setEdit(r.id, 'barcode', e.target.value.trim())}
                            className="w-[128px] h-11 px-2.5 rounded-[10px] border-2 border-gray-200 bg-gray-50 text-[13px] font-mono" />
                        </label>
                      </div>
                    </div>
                  ))}
                </div>
                {filtered(gaps).length > 80 && (
                  <p className="text-[12px] text-gray-400 mt-3">
                    Showing the 80 that earned the most. Save these and the next batch appears.
                  </p>
                )}
              </>
        )}
      </>)}
    </div>
  )
}
