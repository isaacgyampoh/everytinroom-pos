import { useState } from 'react'
import { useStore } from '../hooks/useStore'
import { getSupabase } from '../lib/supabase'
import { fmtDate, fmtDateTime, money, num } from '../lib/utils'
import Modal from '../components/Modal'
import toast from 'react-hot-toast'

export default function StockTakesPage() {
  const { stockTakes, products, user, refreshStockTakes, refreshProducts, setLoading } = useStore()
  const [modal, setModal] = useState(false)
  const [viewModal, setViewModal] = useState(null)
  const [lowStockOpen, setLowStockOpen] = useState(false)
  const [notes, setNotes] = useState('')
  const [counts, setCounts] = useState([])
  const [search, setSearch] = useState('')

  const lowStockProducts = products.filter(p => p.quantity <= 5).sort((a, b) => a.quantity - b.quantity)
  const outOfStock = products.filter(p => p.quantity === 0)
  const totalStockValue = products.reduce((a, p) => a + p.price * p.quantity, 0)

  const startStockTake = () => {
    setCounts(products.map(p => ({ productId: p.id, name: p.name, category: p.category, systemQty: p.quantity, countedQty: '', variance: 0 })))
    setNotes(''); setSearch(''); setModal(true)
  }

  const updateCount = (i, val) => {
    const c = [...counts]; const counted = parseInt(val) || 0
    c[i].countedQty = val; c[i].variance = counted - c[i].systemQty
    setCounts(c)
  }

  const filteredCounts = counts.filter(c => c.name.toLowerCase().includes(search.toLowerCase()) || (c.category || '').toLowerCase().includes(search.toLowerCase()))

  const save = async () => {
    const filled = counts.filter(c => c.countedQty !== '')
    if (!filled.length) { toast.error('Count at least one product'); return }
    if (!confirm('Save stock take with ' + filled.length + ' products counted?')) return
    setLoading(true, 'Saving stock take...')
    const sb = getSupabase()
    const items = filled.map(c => ({ productId: c.productId, name: c.name, systemQty: c.systemQty, countedQty: parseInt(c.countedQty) || 0, variance: c.variance }))
    await sb.from('stock_takes').insert({ date: new Date().toISOString(), items, notes: notes.trim(), conducted_by: user?.name || '' })
    for (const item of items) {
      if (item.variance !== 0) {
        await sb.from('products').update({ quantity: item.countedQty }).eq('id', item.productId)
        await sb.from('stock_adjustments').insert({ date: new Date().toISOString(), product_id: item.productId, product_name: item.name, qty: item.variance, reason: 'Stock Take Adjustment', notes: notes.trim() || 'From stock take', adjusted_by: user?.name || '' })
      }
    }
    await refreshStockTakes(); await refreshProducts(); setLoading(false); setModal(false)
    toast.success('Stock take saved! ' + items.filter(i => i.variance !== 0).length + ' adjustments made')
  }

  return (
    <div className="animate-fade">
      <div className="flex justify-between items-start flex-wrap gap-4 mb-5">
        <div>
          <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight">📋 Stock Takes</h1>
          <p className="text-gray-400 text-sm mt-0.5">Count inventory & track variances</p>
        </div>
        <button onClick={startStockTake} className="h-11 px-5 bg-brand-500 text-white rounded-xl text-sm font-semibold hover:bg-brand-600 active:scale-[.97] transition">📋 New Stock Take</button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <div className="bg-white rounded-2xl p-4 md:p-5 border border-gray-100 text-center">
          <div className="text-xs md:text-sm text-gray-400 font-medium">Total Products</div>
          <div className="text-2xl md:text-3xl font-extrabold mt-1">{products.length}</div>
        </div>
        <div className="bg-white rounded-2xl p-4 md:p-5 border border-gray-100 text-center">
          <div className="text-xs md:text-sm text-gray-400 font-medium">Stock Value</div>
          <div className="text-xl md:text-2xl font-extrabold text-brand-500 mt-1">{money(totalStockValue)}</div>
        </div>
        <button onClick={() => setLowStockOpen(true)} className="bg-amber-50 rounded-2xl p-4 md:p-5 border-2 border-amber-200 text-center hover:bg-amber-100 transition">
          <div className="text-xs md:text-sm text-amber-600 font-medium">⚠️ Low Stock</div>
          <div className="text-2xl md:text-3xl font-extrabold text-amber-500 mt-1">{lowStockProducts.length}</div>
        </button>
        <div className="bg-red-50 rounded-2xl p-4 md:p-5 border border-red-100 text-center">
          <div className="text-xs md:text-sm text-red-500 font-medium">Out of Stock</div>
          <div className="text-2xl md:text-3xl font-extrabold text-red-500 mt-1">{outOfStock.length}</div>
        </div>
      </div>

      {/* Stock Takes History */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="p-4 md:p-5 border-b border-gray-100">
          <h3 className="text-base md:text-lg font-bold text-gray-800">Stock Take History ({stockTakes.length})</h3>
        </div>

        {stockTakes.length === 0 ? (
          <div className="text-center py-16 text-gray-300"><span className="text-5xl block mb-3">📋</span>No stock takes yet</div>
        ) : (
          <div className="divide-y divide-gray-50">
            {stockTakes.map(st => {
              const variances = st.items.filter(i => (i.variance || 0) !== 0).length
              return (
                <div key={st.id} className="p-4 md:p-5 hover:bg-gray-50/50 cursor-pointer transition" onClick={() => setViewModal(st)}>
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm md:text-base font-bold text-gray-800">{fmtDateTime(st.date)}</div>
                      <div className="text-xs md:text-sm text-gray-400 mt-0.5">By {st.conductedBy || 'Unknown'} • {st.items.length} products counted</div>
                      {st.notes && <div className="text-xs text-gray-400 mt-1 italic">"{st.notes}"</div>}
                    </div>
                    <div className="flex gap-2 flex-shrink-0">
                      {variances > 0 && <span className="px-2.5 py-1 bg-red-50 text-red-500 rounded-lg text-xs font-bold">⚠️ {variances}</span>}
                      <span className="text-gray-300 text-lg">→</span>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Low Stock Modal */}
      <Modal open={lowStockOpen} onClose={() => setLowStockOpen(false)} title={'⚠️ Low Stock (' + lowStockProducts.length + ')'}>
        <div className="space-y-2">
          {lowStockProducts.length === 0 && <div className="text-center py-8 text-gray-400">All products well stocked! 🎉</div>}
          {lowStockProducts.map(p => (
            <div key={p.id} className={`flex items-center gap-3 p-3 md:p-4 rounded-xl ${p.quantity === 0 ? 'bg-red-50 border border-red-200' : 'bg-amber-50 border border-amber-200'}`}>
              <div className="w-11 h-11 bg-white rounded-xl overflow-hidden flex items-center justify-center flex-shrink-0">
                {p.image ? <img src={p.image} alt="" className="w-full h-full object-cover" /> : <span className="text-xl">📦</span>}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-bold text-gray-800">{p.name}</div>
                <div className="text-xs text-gray-400">{p.category || '-'} • {money(p.price)}</div>
              </div>
              <div className={`text-xl font-extrabold ${p.quantity === 0 ? 'text-red-500' : 'text-amber-500'}`}>
                {p.quantity === 0 ? 'OUT' : p.quantity}
              </div>
            </div>
          ))}
        </div>
      </Modal>

      {/* New Stock Take Modal */}
      <Modal open={modal} onClose={() => setModal(false)} title="📋 New Stock Take"
        footer={<><button onClick={() => setModal(false)} className="h-11 px-5 bg-gray-100 rounded-xl text-sm font-semibold">Cancel</button><button onClick={save} className="flex-1 h-11 bg-brand-500 text-white rounded-xl text-sm font-bold">💾 Save</button></>}>
        <div className="space-y-4">
          <div className="bg-brand-50 rounded-xl p-3.5 text-sm text-brand-700">
            Enter the physical count for each product. Leave blank to skip. Variances auto-calculated.
          </div>
          <input className="w-full h-11 px-4 bg-gray-50 border border-gray-200 rounded-xl text-sm" placeholder="Notes (e.g. Monthly stock take)" value={notes} onChange={e => setNotes(e.target.value)} />
          <input className="w-full h-11 px-4 bg-gray-50 border border-gray-200 rounded-xl text-sm" placeholder="🔍 Search products..." value={search} onChange={e => setSearch(e.target.value)} />
          <div className="text-xs font-bold text-gray-400 uppercase">Products ({filteredCounts.length})</div>
          {filteredCounts.map((c, i) => {
            const ri = counts.indexOf(c)
            const v = c.countedQty !== '' ? c.variance : null
            return (
              <div key={ri} className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-gray-700">{c.name}</div>
                  <div className="text-xs text-gray-400">{c.category || '-'} • System: <b>{c.systemQty}</b></div>
                </div>
                <input type="number" className="w-20 h-10 px-2 text-center border border-gray-200 rounded-lg text-sm font-bold focus:border-brand-500 focus:outline-none" placeholder="Count" value={c.countedQty} min={0} onChange={e => updateCount(ri, e.target.value)} />
                {v !== null && <span className={`w-12 text-center text-xs font-bold ${v === 0 ? 'text-green-500' : v > 0 ? 'text-blue-500' : 'text-red-500'}`}>{v === 0 ? '✓' : v > 0 ? '+' + v : v}</span>}
              </div>
            )
          })}
        </div>
      </Modal>

      {/* View Stock Take Detail */}
      <Modal open={!!viewModal} onClose={() => setViewModal(null)} title="📋 Stock Take Details">
        {viewModal && (<div className="space-y-3">
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="bg-gray-50 rounded-xl p-3">
              <div className="text-xs text-gray-400">Date</div>
              <div className="text-sm font-bold mt-0.5">{fmtDateTime(viewModal.date)}</div>
            </div>
            <div className="bg-gray-50 rounded-xl p-3">
              <div className="text-xs text-gray-400">By</div>
              <div className="text-sm font-bold mt-0.5">{viewModal.conductedBy || '-'}</div>
            </div>
            <div className="bg-gray-50 rounded-xl p-3">
              <div className="text-xs text-gray-400">Products</div>
              <div className="text-sm font-bold mt-0.5">{viewModal.items.length}</div>
            </div>
          </div>
          {viewModal.notes && <div className="text-sm text-gray-500 italic bg-gray-50 p-3 rounded-xl">"{viewModal.notes}"</div>}
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-gray-50">
                  <th className="p-3 text-left text-[11px] font-bold text-gray-400 uppercase tracking-wide">Product</th>
                  <th className="p-3 text-center text-[11px] font-bold text-gray-400 uppercase tracking-wide">System</th>
                  <th className="p-3 text-center text-[11px] font-bold text-gray-400 uppercase tracking-wide">Count</th>
                  <th className="p-3 text-center text-[11px] font-bold text-gray-400 uppercase tracking-wide">Diff</th>
                </tr>
              </thead>
              <tbody>
                {viewModal.items.map((it, i) => (
                  <tr key={i} className={`border-b border-gray-50 ${it.variance !== 0 ? 'bg-red-50/30' : ''}`}>
                    <td className="p-3 text-sm font-medium text-gray-700">{it.name}</td>
                    <td className="p-3 text-sm text-center text-gray-500">{it.systemQty}</td>
                    <td className="p-3 text-sm text-center font-bold">{it.countedQty}</td>
                    <td className={`p-3 text-sm text-center font-bold ${it.variance === 0 ? 'text-green-500' : it.variance > 0 ? 'text-blue-500' : 'text-red-500'}`}>
                      {it.variance === 0 ? '✓' : it.variance > 0 ? '+' + it.variance : it.variance}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex justify-between p-3 bg-gray-50 rounded-xl text-sm font-bold">
            <span>Variances: {viewModal.items.filter(i => i.variance !== 0).length}</span>
            <span className="text-green-500">Matched: {viewModal.items.filter(i => i.variance === 0).length}</span>
          </div>
        </div>)}
      </Modal>
    </div>
  )
}
