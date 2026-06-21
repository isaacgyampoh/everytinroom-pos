import { useState, useEffect } from 'react'
import { getSupabase } from '../lib/supabase'
import { fmtDateTime } from '../lib/utils'
import { LogoFlat } from '../components/Logo'

export default function DeliveryConfirm() {
  const [order, setOrder] = useState(null)
  const [loading, setLoading] = useState(true)
  const [confirming, setConfirming] = useState(false)
  const [deliveryGuy, setDeliveryGuy] = useState('')
  const [notes, setNotes] = useState('')
  const [done, setDone] = useState(false)

  const orderId = window.location.hash.split('/deliver/')[1]

  useEffect(() => {
    if (!orderId) return
    const load = async () => {
      const sb = getSupabase()
      const { data } = await sb.from('whatsapp_orders').select('*').eq('id', orderId).single()
      if (data) setOrder(data)
      setLoading(false)
    }
    load()
  }, [orderId])

  const confirmDelivery = async () => {
    if (!deliveryGuy.trim()) return
    setConfirming(true)
    const sb = getSupabase()
    await sb.from('whatsapp_orders').update({
      delivery_status: 'Delivered',
      delivery_guy: deliveryGuy.trim(),
      delivered_at: new Date().toISOString(),
      delivery_notes: notes.trim(),
      status: 'Completed',
    }).eq('id', orderId)
    setDone(true)
    setConfirming(false)
    // Auto-close tab after 3 seconds
    setTimeout(() => { window.close() }, 3000)
  }

  if (loading) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="w-6 h-6 border-2 border-gray-200 border-t-gray-800 rounded-full animate-spin" />
    </div>
  )

  if (!order) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="text-center">
        <div className="text-5xl mb-4">?</div>
        <h1 className="text-xl font-bold text-gray-900">Order not found</h1>
        <p className="text-gray-400 text-sm mt-2">This delivery link may be invalid.</p>
      </div>
    </div>
  )

  if (done || order.delivery_status === 'Delivered') return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="text-center max-w-sm">
        <div className="w-20 h-20 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-5">
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#111" strokeWidth="2.5" strokeLinecap="round"><path d="M20 6L9 17l-5-5"/></svg>
        </div>
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Delivered</h1>
        <p className="text-gray-500 text-sm">Order {order.order_no} confirmed.</p>
        {(deliveryGuy || order.delivery_guy) && <p className="text-gray-400 text-xs mt-2">By: {deliveryGuy || order.delivery_guy}</p>}
        {done && <p className="text-gray-300 text-xs mt-4">This tab will close automatically...</p>}
      </div>
    </div>
  )

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-100 px-5 py-4">
        <LogoFlat height={26} tagline={false} />
      </div>

      <div className="max-w-md mx-auto px-5 py-6">
        {/* Tracking badge */}
        {order.tracking_no && (
          <div className="bg-gray-900 text-white rounded-xl px-4 py-3 mb-5 flex items-center justify-between">
            <div>
              <div className="text-[10px] text-gray-400 uppercase tracking-wider">Tracking</div>
              <div className="text-sm font-bold font-mono">{order.tracking_no}</div>
            </div>
            <div className="text-right">
              <div className="text-[10px] text-gray-400 uppercase tracking-wider">Status</div>
              <div className="text-sm font-bold text-amber-400">{order.status}</div>
            </div>
          </div>
        )}

        {/* Order info */}
        <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden mb-5">
          <div className="p-4 border-b border-gray-50">
            <div className="text-xs text-gray-400 mb-1">Order</div>
            <div className="text-lg font-bold">{order.order_no}</div>
          </div>
          <div className="p-4">
            <div className="text-xs text-gray-400 mb-1">Deliver To</div>
            <div className="text-base font-bold">{order.customer_name || 'Customer'}</div>
            <div className="text-sm text-gray-500 mt-1">{order.customer_phone}</div>
            {order.address && <div className="text-sm font-semibold text-gray-700 mt-2 bg-gray-50 rounded-xl p-3">{order.address}</div>}
          </div>
        </div>

        {/* Delivery confirmation form */}
        <div className="bg-white rounded-2xl border border-gray-100 p-5">
          <h2 className="text-base font-bold mb-4">Confirm Delivery</h2>
          
          <div className="mb-4">
            <label className="text-xs text-gray-400 block mb-1.5">Delivery person name *</label>
            <input 
              className="w-full h-12 px-4 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-gray-400"
              placeholder="Enter your name"
              value={deliveryGuy}
              onChange={e => setDeliveryGuy(e.target.value)}
            />
          </div>

          <div className="mb-5">
            <label className="text-xs text-gray-400 block mb-1.5">Notes (optional)</label>
            <textarea 
              className="w-full h-20 px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-gray-400 resize-none"
              placeholder="e.g. Left with security, customer not home..."
              value={notes}
              onChange={e => setNotes(e.target.value)}
            />
          </div>

          <button 
            onClick={confirmDelivery}
            disabled={!deliveryGuy.trim() || confirming}
            className="w-full h-13 bg-gray-900 text-white rounded-xl text-sm font-bold disabled:opacity-30 active:scale-[.98] transition"
          >
            {confirming ? 'Confirming...' : 'Confirm Delivery'}
          </button>
        </div>
      </div>
    </div>
  )
}
