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

  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [address, setAddress] = useState('')
  const [landmark, setLandmark] = useState('')
  const [notes, setNotes] = useState('')

  const orderId = window.location.hash.split('/pay/')[1]

  useEffect(() => {
    if (!orderId) { setError('Invalid link'); setLoading(false); return }
    loadOrder()
  }, [orderId])

  const loadOrder = async () => {
    const sb = getSupabase()
    const { data, error: err } = await sb.from('whatsapp_orders').select('*').eq('id', orderId).single()
    if (err || !data) { setError('Invoice not found'); setLoading(false); return }
    const items = typeof data.items === 'string' ? JSON.parse(data.items) : (data.items || [])
    setOrder({ ...data, items })
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
    // Security: re-check order status before payment
    const sb = getSupabase()
    const { data: fresh } = await sb.from('whatsapp_orders').select('status').eq('id', orderId).single()
    if (fresh?.status === 'Cancelled') { setError('This order has been cancelled. Please contact the shop.'); return }
    if (fresh?.status === 'Paid' || fresh?.status === 'Completed') { setError('This order has already been paid.'); await loadOrder(); return }

    if (!name.trim()) { setError('Please enter your name'); return }
    if (!phone.trim() || phone.trim().length < 9) { setError('Please enter a valid phone number'); return }
    if (!address.trim()) { setError('Please enter your delivery address'); return }

    await saveDelivery()

    if (!order) return
    setPaying(true)
    setError('')
    try {
      const res = await fetch('https://noiiuwkovoojkcwzupye.supabase.co/functions/v1/charge-momo?action=initialize', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: phone.trim() || order.customer_phone,
          amount: amountToPay,
          callbackUrl: window.location.href,
          metadata: { order_id: order.id, order_no: order.order_no, customer: name.trim() }
        }),
      })
      const data = await res.json()
      if (data.success && data.authorizationUrl) {
        await sb.from('whatsapp_orders').update({ paystack_ref: data.reference }).eq('id', order.id)
        window.location.href = data.authorizationUrl
      } else {
        setPaying(false)
        setError(data.error || 'Payment could not be processed. Please try again.')
      }
    } catch (e) {
      setPaying(false)
      setError('Connection error. Please check your internet and try again.')
    }
  }

  // Payment callback
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const ref = params.get('reference') || params.get('trxref')
    if (ref && orderId) {
      const sb = getSupabase()
      sb.from('whatsapp_orders').update({
        paystack_ref: ref,
        paid_at: new Date().toISOString(),
        status: 'Paid'
      }).eq('id', orderId).then(async () => {
        await loadOrder()
        // Send WhatsApp payment confirmation
        try {
          const { data: o } = await sb.from('whatsapp_orders').select('customer_phone,customer_name,order_no,total').eq('id', orderId).single()
          if (o?.customer_phone) {
            const name = o.customer_name ? ` ${o.customer_name}` : ''
            const msg = `Hi${name}! Thank you for completing your payment.\n\nOrder ID: ${o.order_no}\nAmount: GHS ${Number(o.total).toFixed(2)}\n\nYour order will be packaged and our delivery team will contact you to arrange delivery and let you know the delivery fee to your location.\n\nThank you for shopping with EVERYTINROOM!`
            const phone = o.customer_phone.replace(/\D/g, '')
            const chatId = phone.startsWith('0') ? '233' + phone.slice(1) : phone
            await fetch('https://noiiuwkovoojkcwzupye.supabase.co/functions/v1/super-processor', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'send_confirmation', chatId, message: msg })
            }).catch(() => {})
          }
        } catch (e) { console.error('Confirmation send error:', e) }
      })
    }
  }, [])

  const isPaid = order?.status === 'Paid' || order?.status === 'Completed' || order?.paid_at
  const isCancelled = order?.status === 'Cancelled'
  const hasDelivery = order?.address && order.address.length > 3

  // Processing fee: 1.95% added silently to Paystack charge
  const orderTotal = Number(order?.total || 0)
  const amountToPay = Math.ceil(orderTotal * 1.0195 * 100) / 100

  // Loading
  if (loading) return (
    <div className="min-h-screen bg-[#f6f4ef] flex items-center justify-center">
      <div className="w-8 h-8 border-3 border-[#d4dbd0] border-t-[#3d8b6a] rounded-full animate-spin" />
    </div>
  )

  // Not found
  if (error && !order) return (
    <div className="min-h-screen bg-[#f6f4ef] flex items-center justify-center p-6">
      <div className="text-center max-w-sm">
        <h1 className="text-xl font-bold text-gray-800 mb-2">Invoice Not Found</h1>
        <p className="text-gray-500 text-sm">{error}</p>
        <p className="text-gray-400 text-xs mt-4">If you believe this is an error, please contact the shop on {SHOP.phone}</p>
      </div>
    </div>
  )

  // Cancelled
  if (isCancelled) return (
    <div className="min-h-screen bg-[#f6f4ef]">
      <div className="bg-[#1a3d30] text-white relative overflow-hidden">
        <div className="max-w-lg mx-auto px-6 py-8 relative z-10">
          <div className="flex items-center gap-3 mb-6">
            <img src="/logo.png" alt="" className="w-10 h-10 rounded-xl" />
            <div>
              <h1 className="font-bold text-lg tracking-tight" style={{ fontFamily: 'Outfit, sans-serif' }}>{SHOP.name}</h1>
              <p className="text-white/50 text-xs">{SHOP.tagline}</p>
            </div>
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-white/50 text-xs uppercase tracking-wider">Invoice</p>
              <p className="text-xl font-bold mt-0.5">{order?.order_no}</p>
            </div>
            <div className="bg-red-500 text-white px-4 py-2 rounded-full text-sm font-bold">Cancelled</div>
          </div>
        </div>
      </div>
      <div className="max-w-lg mx-auto px-6 py-8">
        <div className="bg-red-50 border-2 border-red-200 rounded-2xl p-6 text-center">
          <h3 className="text-lg font-bold text-red-700 mb-2">Order Cancelled</h3>
          <p className="text-sm text-red-600">This order has been cancelled and payment is no longer accepted.</p>
          <p className="text-sm text-gray-500 mt-3">If you would like to place a new order, please contact us:</p>
          <p className="text-sm font-semibold text-gray-700 mt-1">{SHOP.phone}</p>
        </div>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen bg-[#f6f4ef]">
      {/* Header */}
      <div className="bg-[#1a3d30] text-white relative overflow-hidden">

        <div className="max-w-lg mx-auto px-6 py-8 relative z-10">
          <div className="flex items-center gap-3 mb-6">
            <img src="/logo.png" alt="" className="w-10 h-10 rounded-xl" />
            <div>
              <h1 className="font-bold text-lg tracking-tight" style={{ fontFamily: 'Outfit, sans-serif' }}>{SHOP.name}</h1>
              <p className="text-white/50 text-xs">{SHOP.tagline}</p>
            </div>
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-white/50 text-xs uppercase tracking-wider">Invoice</p>
              <p className="text-xl font-bold mt-0.5">{order?.order_no}</p>
            </div>
            {isPaid ? (
              <div className="bg-gray-800 text-white px-4 py-2 rounded-xl text-sm font-bold">Paid</div>
            ) : (
              <div className="bg-gray-200 text-gray-700 px-4 py-2 rounded-xl text-sm font-bold">Awaiting Payment</div>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-lg mx-auto px-6 py-6">
        {/* Items */}
        <div className="bg-white rounded-2xl overflow-hidden mb-4">
          <div className="px-4 py-3 border-b border-gray-100">
            <p className="text-xs text-gray-400 uppercase tracking-wider font-semibold">Order Summary</p>
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
          <div className="flex justify-between items-center px-4 py-4 bg-gray-50">
            <span className="text-base font-bold text-gray-900">Total</span>
            <span className="text-xl font-bold text-[#1a3d30]">{money(orderTotal)}</span>
          </div>
        </div>

        {/* Delivery form — only when not paid */}
        {!isPaid && (
          <div className="bg-white rounded-2xl p-5 mb-4">
            <h3 className="text-sm font-bold text-gray-900 mb-4">Delivery Details</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Full Name *</label>
                <input type="text" className="w-full h-12 px-4 bg-gray-50 border border-gray-200 rounded-xl text-sm font-medium focus:outline-none focus:border-[#3d8b6a]"
                  placeholder="Your full name" value={name} onChange={e => setName(e.target.value)} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Phone Number *</label>
                <input type="tel" className="w-full h-12 px-4 bg-gray-50 border border-gray-200 rounded-xl text-sm font-medium focus:outline-none focus:border-[#3d8b6a]"
                  placeholder="e.g. 024 XXX XXXX" value={phone} onChange={e => setPhone(e.target.value)} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Delivery Address *</label>
                <input type="text" className="w-full h-12 px-4 bg-gray-50 border border-gray-200 rounded-xl text-sm font-medium focus:outline-none focus:border-[#3d8b6a]"
                  placeholder="Area, street name or description" value={address} onChange={e => setAddress(e.target.value)} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Nearest Landmark</label>
                <input type="text" className="w-full h-12 px-4 bg-gray-50 border border-gray-200 rounded-xl text-sm font-medium focus:outline-none focus:border-[#3d8b6a]"
                  placeholder="e.g. Near the Shell station" value={landmark} onChange={e => setLandmark(e.target.value)} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Delivery Notes</label>
                <textarea className="w-full h-20 px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm font-medium focus:outline-none focus:border-[#3d8b6a] resize-none"
                  placeholder="Any additional information for delivery" value={notes} onChange={e => setNotes(e.target.value)} />
              </div>
            </div>
            {saved && <div className="mt-3 text-xs text-emerald-600 font-semibold">Details saved</div>}
          </div>
        )}

        {/* Delivery summary after payment */}
        {isPaid && hasDelivery && (
          <div className="bg-white rounded-2xl p-4 mb-4">
            <p className="text-xs text-gray-400 uppercase tracking-wider mb-2 font-semibold">Delivery Details</p>
            <p className="font-bold text-gray-900">{order.customer_name}</p>
            <p className="text-sm text-gray-500">{order.customer_phone}</p>
            <p className="text-sm text-gray-500 mt-1">{order.address}</p>
            {order.notes && order.notes !== 'Invoice from POS' && <p className="text-sm text-gray-400 mt-1">Note: {order.notes}</p>}
          </div>
        )}

        {/* Payment section */}
        {isPaid ? (
          <div className="space-y-4">
            <div className="bg-gray-50 border border-gray-200 rounded-2xl p-6 text-center">
              <h3 className="text-lg font-bold text-emerald-700">Payment Received</h3>
              <p className="text-sm text-emerald-600 mt-1">Thank you. Your order is being prepared.</p>
              {order?.paid_at && <p className="text-xs text-emerald-500 mt-2">Paid on {new Date(order.paid_at).toLocaleString('en-GB')}</p>}
            </div>

            <div className="bg-gray-50 border border-gray-200 rounded-2xl p-5">
              <h4 className="text-sm font-bold text-amber-800 mb-1">About Delivery</h4>
              <p className="text-sm text-amber-700">A team member will contact you shortly to confirm your delivery details and delivery fee based on your location.</p>
              <p className="text-xs text-amber-600 mt-2">For urgent enquiries, call: {SHOP.phone}</p>
            </div>
          </div>
        ) : (
          <div>
            {error && <div className="bg-red-50 border border-red-200 text-red-600 p-3 rounded-xl mb-3 text-sm font-medium">{error}</div>}

            <button onClick={handlePay} disabled={paying}
              className="w-full h-14 bg-[#1a3d30] hover:bg-[#265a44] text-white rounded-2xl text-base font-bold flex items-center justify-center gap-2 active:scale-[.98] transition disabled:opacity-50">
              {paying ? (
                <><div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Processing...</>
              ) : (
                <>Pay {money(orderTotal)}</>
              )}
            </button>

            <p className="text-center text-xs text-gray-400 mt-3">Secured by Paystack · Card and Mobile Money accepted</p>

            {order?.ussd_code && (
              <div className="mt-4 bg-gray-50 border border-gray-200 rounded-2xl p-4 text-center">
                <p className="text-xs text-amber-600 font-semibold mb-1">Or pay via USSD (no internet needed)</p>
                <p className="text-lg font-bold text-amber-900 font-mono tracking-wider">*920*141*{order.ussd_code}#</p>
                <p className="text-[11px] text-amber-500 mt-1">Dial this code on your phone → confirm → pay with MoMo</p>
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="text-center mt-8 pb-8">
          <p className="text-xs text-gray-400">{SHOP.phone}</p>
          <p className="text-xs text-gray-400">{SHOP.address}</p>
        </div>
      </div>
    </div>
  )
}
