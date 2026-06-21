import { useState } from 'react'
import { useStore } from '../hooks/useStore'
import { getSupabase } from '../lib/supabase'
import { money, num, fmtDate, today } from '../lib/utils'
import Modal from '../components/Modal'
import toast from 'react-hot-toast'

export default function PromosPage() {
  const { promos, bundles, products, refreshPromos, refreshBundles, setLoading } = useStore()
  const [tab, setTab] = useState('promos')
  // Promo state
  const [modal, setModal] = useState(false)
  const [form, setForm] = useState({ id: '', name: '', startDate: '', endDate: '', items: [] })
  // Bundle state
  const [bunModal, setBunModal] = useState(false)
  const [bunForm, setBunForm] = useState({ id: '', name: '', price: '', items: [] })

  const isActive = (p) => { const t = today(); return p.active && p.startDate <= t && p.endDate >= t }
  const activeCount = promos.filter(isActive).length

  // Promo functions
  const openNewPromo = () => { setForm({ id: '', name: '', startDate: today(), endDate: '', items: [] }); setModal(true) }
  const openEditPromo = (p) => { setForm({ id: p.id, name: p.name, startDate: p.startDate || '', endDate: p.endDate || '', items: [...p.items] }); setModal(true) }
  const addPromoItem = (pid) => {
    if (!pid) return; const p = products.find(x => x.id === pid); if (!p) return
    const items = [...form.items]; if (items.find(x => x.productId === pid)) return
    items.push({ productId: pid, name: p.name, originalPrice: p.price, promoPrice: '' }); setForm({ ...form, items })
  }
  const savePromo = async () => {
    if (!form.name.trim() || !form.startDate || !form.endDate || !form.items.length) { toast.error('Fill all fields'); return }
    for (const it of form.items) { if (!num(it.promoPrice)) { toast.error('Set price for ' + it.name); return } }
    setLoading(true, 'Saving...'); const sb = getSupabase()
    const data = { name: form.name.trim(), start_date: form.startDate, end_date: form.endDate, items: form.items.map(i => ({ productId: i.productId, name: i.name, originalPrice: num(i.originalPrice), promoPrice: num(i.promoPrice) })), active: true }
    if (form.id) await sb.from('promos').update(data).eq('id', form.id); else await sb.from('promos').insert(data)
    await refreshPromos(); setLoading(false); setModal(false); toast.success('Saved')
  }
  const togglePromo = async (id, active) => { const sb = getSupabase(); await sb.from('promos').update({ active: !active }).eq('id', id); refreshPromos() }
  const delPromo = async (id) => { if (!confirm('Delete?')) return; setLoading(true); await getSupabase().from('promos').delete().eq('id', id); await refreshPromos(); setLoading(false); toast.success('Deleted') }

  // Bundle functions
  const openNewBundle = () => { setBunForm({ id: '', name: '', price: '', items: [] }); setBunModal(true) }
  const openEditBundle = (b) => { setBunForm({ id: b.id, name: b.name, price: b.bundlePrice, items: [...b.products] }); setBunModal(true) }
  const addBunItem = (pid) => { if (!pid) return; const items = [...bunForm.items]; const ex = items.find(x => x.productId === pid); if (ex) ex.qty++; else items.push({ productId: pid, qty: 1 }); setBunForm({ ...bunForm, items }) }
  const saveBundle = async () => {
    if (!bunForm.name.trim() || !bunForm.items.length || !num(bunForm.price)) { toast.error('Fill all fields'); return }
    setLoading(true, 'Saving...'); const sb = getSupabase()
    const data = { name: bunForm.name.trim(), bundle_price: num(bunForm.price), products: bunForm.items, active: true }
    if (bunForm.id) await sb.from('bundles').update(data).eq('id', bunForm.id); else await sb.from('bundles').insert(data)
    await refreshBundles(); setLoading(false); setBunModal(false); toast.success('Saved')
  }
  const delBundle = async (id) => { if (!confirm('Delete?')) return; setLoading(true); await getSupabase().from('bundles').delete().eq('id', id); await refreshBundles(); setLoading(false); toast.success('Deleted') }

  return (
    <div >
      <div className="flex justify-between items-start flex-wrap gap-4 mb-5">
        <div>
          <h1 className="text-[22px] md:text-[26px] font-bold tracking-tight">Promos Promos & Bundles Bundles</h1>
          <p className="text-gray-400 text-sm mt-0.5">Manage promotions and product bundles</p>
        </div>
        <div className="flex gap-2">
          {tab === 'promos' && <button onClick={openNewPromo} className="h-11 px-5 bg-gray-700 text-white rounded-xl text-sm font-semibold hover:bg-gray-800 transition">New Promo</button>}
          {tab === 'bundles' && <button onClick={openNewBundle} className="h-11 px-5 bg-gray-700 text-white rounded-xl text-sm font-semibold hover:bg-gray-800 transition">New Bundle</button>}
        </div>
      </div>

      {/* Hero stat */}
      <div className="grid grid-cols-2 gap-3 mb-5">
        <div className="bg-gray-800 rounded-2xl p-5 text-white relative overflow-hidden">
          <div className="relative z-10"><div className="text-xs opacity-70">Active Promos</div><div className="text-[22px] md:text-[26px] font-bold mt-1">{activeCount}</div></div>
        </div>
        <div className="bg-gray-800 rounded-2xl p-5 text-white relative overflow-hidden">
          <div className="relative z-10"><div className="text-xs opacity-70">Active Bundles</div><div className="text-[22px] md:text-[26px] font-bold mt-1">{bundles.filter(b => b.active).length}</div></div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-white rounded-2xl p-1 mb-5 border border-gray-100 w-fit">
        <button onClick={() => setTab('promos')} className={`h-9 px-5 rounded-xl text-sm font-semibold transition ${tab === 'promos' ? 'bg-gray-800 text-white' : 'text-stone-500 hover:text-stone-700'}`}>Promos</button>
        <button onClick={() => setTab('bundles')} className={`h-9 px-5 rounded-xl text-sm font-semibold transition ${tab === 'bundles' ? 'bg-gray-800 text-white' : 'text-stone-500 hover:text-stone-700'}`}>Bundles</button>
      </div>

      {/* Promos Tab */}
      {tab === 'promos' && (
        <div className="space-y-3">
          {promos.length === 0 && <div className="text-center py-16 text-gray-300"><span className="text-xl opacity-15">—</span>No promotions</div>}
          {promos.map(p => {
            const active = isActive(p)
            return (
              <div key={p.id} className={`bg-white rounded-2xl p-5 border-l-4 ${active ? 'border-gray-500' : 'border-gray-300 opacity-60'}`}>
                <div className="flex justify-between items-start flex-wrap gap-3 mb-3">
                  <div><h3 className="font-bold">{p.name}</h3><p className="text-xs text-gray-400">{fmtDate(p.startDate)} → {fmtDate(p.endDate)}</p></div>
                  <span className={`px-3 py-1 rounded-full text-xs font-bold ${active ? 'bg-gray-50 text-gray-700' : 'bg-gray-100 text-gray-500'}`}>{active ? 'Active' : 'Off'}</span>
                </div>
                {p.items.map((it, i) => (
                  <div key={i} className="flex justify-between py-1.5 border-b border-dashed border-gray-100 last:border-0 text-sm">
                    <span>{it.name}</span><span><s className="text-gray-400 mr-2">{money(it.originalPrice)}</s><b className="text-gray-700">{money(it.promoPrice)}</b></span>
                  </div>
                ))}
                <div className="flex gap-2 mt-3">
                  <button onClick={() => togglePromo(p.id, p.active)} className={`h-8 px-3 rounded-lg text-xs font-semibold ${p.active ? 'bg-gray-100' : 'bg-green-50 text-green-500'}`}>{p.active ? 'Deactivate' : 'Activate'}</button>
                  <button onClick={() => openEditPromo(p)} className="h-8 px-3 border border-stone-300 rounded-lg text-xs font-medium text-stone-600 hover:bg-stone-100 transition">Edit</button>
                  <button onClick={() => delPromo(p.id)} className="h-8 px-3 bg-[#c0492f] text-white rounded-lg text-xs font-medium hover:bg-[#a83d27] transition">Delete</button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Bundles Tab */}
      {tab === 'bundles' && (
        <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
          <table className="w-full min-w-[400px]">
            <thead><tr><th className="p-3 bg-gray-50 text-left text-[11px] font-bold text-gray-400 uppercase">Bundle</th><th className="p-3 bg-gray-50 text-left text-[11px] font-bold text-gray-400 uppercase">Products</th><th className="p-3 bg-gray-50 text-left text-[11px] font-bold text-gray-400 uppercase">Price</th><th className="p-3 bg-gray-50"></th></tr></thead>
            <tbody>{bundles.length === 0 ? <tr><td colSpan={4} className="text-center py-16 text-gray-300">No bundles</td></tr> : bundles.map(b => {
              const names = b.products.map(p => { const pr = products.find(x => x.id === p.productId); return pr ? p.qty + 'x ' + pr.name : '?' }).join(', ')
              return (<tr key={b.id} className="border-b border-gray-50"><td className="p-3 text-sm font-semibold">{b.name}</td><td className="p-3 text-xs text-gray-500 max-w-[200px] truncate">{names}</td><td className="p-3 font-bold text-sm">{money(b.bundlePrice)}</td><td className="p-3"><div className="flex gap-2"><button onClick={() => openEditBundle(b)} className="h-8 px-3 border border-stone-300 rounded-lg text-xs font-medium text-stone-600 hover:bg-stone-100 transition">Edit</button><button onClick={() => delBundle(b.id)} className="h-8 px-3 bg-[#c0492f] text-white rounded-lg text-xs font-medium hover:bg-[#a83d27] transition">Delete</button></div></td></tr>)
            })}</tbody>
          </table>
        </div>
      )}

      {/* Promo Modal */}
      <Modal open={modal} onClose={() => setModal(false)} title={form.id ? 'Edit Promo' : 'New Promo'}
        footer={<><button onClick={() => setModal(false)} className="h-11 px-5 border border-stone-300 rounded-xl text-sm font-semibold text-stone-600">Cancel</button><button onClick={savePromo} className="flex-1 h-11 bg-gray-700 text-white rounded-xl text-sm font-bold">Save</button></>}>
        <div className="space-y-4">
          <input className="w-full h-12 px-4 bg-gray-50 border border-gray-200 rounded-xl text-sm" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Promo name" />
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-xs font-semibold text-gray-500 mb-1">Start</label><input type="date" className="w-full h-12 px-4 bg-gray-50 border border-gray-200 rounded-xl text-sm" value={form.startDate} onChange={e => setForm({ ...form, startDate: e.target.value })} /></div>
            <div><label className="block text-xs font-semibold text-gray-500 mb-1">End</label><input type="date" className="w-full h-12 px-4 bg-gray-50 border border-gray-200 rounded-xl text-sm" value={form.endDate} onChange={e => setForm({ ...form, endDate: e.target.value })} /></div>
          </div>
          <select className="w-full h-12 px-4 bg-gray-50 border border-gray-200 rounded-xl text-sm" onChange={e => { addPromoItem(e.target.value); e.target.value = '' }}><option value="">Add product...</option>{products.map(p => <option key={p.id} value={p.id}>{p.name} ({money(p.price)})</option>)}</select>
          <div className="bg-gray-50 rounded-xl p-3 min-h-[60px]">
            {form.items.length === 0 ? <div className="text-center text-gray-400 py-5 text-sm">No products</div> : form.items.map((it, i) => (
              <div key={i} className="flex items-center gap-2 p-2.5 bg-white rounded-lg mb-2">
                <div className="flex-1"><div className="text-sm font-semibold">{it.name}</div><div className="text-xs text-gray-400">Was: {money(it.originalPrice)}</div></div>
                <input type="number" className="w-20 h-8 px-2 text-center border border-gray-300 rounded-lg text-sm font-bold text-gray-700" placeholder="Price" value={it.promoPrice} onChange={e => { const items = [...form.items]; items[i].promoPrice = e.target.value; setForm({ ...form, items }) }} />
                <button onClick={() => { const items = [...form.items]; items.splice(i, 1); setForm({ ...form, items }) }} className="w-7 h-7 bg-red-50 text-red-500 rounded-md text-xs flex items-center justify-center">✕</button>
              </div>
            ))}
          </div>
        </div>
      </Modal>

      {/* Bundle Modal */}
      <Modal open={bunModal} onClose={() => setBunModal(false)} title={bunForm.id ? 'Edit Bundle' : 'New Bundle'}
        footer={<><button onClick={() => setBunModal(false)} className="h-11 px-5 border border-stone-300 rounded-xl text-sm font-semibold text-stone-600">Cancel</button><button onClick={saveBundle} className="flex-1 h-11 bg-gray-700 text-white rounded-xl text-sm font-bold">Save</button></>}>
        <div className="space-y-4">
          <input className="w-full h-12 px-4 bg-gray-50 border border-gray-200 rounded-xl text-sm" value={bunForm.name} onChange={e => setBunForm({...bunForm, name: e.target.value})} placeholder="Bundle name" />
          <input type="number" className="w-full h-12 px-4 bg-gray-50 border border-gray-200 rounded-xl text-sm" value={bunForm.price} onChange={e => setBunForm({...bunForm, price: e.target.value})} placeholder="Bundle price (GHS)" />
          <select className="w-full h-12 px-4 bg-gray-50 border border-gray-200 rounded-xl text-sm" onChange={e => { addBunItem(e.target.value); e.target.value = '' }}><option value="">Add product...</option>{products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
          <div className="bg-gray-50 rounded-xl p-3 min-h-[60px]">
            {bunForm.items.length === 0 ? <div className="text-center text-gray-400 py-5 text-sm">No products</div> : bunForm.items.map((it, i) => {
              const p = products.find(x => x.id === it.productId)
              return p ? <div key={i} className="flex items-center gap-2 p-2.5 bg-white rounded-lg mb-2"><span className="flex-1 text-sm font-semibold">{p.name}</span><input type="number" value={it.qty} min={1} className="w-12 h-8 text-center border border-gray-200 rounded-lg text-sm font-bold" onChange={e => { const items = [...bunForm.items]; items[i].qty = parseInt(e.target.value) || 1; setBunForm({...bunForm, items}) }} /><button onClick={() => { const items = [...bunForm.items]; items.splice(i, 1); setBunForm({...bunForm, items}) }} className="w-7 h-7 bg-red-50 text-red-500 rounded-md text-xs flex items-center justify-center">✕</button></div> : null
            })}
          </div>
        </div>
      </Modal>
    </div>
  )
}
