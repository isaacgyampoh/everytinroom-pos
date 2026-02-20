import { useState } from 'react'
import { useStore } from '../hooks/useStore'
import { getSupabase } from '../lib/supabase'
import { money, num, fmtDate, today } from '../lib/utils'
import Modal from '../components/Modal'
import toast from 'react-hot-toast'

export default function PromosPage() {
  const { promos, products, refreshPromos, setLoading } = useStore()
  const [modal, setModal] = useState(false)
  const [form, setForm] = useState({ id: '', name: '', startDate: '', endDate: '', items: [] })

  const isActive = (p) => { const t = today(); return p.active && p.startDate <= t && p.endDate >= t }
  const activeCount = promos.filter(isActive).length

  const openNew = () => { setForm({ id: '', name: '', startDate: today(), endDate: '', items: [] }); setModal(true) }
  const openEdit = (p) => { setForm({ id: p.id, name: p.name, startDate: p.startDate || '', endDate: p.endDate || '', items: [...p.items] }); setModal(true) }

  const addItem = (productId) => {
    if (!productId) return
    const p = products.find(x => x.id === productId)
    if (!p) return
    const items = [...form.items]
    if (items.find(x => x.productId === productId)) return
    items.push({ productId, name: p.name, originalPrice: p.price, promoPrice: '' })
    setForm({ ...form, items })
  }

  const save = async () => {
    if (!form.name.trim() || !form.startDate || !form.endDate || !form.items.length) { toast.error('Fill all fields'); return }
    for (const it of form.items) { if (!num(it.promoPrice)) { toast.error('Set promo price for ' + it.name); return } }
    setLoading(true, 'Saving...'); const sb = getSupabase()
    const data = { name: form.name.trim(), start_date: form.startDate, end_date: form.endDate, items: form.items.map(i => ({ productId: i.productId, name: i.name, originalPrice: num(i.originalPrice), promoPrice: num(i.promoPrice) })), active: true }
    if (form.id) await sb.from('promos').update(data).eq('id', form.id)
    else await sb.from('promos').insert(data)
    await refreshPromos(); setLoading(false); setModal(false); toast.success('Saved!')
  }

  const toggleActive = async (id, active) => {
    const sb = getSupabase(); await sb.from('promos').update({ active: !active }).eq('id', id); refreshPromos()
  }
  const del = async (id) => {
    if (!confirm('Delete?')) return; setLoading(true); const sb = getSupabase()
    await sb.from('promos').delete().eq('id', id); await refreshPromos(); setLoading(false); toast.success('Deleted!')
  }

  return (
    <div className="animate-fade">
      <div className="flex justify-between items-start flex-wrap gap-4 mb-6">
        <div><h1 className="text-3xl font-extrabold">🏷️ Promotions</h1><p className="text-gray-500">Temporary pricing without changing base prices</p></div>
        <button onClick={openNew} className="h-12 px-5 bg-brand-500 text-white rounded-xl text-sm font-semibold">➕ New Promo</button>
      </div>
      <div className="bg-orange-500 rounded-3xl p-7 text-white mb-6"><small className="text-sm opacity-80">Active Promos</small><strong className="block text-4xl font-extrabold mt-2">{activeCount}</strong></div>

      <div className="space-y-4">
        {promos.length === 0 && <div className="text-center py-12 text-gray-400"><span className="text-5xl block mb-3 opacity-30">🏷️</span>No promotions</div>}
        {promos.map(p => {
          const active = isActive(p)
          return (
            <div key={p.id} className={`bg-white rounded-3xl p-6 shadow-md border-l-4 ${active ? 'border-orange-500' : 'border-gray-300 opacity-60'}`}>
              <div className="flex justify-between items-start flex-wrap gap-3 mb-4">
                <div>
                  <h3 className="text-lg font-bold">{p.name}</h3>
                  <p className="text-sm text-gray-500">{fmtDate(p.startDate)} → {fmtDate(p.endDate)}</p>
                </div>
                <div className="flex gap-2">
                  <span className={`px-3 py-1.5 rounded-full text-xs font-bold ${active ? 'bg-orange-50 text-orange-500' : 'bg-gray-100 text-gray-500'}`}>{active ? '🟢 Active' : '⚪ Inactive'}</span>
                </div>
              </div>
              <div className="mb-4">
                {p.items.map((it, i) => (
                  <div key={i} className="flex justify-between py-2 border-b border-dashed border-gray-100 last:border-0 text-sm">
                    <span>{it.name}</span>
                    <span><s className="text-gray-400 mr-2">{money(it.originalPrice)}</s><b className="text-orange-500">{money(it.promoPrice)}</b></span>
                  </div>
                ))}
              </div>
              <div className="flex gap-2">
                <button onClick={() => toggleActive(p.id, p.active)} className={`h-9 px-3 rounded-lg text-xs font-semibold ${p.active ? 'bg-gray-100' : 'bg-green-50 text-green-500'}`}>{p.active ? '⏸ Deactivate' : '▶️ Activate'}</button>
                <button onClick={() => openEdit(p)} className="h-9 px-3 bg-gray-100 rounded-lg text-xs font-semibold">✏️</button>
                <button onClick={() => del(p.id)} className="h-9 px-3 bg-red-50 text-red-500 rounded-lg text-xs font-semibold">🗑️</button>
              </div>
            </div>
          )
        })}
      </div>

      <Modal open={modal} onClose={() => setModal(false)} title={form.id ? 'Edit Promo' : 'New Promotion'}
        footer={<><button onClick={() => setModal(false)} className="h-12 px-5 bg-gray-100 rounded-xl text-sm font-semibold">Cancel</button><button onClick={save} className="flex-1 h-12 bg-orange-500 text-white rounded-xl text-sm font-bold">💾 Save</button></>}>
        <div className="space-y-4">
          <div><label className="block text-xs font-semibold text-gray-500 mb-2">Promo Name</label><input className="w-full h-13 px-4 bg-gray-50 border-2 border-gray-200 rounded-xl text-base" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. Weekend Special" /></div>
          <div className="grid grid-cols-2 gap-3.5">
            <div><label className="block text-xs font-semibold text-gray-500 mb-2">Start Date</label><input type="date" className="w-full h-13 px-4 bg-gray-50 border-2 border-gray-200 rounded-xl text-base" value={form.startDate} onChange={e => setForm({ ...form, startDate: e.target.value })} /></div>
            <div><label className="block text-xs font-semibold text-gray-500 mb-2">End Date</label><input type="date" className="w-full h-13 px-4 bg-gray-50 border-2 border-gray-200 rounded-xl text-base" value={form.endDate} onChange={e => setForm({ ...form, endDate: e.target.value })} /></div>
          </div>
          <div><label className="block text-xs font-semibold text-gray-500 mb-2">Add Products</label>
            <select className="w-full h-13 px-4 bg-gray-50 border-2 border-gray-200 rounded-xl text-base" onChange={e => { addItem(e.target.value); e.target.value = '' }}><option value="">-- Select product --</option>{products.map(p => <option key={p.id} value={p.id}>{p.name} ({money(p.price)})</option>)}</select>
          </div>
          <div className="bg-gray-50 rounded-xl p-3 min-h-[60px]">
            {form.items.length === 0 ? <div className="text-center text-gray-400 py-5">No products added</div> : form.items.map((it, i) => (
              <div key={i} className="flex items-center gap-2.5 p-3 bg-white rounded-lg mb-2">
                <div className="flex-1"><div className="font-semibold text-sm">{it.name}</div><div className="text-xs text-gray-400">Original: {money(it.originalPrice)}</div></div>
                <div><label className="text-[10px] text-gray-400">Promo ₵</label><input type="number" className="w-20 h-8 px-2 text-center border-2 border-orange-300 rounded-lg text-sm font-bold text-orange-500" value={it.promoPrice} onChange={e => { const items = [...form.items]; items[i].promoPrice = e.target.value; setForm({ ...form, items }) }} /></div>
                <button onClick={() => { const items = [...form.items]; items.splice(i, 1); setForm({ ...form, items }) }} className="w-7 h-7 bg-red-50 text-red-500 rounded-md text-xs flex items-center justify-center">✕</button>
              </div>
            ))}
          </div>
        </div>
      </Modal>
    </div>
  )
}
