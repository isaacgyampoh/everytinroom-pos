import { useState, useEffect } from 'react'
import { getSupabase } from '../lib/supabase'
import { SHOP } from '../lib/utils'

const money = v => 'GHS ' + Number(v || 0).toFixed(2)

export default function InvoicePay() {
  const [order, setOrder] = useState(null)
  const [loading, setLoading] = useState(true)
  const [paying, setPaying] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  // Delivery form
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [address, setAddress] = useState('')
  const [landmark, setLandmark] = useState('')
  const [notes, setNotes] = useState('')

  const orderId = window.location.hash.split('/pay/')[1]

  useEffect(() => {
    if (!orderId) { setError('Invalid invoice link'); setLoading(false); return }
    loadOrder()
  }, [orderId])

  const loadOrder = async () => {
    const sb = getSupabase()
    const { data, error: err } = await sb.from('whatsapp_orders').select('*').eq('id', orderId).single()
    if (err || !data) { setError('Invoice not found'); setLoading(false); return }
    const items = typeof data.items === 'string' ? JSON.parse(data.items) : (data.items || [])
    setOrder({ ...data, items })
    // Pre-fill from existing data
    setName(data.customer_name || '')
    setPhone(data.customer_phone || '')
    setAddress(data.address || '')
    setNotes(data.notes === 'Invoice from POS' ? '' : (data.notes || ''))
    setLoading(false)
  }

  const saveDelivery = async () => {
    if (!name.trim()) return
    const sb = getSupabase()
    await sb.from('whatsapp_orders').update({
      customer_name: name.trim(),
      customer_phone: phone.trim(),
      address: [address.trim(), landmark.trim()].filter(Boolean).join(' | '),
      notes: notes.trim()
    }).eq('id', orderId)
    setSaved(true)
    setOrder(prev => ({ ...prev, customer_name: name.trim(), address: [address.trim(), landmark.trim()].filter(Boolean).join(' | ') }))
  }

  const handlePay = async () => {
    if (!name.trim()) { setError('Please enter your name'); return }
    if (!address.trim()) { setError('Please enter your delivery address'); return }

    // Save delivery details first
    await saveDelivery()

    if (!order) return
    setPaying(true)
    setError('')
    try {
      const res = await fetch('https://noiiuwkovoojkcwzupye.supabase.co/functions/v1/charge-momo?action=initialize', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: phone.trim() || order.customer_phone,
          amount: Number(order.total),
          callbackUrl: window.location.href,
          metadata: { order_id: order.id, order_no: order.order_no, customer: name.trim() }
        }),
      })
      const data = await res.json()
      if (data.success && data.authorizationUrl) {
        const sb = getSupabase()
        await sb.from('whatsapp_orders').update({ paystack_ref: data.reference }).eq('id', order.id)
        window.location.href = data.authorizationUrl
      } else {
        setPaying(false)
        setError(data.error || 'Payment failed to initialize')
      }
    } catch (e) {
      setPaying(false)
      setError('Network error. Please try again.')
    }
  }

  // Check if payment callback
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const ref = params.get('reference') || params.get('trxref')
    if (ref && orderId) {
      const sb = getSupabase()
      sb.from('whatsapp_orders').update({
        paystack_ref: ref,
        paid_at: new Date().toISOString(),
        status: 'Paid'
      }).eq('id', orderId).then(() => loadOrder())
    }
  }, [])

  const isPaid = order?.status === 'Paid' || order?.status === 'Completed' || order?.paid_at
  const hasDelivery = order?.address && order.address.length > 3

  if (loading) return (
    <div className="min-h-screen bg-[#f6f4ef] flex items-center justify-center">
      <div className="w-8 h-8 border-3 border-[#d4dbd0] border-t-[#3d8b6a] rounded-full animate-spin" />
    </div>
  )

  if (error && !order) return (
    <div className="min-h-screen bg-[#f6f4ef] flex items-center justify-center p-6">
      <div className="text-center">
        <div className="text-5xl mb-4">❌</div>
        <h1 className="text-xl font-bold text-gray-800 mb-2">Invoice Not Found</h1>
        <p className="text-gray-500 text-sm">{error}</p>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen bg-[#f6f4ef]">
      {/* Header */}
      <div className="bg-[#1a3d30] text-white relative overflow-hidden">
        <div className="absolute -right-8 -top-8 w-32 h-32 rounded-full border border-white/5" />
        <div className="absolute -right-3 -top-3 w-20 h-20 rounded-full border border-white/5" />
        <div className="absolute -left-6 -bottom-6 w-24 h-24 rounded-full border border-white/5" />
        <div className="absolute left-1/3 -top-4 w-16 h-16 rounded-full bg-white/3" />
        <div className="absolute right-1/4 bottom-2 w-10 h-10 rounded-full border border-white/5" />

        <div className="max-w-lg mx-auto px-6 py-8 relative z-10">
          <div className="flex items-center gap-3 mb-6">
            <img src="/logo.png" alt="" className="w-12 h-12 rounded-xl object-contain" />
            <div>
              <h1 className="font-bold text-lg tracking-tight" style={{ fontFamily: 'Outfit, sans-serif' }}>{SHOP.name}</h1>
              <p className="text-white/50 text-xs">{SHOP.tagline}</p>
            </div>
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-white/50 text-xs uppercase tracking-wider">Invoice</p>
              <p className="text-xl font-extrabold mt-0.5">{order?.order_no}</p>
            </div>
            {isPaid ? (
              <div className="bg-emerald-500 text-white px-4 py-2 rounded-full text-sm font-bold flex items-center gap-1.5">✓ Paid</div>
            ) : (
              <div className="bg-amber-500 text-white px-4 py-2 rounded-full text-sm font-bold">Pending</div>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-lg mx-auto px-6 py-6">
        {/* Items */}
        <div className="bg-white rounded-2xl overflow-hidden mb-4">
          <div className="px-4 py-3 border-b border-gray-100">
            <p className="text-xs text-gray-400 uppercase tracking-wider font-semibold">Order Items</p>
          </div>
          {order?.items?.map((it, i) => (
            <div key={i} className="flex justify-between items-center px-4 py-3 border-b border-gray-50 last:border-0">
              <div>
                <p className="text-sm font-semibold text-gray-900">{it.name}</p>
                <p className="text-xs text-gray-400">{it.qty} × {money(it.price)}</p>
              </div>
              <p className="text-sm font-bold text-gray-900">{money(it.lineTotal || it.price * it.qty)}</p>
            </div>
          ))}
          {/* Total */}
          <div className="flex justify-between items-center px-4 py-4 bg-gray-50">
            <span className="text-base font-bold text-gray-900">Total</span>
            <span className="text-xl font-extrabold text-[#1a3d30]">{money(order?.total)}</span>
          </div>
        </div>

        {/* Delivery Details Form — only show if not paid */}
        {!isPaid && (
          <div className="bg-white rounded-2xl p-5 mb-4">
            <div className="flex items-center gap-2 mb-4">
              <span className="text-lg">🚚</span>
              <h3 className="text-sm font-bold text-gray-900">Delivery Details</h3>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Full Name *</label>
                <input type="text" className="w-full h-12 px-4 bg-gray-50 border border-gray-200 rounded-xl text-sm font-medium focus:outline-none focus:border-[#3d8b6a]"
                  placeholder="Your full name" value={name} onChange={e => setName(e.target.value)} />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Phone Number *</label>
                <input type="tel" className="w-full h-12 px-4 bg-gray-50 border border-gray-200 rounded-xl text-sm font-medium focus:outline-none focus:border-[#3d8b6a]"
                  placeholder="0XX XXX XXXX" value={phone} onChange={e => setPhone(e.target.value)} />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Delivery Address *</label>
                <input type="text" className="w-full h-12 px-4 bg-gray-50 border border-gray-200 rounded-xl text-sm font-medium focus:outline-none focus:border-[#3d8b6a]"
                  placeholder="e.g. Adenta, Frafraha Estate" value={address} onChange={e => setAddress(e.target.value)} />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Nearest Landmark</label>
                <input type="text" className="w-full h-12 px-4 bg-gray-50 border border-gray-200 rounded-xl text-sm font-medium focus:outline-none focus:border-[#3d8b6a]"
                  placeholder="e.g. Near Shell filling station" value={landmark} onChange={e => setLandmark(e.target.value)} />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Special Instructions</label>
                <textarea className="w-full h-20 px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm font-medium focus:outline-none focus:border-[#3d8b6a] resize-none"
                  placeholder="e.g. Call before delivery, gate is blue..." value={notes} onChange={e => setNotes(e.target.value)} />
              </div>
            </div>

            {saved && <div className="mt-3 text-xs text-emerald-600 font-semibold flex items-center gap-1">✓ Details saved</div>}
          </div>
        )}

        {/* Show delivery details if paid */}
        {isPaid && hasDelivery && (
          <div className="bg-white rounded-2xl p-4 mb-4">
            <p className="text-xs text-gray-400 uppercase tracking-wider mb-2 font-semibold">Delivery Details</p>
            <p className="font-bold text-gray-900">{order.customer_name}</p>
            <p className="text-sm text-gray-500">{order.customer_phone}</p>
            <p className="text-sm text-gray-500 mt-1">📍 {order.address}</p>
            {order.notes && order.notes !== 'Invoice from POS' && <p className="text-sm text-gray-400 mt-1 italic">"{order.notes}"</p>}
          </div>
        )}

        {/* Payment */}
        {isPaid ? (
          <div className="bg-emerald-50 border-2 border-emerald-200 rounded-2xl p-6 text-center">
            <div className="text-4xl mb-3">✅</div>
            <h3 className="text-lg font-bold text-emerald-700">Payment Received!</h3>
            <p className="text-sm text-emerald-600 mt-1">Thank you for your purchase. Your order is being processed.</p>
            {order?.paid_at && <p className="text-xs text-emerald-500 mt-2">Paid on {new Date(order.paid_at).toLocaleString('en-GB')}</p>}
          </div>
        ) : (
          <div>
            {error && <div className="bg-red-50 border border-red-200 text-red-600 p-3 rounded-xl mb-3 text-sm font-medium">{error}</div>}

            <button onClick={handlePay} disabled={paying}
              className="w-full h-14 bg-[#1a3d30] hover:bg-[#265a44] text-white rounded-2xl text-base font-bold flex items-center justify-center gap-2 active:scale-[.98] transition disabled:opacity-50">
              {paying ? (
                <><div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Processing...</>
              ) : (
                <>💳 Pay {money(order?.total)}</>
              )}
            </button>

            <p className="text-center text-xs text-gray-400 mt-3">Secured by Paystack • Card & Mobile Money accepted</p>

            <div className="bg-[#f0ece4] rounded-xl p-3 mt-4">
              <p className="text-xs text-gray-500 text-center">💡 Fill in your delivery details above before paying. Your info will be saved automatically when you pay.</p>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="text-center mt-8 pb-8">
          <p className="text-xs text-gray-400">{SHOP.phone}</p>
          <p className="text-xs text-gray-400">{SHOP.address}</p>
          <p className="text-xs text-gray-300 mt-2">Powered by {SHOP.name}</p>
        </div>
      </div>
    </div>
  )
}
