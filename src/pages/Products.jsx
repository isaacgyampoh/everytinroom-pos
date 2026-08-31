import { useState, useEffect, useRef } from 'react'
import { useStore } from '../hooks/useStore'
import { getSupabase } from '../lib/supabase'
import { money, num, thumb } from '../lib/utils'
import Modal from '../components/Modal'
import toast from 'react-hot-toast'
import { IconImage, IconSearch } from '../components/Icons'
import { compressImage, kb } from '../lib/image'

export default function Products() {
  const { products, refreshProducts, setLoading } = useStore()
  const [query, setQuery] = useState('')
  const [modal, setModal] = useState(false)
  const [form, setForm] = useState({ id: '', name: '', category: '', barcode: '', costPrice: '', price: '', wholesalePrice: '', wholesaleMinQty: '', quantity: '', groupTag: '', file: null, existingImage: '' })
  const [preview, setPreview] = useState('')
  const [migrating, setMigrating] = useState(false)
  const [photoFilter, setPhotoFilter] = useState(false)
  const filtered = products.filter(p => { const q = query.trim().toLowerCase(); return !q || p.name.toLowerCase().includes(q) || (p.barcode || '').includes(q) }).filter(p => !photoFilter || needsPhoto(p))

  // Old Cloudinary images are unrecoverable (account blocked); those products
  // need a fresh photo. This flags them so staff can work through re-uploads.
  const needsPhoto = (p) => !p.image || p.image.includes('res.cloudinary.com')

  const openNew = () => { setForm({ id: '', name: '', category: '', barcode: '', costPrice: '', price: '', wholesalePrice: '', wholesaleMinQty: '', quantity: '', groupTag: '', file: null, existingImage: '' }); setPreview(''); setShrunk(''); setModal(true) }
  const openEdit = (p) => { setForm({ id: p.id, name: p.name, category: p.category, barcode: p.barcode || '', costPrice: p.costPrice, price: p.price, wholesalePrice: p.wholesalePrice, wholesaleMinQty: p.wholesaleMinQty || '', quantity: p.quantity, groupTag: p.groupTag || '', file: null, existingImage: p.image }); setPreview(p.image || ''); setShrunk(''); setModal(true) }
  const [shrunk, setShrunk] = useState('')
  const handleFile = async (e) => {
    const raw = e.target.files[0]; if (!raw) return
    // Downscale before it ever leaves the machine. Straight-from-the-phone
    // photos were going in at up to 5.7MB for something never shown above 800px.
    const file = await compressImage(raw)
    setShrunk(file !== raw ? `${kb(raw.size)} → ${kb(file.size)}` : '')
    setForm(f => ({ ...f, file }))
    const r = new FileReader(); r.onload = (ev) => setPreview(ev.target.result); r.readAsDataURL(file)
  }

  const save = async () => {
    if (!form.name.trim()) { toast.error('Enter name'); return }
    setLoading(true, 'Saving...'); const sb = getSupabase(); let imageUrl = form.existingImage || ''
    if (form.file) {
      // Upload the image via the edge function (service role — always has write
      // access, no dependency on browser RLS). Falls back to a direct browser
      // upload if the edge call fails.
      try {
        const file = form.file
        if (file.size > 6 * 1024 * 1024) { toast.error('Image too large (max 6MB)'); setLoading(false); return }
        const ext = (file.name.split('.').pop() || 'jpg').toLowerCase()
        // file -> base64
        const b64 = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsDataURL(file) })
        let ok = false
        try {
          const r = await fetch('https://noiiuwkovoojkcwzupye.supabase.co/functions/v1/charge-momo?action=upload-image', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ data: b64, contentType: file.type || 'image/jpeg', ext })
          })
          const j = await r.json()
          if (j.success && j.url) { imageUrl = j.url; ok = true } else console.error('Edge upload failed:', j.error)
        } catch (e) { console.error('Edge upload error:', e) }
        // Fallback: direct browser upload.
        if (!ok) {
          const path = `products/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
          const { error: upErr } = await sb.storage.from('product-images').upload(path, file, { cacheControl: '31536000', upsert: true, contentType: file.type || 'image/jpeg' })
          if (upErr) { toast.error('Upload failed: ' + (upErr.message || '')); setLoading(false); return }
          imageUrl = `https://noiiuwkovoojkcwzupye.supabase.co/storage/v1/object/public/product-images/${path}`
        }
      } catch (e) { console.error('Image upload failed:', e); toast.error('Image upload failed: ' + (e?.message || '')); setLoading(false); return }
    }
    const data = { name: form.name.trim(), category: form.category.trim(), barcode: form.barcode.trim(), cost_price: num(form.costPrice), price: num(form.price), wholesale_price: num(form.wholesalePrice), wholesale_min_qty: num(form.wholesaleMinQty), quantity: num(form.quantity), group_tag: form.groupTag.trim().toLowerCase(), image: imageUrl }
    const { error: saveErr } = form.id
      ? await sb.from('products').update(data).eq('id', form.id)
      : await sb.from('products').insert(data)
    if (saveErr) {
      setLoading(false)
      // A barcode belongs to exactly one product — scanning has to be
      // unambiguous or the wrong item gets rung up.
      if (saveErr.code === '23505' && /barcode/.test(saveErr.message || '')) {
        const owner = products.find(p => p.barcode === form.barcode.trim())
        toast.error(owner ? `That barcode already belongs to "${owner.name}"` : 'That barcode is already used by another product')
      } else toast.error('Save failed: ' + saveErr.message)
      return
    }
    await refreshProducts(); setLoading(false); setModal(false); toast.success('Saved!')
  }
  const del = async (id) => { if (!confirm('Delete?')) return; setLoading(true); const sb = getSupabase(); await sb.from('products').delete().eq('id', id); await refreshProducts(); setLoading(false); toast.success('Deleted!') }

  return (
    <div >
      <div className="flex justify-between items-start flex-wrap gap-4 mb-6"><h1 className="text-[22px] md:text-[26px] font-bold">Products</h1><div className="flex gap-2">{products.some(needsPhoto) && <button onClick={() => setPhotoFilter(v => !v)} className={`h-12 px-4 rounded-xl text-xs font-semibold border transition ${photoFilter ? 'bg-amber-500 border-amber-500 text-white' : 'border-amber-400 bg-amber-50 text-amber-700'}`}>{photoFilter ? 'Showing: needs photo' : `${products.filter(needsPhoto).length} need new photos`}</button>}<button onClick={openNew} className="h-12 px-5 bg-gray-700 text-white rounded-xl text-sm font-semibold">Add</button></div></div>
      <div className="bg-white rounded-2xl p-6 shadow-md">
        <div className="relative mb-5">
          <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-stone-300 pointer-events-none"><IconSearch size={18} /></span>
          <input className="w-full h-13 pl-11 pr-4 bg-gray-50 border-2 border-gray-200 rounded-xl text-base" placeholder="Search by name or barcode..." value={query} onChange={e => setQuery(e.target.value)} />
        </div>
        <div className="overflow-x-auto"><table className="w-full min-w-[600px]"><thead><tr><th className="p-3 bg-gray-50 text-left text-[11px] font-bold text-gray-500 uppercase">Product</th><th className="p-3 bg-gray-50 text-left text-[11px] font-bold text-gray-500 uppercase">Price</th><th className="p-3 bg-gray-50 text-left text-[11px] font-bold text-gray-500 uppercase">Margin</th><th className="p-3 bg-gray-50 text-left text-[11px] font-bold text-gray-500 uppercase">Stock</th><th className="p-3 bg-gray-50 text-[11px] font-bold text-gray-500 uppercase">Actions</th></tr></thead>
          <tbody>{filtered.map(p => (
            <tr key={p.id} className="border-b border-gray-50"><td className="p-3"><div className="flex items-center gap-3"><div className={`thumb-shot w-11 h-11 rounded-xl flex-shrink-0 flex items-center justify-center ${needsPhoto(p) ? 'ring-2 ring-amber-400' : ''}`} title={needsPhoto(p) ? 'Needs a new photo' : ''}>{p.image ? <img src={thumb(p.image, 88)} alt="" /> : <span className="text-stone-300"><IconImage size={18} /></span>}</div><div><b className="text-sm">{p.name}</b><br /><small className="text-gray-400">{p.category || '-'}</small></div></div></td><td className="p-3 font-bold text-sm">{money(p.price)}</td><td className="p-3 text-xs">{p.costPrice > 0 ? <span className={`font-bold ${((p.price - p.costPrice) / p.price * 100) >= 30 ? 'text-emerald-600' : ((p.price - p.costPrice) / p.price * 100) >= 15 ? 'text-amber-600' : 'text-red-500'}`}>{((p.price - p.costPrice) / p.price * 100).toFixed(0)}%</span> : <span className="text-stone-300">—</span>}</td><td className={`p-3 font-bold text-sm ${p.quantity === 0 ? 'text-red-500' : p.quantity <= 5 ? 'text-amber-500' : ''}`}>{p.quantity}</td><td className="p-3"><div className="flex gap-2 justify-center"><button onClick={() => openEdit(p)} className="h-9 px-3 border border-stone-300 rounded-lg text-xs font-medium text-stone-600 hover:bg-stone-100 transition">Edit</button><button onClick={() => del(p.id)} className="h-9 px-3 bg-[#c0492f] text-white rounded-lg text-xs font-medium hover:bg-[#a83d27] transition">Delete</button></div></td></tr>
          ))}</tbody></table></div>
      </div>
      <Modal open={modal} onClose={() => setModal(false)} title={form.id ? 'Edit Product' : 'Add Product'} footer={<><button onClick={() => setModal(false)} className="h-12 px-5 border border-stone-300 rounded-xl text-sm font-semibold text-stone-600">Cancel</button><button onClick={save} className="flex-1 h-12 bg-gray-700 text-white rounded-xl text-sm font-bold">Save</button></>}>
        <div className="space-y-4">
          <div><label className="block text-xs font-semibold text-gray-500 mb-2">Product Image</label><div className="flex items-center gap-4"><div className="thumb-shot w-20 h-20 rounded-xl flex items-center justify-center flex-shrink-0">{preview ? <img src={thumb(preview, 160)} alt="" /> : <span className="text-stone-300"><IconImage size={26} /></span>}</div><div className="flex-1"><input type="file" accept="image/*" className="w-full text-sm file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-gray-50 file:text-gray-600" onChange={handleFile} /><p className="text-xs text-gray-400 mt-1">{shrunk ? <span className="text-emerald-600 font-semibold">Optimised {shrunk}</span> : 'JPG or PNG — large photos are shrunk automatically'}</p></div></div></div>
          <div><label className="block text-xs font-semibold text-gray-500 mb-2">Name</label><input className="w-full h-13 px-4 bg-gray-50 border-2 border-gray-200 rounded-xl text-base" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
          <div><label className="block text-xs font-semibold text-gray-500 mb-2">Barcode <span className="font-normal text-gray-400">(scan it here)</span></label><input data-no-scan className="w-full h-13 px-4 bg-gray-50 border-2 border-gray-200 rounded-xl text-base font-mono" placeholder="Click here, then scan the product" value={form.barcode} onChange={e => setForm({ ...form, barcode: e.target.value.trim() })} /><p className="text-xs text-gray-400 mt-1.5">Without this, the scanner cannot find this product at the till. Leave blank for items with no barcode.</p></div>
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
