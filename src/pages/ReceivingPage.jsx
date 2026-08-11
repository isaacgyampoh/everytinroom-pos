import { useState, useMemo, useEffect } from 'react'
import { useStore } from '../hooks/useStore'
import { getSupabase } from '../lib/supabase'
import { money, num } from '../lib/utils'
import toast from 'react-hot-toast'

// Supplier receiving. Warehouse staff create a delivery record (expected vs
// actually received -> variance). Stock does NOT change until an admin approves.
export default function ReceivingPage() {
  const { products, refreshProducts, user, isAdmin, can } = useStore()
  const sb = getSupabase()

  const [tab, setTab] = useState('new')        // new | pending | history
  const [supplier, setSupplier] = useState('')
  const [note, setNote] = useState('')
  const [query, setQuery] = useState('')
  const [items, setItems] = useState([])       // {productId,name,expected,received,costPrice}
  const [saving, setSaving] = useState(false)
  const [records, setRecords] = useState([])

  const canApprove = isAdmin || can('admin')

  const load = async () => {
    const { data } = await sb.from('receivings').select('*').order('created_at', { ascending: false }).limit(100)
    setRecords(data || [])
  }
  useEffect(() => { load() }, []) // eslint-disable-line

  const filtered = useMemo(() => {
    if (!query.trim()) return []
    const q = query.toLowerCase()
    return products.filter(p => p.name.toLowerCase().includes(q)).slice(0, 8)
  }, [products, query])

  const addItem = (p) => {
    if (items.find(i => i.productId === p.id)) { toast('Already added'); return }
    setItems([...items, { productId: p.id, name: p.name, expected: '', received: '', costPrice: p.costPrice }])
    setQuery('')
  }
  const upd = (i, field, val) => { const u = [...items]; u[i][field] = val; setItems(u) }
  const rm = (i) => { const u = [...items]; u.splice(i, 1); setItems(u) }

  const submit = async () => {
    const valid = items.filter(i => num(i.received) > 0 || num(i.expected) > 0)
    if (!supplier.trim()) { toast.error('Enter the supplier name'); return }
    if (valid.length === 0) { toast.error('Add products and quantities'); return }
    setSaving(true)
    const payload = valid.map(i => ({
      product_id: i.productId, name: i.name,
      expected: num(i.expected) || 0, received: num(i.received) || 0,
      variance: (num(i.received) || 0) - (num(i.expected) || 0),
      cost_price: num(i.costPrice) || 0,
    }))
    const ref = 'RCV-' + Date.now().toString(36).toUpperCase()
    const { error } = await sb.from('receivings').insert({
      ref_no: ref, supplier_name: supplier.trim(), status: 'pending', items: JSON.stringify(payload),
      total_expected: payload.reduce((a, x) => a + x.expected, 0),
      total_received: payload.reduce((a, x) => a + x.received, 0),
      note: note.trim(), created_by: user?.name || 'Staff',
    })
    setSaving(false)
    if (error) { toast.error('Failed: ' + error.message); return }
    toast.success('Receiving submitted for approval')
    setItems([]); setSupplier(''); setNote(''); setTab('pending'); load()
  }

  const approve = async (rec) => {
    if (!confirm(`Approve ${rec.ref_no}? This will add the received quantities to stock.`)) return
    const { data, error } = await sb.rpc('approve_receiving', { p_id: rec.id, p_approver: user?.name || 'Admin' })
    if (error || !data?.success) { toast.error('Approve failed: ' + (error?.message || data?.error)); return }
    toast.success(`Approved — ${data.applied} product(s) stocked`)
    await refreshProducts(); load()
  }
  const reject = async (rec) => {
    const reason = prompt('Reason for rejecting?') || ''
    await sb.from('receivings').update({ status: 'rejected', reject_reason: reason, approved_by: user?.name || 'Admin', approved_at: new Date().toISOString() }).eq('id', rec.id)
    toast.success('Rejected'); load()
  }

  const pending = records.filter(r => r.status === 'pending')
  const done = records.filter(r => r.status !== 'pending')
  const parseItems = (r) => { try { return typeof r.items === 'string' ? JSON.parse(r.items) : (r.items || []) } catch { return [] } }

  return (
    <div className="max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-[22px] md:text-[26px] font-bold">Supplier Receiving</h1>
        <p className="text-xs text-gray-500 mt-1">Record deliveries — stock updates only after approval</p>
      </div>

      <div className="flex gap-2 mb-5">
        <button onClick={() => setTab('new')} className={`h-9 px-4 rounded-lg text-xs font-semibold ${tab === 'new' ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-500'}`}>New Receiving</button>
        <button onClick={() => setTab('pending')} className={`h-9 px-4 rounded-lg text-xs font-semibold ${tab === 'pending' ? 'bg-amber-500 text-white' : 'bg-gray-100 text-gray-500'}`}>Pending {pending.length > 0 && `(${pending.length})`}</button>
        <button onClick={() => setTab('history')} className={`h-9 px-4 rounded-lg text-xs font-semibold ${tab === 'history' ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-500'}`}>History</button>
      </div>

      {tab === 'new' && (
        <div className="bg-white rounded-2xl p-5 shadow-md space-y-4">
          <div><label className="block text-xs font-semibold text-gray-500 mb-2">Supplier name</label><input className="w-full h-12 px-4 bg-gray-50 border-2 border-gray-200 rounded-xl text-base" value={supplier} onChange={e => setSupplier(e.target.value)} placeholder="e.g. Kofi Imports" /></div>

          <div className="relative">
            <label className="block text-xs font-semibold text-gray-500 mb-2">Add products</label>
            <input className="w-full h-12 px-4 bg-gray-50 border-2 border-gray-200 rounded-xl text-base" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search product…" />
            {filtered.length > 0 && (
              <div className="absolute z-10 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg max-h-60 overflow-y-auto">
                {filtered.map(p => (
                  <button key={p.id} onClick={() => addItem(p)} className="w-full text-left px-4 py-2.5 hover:bg-gray-50 text-sm flex justify-between">
                    <span>{p.name}</span><span className="text-gray-400">stock: {p.quantity}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {items.length > 0 && (
            <div className="space-y-2">
              <div className="grid grid-cols-[1fr_70px_70px_60px_32px] gap-2 text-[10px] font-bold text-gray-400 uppercase px-1">
                <span>Product</span><span className="text-center">Expected</span><span className="text-center">Received</span><span className="text-center">Var.</span><span></span>
              </div>
              {items.map((it, i) => {
                const variance = (num(it.received) || 0) - (num(it.expected) || 0)
                return (
                  <div key={it.productId} className="grid grid-cols-[1fr_70px_70px_60px_32px] gap-2 items-center">
                    <span className="text-sm font-medium truncate">{it.name}</span>
                    <input type="tel" value={it.expected} onChange={e => upd(i, 'expected', e.target.value.replace(/\D/g,''))} className="h-10 text-center bg-gray-50 border-2 border-gray-200 rounded-lg text-sm" />
                    <input type="tel" value={it.received} onChange={e => upd(i, 'received', e.target.value.replace(/\D/g,''))} className="h-10 text-center bg-gray-50 border-2 border-gray-200 rounded-lg text-sm" />
                    <span className={`text-center text-sm font-bold ${variance < 0 ? 'text-red-500' : variance > 0 ? 'text-amber-500' : 'text-gray-400'}`}>{variance > 0 ? '+' : ''}{variance || 0}</span>
                    <button onClick={() => rm(i)} className="text-gray-300 hover:text-red-500 text-lg">×</button>
                  </div>
                )
              })}
            </div>
          )}

          <div><label className="block text-xs font-semibold text-gray-500 mb-2">Note (optional)</label><input className="w-full h-11 px-4 bg-gray-50 border-2 border-gray-200 rounded-xl text-sm" value={note} onChange={e => setNote(e.target.value)} placeholder="Any note about this delivery" /></div>

          <button onClick={submit} disabled={saving} className="w-full h-12 bg-gray-900 text-white rounded-xl text-sm font-bold disabled:opacity-50">{saving ? 'Submitting…' : 'Submit for Approval'}</button>
        </div>
      )}

      {(tab === 'pending' || tab === 'history') && (
        <div className="space-y-3">
          {(tab === 'pending' ? pending : done).length === 0 && <p className="text-sm text-gray-400 text-center py-10">Nothing here</p>}
          {(tab === 'pending' ? pending : done).map(r => (
            <div key={r.id} className="bg-white rounded-2xl p-4 shadow-md">
              <div className="flex items-start justify-between flex-wrap gap-2">
                <div>
                  <div className="font-bold text-sm">{r.supplier_name} <span className="text-gray-400 font-normal">· {r.ref_no}</span></div>
                  <div className="text-[11px] text-gray-400">By {r.created_by} · {new Date(r.created_at).toLocaleString('en-GB')}</div>
                </div>
                <span className={`text-[10px] font-bold px-2 py-1 rounded ${r.status === 'pending' ? 'bg-amber-100 text-amber-700' : r.status === 'approved' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>{r.status.toUpperCase()}</span>
              </div>
              <div className="mt-3 space-y-1">
                {parseItems(r).map((it, i) => (
                  <div key={i} className="flex justify-between text-xs text-gray-600">
                    <span className="truncate">{it.name}</span>
                    <span className="shrink-0 ml-2">exp {it.expected} · rec <b>{it.received}</b>{it.variance !== 0 && <span className={it.variance < 0 ? 'text-red-500' : 'text-amber-500'}> ({it.variance > 0 ? '+' : ''}{it.variance})</span>}</span>
                  </div>
                ))}
              </div>
              {r.note && <div className="mt-2 text-[11px] text-gray-400">Note: {r.note}</div>}
              {r.status === 'rejected' && r.reject_reason && <div className="mt-2 text-[11px] text-red-500">Rejected: {r.reject_reason}</div>}
              {r.status === 'approved' && <div className="mt-2 text-[11px] text-green-600">Approved by {r.approved_by}</div>}
              {r.status === 'pending' && canApprove && (
                <div className="flex gap-2 mt-3">
                  <button onClick={() => approve(r)} className="flex-1 h-10 bg-green-600 text-white rounded-lg text-xs font-bold">Approve & Add to Stock</button>
                  <button onClick={() => reject(r)} className="h-10 px-4 border border-red-300 text-red-500 rounded-lg text-xs font-bold">Reject</button>
                </div>
              )}
              {r.status === 'pending' && !canApprove && <div className="mt-3 text-[11px] text-amber-600">Waiting for admin approval</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
