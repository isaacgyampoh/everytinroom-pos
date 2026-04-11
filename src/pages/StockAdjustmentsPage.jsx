import { useState } from 'react'
import { useStore } from '../hooks/useStore'
import { getSupabase } from '../lib/supabase'
import { fmtDateTime, money } from '../lib/utils'
import Modal from '../components/Modal'
import toast from 'react-hot-toast'

const REASONS = ['Damaged', 'Broken', 'Missing', 'Expired', 'Theft', 'Returned to Supplier', 'Other']

export default function StockAdjustmentsPage() {
  const { stockAdjustments, products, user, refreshStockAdjustments, refreshProducts, setLoading } = useStore()
  const [modal, setModal] = useState(false)
  const [search, setSearch] = useState('')
  const [form, setForm] = useState({ productId: '', qty: '', reason: 'Damaged', notes: '' })
  const [filterReason, setFilterReason] = useState('all')

  const selectedProduct = products.find(p => p.id === form.productId)

  const save = async () => {
    if (!form.productId) { toast.error('Select a product'); return }
    const qty = parseInt(form.qty)
    if (!qty || qty < 1) { toast.error('Enter valid quantity'); return }
    if (!form.reason) { toast.error('Select a reason'); return }

    const product = products.find(p => p.id === form.productId)
    if (!product) { toast.error('Product not found'); return }
    if (qty > product.quantity) { toast.error('Quantity exceeds current stock (' + product.quantity + ')'); return }

    if (!confirm(`Remove ${qty} x ${product.name}?\nReason: ${form.reason}\nThis will deduct from stock.`)) return

    setLoading(true, 'Recording adjustment...')
    const sb = getSupabase()

    // Insert adjustment record
    await sb.from('stock_adjustments').insert({
      date: new Date().toISOString(),
      product_id: form.productId,
      product_name: product.name,
      qty: -qty, // Negative because we're removing
      reason: form.reason,
      notes: form.notes.trim() || '',
      adjusted_by: user?.name || '',
    })

    // Deduct from product stock
    await sb.from('products').update({ quantity: product.quantity - qty }).eq('id', form.productId)

    await refreshStockAdjustments()
    await refreshProducts()
    setLoading(false)
    setModal(false)
    setForm({ productId: '', qty: '', reason: 'Damaged', notes: '' })
    toast.success(`${qty} x ${product.name} removed — ${form.reason}`)
  }

  const filteredAdj = filterReason === 'all'
    ? stockAdjustments
    : stockAdjustments.filter(a => a.reason === filterReason)

  const totalLost = stockAdjustments.filter(a => a.qty < 0).reduce((acc, a) => acc + Math.abs(a.qty), 0)

  // Estimate value lost
  const valueLost = stockAdjustments.filter(a => a.qty < 0).reduce((acc, a) => {
    const p = products.find(pr => pr.id === a.productId)
    return acc + (p ? p.costPrice * Math.abs(a.qty) : 0)
  }, 0)

  const filteredProducts = products.filter(p =>
    p.name.toLowerCase().includes(search.toLowerCase()) ||
    (p.category || '').toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div >
      <div className="flex justify-between items-start flex-wrap gap-4 mb-5">
        <div>
          <h1 className="text-[22px] md:text-[26px] font-bold tracking-tight">Stock Adjustments</h1>
          <p className="text-gray-400 text-sm mt-0.5">Record damaged, broken, or missing items</p>
        </div>
        <button onClick={() => { setForm({ productId: '', qty: '', reason: 'Damaged', notes: '' }); setSearch(''); setModal(true) }}
          className="h-11 px-5 bg-red-500 text-white rounded-xl text-sm font-semibold hover:bg-red-600 active:scale-[.97] transition">
          Record Adjustment
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        <div className="bg-white rounded-2xl p-4 md:p-5 border border-gray-100 text-center">
          <div className="text-xs md:text-sm text-gray-400 font-medium">Total Adjustments</div>
          <div className="text-[22px] md:text-[26px] font-bold mt-1">{stockAdjustments.length}</div>
        </div>
        <div className="bg-white rounded-2xl p-4 md:p-5 border border-gray-100 text-center">
          <div className="text-xs md:text-sm text-gray-400 font-medium">Items Lost</div>
          <div className="text-[22px] md:text-[26px] font-bold text-red-500 mt-1">{totalLost}</div>
        </div>
        <div className="bg-white rounded-2xl p-4 md:p-5 border border-gray-100 text-center">
          <div className="text-xs md:text-sm text-gray-400 font-medium">Value Lost (Cost)</div>
          <div className="text-xl md:text-2xl font-bold text-red-500 mt-1">{money(valueLost)}</div>
        </div>
      </div>

      {/* Filter */}
      <div className="flex gap-2 overflow-x-auto mb-4 pb-1 scrollbar-hide">
        <button onClick={() => setFilterReason('all')}
          className={`h-9 px-4 rounded-full text-sm font-semibold whitespace-nowrap transition-all ${filterReason === 'all' ? 'bg-gray-700 text-white' : 'bg-white border border-gray-200 text-gray-500'}`}>
          All
        </button>
        {REASONS.map(r => (
          <button key={r} onClick={() => setFilterReason(r)}
            className={`h-9 px-4 rounded-full text-sm font-semibold whitespace-nowrap transition-all ${filterReason === r ? 'bg-gray-700 text-white' : 'bg-white border border-gray-200 text-gray-500'}`}>
            {r}
          </button>
        ))}
      </div>

      {/* Adjustments List */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        {filteredAdj.length === 0 ? (
          <div className="text-center py-16 text-gray-300"><span className="text-xl opacity-15">—</span>No adjustments recorded</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-gray-50">
                  <th className="p-3 text-left text-[11px] font-bold text-gray-400 uppercase tracking-wide">Date</th>
                  <th className="p-3 text-left text-[11px] font-bold text-gray-400 uppercase tracking-wide">Product</th>
                  <th className="p-3 text-center text-[11px] font-bold text-gray-400 uppercase tracking-wide">Qty</th>
                  <th className="p-3 text-left text-[11px] font-bold text-gray-400 uppercase tracking-wide">Reason</th>
                  <th className="p-3 text-left text-[11px] font-bold text-gray-400 uppercase tracking-wide">Notes</th>
                  <th className="p-3 text-left text-[11px] font-bold text-gray-400 uppercase tracking-wide">By</th>
                </tr>
              </thead>
              <tbody>
                {filteredAdj.map(a => (
                  <tr key={a.id} className="border-b border-gray-50 hover:bg-gray-50/50 transition">
                    <td className="p-3 text-sm text-gray-600">{fmtDateTime(a.date)}</td>
                    <td className="p-3 text-sm font-semibold text-gray-800">{a.productName}</td>
                    <td className="p-3 text-center"><span className="px-2.5 py-1 bg-red-50 text-red-500 rounded-lg text-xs font-bold">{Math.abs(a.qty)}</span></td>
                    <td className="p-3">
                      <span className={`px-2.5 py-1 rounded-lg text-xs font-bold ${
                        a.reason === 'Damaged' ? 'bg-amber-50 text-amber-600' :
                        a.reason === 'Broken' ? 'bg-red-50 text-red-500' :
                        a.reason === 'Missing' ? 'bg-gray-100 text-gray-600' :
                        a.reason === 'Theft' ? 'bg-red-50 text-red-600' :
                        'bg-gray-100 text-gray-500'
                      }`}>{a.reason}</span>
                    </td>
                    <td className="p-3 text-sm text-gray-500">{a.notes || '-'}</td>
                    <td className="p-3 text-sm text-gray-500">{a.adjustedBy || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* New Adjustment Modal */}
      <Modal open={modal} onClose={() => setModal(false)} title="Record Stock Adjustment"
        footer={<><button onClick={() => setModal(false)} className="h-11 px-5 border border-stone-300 rounded-xl text-sm font-semibold text-stone-600">Cancel</button><button onClick={save} className="flex-1 h-11 bg-red-500 text-white rounded-xl text-sm font-bold">Remove from Stock</button></>}>
        <div className="space-y-4">
          <div className="bg-red-50 rounded-xl p-3.5 text-sm text-red-700">
            This will deduct items from stock. Use for damaged, broken, missing, or stolen goods.
          </div>

          {/* Product Search & Select */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-2">Select Product</label>
            <input className="w-full h-11 px-4 bg-gray-50 border border-gray-200 rounded-xl text-sm mb-2"
              placeholder="Search product..." value={search} onChange={e => setSearch(e.target.value)} />

            {!form.productId && (
              <div className="max-h-48 overflow-y-auto border border-gray-200 rounded-xl divide-y divide-gray-50">
                {filteredProducts.slice(0, 20).map(p => (
                  <button key={p.id} onClick={() => { setForm({ ...form, productId: p.id }); setSearch('') }}
                    className="w-full flex items-center justify-between p-3 hover:bg-gray-50 transition text-left">
                    <div>
                      <div className="text-sm font-semibold text-gray-800">{p.name}</div>
                      <div className="text-xs text-gray-400">{p.category || '-'} • Stock: {p.quantity}</div>
                    </div>
                    <span className="text-xs font-bold text-gray-400">{money(p.price)}</span>
                  </button>
                ))}
                {filteredProducts.length === 0 && <div className="p-4 text-center text-gray-400 text-sm">No products found</div>}
              </div>
            )}

            {selectedProduct && (
              <div className="flex items-center justify-between p-3 bg-gray-50 rounded-xl border border-gray-200">
                <div>
                  <div className="text-sm font-bold text-gray-800">{selectedProduct.name}</div>
                  <div className="text-xs text-gray-500">{selectedProduct.category || '-'} • Current stock: <b>{selectedProduct.quantity}</b></div>
                </div>
                <button onClick={() => setForm({ ...form, productId: '' })} className="text-xs text-red-500 font-semibold">✕ Change</button>
              </div>
            )}
          </div>

          {/* Quantity */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-2">Quantity Removed</label>
            <input type="number" className="w-full h-11 px-4 bg-gray-50 border border-gray-200 rounded-xl text-sm font-bold"
              placeholder="How many?" value={form.qty} min={1} max={selectedProduct?.quantity || 999}
              onChange={e => setForm({ ...form, qty: e.target.value })} />
          </div>

          {/* Reason */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-2">Reason</label>
            <div className="grid grid-cols-3 md:grid-cols-4 gap-2">
              {REASONS.map(r => (
                <button key={r} onClick={() => setForm({ ...form, reason: r })}
                  className={`h-10 rounded-xl text-xs font-semibold transition-all ${form.reason === r ? 'bg-gray-700 text-white' : 'bg-gray-50 border border-gray-200 text-gray-500'}`}>
                  {r}
                </button>
              ))}
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-2">Notes (optional)</label>
            <textarea className="w-full h-20 px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm resize-none"
              placeholder="e.g. Glass jar fell and broke during restocking"
              value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} />
          </div>
        </div>
      </Modal>
    </div>
  )
}
