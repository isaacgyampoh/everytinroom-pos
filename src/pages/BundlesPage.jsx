import { useState } from 'react'
import { useStore } from '../hooks/useStore'
import { getSupabase } from '../lib/supabase'
import { money, num } from '../lib/utils'
import Modal from '../components/Modal'
import toast from 'react-hot-toast'

export default function BundlesPage() {
  const { bundles, products, refreshBundles, setLoading } = useStore()
  const [modal, setModal] = useState(false)
  const [form, setForm] = useState({ id: '', name: '', price: '', items: [] })

  const openNew = () => { setForm({ id: '', name: '', price: '', items: [] }); setModal(true) }
  const openEdit = (b) => { setForm({ id: b.id, name: b.name, price: b.bundlePrice, items: [...b.products] }); setModal(true) }

  const addItem = (productId) => {
    if (!productId) return
    const items = [...form.items]; const ex = items.find(x => x.productId === productId)
    if (ex) ex.qty++; else items.push({ productId, qty: 1 })
    setForm({ ...form, items })
  }

  const save = async () => {
    if (!form.name.trim() || !form.items.length || !num(form.price)) { toast.error('Fill all fields'); return }
    setLoading(true, 'Saving...'); const sb = getSupabase()
    const data = { name: form.name.trim(), bundle_price: num(form.price), products: form.items, active: true }
    if (form.id) await sb.from('bundles').update(data).eq('id', form.id)
    else await sb.from('bundles').insert(data)
    await refreshBundles(); setLoading(false); setModal(false); toast.success('Saved!')
  }
  const del = async (id) => {
    if (!confirm('Delete?')) return; setLoading(true); const sb = getSupabase()
    await sb.from('bundles').delete().eq('id', id)
    await refreshBundles(); setLoading(false); toast.success('Deleted!')
  }

  return (
    <div >
      <div className="flex justify-between items-start flex-wrap gap-4 mb-6">
        <h1 className="text-[22px] md:text-[26px] font-bold">Bundles</h1>
        <button onClick={openNew} className="h-12 px-5 bg-gray-700 text-white rounded-xl text-sm font-semibold">Create</button>
      </div>
      <div className="bg-white rounded-2xl p-6 shadow-md overflow-x-auto">
        <table className="w-full min-w-[400px]">
          <thead><tr><th className="p-3 bg-gray-50 text-left text-[11px] font-bold text-gray-500 uppercase">Bundle</th><th className="p-3 bg-gray-50 text-left text-[11px] font-bold text-gray-500 uppercase">Products</th><th className="p-3 bg-gray-50 text-left text-[11px] font-bold text-gray-500 uppercase">Price</th><th className="p-3 bg-gray-50 text-left text-[11px] font-bold text-gray-500 uppercase">Status</th><th className="p-3 bg-gray-50"></th></tr></thead>
          <tbody>{bundles.length === 0 ? <tr><td colSpan={5} className="text-center py-12 text-gray-400">No bundles</td></tr> : bundles.map(b => {
            const names = b.products.map(p => { const pr = products.find(x => x.id === p.productId); return pr ? p.qty + 'x ' + pr.name : '?' }).join(', ')
            return (<tr key={b.id} className="border-b border-gray-50"><td className="p-3 text-sm font-semibold">{b.name}</td><td className="p-3 text-xs text-gray-500">{names}</td><td className="p-3 text-gray-600 font-bold text-sm">{money(b.bundlePrice)}</td><td className="p-3"><span className={`px-2.5 py-1 rounded-lg text-[11px] font-bold ${b.active ? 'bg-green-50 text-green-500' : 'bg-red-50 text-red-500'}`}>{b.active ? 'Active' : 'Off'}</span></td><td className="p-3"><div className="flex gap-2"><button onClick={() => openEdit(b)} className="h-9 px-3 border border-stone-300 rounded-lg text-xs font-medium text-stone-600 hover:bg-stone-100 transition">Edit</button><button onClick={() => del(b.id)} className="h-9 px-3 bg-red-500 text-white rounded-lg text-xs font-medium hover:bg-red-600 transition">Delete</button></div></td></tr>)
          })}</tbody>
        </table>
      </div>
      <Modal open={modal} onClose={() => setModal(false)} title={form.id ? 'Edit Bundle' : 'Create Bundle'}
        footer={<><button onClick={() => setModal(false)} className="h-12 px-5 border border-stone-300 rounded-xl text-sm font-semibold text-stone-600">Cancel</button><button onClick={save} className="flex-1 h-12 bg-gray-700 text-white rounded-xl text-sm font-bold">Save</button></>}>
        <div className="space-y-4">
          <div><label className="block text-xs font-semibold text-gray-500 mb-2">Name</label><input className="w-full h-13 px-4 bg-gray-50 border-2 border-gray-200 rounded-xl text-base" value={form.name} onChange={e => setForm({...form, name: e.target.value})} /></div>
          <div><label className="block text-xs font-semibold text-gray-500 mb-2">Price (GHS)</label><input type="number" className="w-full h-13 px-4 bg-gray-50 border-2 border-gray-200 rounded-xl text-base" value={form.price} onChange={e => setForm({...form, price: e.target.value})} /></div>
          <div><label className="block text-xs font-semibold text-gray-500 mb-2">Add Products</label>
            <select className="w-full h-13 px-4 bg-gray-50 border-2 border-gray-200 rounded-xl text-base" onChange={e => { addItem(e.target.value); e.target.value = '' }}><option value="">-- Select --</option>{products.map(p => <option key={p.id} value={p.id}>{p.name} ({money(p.price)})</option>)}</select></div>
          <div className="bg-gray-50 rounded-xl p-3 min-h-[60px]">
            {form.items.length === 0 ? <div className="text-center text-gray-400 py-5">No products added</div> : form.items.map((it, i) => {
              const p = products.find(x => x.id === it.productId)
              return p ? <div key={i} className="flex items-center gap-2.5 p-2.5 bg-white rounded-lg mb-2"><span className="flex-1 font-semibold text-sm">{p.name}</span><input type="number" value={it.qty} min={1} className="w-12 h-8 text-center border-2 border-gray-200 rounded-lg text-sm font-semibold" onChange={e => { const items = [...form.items]; items[i].qty = parseInt(e.target.value) || 1; setForm({...form, items}) }} /><button onClick={() => { const items = [...form.items]; items.splice(i, 1); setForm({...form, items}) }} className="w-7 h-7 bg-red-50 text-red-500 rounded-md text-xs flex items-center justify-center">✕</button></div> : null
            })}
          </div>
        </div>
      </Modal>
    </div>
  )
}
