import { useState, useEffect } from 'react'
import { getSupabase } from '../lib/supabase'
import { money } from '../lib/utils'
import { Logo } from '../components/Logo'

// Public page — customer opens this from the WhatsApp link to add delivery details.
// Route: #/details/<orderNo>
export default function DeliveryDetails() {
  const [order, setOrder] = useState(undefined) // undefined = loading, null = not found
  const [form, setForm] = useState({ name: '', phone: '', address: '', landmark: '', notes: '' })
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(false)

  const orderNo = (() => {
    try { const h = window.location.hash; const m = h.match(/\/details\/([^/?]+)/); return m ? decodeURIComponent(m[1]) : '' } catch { return '' }
  })()

  useEffect(() => {
    document.body.classList.remove('dark'); document.body.style.background = '#f6f6f5'
    ;(async () => {
      const sb = getSupabase(); if (!sb || !orderNo) { setOrder(null); return }
      const { data } = await sb.from('whatsapp_orders').select('id,order_no,total,customer_name,customer_phone,address,details_filled,status').eq('order_no', orderNo).limit(1)
      const o = data?.[0] || null
      setOrder(o)
      if (o) {
        setForm(f => ({ ...f, name: o.customer_name && o.customer_name !== o.customer_phone ? o.customer_name : '', phone: o.customer_phone || '', address: o.address || '' }))
        if (o.details_filled && o.address) setDone(true)
      }
    })()
    return () => { document.body.style.background = '' }
  }, [orderNo])

  const save = async () => {
    if (!form.name.trim() || !form.address.trim()) return
    setSaving(true)
    try {
      const sb = getSupabase()
      const fullAddress = [form.address.trim(), form.landmark.trim() ? `Landmark: ${form.landmark.trim()}` : ''].filter(Boolean).join('\n')
      const { error } = await sb.from('whatsapp_orders').update({
        customer_name: form.name.trim(),
        customer_phone: form.phone.trim() || order.customer_phone,
        address: fullAddress,
        notes: form.notes.trim() || null,
        details_filled: true,
      }).eq('id', order.id)
      if (error) throw error
      setDone(true)
    } catch (e) {
      alert('Could not save. Please check your connection and try again.')
    } finally { setSaving(false) }
  }

  if (order === undefined) return <div className="min-h-screen flex items-center justify-center text-gray-400">Loading...</div>

  if (order === null) return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 text-center">
      <Logo height={64} color="#16181d" accent="#9a9da3" className="mb-6" />
      <h1 className="text-xl font-bold text-gray-900 mb-2">Order not found</h1>
      <p className="text-gray-500 text-sm">Please check the link, or contact us on 024 531 5581.</p>
    </div>
  )

  if (done) return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 text-center">
      <div className="w-16 h-16 rounded-full bg-[#0e7c86] flex items-center justify-center mb-5">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5"><path d="M20 6L9 17l-5-5"/></svg>
      </div>
      <h1 className="text-2xl font-bold text-gray-900 mb-2">Delivery details saved!</h1>
      <p className="text-gray-500 text-sm max-w-sm">Thank you. We have your delivery details for order <b>{order.order_no}</b>. Once your payment is received, we'll process and deliver your order.</p>
      <div className="mt-6 bg-white rounded-2xl border border-gray-200 p-4 text-left max-w-sm w-full">
        <div className="text-xs text-gray-400 font-medium">Delivering to</div>
        <div className="text-sm font-semibold text-gray-900 mt-1">{form.name}</div>
        <div className="text-sm text-gray-600 whitespace-pre-line mt-0.5">{form.address}{form.landmark ? `\nLandmark: ${form.landmark}` : ''}</div>
      </div>
      <p className="text-gray-400 text-xs mt-6">EVERYTINROOM & BEDTIME · 024 531 5581</p>
    </div>
  )

  return (
    <div className="min-h-screen py-8 px-5">
      <div className="max-w-md mx-auto">
        <div className="text-center mb-6">
          <Logo height={56} color="#16181d" accent="#9a9da3" className="mb-4 mx-auto" />
          <h1 className="text-xl font-bold text-gray-900">Delivery Details</h1>
          <p className="text-gray-500 text-sm mt-1">Order {order.order_no} · {money(order.total)}</p>
        </div>

        <div className="bg-white rounded-2xl border border-gray-200 p-5 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1.5">Full Name *</label>
            <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Your full name" className="w-full h-12 px-4 bg-gray-50 border-2 border-gray-200 rounded-xl text-base focus:outline-none focus:border-[#0e7c86]" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1.5">Phone Number *</label>
            <input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} inputMode="tel" placeholder="024 000 0000" className="w-full h-12 px-4 bg-gray-50 border-2 border-gray-200 rounded-xl text-base focus:outline-none focus:border-[#0e7c86]" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1.5">Delivery Address *</label>
            <textarea value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} rows={3} placeholder="House number, street, area, town/city" className="w-full px-4 py-3 bg-gray-50 border-2 border-gray-200 rounded-xl text-base focus:outline-none focus:border-[#0e7c86] resize-none" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1.5">Nearest Landmark</label>
            <input value={form.landmark} onChange={e => setForm({ ...form, landmark: e.target.value })} placeholder="e.g. near the blue church" className="w-full h-12 px-4 bg-gray-50 border-2 border-gray-200 rounded-xl text-base focus:outline-none focus:border-[#0e7c86]" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1.5">Delivery Notes</label>
            <input value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder="Anything we should know" className="w-full h-12 px-4 bg-gray-50 border-2 border-gray-200 rounded-xl text-base focus:outline-none focus:border-[#0e7c86]" />
          </div>

          <button onClick={save} disabled={saving || !form.name.trim() || !form.address.trim()} className="w-full h-13 bg-[#0e7c86] text-white rounded-xl font-bold text-base disabled:opacity-40 mt-2">
            {saving ? 'Saving...' : 'Save Delivery Details'}
          </button>
          <p className="text-center text-xs text-gray-400">Remember to dial your payment code to complete your order.</p>
        </div>
      </div>
    </div>
  )
}
