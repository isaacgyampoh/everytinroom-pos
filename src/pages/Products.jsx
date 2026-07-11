import { useState, useEffect, useRef } from 'react'
import { useStore } from '../hooks/useStore'
import { getSupabase } from '../lib/supabase'
import { money, num, thumb } from '../lib/utils'
import Modal from '../components/Modal'
import toast from 'react-hot-toast'

export default function Products() {
  const { products, refreshProducts, setLoading } = useStore()
  const [query, setQuery] = useState('')
  const [modal, setModal] = useState(false)
  const [form, setForm] = useState({ id: '', name: '', category: '', costPrice: '', price: '', wholesalePrice: '', wholesaleMinQty: '', quantity: '', groupTag: '', file: null, existingImage: '' })
  const [preview, setPreview] = useState('')
  const [migrating, setMigrating] = useState(false)
  const filtered = products.filter(p => p.name.toLowerCase().includes(query.toLowerCase()))

  // Auto-migrate Cloudinary images -> Supabase, SERVER-SIDE, silently in the
  // background. No button needed. Fires batches until none remain. Runs once
  // per page load if any Cloudinary images exist.
  const migratedRef = useRef(false)
  useEffect(() => {
    if (migratedRef.current) return
    const hasCloudinary = products.some(p => p.image && p.image.includes('res.cloudinary.com'))
    if (!hasCloudinary) return
    migratedRef.current = true
    ;(async () => {
      let guard = 0
      while (guard++ < 50) {
        try {
          const r = await fetch('https://noiiuwkovoojkcwzupye.supabase.co/functions/v1/charge-momo?action=migrate-images', { method: 'POST' })
          const j = await r.json()
          if (!j.success) break
          if (j.done > 0) { try { await refreshProducts() } catch {} }
          if (!j.remaining || j.remaining === 0) { toast.success('Images moved to Supabase'); break }
          if (j.done === 0 && j.failed > 0) { console.error('Migration stuck:', j.errors); break }
        } catch (e) { console.error('Migration error:', e); break }
      }
    })()
  }, [products]) // eslint-disable-line

  // Manual fallback (kept, but migration is automatic above)
  const migrateImages = async () => {
    setMigrating(true)
    try {
      let guard = 0
      while (guard++ < 50) {
        const r = await fetch('https://noiiuwkovoojkcwzupye.supabase.co/functions/v1/charge-momo?action=migrate-images', { method: 'POST' })
        const j = await r.json()
        if (!j.success) { toast.error('Migration failed'); break }
        if (j.done > 0) await refreshProducts()
        if (!j.remaining || j.remaining === 0) { toast.success('All images moved to Supabase'); break }
        if (j.done === 0 && j.failed > 0) { toast.error(`${j.failed} failed: ${(j.errors||[])[0] || ''}`); break }
      }
    } catch (e) { toast.error('Migration error') }
    setMigrating(false)
  }

  const openNew = () => { setForm({ id: '', name: '', category: '', costPrice: '', price: '', wholesalePrice: '', wholesaleMinQty: '', quantity: '', groupTag: '', file: null, existingImage: '' }); setPreview(''); setModal(true) }
  const openEdit = (p) => { setForm({ id: p.id, name: p.name, category: p.category, costPrice: p.costPrice, price: p.price, wholesalePrice: p.wholesalePrice, wholesaleMinQty: p.wholesaleMinQty || '', quantity: p.quantity, groupTag: p.groupTag || '', file: null, existingImage: p.image }); setPreview(p.image || ''); setModal(true) }
  const handleFile = (e) => { const file = e.target.files[0]; if (!file) return; setForm({ ...form, file }); const r = new FileReader(); r.onload = (ev) => setPreview(ev.target.result); r.readAsDataURL(file) }

  const save = async () => {
    if (!form.name.trim()) { toast.error('Enter name'); return }
    setLoading(true, 'Saving...'); const sb = getSupabase(); let imageUrl = form.existingImage || ''
    if (form.file) {
      // Upload to Supabase storage (permanent, owned by us — no third-party
      // free-tier deactivation risk). ImageKit still optimizes on delivery.
      try {
        const ext = (form.file.name.split('.').pop() || 'jpg').toLowerCase()
        const path = `products/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
        const { error: upErr } = await sb.storage.from('product-images').upload(path, form.file, { cacheControl: '31536000', upsert: true, contentType: form.file.type || 'image/jpeg' })
        if (upErr) { console.error('Upload error:', upErr); toast.error('Upload: ' + (upErr.message || 'failed')); setLoading(false); return }
        const { data: urlData } = sb.storage.from('product-images').getPublicUrl(path)
        if (urlData?.publicUrl) imageUrl = urlData.publicUrl
        else { toast.error('Could not get image URL'); setLoading(false); return }
      } catch (e) { console.error('Image upload failed:', e); toast.error('Image upload failed: ' + (e?.message || '')); setLoading(false); return }
    }
    const data = { name: form.name.trim(), category: form.category.trim(), cost_price: num(form.costPrice), price: num(form.price), wholesale_price: num(form.wholesalePrice), wholesale_min_qty: num(form.wholesaleMinQty), quantity: num(form.quantity), group_tag: form.groupTag.trim().toLowerCase(), image: imageUrl }
    if (form.id) await sb.from('products').update(data).eq('id', form.id); else await sb.from('products').insert(data)
    await refreshProducts(); setLoading(false); setModal(false); toast.success('Saved!')
  }
  const del = async (id) => { if (!confirm('Delete?')) return; setLoading(true); const sb = getSupabase(); await sb.from('products').delete().eq('id', id); await refreshProducts(); setLoading(false); toast.success('Deleted!') }

  return (
    <div >
      <div className="flex justify-between items-start flex-wrap gap-4 mb-6"><h1 className="text-[22px] md:text-[26px] font-bold">Products</h1><div className="flex gap-2">{products.some(p => p.image && p.image.includes('res.cloudinary.com')) && <button onClick={migrateImages} disabled={migrating} className="h-12 px-4 border border-[#0e7c86] bg-[#0e7c86]/5 text-[#0e7c86] rounded-xl text-xs font-semibold disabled:opacity-50">{migrating ? 'Moving images...' : `Move ${products.filter(p => p.image && p.image.includes('res.cloudinary.com')).length} images to Supabase`}</button>}<button onClick={openNew} className="h-12 px-5 bg-gray-700 text-white rounded-xl text-sm font-semibold">Add</button></div></div>
      <div className="bg-white rounded-2xl p-6 shadow-md">
        <input className="w-full h-13 px-4 bg-gray-50 border-2 border-gray-200 rounded-xl text-base mb-5" placeholder="Search..." value={query} onChange={e => setQuery(e.target.value)} />
        <div className="overflow-x-auto"><table className="w-full min-w-[600px]"><thead><tr><th className="p-3 bg-gray-50 text-left text-[11px] font-bold text-gray-500 uppercase">Product</th><th className="p-3 bg-gray-50 text-left text-[11px] font-bold text-gray-500 uppercase">Price</th><th className="p-3 bg-gray-50 text-left text-[11px] font-bold text-gray-500 uppercase">Margin</th><th className="p-3 bg-gray-50 text-left text-[11px] font-bold text-gray-500 uppercase">Stock</th><th className="p-3 bg-gray-50 text-[11px] font-bold text-gray-500 uppercase">Actions</th></tr></thead>
          <tbody>{filtered.map(p => (
            <tr key={p.id} className="border-b border-gray-50"><td className="p-3"><div className="flex items-center gap-3"><div className="w-11 h-11 bg-gray-100 rounded-xl flex-shrink-0 overflow-hidden flex items-center justify-center text-xl">{p.image ? <img src={thumb(p.image, 88)} alt="" className="w-full h-full object-cover" /> : ''}</div><div><b className="text-sm">{p.name}</b><br /><small className="text-gray-400">{p.category || '-'}</small></div></div></td><td className="p-3 font-bold text-sm">{money(p.price)}</td><td className="p-3 text-xs">{p.costPrice > 0 ? <span className={`font-bold ${((p.price - p.costPrice) / p.price * 100) >= 30 ? 'text-emerald-600' : ((p.price - p.costPrice) / p.price * 100) >= 15 ? 'text-amber-600' : 'text-red-500'}`}>{((p.price - p.costPrice) / p.price * 100).toFixed(0)}%</span> : <span className="text-stone-300">—</span>}</td><td className={`p-3 font-bold text-sm ${p.quantity === 0 ? 'text-red-500' : p.quantity <= 5 ? 'text-amber-500' : ''}`}>{p.quantity}</td><td className="p-3"><div className="flex gap-2 justify-center"><button onClick={() => openEdit(p)} className="h-9 px-3 border border-stone-300 rounded-lg text-xs font-medium text-stone-600 hover:bg-stone-100 transition">Edit</button><button onClick={() => del(p.id)} className="h-9 px-3 bg-[#c0492f] text-white rounded-lg text-xs font-medium hover:bg-[#a83d27] transition">Delete</button></div></td></tr>
          ))}</tbody></table></div>
      </div>
      <Modal open={modal} onClose={() => setModal(false)} title={form.id ? 'Edit Product' : 'Add Product'} footer={<><button onClick={() => setModal(false)} className="h-12 px-5 border border-stone-300 rounded-xl text-sm font-semibold text-stone-600">Cancel</button><button onClick={save} className="flex-1 h-12 bg-gray-700 text-white rounded-xl text-sm font-bold">Save</button></>}>
        <div className="space-y-4">
          <div><label className="block text-xs font-semibold text-gray-500 mb-2">Product Image</label><div className="flex items-center gap-4"><div className="w-20 h-20 bg-gray-100 rounded-xl overflow-hidden flex items-center justify-center text-3xl flex-shrink-0">{preview ? <img src={thumb(preview, 160)} alt="" className="w-full h-full object-cover" /> : ''}</div><div className="flex-1"><input type="file" accept="image/*" className="w-full text-sm file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-gray-50 file:text-gray-600" onChange={handleFile} /><p className="text-xs text-gray-400 mt-1">JPG, PNG up to 5MB</p></div></div></div>
          <div><label className="block text-xs font-semibold text-gray-500 mb-2">Name</label><input className="w-full h-13 px-4 bg-gray-50 border-2 border-gray-200 rounded-xl text-base" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
          <div><label className="block text-xs font-semibold text-gray-500 mb-2">Category</label><select className="w-full h-13 px-4 bg-gray-50 border-2 border-gray-200 rounded-xl text-base appearance-none" value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}><option value="">Select category...</option>{['Curtains','Kitchenware','Cookware Sets','Racks','Rods','Chairs','Carpets','Home Appliances','Blankets','Bed Sheets','Mats','Pillows','Towels & Covers','Artefacts & Decor','Other'].map(c => <option key={c} value={c}>{c}</option>)}</select></div>
          <div className="grid grid-cols-2 gap-3.5"><div><label className="block text-xs font-semibold text-gray-500 mb-2">Cost</label><input type="number" className="w-full h-13 px-4 bg-gray-50 border-2 border-gray-200 rounded-xl text-base" value={form.costPrice} onChange={e => setForm({ ...form, costPrice: e.target.value })} /></div><div><label className="block text-xs font-semibold text-gray-500 mb-2">Price</label><input type="number" className="w-full h-13 px-4 bg-gray-50 border-2 border-gray-200 rounded-xl text-base" value={form.price} onChange={e => setForm({ ...form, price: e.target.value })} /></div></div>
          <div><label className="block text-xs font-semibold text-gray-500 mb-2">Stock Quantity</label><input type="number" className="w-full h-13 px-4 bg-gray-50 border-2 border-gray-200 rounded-xl text-base" placeholder="e.g. 20" value={form.quantity} onChange={e => setForm({ ...form, quantity: e.target.value })} /></div>
          <div className="grid grid-cols-2 gap-3.5"><div><label className="block text-xs font-semibold text-gray-500 mb-2">Wholesale Price <span className="font-normal text-gray-400">(optional)</span></label><input type="number" className="w-full h-13 px-4 bg-gray-50 border-2 border-gray-200 rounded-xl text-base" placeholder="0.00" value={form.wholesalePrice} onChange={e => setForm({ ...form, wholesalePrice: e.target.value })} /></div><div><label className="block text-xs font-semibold text-gray-500 mb-2">Wholesale Min Qty</label><input type="number" className="w-full h-13 px-4 bg-gray-50 border-2 border-gray-200 rounded-xl text-base" placeholder="e.g. 5" value={form.wholesaleMinQty} onChange={e => setForm({ ...form, wholesaleMinQty: e.target.value })} /></div></div>
          <div><label className="block text-xs font-semibold text-gray-500 mb-2">Variant Group <span className="font-normal text-gray-400">(optional)</span></label><input className="w-full h-13 px-4 bg-gray-50 border-2 border-gray-200 rounded-xl text-base" placeholder="e.g. sunblock-curtains" value={form.groupTag} onChange={e => setForm({ ...form, groupTag: e.target.value })} /><p className="text-xs text-gray-400 mt-1.5">Give every colour/type of the same product the SAME group so 5 across colours triggers wholesale. Leave blank if no variants.</p></div>
          {num(form.wholesalePrice) > 0 && num(form.wholesaleMinQty) > 0 && <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-700">When a customer buys <b>{form.wholesaleMinQty}+</b> units, price switches from <b>GHS {num(form.price).toFixed(2)}</b> to <b>GHS {num(form.wholesalePrice).toFixed(2)}</b></div>}
        </div>
      </Modal>
    </div>
  )
}
