import { useState } from 'react'
import { useStore } from '../hooks/useStore'
import { getSupabase } from '../lib/supabase'
import { money, num, fmtDate, today } from '../lib/utils'
import Modal from '../components/Modal'
import toast from 'react-hot-toast'
import { IconTag, EmptyState } from '../components/Icons'
import { CHANNELS, promoApplies } from '../lib/promoPricing'
import ProductPicker from '../components/ProductPicker'

export default function PromosPage() {
  const { promos, bundles, products, refreshPromos, refreshBundles, setLoading } = useStore()
  const [tab, setTab] = useState('promos')
  // Promo state
  const [modal, setModal] = useState(false)
  const [form, setForm] = useState({ id: '', name: '', startDate: '', endDate: '', items: [], channel: 'both' })
  // Bundle state
  const [bunModal, setBunModal] = useState(false)
  const [bunForm, setBunForm] = useState({ id: '', name: '', price: '', items: [], channel: 'both' })

  // `channel` only exists after migration 033. Writing it to a database that
  // has not run yet rejects the WHOLE row, so saving a promotion would simply
  // fail. Retry without it and say so, rather than losing the admin's work.
  const saveRow = async (table, data, id) => {
    const sb = getSupabase()
    const run = (payload) => id
      ? sb.from(table).update(payload).eq('id', id)
      : sb.from(table).insert(payload)
    let r = await run(data)
    if (r.error && /channel/i.test(r.error.message || '')) {
      const { channel, ...withoutChannel } = data
      console.warn(`${table}.channel does not exist — run migration 033. Saved without a channel, so it applies everywhere.`)
      r = await run(withoutChannel)
      if (!r.error) toast('Saved — but channels need migration 033', { icon: '!' })
    }
    return r
  }

  const CHANNEL_LABEL = { shop: 'Shop only', web: 'Website only', both: 'Shop + Website' }
  const CHANNEL_HINT = {
    shop: 'Only at the counter. Online prices are untouched.',
    web: 'Only on the website. The till charges the normal price.',
    both: 'Everywhere — the counter and the website.',
  }
  const ChannelPicker = ({ value, onChange }) => (
    <div>
      <label className="block text-xs font-semibold text-gray-500 mb-1.5">Where does this apply?</label>
      <div className="flex gap-2">
        {CHANNELS.map(c => (
          <button key={c} type="button" onClick={() => onChange(c)}
            className={`flex-1 h-11 px-2 rounded-xl text-xs font-bold border-2 transition ${value === c ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-200 text-gray-500 hover:border-gray-300'}`}>
            {CHANNEL_LABEL[c]}
          </button>
        ))}
      </div>
      <p className="text-[11px] text-gray-400 mt-1.5">{CHANNEL_HINT[value] || CHANNEL_HINT.both}</p>
    </div>
  )

  // Nobody sets six hundred prices by hand. A promotion is almost always "this
  // much off these things", so the percentage is the control and a per-item
  // price is the exception you override afterwards.
  const applyPercent = (pct) => {
    const n = num(pct)
    if (!(n > 0 && n < 100)) { toast.error('Enter a discount between 1 and 99'); return }
    setForm(f => ({
      ...f,
      items: f.items.map(it => ({
        ...it,
        promoPrice: Math.max(0, Math.round(num(it.originalPrice) * (1 - n / 100) * 100) / 100),
      })),
    }))
  }

  const togglePromoProduct = (pr) => setForm(f => {
    const items = [...f.items]
    const i = items.findIndex(x => x.productId === pr.id)
    if (i >= 0) items.splice(i, 1)
    else items.push({ productId: pr.id, name: pr.name, originalPrice: pr.price, promoPrice: '' })
    return { ...f, items }
  })

  const addPromoProducts = (list) => setForm(f => {
    const have = new Set(f.items.map(x => x.productId))
    return { ...f, items: [...f.items, ...list.filter(pr => !have.has(pr.id))
      .map(pr => ({ productId: pr.id, name: pr.name, originalPrice: pr.price, promoPrice: '' }))] }
  })

  const toggleBundleProduct = (pr) => setBunForm(f => {
    const items = [...f.items]
    const i = items.findIndex(x => x.productId === pr.id)
    if (i >= 0) items.splice(i, 1); else items.push({ productId: pr.id, qty: 1 })
    return { ...f, items }
  })

  const addBundleProducts = (list) => setBunForm(f => {
    const have = new Set(f.items.map(x => x.productId))
    return { ...f, items: [...f.items, ...list.filter(pr => !have.has(pr.id)).map(pr => ({ productId: pr.id, qty: 1 }))] }
  })

  // The one rule, from the shared module. The copy that used to live here read
  // `p.endDate >= today`, and `null >= '2026-11-03'` is false — so a promotion
  // with no end date, which runs until you switch it off, displayed as "Off"
  // while the till was happily applying it.
  const isActive = (p) => promoApplies(p, 'shop') || promoApplies(p, 'web')
  const activeCount = promos.filter(isActive).length

  // Promo functions
  const openNewPromo = () => { setForm({ id: '', name: '', startDate: today(), endDate: '', items: [], channel: 'both' }); setModal(true) }
  const openEditPromo = (p) => { setForm({ id: p.id, name: p.name, startDate: p.startDate || '', endDate: p.endDate || '', items: [...p.items], channel: p.channel || 'both' }); setModal(true) }
  const savePromo = async () => {
    if (!form.name.trim()) { toast.error('Give the promotion a name'); return }
    if (!form.startDate) { toast.error('Set a start date'); return }
    if (!form.items.length) { toast.error('Choose at least one product'); return }
    if (form.endDate && form.endDate < form.startDate) { toast.error('The end date is before the start date'); return }
    for (const it of form.items) { if (!num(it.promoPrice)) { toast.error('Set price for ' + it.name); return } }
    setLoading(true, 'Saving...'); const sb = getSupabase()
    const data = { name: form.name.trim(), start_date: form.startDate, end_date: form.endDate, items: form.items.map(i => ({ productId: i.productId, name: i.name, originalPrice: num(i.originalPrice), promoPrice: num(i.promoPrice) })), active: true, channel: form.channel || 'both' }
    const { error } = await saveRow('promos', data, form.id)
    if (error) { setLoading(false); toast.error('Could not save: ' + (error.message || '')); return }
    await refreshPromos(); setLoading(false); setModal(false); toast.success('Saved')
  }
  const togglePromo = async (id, active) => { const sb = getSupabase(); await sb.from('promos').update({ active: !active }).eq('id', id); refreshPromos() }
  const delPromo = async (id) => { if (!confirm('Delete?')) return; setLoading(true); await getSupabase().from('promos').delete().eq('id', id); await refreshPromos(); setLoading(false); toast.success('Deleted') }

  // Bundle functions
  const openNewBundle = () => { setBunForm({ id: '', name: '', price: '', items: [], channel: 'both' }); setBunModal(true) }
  const openEditBundle = (b) => { setBunForm({ id: b.id, name: b.name, price: b.bundlePrice, items: [...b.products], channel: b.channel || 'both' }); setBunModal(true) }
  const saveBundle = async () => {
    if (!bunForm.name.trim() || !bunForm.items.length || !num(bunForm.price)) { toast.error('Fill all fields'); return }
    setLoading(true, 'Saving...'); const sb = getSupabase()
    const data = { name: bunForm.name.trim(), bundle_price: num(bunForm.price), products: bunForm.items, active: true, channel: bunForm.channel || 'both' }
    const { error } = await saveRow('bundles', data, bunForm.id)
    if (error) { setLoading(false); toast.error('Could not save: ' + (error.message || '')); return }
    await refreshBundles(); setLoading(false); setBunModal(false); toast.success('Saved')
  }
  const delBundle = async (id) => { if (!confirm('Delete?')) return; setLoading(true); await getSupabase().from('bundles').delete().eq('id', id); await refreshBundles(); setLoading(false); toast.success('Deleted') }

  return (
    <div >
      <div className="flex justify-between items-start flex-wrap gap-4 mb-5">
        <div>
          <h1 className="text-[22px] md:text-[26px] font-bold tracking-tight">Promos &amp; Bundles</h1>
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
          {promos.length === 0 && <EmptyState icon={IconTag} title="No promotions" hint="Create one to discount selected products for a date range" />}
          {promos.map(p => {
            const active = isActive(p)
            return (
              <div key={p.id} className={`bg-white rounded-2xl p-5 border-l-4 ${active ? 'border-gray-500' : 'border-gray-300 opacity-60'}`}>
                <div className="flex justify-between items-start flex-wrap gap-3 mb-3">
                  <div><h3 className="font-bold">{p.name}</h3><p className="text-xs text-gray-400">{fmtDate(p.startDate)} → {fmtDate(p.endDate)}</p></div>
                  {/* Which channel a promotion touches is worth seeing
                      without opening it: a discount running in the wrong
                      place costs money quietly. */}
                  <span className={`px-2.5 py-1 mr-2 rounded-full text-[11px] font-bold border ${
                    (p.channel || 'both') === 'shop' ? 'bg-amber-50 text-amber-700 border-amber-200'
                    : (p.channel || 'both') === 'web' ? 'bg-sky-50 text-sky-700 border-sky-200'
                    : 'bg-stone-50 text-stone-600 border-stone-200'}`}>{CHANNEL_LABEL[p.channel || 'both']}</span>
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
        <div className="bg-white rounded-2xl border border-gray-100 overflow-x-auto rtable-wrap">
          <table className="rtable w-full min-w-[400px]">
            <thead><tr><th className="p-3 bg-gray-50 text-left text-[11px] font-bold text-gray-400 uppercase">Bundle</th><th className="p-3 bg-gray-50 text-left text-[11px] font-bold text-gray-400 uppercase">Products</th><th className="p-3 bg-gray-50 text-left text-[11px] font-bold text-gray-400 uppercase">Price</th><th className="p-3 bg-gray-50"></th></tr></thead>
            <tbody>{bundles.length === 0 ? <tr><td colSpan={4} className="text-center py-16 text-gray-300">No bundles</td></tr> : bundles.map(b => {
              const names = b.products.map(p => { const pr = products.find(x => x.id === p.productId); return pr ? p.qty + 'x ' + pr.name : '?' }).join(', ')
              return (<tr key={b.id} className="border-b border-gray-50"><td data-label="Bundle" className="p-3 text-sm font-semibold">{b.name}</td><td data-label="Products" className="p-3 text-xs text-gray-500 max-w-[200px] truncate">{names}</td><td data-label="Price" className="p-3 font-bold text-sm">{money(b.bundlePrice)}</td><td data-label="" className="p-3"><div className="flex gap-2"><button onClick={() => openEditBundle(b)} className="h-8 px-3 border border-stone-300 rounded-lg text-xs font-medium text-stone-600 hover:bg-stone-100 transition">Edit</button><button onClick={() => delBundle(b.id)} className="h-8 px-3 bg-[#c0492f] text-white rounded-lg text-xs font-medium hover:bg-[#a83d27] transition">Delete</button></div></td></tr>)
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
            <div><label className="block text-xs font-semibold text-gray-500 mb-1">End <span className="font-normal text-gray-300">— optional</span></label><input type="date" className="w-full h-12 px-4 bg-gray-50 border border-gray-200 rounded-xl text-sm" value={form.endDate} onChange={e => setForm({ ...form, endDate: e.target.value })} /></div>
          </div>
          <div className="pt-1">
            <ChannelPicker value={form.channel} onChange={c => setForm({ ...form, channel: c })} />
          </div>
          <ProductPicker
            products={products}
            selectedIds={new Set(form.items.map(i => i.productId))}
            onToggle={togglePromoProduct}
            onAddMany={addPromoProducts} />

          {form.items.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-semibold text-gray-500">Take</span>
              {[5, 10, 15, 20, 25, 30, 50].map(pc => (
                <button key={pc} type="button" onClick={() => applyPercent(pc)}
                  className="h-8 px-2.5 rounded-lg border border-gray-200 text-[12px] font-bold text-gray-600 hover:border-gray-900 hover:text-gray-900 transition">
                  {pc}%
                </button>
              ))}
              <span className="text-xs text-gray-400">off all {form.items.length}</span>
            </div>
          )}
          <div className="bg-gray-50 rounded-xl p-3 min-h-[60px]">
            {form.items.length === 0 ? <div className="text-center text-gray-400 py-5 text-sm">No products</div> : form.items.map((it, i) => (
              <div key={i} className="flex items-center gap-2 p-2.5 bg-white rounded-lg mb-2">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold truncate">{it.name}</div>
                  <div className="text-xs text-gray-400">
                    Was {money(it.originalPrice)}
                    {num(it.promoPrice) > 0 && num(it.originalPrice) > 0 && (
                      <span className={num(it.promoPrice) >= num(it.originalPrice) ? 'text-[#b3402b] font-semibold' : 'text-emerald-600 font-semibold'}>
                        {' · '}
                        {num(it.promoPrice) >= num(it.originalPrice)
                          ? 'not a discount'
                          : `${Math.round((1 - num(it.promoPrice) / num(it.originalPrice)) * 100)}% off`}
                      </span>
                    )}
                  </div>
                </div>
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
          <ChannelPicker value={bunForm.channel} onChange={c => setBunForm({ ...bunForm, channel: c })} />
          <ProductPicker
            products={products}
            selectedIds={new Set(bunForm.items.map(i => i.productId))}
            onToggle={toggleBundleProduct}
            onAddMany={addBundleProducts}
            label="Products in this bundle" />
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
