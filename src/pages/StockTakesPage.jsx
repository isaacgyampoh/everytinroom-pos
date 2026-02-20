import { useState } from 'react'
import { useStore } from '../hooks/useStore'
import { getSupabase } from '../lib/supabase'
import { fmtDate, fmtDateTime, today } from '../lib/utils'
import Modal from '../components/Modal'
import toast from 'react-hot-toast'

export default function StockTakesPage() {
  const { stockTakes, products, user, refreshStockTakes, refreshProducts, setLoading } = useStore()
  const [modal, setModal] = useState(false)
  const [viewModal, setViewModal] = useState(null)
  const [notes, setNotes] = useState('')
  const [counts, setCounts] = useState([])

  const startStockTake = () => {
    setCounts(products.map(p => ({ productId: p.id, name: p.name, category: p.category, systemQty: p.quantity, countedQty: '', variance: 0 })))
    setNotes(''); setModal(true)
  }

  const updateCount = (i, val) => {
    const newCounts = [...counts]; const counted = parseInt(val) || 0
    newCounts[i].countedQty = val; newCounts[i].variance = counted - newCounts[i].systemQty
    setCounts(newCounts)
  }

  const save = async () => {
    const filled = counts.filter(c => c.countedQty !== '')
    if (!filled.length) { toast.error('Count at least one product'); return }
    if (!confirm(`Save stock take with ${filled.length} products counted?`)) return
    setLoading(true, 'Saving stock take...')
    const sb = getSupabase()
    const items = filled.map(c => ({ productId: c.productId, name: c.name, systemQty: c.systemQty, countedQty: parseInt(c.countedQty) || 0, variance: c.variance }))

    await sb.from('stock_takes').insert({ date: new Date().toISOString(), items, notes: notes.trim(), conducted_by: user?.name || '' })

    // Update product quantities to match counted
    for (const item of items) {
      if (item.variance !== 0) {
        await sb.from('products').update({ quantity: item.countedQty }).eq('id', item.productId)
        await sb.from('stock_adjustments').insert({ date: new Date().toISOString(), product_id: item.productId, product_name: item.name, qty: item.variance, reason: 'Stock Take Adjustment', notes: notes.trim() || 'From stock take', adjusted_by: user?.name || '' })
      }
    }

    await refreshStockTakes(); await refreshProducts(); setLoading(false); setModal(false); toast.success('Stock take saved! ' + items.filter(i => i.variance !== 0).length + ' adjustments made')
  }

  const totalVariance = (items) => items.reduce((a, i) => a + Math.abs(i.variance || 0), 0)
  const discrepancies = (items) => items.filter(i => (i.variance || 0) !== 0).length

  return (
    <div className="animate-fade">
      <div className="flex justify-between items-start flex-wrap gap-4 mb-6">
        <div><h1 className="text-3xl font-extrabold">📋 Stock Takes</h1><p className="text-gray-500">Count inventory & track variances</p></div>
        <button onClick={startStockTake} className="h-12 px-5 bg-brand-500 text-white rounded-xl text-sm font-semibold">📋 New Stock Take</button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-3xl p-6 shadow-md"><div className="text-4xl mb-3">📋</div><div className="text-xs font-bold text-gray-400 uppercase">Total Takes</div><div className="text-2xl font-extrabold mt-1">{stockTakes.length}</div></div>
        <div className="bg-white rounded-3xl p-6 shadow-md"><div className="text-4xl mb-3">📦</div><div className="text-xs font-bold text-gray-400 uppercase">Products</div><div className="text-2xl font-extrabold mt-1">{products.length}</div></div>
        <div className="bg-white rounded-3xl p-6 shadow-md"><div className="text-4xl mb-3">⚠️</div><div className="text-xs font-bold text-gray-400 uppercase">Low Stock</div><div className="text-2xl font-extrabold mt-1 text-amber-500">{products.filter(p => p.quantity <= 5).length}</div></div>
      </div>

      <div className="space-y-4">
        {stockTakes.length === 0 && <div className="text-center py-12 text-gray-400"><span className="text-5xl block mb-3 opacity-30">📋</span>No stock takes yet</div>}
        {stockTakes.map(st => (
          <div key={st.id} className="bg-white rounded-3xl p-6 shadow-md cursor-pointer hover:shadow-lg transition" onClick={() => setViewModal(st)}>
            <div className="flex justify-between items-start flex-wrap gap-3 mb-3">
              <div><div className="text-lg font-bold">{fmtDateTime(st.date)}</div><div className="text-sm text-gray-500">By: {st.conductedBy || 'Unknown'}</div></div>
              <div className="flex gap-2">
                <span className="px-3 py-1.5 bg-brand-50 text-brand-500 rounded-full text-xs font-bold">{st.items.length} products</span>
                {discrepancies(st.items) > 0 && <span className="px-3 py-1.5 bg-red-50 text-red-500 rounded-full text-xs font-bold">⚠️ {discrepancies(st.items)} variances</span>}
              </div>
            </div>
            {st.notes && <div className="text-sm text-gray-500 bg-gray-50 p-2.5 rounded-lg">{st.notes}</div>}
          </div>
        ))}
      </div>

      {/* New Stock Take Modal */}
      <Modal open={modal} onClose={() => setModal(false)} title="📋 New Stock Take"
        footer={<><button onClick={() => setModal(false)} className="h-12 px-5 bg-gray-100 rounded-xl text-sm font-semibold">Cancel</button><button onClick={save} className="flex-1 h-12 bg-brand-500 text-white rounded-xl text-sm font-bold">💾 Save Stock Take</button></>}>
        <div className="space-y-4">
          <div className="bg-brand-50 rounded-xl p-4 text-sm text-brand-700">
            <b>Instructions:</b> Enter the physical count for each product. Leave blank to skip. Variances will be auto-calculated and stock adjusted.
          </div>
          <div><label className="block text-xs font-semibold text-gray-500 mb-2">Notes</label><input className="w-full h-13 px-4 bg-gray-50 border-2 border-gray-200 rounded-xl text-base" placeholder="e.g. Monthly stock take" value={notes} onChange={e => setNotes(e.target.value)} /></div>
          <div className="text-xs font-bold text-gray-400 uppercase mb-2">Products ({counts.length})</div>
          {counts.map((c, i) => {
            const v = parseInt(c.countedQty) >= 0 ? c.variance : null
            return (
              <div key={i} className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl">
                <div className="flex-1 min-w-0"><div className="font-semibold text-sm truncate">{c.name}</div><div className="text-xs text-gray-400">{c.category || '-'} • System: <b>{c.systemQty}</b></div></div>
                <input type="number" className="w-20 h-10 px-2 text-center border-2 border-gray-200 rounded-lg text-sm font-bold focus:border-brand-500 focus:outline-none" placeholder="Count" value={c.countedQty} min={0} onChange={e => updateCount(i, e.target.value)} />
                {v !== null && <span className={`w-14 text-center text-xs font-bold ${v === 0 ? 'text-green-500' : v > 0 ? 'text-blue-500' : 'text-red-500'}`}>{v === 0 ? '✓' : v > 0 ? '+' + v : v}</span>}
              </div>
            )
          })}
        </div>
      </Modal>

      {/* View Stock Take */}
      <Modal open={!!viewModal} onClose={() => setViewModal(null)} title="📋 Stock Take Details">
        {viewModal && (<div className="space-y-3">
          <div className="bg-gray-50 rounded-xl p-4 text-sm"><b>Date:</b> {fmtDateTime(viewModal.date)}<br /><b>By:</b> {viewModal.conductedBy}<br />{viewModal.notes && <><b>Notes:</b> {viewModal.notes}</>}</div>
          <div className="text-xs font-bold text-gray-400 uppercase">Items ({viewModal.items.length})</div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[400px]">
              <thead><tr><th className="p-2 bg-gray-50 text-left text-[10px] font-bold text-gray-500">Product</th><th className="p-2 bg-gray-50 text-center text-[10px] font-bold text-gray-500">System</th><th className="p-2 bg-gray-50 text-center text-[10px] font-bold text-gray-500">Counted</th><th className="p-2 bg-gray-50 text-center text-[10px] font-bold text-gray-500">Variance</th></tr></thead>
              <tbody>{viewModal.items.map((it, i) => (
                <tr key={i} className={`border-b border-gray-50 ${it.variance !== 0 ? 'bg-red-50/50' : ''}`}>
                  <td className="p-2 text-sm font-medium">{it.name}</td>
                  <td className="p-2 text-sm text-center">{it.systemQty}</td>
                  <td className="p-2 text-sm text-center font-bold">{it.countedQty}</td>
                  <td className={`p-2 text-sm text-center font-bold ${it.variance === 0 ? 'text-green-500' : it.variance > 0 ? 'text-blue-500' : 'text-red-500'}`}>{it.variance === 0 ? '✓' : it.variance > 0 ? '+' + it.variance : it.variance}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </div>)}
      </Modal>
    </div>
  )
}
