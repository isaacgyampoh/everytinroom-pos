import { useState } from 'react'
import { useStore } from '../hooks/useStore'
import { getSupabase } from '../lib/supabase'
import { fmtDate, fmtDateTime, money, num } from '../lib/utils'
import Modal from '../components/Modal'
import toast from 'react-hot-toast'

export default function StockTakesPage() {
  const { stockTakes, stockAdjustments, products, user, isAdmin, refreshStockTakes, refreshStockAdjustments, refreshProducts, setLoading } = useStore()
  const [tab, setTab] = useState('takes')
  const [modal, setModal] = useState(false)
  const [adjModal, setAdjModal] = useState(false)
  const [viewModal, setViewModal] = useState(null)
  const [lowStockOpen, setLowStockOpen] = useState(false)
  const [notes, setNotes] = useState('')
  const [counts, setCounts] = useState([])
  const [search, setSearch] = useState('')
  // Adjustment form
  const [adjProduct, setAdjProduct] = useState('')
  const [adjQty, setAdjQty] = useState('')
  const [adjReason, setAdjReason] = useState('Damaged')
  const [adjNotes, setAdjNotes] = useState('')

  const lowStockProducts = products.filter(p => p.quantity <= 5).sort((a, b) => a.quantity - b.quantity)
  const outOfStock = products.filter(p => p.quantity === 0)
  const totalStockValue = products.reduce((a, p) => a + p.price * p.quantity, 0)

  // Print a paper stock-count sheet on the 80mm thermal printer.
  // Staff walk around ticking / writing the physical count by hand.
  const printStockSheet = () => {
    const sorted = [...products].sort((a, b) =>
      (a.category || 'zzz').localeCompare(b.category || 'zzz') || a.name.localeCompare(b.name))
    const date = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
    let cat = ''
    const rows = sorted.map(p => {
      let head = ''
      if ((p.category || 'Uncategorised') !== cat) {
        cat = p.category || 'Uncategorised'
        head = `<tr><td colspan="3" class="cat">${cat}</td></tr>`
      }
      return head + `<tr>
        <td class="nm">${p.name}</td>
        <td class="sys">${p.quantity}</td>
        <td class="cnt">________</td>
      </tr>`
    }).join('')

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Stock Sheet</title>
      <style>
        @page { size: 80mm auto; margin: 0; }
        * { box-sizing: border-box; }
        body { width: 72mm; margin: 0 auto; padding: 6mm 2mm; font-family: 'Courier New', monospace; color: #000; }
        h1 { font-size: 15px; text-align: center; margin: 0 0 2px; letter-spacing: 1px; }
        .sub { text-align: center; font-size: 10px; margin-bottom: 2px; }
        .meta { font-size: 10px; display: flex; justify-content: space-between; border-bottom: 1px dashed #000; padding-bottom: 4px; margin-bottom: 4px; }
        table { width: 100%; border-collapse: collapse; font-size: 11px; }
        th { text-align: left; border-bottom: 1px solid #000; padding: 2px 0; font-size: 10px; }
        th.sys, th.cnt { text-align: right; }
        td { padding: 3px 0; vertical-align: bottom; }
        td.nm { width: 56%; }
        td.sys { width: 16%; text-align: right; padding-right: 4px; }
        td.cnt { width: 28%; text-align: right; font-weight: bold; }
        td.cat { font-weight: bold; padding-top: 7px; border-bottom: 1px dotted #000; font-size: 11px; text-transform: uppercase; }
        .foot { margin-top: 8px; border-top: 1px dashed #000; padding-top: 6px; font-size: 10px; }
        .sign { margin-top: 16px; }
      </style></head><body>
      <h1>STOCK COUNT SHEET</h1>
      <div class="sub">EVERYTINROOM</div>
      <div class="meta"><span>${date}</span><span>${products.length} items</span></div>
      <table>
        <thead><tr><th>Product</th><th class="sys">Sys</th><th class="cnt">Count</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="foot">
        Sys = quantity in system. Write the real count you find.
        <div class="sign">Counted by: ____________________</div>
        <div class="sign">Checked by: _____________________</div>
      </div>
      <script>window.onload = function(){ window.print(); setTimeout(function(){ window.close() }, 300) }<\/script>
      </body></html>`

    const w = window.open('', 'stock-sheet', 'width=360,height=640')
    if (!w) { alert('Allow popups to print the stock sheet.'); return }
    w.document.write(html); w.document.close()
  }

  const startStockTake = () => {
    setCounts(products.map(p => ({ productId: p.id, name: p.name, category: p.category, systemQty: p.quantity, countedQty: '', variance: 0 })))
    setNotes(''); setSearch(''); setModal(true)
  }

  const updateCount = (i, val) => {
    const c = [...counts]; const counted = parseInt(val) || 0
    c[i].countedQty = val; c[i].variance = counted - c[i].systemQty; setCounts(c)
  }

  const filteredCounts = counts.filter(c => c.name.toLowerCase().includes(search.toLowerCase()) || (c.category || '').toLowerCase().includes(search.toLowerCase()))

  const saveTake = async () => {
    const filled = counts.filter(c => c.countedQty !== '')
    if (!filled.length) { toast.error('Count at least one product'); return }
    const items = filled.map(c => ({ productId: c.productId, name: c.name, systemQty: c.systemQty, countedQty: parseInt(c.countedQty) || 0, variance: c.variance }))
    const sb = getSupabase()

    // Non-admins: submit for approval. Stock does NOT change until an admin approves.
    if (!isAdmin) {
      if (!confirm(`Submit stock take (${filled.length} products) for admin approval?`)) return
      setLoading(true, 'Submitting...')
      await sb.from('stock_takes').insert({ date: new Date().toISOString(), items, notes: notes.trim(), conducted_by: user?.name || '', status: 'pending' })
      await refreshStockTakes(); setLoading(false); setModal(false)
      toast.success('Submitted for approval')
      return
    }

    // Admins: apply immediately (with audit logging).
    if (!confirm('Save stock take with ' + filled.length + ' products counted?')) return
    setLoading(true, 'Saving...')
    await sb.from('stock_takes').insert({ date: new Date().toISOString(), items, notes: notes.trim(), conducted_by: user?.name || '', status: 'approved', approved_by: user?.name || '', approved_at: new Date().toISOString() })
    for (const item of items) {
      if (item.variance !== 0) {
        const prod = products.find(p => p.id === item.productId)
        await sb.from('products').update({ quantity: item.countedQty }).eq('id', item.productId)
        await sb.from('stock_adjustments').insert({ date: new Date().toISOString(), product_id: item.productId, product_name: item.name, qty: item.variance, reason: 'Stock Take', notes: notes.trim() || 'From stock take', adjusted_by: user?.name || '' })
        try { await sb.from('stock_ledger').insert({ product_id: item.productId, product_name: item.name, previous_qty: prod?.quantity ?? item.systemQty, change_qty: item.variance, new_qty: item.countedQty, reason: 'Stock take', action_type: 'stock_take', staff: user?.name || '', reference: 'ST' }) } catch {}
      }
    }
    await refreshStockTakes(); await refreshStockAdjustments(); await refreshProducts(); setLoading(false); setModal(false)
    toast.success('Saved! ' + items.filter(i => i.variance !== 0).length + ' adjustments')
  }

  const approveTake = async (st) => {
    if (!confirm('Approve this stock take? Counted quantities will become the official stock.')) return
    setLoading(true, 'Approving...')
    const sb = getSupabase()
    const { data, error } = await sb.rpc('approve_stock_take', { p_id: st.id, p_approver: user?.name || 'Admin' })
    if (error || !data?.success) { toast.error('Approve failed: ' + (error?.message || data?.error)); setLoading(false); return }
    await refreshStockTakes(); await refreshStockAdjustments(); await refreshProducts(); setLoading(false)
    toast.success(`Approved — ${data.applied} product(s) updated`)
  }
  const rejectTake = async (st) => {
    const reason = prompt('Reason for rejecting?') || ''
    const sb = getSupabase()
    await sb.from('stock_takes').update({ status: 'rejected', reject_reason: reason, approved_by: user?.name || 'Admin', approved_at: new Date().toISOString() }).eq('id', st.id)
    await refreshStockTakes(); toast.success('Rejected')
  }

  const saveAdj = async () => {
    if (!adjProduct || !adjQty) { toast.error('Select product and quantity'); return }
    const p = products.find(x => x.id === adjProduct)
    if (!p) return
    const qty = parseInt(adjQty)
    const newQty = Math.max(0, p.quantity + qty)
    setLoading(true, 'Saving...')
    const sb = getSupabase()
    await sb.from('products').update({ quantity: newQty }).eq('id', adjProduct)
    await sb.from('stock_adjustments').insert({ date: new Date().toISOString(), product_id: adjProduct, product_name: p.name, qty, reason: adjReason, notes: adjNotes.trim() || adjReason, adjusted_by: user?.name || '' })
    await refreshProducts(); await refreshStockAdjustments(); setLoading(false); setAdjModal(false)
    setAdjProduct(''); setAdjQty(''); setAdjNotes('')
    toast.success(`${p.name}: ${p.quantity} → ${newQty}`)
  }

  return (
    <div >
      <div className="flex justify-between items-start flex-wrap gap-4 mb-5">
        <div>
          <h1 className="text-[22px] md:text-[26px] font-bold tracking-tight">Stock Stock & Adjustments Adjustments</h1>
          <p className="text-gray-400 text-sm mt-0.5">Count inventory, track variances & adjustments</p>
        </div>
        <div className="flex gap-2">
          <button onClick={printStockSheet} className="h-11 px-4 bg-white border border-gray-200 text-gray-700 rounded-xl text-sm font-semibold hover:bg-gray-50 transition">Print Stock Sheet</button>
          <button onClick={() => setAdjModal(true)} className="h-11 px-4 bg-white border border-gray-200 text-gray-700 rounded-xl text-sm font-semibold hover:bg-gray-50 transition">Adjust</button>
          <button onClick={startStockTake} className="h-11 px-5 bg-gray-700 text-white rounded-xl text-sm font-semibold hover:bg-gray-800 transition">New Stock Take</button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <div className="bg-white rounded-2xl p-4 border border-gray-100 text-center relative overflow-hidden">
          <div className="absolute -right-3 -top-3 w-14 h-14 rounded-full border border-gray-400/10" />
          <div className="text-xs text-gray-400 font-medium">Total Products</div>
          <div className="text-2xl font-bold mt-1">{products.length}</div>
        </div>
        <div className="bg-white rounded-2xl p-4 border border-gray-100 text-center relative overflow-hidden">
          <div className="absolute -right-3 -top-3 w-14 h-14 rounded-full border border-gray-400/10" />
          <div className="text-xs text-gray-400 font-medium">Stock Value</div>
          <div className="text-xl font-bold text-gray-700 mt-1">{money(totalStockValue)}</div>
        </div>
        <button onClick={() => setLowStockOpen(true)} className="bg-amber-50 rounded-2xl p-4 border-2 border-amber-200 text-center hover:bg-amber-100 transition">
          <div className="text-xs text-amber-600 font-medium">Low Stock</div>
          <div className="text-2xl font-bold text-amber-500 mt-1">{lowStockProducts.length}</div>
        </button>
        <div className="bg-red-50 rounded-2xl p-4 border border-red-100 text-center">
          <div className="text-xs text-red-500 font-medium">Out of Stock</div>
          <div className="text-2xl font-bold text-red-500 mt-1">{outOfStock.length}</div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-white rounded-2xl p-1 mb-5 border border-gray-100 w-fit">
        <button onClick={() => setTab('takes')} className={`h-9 px-5 rounded-xl text-sm font-semibold transition ${tab === 'takes' ? 'bg-gray-800 text-white' : 'text-stone-500 hover:text-stone-700'}`}>Stock Takes</button>
        <button onClick={() => setTab('adjustments')} className={`h-9 px-5 rounded-xl text-sm font-semibold transition ${tab === 'adjustments' ? 'bg-gray-800 text-white' : 'text-stone-500 hover:text-stone-700'}`}>Adjustments</button>
      </div>

      {/* Stock Takes Tab */}
      {tab === 'takes' && (
        <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
          <div className="p-4 border-b border-gray-100"><h3 className="font-bold text-gray-800">Stock Take History ({stockTakes.length})</h3></div>
          {stockTakes.length === 0 ? <div className="text-center py-16 text-gray-300"><span className="text-xl opacity-15">—</span>No stock takes yet</div> : (
            <div className="divide-y divide-gray-50">
              {stockTakes.map(st => {
                const variances = st.items.filter(i => (i.variance || 0) !== 0).length
                const status = st.status || 'approved'
                return (
                  <div key={st.id} className="p-4 hover:bg-gray-50/50 transition">
                    <div className="flex items-center justify-between cursor-pointer" onClick={() => setViewModal(st)}>
                      <div>
                        <div className="text-sm font-bold text-gray-800">{fmtDateTime(st.date)}</div>
                        <div className="text-xs text-gray-400 mt-0.5">By {st.conductedBy || 'Unknown'} • {st.items.length} counted</div>
                        {st.notes && <div className="text-xs text-gray-400 mt-1 italic">"{st.notes}"</div>}
                      </div>
                      <div className="flex gap-2 items-center">
                        {status === 'pending' && <span className="px-2 py-1 bg-amber-100 text-amber-700 rounded-lg text-[10px] font-bold">PENDING</span>}
                        {status === 'rejected' && <span className="px-2 py-1 bg-red-100 text-red-700 rounded-lg text-[10px] font-bold">REJECTED</span>}
                        {variances > 0 && <span className="px-2.5 py-1 bg-red-50 text-red-500 rounded-lg text-xs font-bold">{variances}</span>}
                        <span className="text-gray-300">→</span>
                      </div>
                    </div>
                    {status === 'pending' && isAdmin && (
                      <div className="flex gap-2 mt-3">
                        <button onClick={(e) => { e.stopPropagation(); approveTake(st) }} className="flex-1 h-9 bg-green-600 text-white rounded-lg text-xs font-bold">Approve & Update Stock</button>
                        <button onClick={(e) => { e.stopPropagation(); rejectTake(st) }} className="h-9 px-4 border border-red-300 text-red-500 rounded-lg text-xs font-bold">Reject</button>
                      </div>
                    )}
                    {status === 'pending' && !isAdmin && <div className="mt-2 text-[11px] text-amber-600">Waiting for admin approval</div>}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Adjustments Tab */}
      {tab === 'adjustments' && (
        <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
          <div className="p-4 border-b border-gray-100 flex justify-between items-center">
            <h3 className="font-bold text-gray-800">Adjustments ({stockAdjustments.length})</h3>
            <button onClick={() => setAdjModal(true)} className="h-8 px-3 bg-gray-50 text-gray-700 rounded-lg text-xs font-bold hover:bg-gray-100 transition">+ New</button>
          </div>
          {stockAdjustments.length === 0 ? <div className="text-center py-16 text-gray-300"><span className="text-xl opacity-15">—</span>No adjustments yet</div> : (
            <div className="divide-y divide-gray-50">
              {stockAdjustments.slice(0, 50).map(a => (
                <div key={a.id} className="p-4 flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-sm font-bold flex-shrink-0 ${a.qty > 0 ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-500'}`}>
                    {a.qty > 0 ? '+' + a.qty : a.qty}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold truncate">{a.productName}</div>
                    <div className="text-xs text-gray-400">{fmtDateTime(a.date)} • {a.reason}</div>
                  </div>
                  <div className="text-xs text-gray-400">{a.adjustedBy}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Low Stock Modal */}
      <Modal open={lowStockOpen} onClose={() => setLowStockOpen(false)} title={'Low Stock (' + lowStockProducts.length + ')'}>
        <div className="space-y-2">
          {lowStockProducts.length === 0 && <div className="text-center py-8 text-gray-400">All stocked! </div>}
          {lowStockProducts.map(p => (
            <div key={p.id} className={`flex items-center gap-3 p-3 rounded-xl ${p.quantity === 0 ? 'bg-red-50 border border-red-200' : 'bg-amber-50 border border-amber-200'}`}>
              <div className="flex-1"><div className="text-sm font-bold">{p.name}</div><div className="text-xs text-gray-400">{p.category || '-'}</div></div>
              <div className={`text-xl font-bold ${p.quantity === 0 ? 'text-red-500' : 'text-amber-500'}`}>{p.quantity === 0 ? 'OUT' : p.quantity}</div>
            </div>
          ))}
        </div>
      </Modal>

      {/* New Stock Take Modal */}
      <Modal open={modal} onClose={() => setModal(false)} title="New Stock Take"
        footer={<><button onClick={() => setModal(false)} className="h-11 px-5 border border-stone-300 rounded-xl text-sm font-semibold text-stone-600">Cancel</button><button onClick={saveTake} className="flex-1 h-11 bg-gray-700 text-white rounded-xl text-sm font-bold">Save</button></>}>
        <div className="space-y-4">
          <div className="bg-gray-50 rounded-xl p-3 text-sm text-gray-800">Enter physical count. Leave blank to skip. Variances auto-calculated.</div>
          <input className="w-full h-11 px-4 bg-gray-50 border border-gray-200 rounded-xl text-sm" placeholder="Notes..." value={notes} onChange={e => setNotes(e.target.value)} />
          <input className="w-full h-11 px-4 bg-gray-50 border border-gray-200 rounded-xl text-sm" placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)} />
          {filteredCounts.map((c, i) => {
            const ri = counts.indexOf(c); const v = c.countedQty !== '' ? c.variance : null
            return (
              <div key={ri} className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl">
                <div className="flex-1 min-w-0"><div className="text-sm font-semibold">{c.name}</div><div className="text-xs text-gray-400">System: <b>{c.systemQty}</b></div></div>
                <input type="number" className="w-20 h-10 px-2 text-center border border-gray-200 rounded-lg text-sm font-bold focus:border-gray-500 focus:outline-none" placeholder="Count" value={c.countedQty} min={0} onChange={e => updateCount(ri, e.target.value)} />
                {v !== null && <span className={`w-10 text-center text-xs font-bold ${v === 0 ? 'text-green-500' : v > 0 ? 'text-blue-500' : 'text-red-500'}`}>{v === 0 ? '✓' : v > 0 ? '+' + v : v}</span>}
              </div>
            )
          })}
        </div>
      </Modal>

      {/* New Adjustment Modal */}
      <Modal open={adjModal} onClose={() => setAdjModal(false)} title="New Adjustment"
        footer={<><button onClick={() => setAdjModal(false)} className="h-11 px-5 border border-stone-300 rounded-xl text-sm font-semibold text-stone-600">Cancel</button><button onClick={saveAdj} className="flex-1 h-11 bg-gray-700 text-white rounded-xl text-sm font-bold">Save</button></>}>
        <div className="space-y-4">
          <div><label className="block text-xs font-semibold text-gray-500 mb-2">Product</label>
            <select className="w-full h-12 px-4 bg-gray-50 border border-gray-200 rounded-xl text-sm" value={adjProduct} onChange={e => setAdjProduct(e.target.value)}>
              <option value="">-- Select --</option>{products.map(p => <option key={p.id} value={p.id}>{p.name} (Stock: {p.quantity})</option>)}
            </select>
          </div>
          <div><label className="block text-xs font-semibold text-gray-500 mb-2">Quantity (+add / -remove)</label>
            <input type="number" className="w-full h-12 px-4 bg-gray-50 border border-gray-200 rounded-xl text-sm font-bold" placeholder="e.g. -3 or +5" value={adjQty} onChange={e => setAdjQty(e.target.value)} />
          </div>
          <div><label className="block text-xs font-semibold text-gray-500 mb-2">Reason</label>
            <select className="w-full h-12 px-4 bg-gray-50 border border-gray-200 rounded-xl text-sm" value={adjReason} onChange={e => setAdjReason(e.target.value)}>
              {['Damaged', 'Expired', 'Stolen', 'Returned', 'Recount', 'Gift/Sample', 'Other'].map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div><label className="block text-xs font-semibold text-gray-500 mb-2">Notes</label>
            <input className="w-full h-12 px-4 bg-gray-50 border border-gray-200 rounded-xl text-sm" placeholder="Optional notes..." value={adjNotes} onChange={e => setAdjNotes(e.target.value)} />
          </div>
        </div>
      </Modal>

      {/* View Stock Take Detail */}
      <Modal open={!!viewModal} onClose={() => setViewModal(null)} title="Stock Take Details">
        {viewModal && (<div className="space-y-3">
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="bg-gray-50 rounded-xl p-3"><div className="text-xs text-gray-400">Date</div><div className="text-sm font-bold mt-0.5">{fmtDateTime(viewModal.date)}</div></div>
            <div className="bg-gray-50 rounded-xl p-3"><div className="text-xs text-gray-400">By</div><div className="text-sm font-bold mt-0.5">{viewModal.conductedBy || '-'}</div></div>
            <div className="bg-gray-50 rounded-xl p-3"><div className="text-xs text-gray-400">Counted</div><div className="text-sm font-bold mt-0.5">{viewModal.items.length}</div></div>
          </div>
          <div className="overflow-x-auto"><table className="w-full"><thead><tr className="bg-gray-50"><th className="p-2 text-left text-[11px] font-bold text-gray-400 uppercase">Product</th><th className="p-2 text-center text-[11px] font-bold text-gray-400 uppercase">Sys</th><th className="p-2 text-center text-[11px] font-bold text-gray-400 uppercase">Count</th><th className="p-2 text-center text-[11px] font-bold text-gray-400 uppercase">Diff</th></tr></thead><tbody>
            {viewModal.items.map((it, i) => (
              <tr key={i} className="border-b border-gray-50"><td className="p-2 text-sm">{it.name}</td><td className="p-2 text-sm text-center text-gray-400">{it.systemQty}</td><td className="p-2 text-sm text-center font-bold">{it.countedQty}</td>
                <td className={`p-2 text-sm text-center font-bold ${it.variance === 0 ? 'text-green-500' : it.variance > 0 ? 'text-blue-500' : 'text-red-500'}`}>{it.variance === 0 ? '✓' : it.variance > 0 ? '+' + it.variance : it.variance}</td></tr>
            ))}
          </tbody></table></div>
        </div>)}
      </Modal>
    </div>
  )
}
