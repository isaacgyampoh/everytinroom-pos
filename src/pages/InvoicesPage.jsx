import { useState } from 'react'
import { useStore } from '../hooks/useStore'
import { getSupabase } from '../lib/supabase'
import { money, num, fmtDate, today } from '../lib/utils'
import Modal from '../components/Modal'
import toast from 'react-hot-toast'

export default function InvoicesPage() {
  const { invoices, refreshInvoices, setLoading } = useStore()
  const [modal, setModal] = useState(false)
  const [viewImg, setViewImg] = useState(null)
  const [form, setForm] = useState({ invoiceId: '', date: '', supplier: '', amount: '', notes: '', file: null })
  const totalAmount = invoices.reduce((a, i) => a + i.amount, 0)

  const save = async () => {
    if (!form.supplier.trim() || !num(form.amount)) { toast.error('Supplier & amount required'); return }
    setLoading(true, 'Saving...')
    const sb = getSupabase(); let imageUrl = ''
    if (form.file) {
      const ext = form.file.name.split('.').pop()
      const path = `inv_${Date.now()}.${ext}`
      const { data: upData, error: upErr } = await sb.storage.from('invoice-photos').upload(path, form.file)
      if (!upErr) { const { data: urlData } = sb.storage.from('invoice-photos').getPublicUrl(path); imageUrl = urlData?.publicUrl || '' }
    }
    const invId = form.invoiceId.trim() || 'INV-' + Date.now().toString(36).toUpperCase()
    await sb.from('invoices').insert({ invoice_id: invId, date: form.date || today(), supplier: form.supplier.trim(), amount: num(form.amount), notes: form.notes.trim(), image: imageUrl })
    await refreshInvoices(); setLoading(false); setModal(false); toast.success('Invoice added!')
  }

  const del = async (id) => {
    if (!confirm('Delete?')) return; setLoading(true); const sb = getSupabase()
    await sb.from('invoices').delete().eq('id', id); await refreshInvoices(); setLoading(false); toast.success('Deleted!')
  }

  return (
    <div >
      <div className="flex justify-between items-start flex-wrap gap-4 mb-6">
        <div><h1 className="text-[22px] md:text-[26px] font-bold">Invoices</h1><p className="text-gray-500">Supplier invoices & receipts</p></div>
        <button onClick={() => { setForm({ invoiceId: '', date: today(), supplier: '', amount: '', notes: '', file: null }); setModal(true) }} className="h-12 px-5 bg-gray-700 text-white rounded-xl text-sm font-semibold">Add Invoice</button>
      </div>
      <div className="bg-gray-800 rounded-2xl p-5 text-white mb-6"><small className="text-sm opacity-80">Total Invoices Value</small><strong className="block text-[22px] md:text-[26px] font-bold mt-2">{money(totalAmount)}</strong></div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {invoices.length === 0 && <div className="col-span-full text-center py-12 text-gray-400"><span className="text-xl opacity-15">—</span>No invoices</div>}
        {invoices.map(inv => (
          <div key={inv.id} className="bg-white rounded-2xl p-5 shadow-md">
            {inv.image && (
              <div className="w-full h-40 bg-gray-100 rounded-xl mb-4 overflow-hidden cursor-pointer" onClick={() => setViewImg(inv.image)}>
                <img src={inv.image} alt="" className="w-full h-full object-cover" />
              </div>
            )}
            <div className="flex justify-between items-start mb-3">
              <div><div className="font-bold text-base">{inv.supplier}</div><div className="text-xs text-gray-400">{inv.invoiceId}</div></div>
              <span className="text-lg font-bold text-indigo-500">{money(inv.amount)}</span>
            </div>
            <div className="text-sm text-gray-500 mb-3">{fmtDate(inv.date)}</div>
            {inv.notes && <div className="text-sm text-gray-500 bg-gray-50 p-2.5 rounded-lg mb-3">{inv.notes}</div>}
            <button onClick={() => del(inv.id)} className="h-9 px-3 bg-red-500 text-white rounded-lg text-xs font-semibold hover:bg-red-600 transition">Delete</button>
          </div>
        ))}
      </div>

      {viewImg && (<div className="fixed inset-0 z-[500] flex items-center justify-center bg-black/80" onClick={() => setViewImg(null)}><img src={viewImg} className="max-w-[90vw] max-h-[90vh] rounded-xl" /><button onClick={() => setViewImg(null)} className="absolute top-6 right-6 w-12 h-12 bg-white rounded-full text-xl flex items-center justify-center">✕</button></div>)}

      <Modal open={modal} onClose={() => setModal(false)} title="Add Invoice"
        footer={<><button onClick={() => setModal(false)} className="h-12 px-5 border border-stone-300 rounded-xl text-sm font-semibold text-stone-600">Cancel</button><button onClick={save} className="flex-1 h-12 bg-gray-800 text-white rounded-xl text-sm font-bold">Save</button></>}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3.5">
            <div><label className="block text-xs font-semibold text-gray-500 mb-2">Invoice ID</label><input className="w-full h-13 px-4 bg-gray-50 border-2 border-gray-200 rounded-xl text-base" placeholder="Optional" value={form.invoiceId} onChange={e => setForm({ ...form, invoiceId: e.target.value })} /></div>
            <div><label className="block text-xs font-semibold text-gray-500 mb-2">Date</label><input type="date" className="w-full h-13 px-4 bg-gray-50 border-2 border-gray-200 rounded-xl text-base" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} /></div>
          </div>
          <div><label className="block text-xs font-semibold text-gray-500 mb-2">Supplier</label><input className="w-full h-13 px-4 bg-gray-50 border-2 border-gray-200 rounded-xl text-base" value={form.supplier} onChange={e => setForm({ ...form, supplier: e.target.value })} /></div>
          <div><label className="block text-xs font-semibold text-gray-500 mb-2">Amount (GHS)</label><input type="number" className="w-full h-13 px-4 bg-gray-50 border-2 border-gray-200 rounded-xl text-base" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} /></div>
          <div><label className="block text-xs font-semibold text-gray-500 mb-2">Notes</label><textarea className="w-full h-24 px-4 py-3 bg-gray-50 border-2 border-gray-200 rounded-xl text-base resize-none" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></div>
          <div><label className="block text-xs font-semibold text-gray-500 mb-2">Invoice Photo</label>
            <input type="file" accept="image/*" className="w-full h-13 px-4 py-3 bg-gray-50 border-2 border-gray-200 rounded-xl text-sm" onChange={e => setForm({ ...form, file: e.target.files[0] })} />
          </div>
        </div>
      </Modal>
    </div>
  )
}
