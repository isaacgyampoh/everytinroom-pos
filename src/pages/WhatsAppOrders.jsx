import { useState } from 'react'
import { useStore } from '../hooks/useStore'
import { getSupabase } from '../lib/supabase'
import { money, fmtDateTime } from '../lib/utils'
import Modal from '../components/Modal'
import toast from 'react-hot-toast'

export default function WhatsAppOrders() {
  const { waOrders, waFilter, setWAFilter, refreshWAOrders, user, setLoading, loadAll } = useStore()
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState(null)
  const [editDelivery, setEditDelivery] = useState(false)
  const [editName, setEditName] = useState('')
  const [editPhone, setEditPhone] = useState('')
  const [editAddress, setEditAddress] = useState('')
  const [editNotes, setEditNotes] = useState('')

  const pending = waOrders.filter(o => o.status === 'Pending').length
  const paid = waOrders.filter(o => o.status === 'Paid').length
  const completed = waOrders.filter(o => o.status === 'Completed').length

  const filtered = waFilter === 'all' ? waOrders : waOrders.filter(o => o.status === waFilter)
  const searched = search.trim()
    ? filtered.filter(o => (o.customerName || '').toLowerCase().includes(search.toLowerCase()) || (o.customerPhone || '').includes(search) || (o.orderNo || '').toLowerCase().includes(search.toLowerCase()))
    : filtered
  const sorted = [...searched].sort((a, b) => new Date(b.date) - new Date(a.date))

  const complete = async (id) => {
    if (!confirm('Complete order? Stock will be deducted.')) return
    setLoading(true, 'Completing...')
    try {
      const sb = getSupabase()
      const { data, error } = await sb.rpc('complete_wa_order', { p_order_id: id, p_processed_by: user?.name || '' })
      setLoading(false)
      if (data?.success) { toast.success('Completed! ' + data.receiptNo); setSelected(null); loadAll() }
      else toast.error(data?.error || error?.message || 'Error')
    } catch (e) { setLoading(false); toast.error('Error') }
  }

  const cancel = async (id) => {
    const reason = prompt('Reason for cancellation:')
    if (reason === null) return
    setLoading(true, 'Cancelling...')
    const sb = getSupabase()
    await sb.from('whatsapp_orders').update({ status: 'Cancelled', processed_by: user?.name || '', processed_at: new Date().toISOString(), notes: reason }).eq('id', id)
    setLoading(false); setSelected(null); toast('Cancelled'); refreshWAOrders()
  }

  const markPackaged = async (id) => {
    const sb = getSupabase()
    
    // Get the full order to create a sales record
    const { data: orderData } = await sb.from('whatsapp_orders')
      .select('*')
      .eq('id', id)
      .limit(1)
    
    const order = orderData?.[0]
    
    // Update delivery status
    await sb.from('whatsapp_orders').update({
      delivery_status: 'Packaged',
      status: 'Completed',
      processed_by: user?.name || '',
      processed_at: new Date().toISOString(),
    }).eq('id', id)

    // Create a sales record if this is a paid order
    if (order && (order.status === 'Paid' || order.status === 'Completed')) {
      try {
        let items = order.items
        if (typeof items === 'string') items = JSON.parse(items)
        
        const saleTotal = Number(order.total) || 0
        const receiptNo = order.order_no || 'WA-' + Date.now()
        
        await sb.from('sales').insert({
          receipt_no: receiptNo,
          date: order.paid_at || order.date || new Date().toISOString(),
          items: items,
          subtotal: Number(order.subtotal) || saleTotal,
          discount: 0,
          total: saleTotal,
          profit: 0,
          payment: 'Momo',
          type: 'Retail',
          customer: order.customer_phone || order.customer_name || '',
          cashier: user?.name || 'Online',
          voided: false,
        })
        console.log('Sales record created for:', receiptNo)
      } catch (e) {
        console.error('Failed to create sales record:', e)
      }
    }

    setSelected(s => s ? { ...s, deliveryStatus: 'Packaged', status: 'Completed' } : s)
    refreshWAOrders()
    toast.success('Packaged — sales recorded')
  }

  const markDispatched = async (id, deliveryGuy) => {
    const sb = getSupabase()
    await sb.from('whatsapp_orders').update({
      delivery_status: 'Out for Delivery',
      delivery_guy: deliveryGuy,
    }).eq('id', id)
    setSelected(s => s ? { ...s, deliveryStatus: 'Out for Delivery', deliveryGuy } : s)
    refreshWAOrders()
    toast.success('Dispatched')
  }

  const markPickedUp = async (id, method) => {
    const sb = getSupabase()
    const who = method === 'self' ? 'Customer (Self Pickup)' : prompt('Rider/service name (e.g. Yango, Bolt):')
    if (!who) return
    await sb.from('whatsapp_orders').update({
      delivery_status: 'Picked Up',
      delivery_guy: who,
      delivered_at: new Date().toISOString(),
      status: 'Completed',
    }).eq('id', id)
    setSelected(s => s ? { ...s, deliveryStatus: 'Picked Up', deliveryGuy: who, deliveredAt: new Date().toISOString(), status: 'Completed' } : s)
    refreshWAOrders()
    toast.success(method === 'self' ? 'Customer picked up' : 'Picked up by ' + who)
  }

  const resendInvoice = (o) => {
    const link = window.location.origin + '/#/pay/' + o.id
    const lines = [`Hi${o.customerName ? ' ' + o.customerName : ''}, just a reminder about your order from EVERYTINROOM.`, '']
    o.items.forEach(it => lines.push(`${it.qty}x ${it.name} - ${money(it.lineTotal || it.price * it.qty)}`))
    lines.push('', `Total: ${money(o.total)}`, '', 'Please click the link below to make payment:', link, '', 'Thank you.')
    const msg = lines.join('\n')
    const waPhone = (o.customerPhone || '').replace(/^0/, '233')
    const isMobile = /Android|iPhone|iPad/i.test(navigator.userAgent)
    if (isMobile) window.location.href = `whatsapp://send?phone=${waPhone}&text=${encodeURIComponent(msg)}`
    else window.open(`https://web.whatsapp.com/send?phone=${waPhone}&text=${encodeURIComponent(msg)}`, '_blank')
    try { navigator.clipboard.writeText(msg) } catch {}
    toast.success('Invoice resent')
  }

  const saveDeliveryDetails = async () => {
    const sb = getSupabase()
    await sb.from('whatsapp_orders').update({
      customer_name: editName.trim(),
      customer_phone: editPhone.trim(),
      address: editAddress.trim(),
      notes: editNotes.trim() || null,
    }).eq('id', selected.id)
    setSelected({ ...selected, customerName: editName.trim(), customerPhone: editPhone.trim(), address: editAddress.trim(), notes: editNotes.trim() })
    setEditDelivery(false)
    refreshWAOrders()
    toast.success('Delivery details saved')
  }

  const startEditDelivery = (o) => {
    setEditName(o.customerName || '')
    setEditPhone(o.customerPhone || '')
    setEditAddress(o.address || '')
    setEditNotes(o.notes && o.notes !== 'Invoice from POS' && o.notes !== 'USSD order' ? o.notes : '')
    setEditDelivery(true)
  }

  const copyLink = (o) => {
    const link = window.location.origin + '/#/pay/' + o.id
    navigator.clipboard?.writeText(link)
    toast.success('Link copied')
  }

  const printSticker = (o) => {
    const deliverUrl = window.location.origin + '/#/deliver/' + o.id
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(deliverUrl)}`
    const trackNo = o.trackingNo || o.orderNo
    const orderDate = new Date(o.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })

    const w = window.open('', '_blank', 'width=420,height=700')
    w.document.write(`<!DOCTYPE html><html><head><title>${trackNo}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Helvetica Neue', 'Arial', sans-serif; width: 80mm; color: #000; }
  .s { margin: 1.5mm; border: 2.5px solid #000; }

  /* ── HEADER ── */
  .hd { background: #000; padding: 4mm; text-align: center; }
  .hd-name { color: #fff; font-size: 18px; font-weight: 900; letter-spacing: 3px; text-transform: uppercase; }
  .hd-tag { color: #fff; font-size: 6.5px; letter-spacing: 4px; text-transform: uppercase; opacity: 0.4; margin-top: 1mm; }
  .hd-line { height: 0.5mm; background: #fff; opacity: 0.15; margin: 2.5mm auto 0; width: 60%; }
  .hd-contact { color: #fff; font-size: 7.5px; margin-top: 2mm; opacity: 0.6; letter-spacing: 0.5px; }

  /* ── TRACKING ── */
  .trk { border-bottom: 2.5px solid #000; padding: 3mm 4mm; text-align: center; }
  .trk-label { font-size: 5.5px; text-transform: uppercase; letter-spacing: 3px; color: #aaa; font-weight: 700; }
  .trk-no { font-size: 22px; font-weight: 900; font-family: 'Courier New', monospace; letter-spacing: 3px; margin-top: 1.5mm; }
  .trk-bars { margin-top: 1.5mm; font-family: monospace; font-size: 10px; letter-spacing: -0.5px; color: #000; }

  /* ── SHIP SECTION ── */
  .ship { padding: 3.5mm 4mm; }

  .from { padding-bottom: 2.5mm; margin-bottom: 2.5mm; border-bottom: 1px solid #e0e0e0; }
  .from-label { font-size: 5px; text-transform: uppercase; letter-spacing: 3px; color: #bbb; font-weight: 700; }
  .from-val { font-size: 8px; font-weight: 600; color: #888; margin-top: 0.5mm; }

  .to-label { font-size: 5px; text-transform: uppercase; letter-spacing: 3px; color: #bbb; font-weight: 700; margin-bottom: 2mm; }
  .to-name { font-size: 20px; font-weight: 900; line-height: 1.1; letter-spacing: -0.3px; }
  .to-phone { font-size: 14px; font-weight: 800; margin-top: 2mm; letter-spacing: 0.5px; }
  .to-addr { font-size: 11px; font-weight: 600; line-height: 1.5; margin-top: 3mm; padding: 3mm; border: 1.5px solid #000; position: relative; }
  .to-addr::before { content: 'ADDRESS'; position: absolute; top: -1.5mm; left: 3mm; background: #fff; padding: 0 1.5mm; font-size: 5px; letter-spacing: 2px; color: #999; font-weight: 700; }

  /* ── QR ── */
  .qr { border-top: 2.5px solid #000; padding: 3mm 4mm; display: flex; gap: 3.5mm; align-items: center; }
  .qr img { width: 26mm; height: 26mm; border: 1.5px solid #000; padding: 1mm; }
  .qr-r { flex: 1; }
  .qr-t { font-size: 7px; font-weight: 900; text-transform: uppercase; letter-spacing: 1.5px; }
  .qr-d { font-size: 6px; color: #777; margin-top: 1mm; line-height: 1.5; }
  .qr-ref { font-size: 7px; font-weight: 800; font-family: monospace; margin-top: 2.5mm; letter-spacing: 0.5px; }
  .qr-date { font-size: 6.5px; color: #999; margin-top: 0.5mm; }

  /* ── FOOTER ── */
  .ft { background: #000; padding: 2mm 4mm; text-align: center; }
  .ft-text { color: #fff; font-size: 5.5px; letter-spacing: 3px; text-transform: uppercase; opacity: 0.5; }

  @media print { body { width: 80mm; } @page { size: 80mm auto; margin: 0; } }
</style></head><body>

<div class="s">

  <div class="hd">
    <div class="hd-name">EverytnRoom</div>
    <div class="hd-tag">Your One Stop Shop</div>
    <div class="hd-line"></div>
    <div class="hd-contact">024 531 5581 &nbsp;&bull;&nbsp; 024 936 5339</div>
  </div>

  <div class="trk">
    <div class="trk-label">Tracking Number</div>
    <div class="trk-no">${trackNo}</div>
    <div class="trk-bars">${'|'.repeat(40)}</div>
  </div>

  <div class="ship">
    <div class="from">
      <div class="from-label">From Sender</div>
      <div class="from-val">EverytnRoom &bull; Aviation Road J382, Adenta, Accra</div>
    </div>

    <div class="to-label">Deliver To Recipient</div>
    <div class="to-name">${(o.customerName || 'CUSTOMER').toUpperCase()}</div>
    <div class="to-phone">${o.customerPhone || ''}</div>
    ${o.address ? `<div class="to-addr">${o.address}</div>` : ''}
  </div>

  <div class="qr">
    <img src="${qrUrl}" alt="QR" />
    <div class="qr-r">
      <div class="qr-t">Scan to Confirm</div>
      <div class="qr-d">Delivery personnel: scan this code at destination to confirm successful delivery.</div>
      <div class="qr-ref">${o.orderNo}</div>
      <div class="qr-date">${orderDate}</div>
    </div>
  </div>

  <div class="ft">
    <div class="ft-text">Handle With Care &nbsp;&bull;&nbsp; EverytnRoom</div>
  </div>

</div>

<script>setTimeout(() => { window.print(); }, 600);</script>
</body></html>`)
    w.document.close()
  }

  const statusColor = (s) => {
    const sc = s?.toLowerCase()
    if (sc === 'paid') return 'bg-[#33363d] text-white'
    if (sc === 'completed') return 'bg-[#16181d] text-white'
    if (sc === 'cancelled') return 'bg-[#c0492f] text-white'
    return 'bg-[#16181d] text-white'
  }

  const deliveryColor = (s) => {
    if (s === 'Delivered') return 'bg-[#33363d] text-white'
    if (s === 'Picked Up') return 'bg-[#33363d] text-white'
    if (s === 'Out for Delivery') return 'bg-[#16181d] text-white'
    if (s === 'Packaged') return 'bg-[#5e6b62] text-white'
    return 'bg-[#dde2dc] text-[#5e6b62]'
  }

  const o = selected // shorthand for modal

  return (
    <div >
      <div className="flex justify-between items-start flex-wrap gap-4 mb-5">
        <div>
          <h1 className="text-[22px] md:text-[26px] font-bold tracking-tight">WhatsApp Invoices</h1>
          <p className="text-gray-400 text-sm mt-0.5">Send invoices, track payments</p>
        </div>
        <button onClick={refreshWAOrders} className="h-10 px-4 bg-white border border-gray-200 rounded-xl text-sm font-semibold text-gray-600 hover:bg-gray-50 transition">Refresh</button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3 mb-5">
        <div className="bg-gray-100 rounded-2xl p-4 text-gray-900">
          <div className="text-xs font-medium opacity-60">Pending</div><div className="text-[22px] font-bold mt-0.5">{pending}</div>
        </div>
        <div className="bg-gray-900 rounded-2xl p-4 text-white">
          <div className="text-xs font-medium opacity-70">Paid</div><div className="text-[22px] font-bold mt-0.5">{paid}</div>
        </div>
        <div className="bg-gray-900 rounded-2xl p-4 text-white">
          <div className="text-xs font-medium opacity-70">Completed</div><div className="text-[22px] font-bold mt-0.5">{completed}</div>
        </div>
      </div>

      {/* Search + Filters */}
      <input className="w-full h-10 px-4 bg-white rounded-xl text-sm placeholder:text-stone-300 border border-gray-100 focus:outline-none focus:ring-2 focus:ring-gray-400/30 mb-4" placeholder="Search by name, phone, or order #..." value={search} onChange={e => setSearch(e.target.value)} />

      <div className="flex gap-1.5 mb-5 overflow-x-auto scrollbar-hide">
        {['Pending', 'Paid', 'Completed', 'Cancelled', 'all'].map(f => (
          <button key={f} onClick={() => setWAFilter(f)}
            className={`h-8 px-4 rounded-full text-xs font-semibold whitespace-nowrap transition ${waFilter === f ? ('bg-gray-900 text-white') : 'bg-white text-stone-400'}`}>
            {f === 'all' ? 'All' : f}
          </button>
        ))}
      </div>

      {/* Orders — clickable cards */}
      <div className="space-y-3">
        {sorted.length === 0 && (
          <div className="text-center py-16">
            <p className="text-stone-400 text-sm">No invoices found</p>
            <p className="text-stone-300 text-xs mt-1">Go to POS to create and send one</p>
          </div>
        )}
        {sorted.map(order => (
          <div key={order.id} onClick={() => setSelected(order)} className="bg-white rounded-2xl overflow-hidden cursor-pointer hover:bg-stone-50/50 transition border border-transparent hover:border-stone-200">
            <div className="p-4">
              <div className="flex items-center justify-between mb-2.5">
                <div>
                  <div className="text-sm font-bold">{order.customerName || 'Customer'}</div>
                  <div className="text-xs text-stone-400 mt-0.5">{order.orderNo} · {fmtDateTime(order.date)}</div>
                </div>
                <span className={`px-3 py-1.5 rounded-lg text-[11px] font-bold ${statusColor(order.status)}`}>{order.status}</span>
              </div>
              <div className="text-xs text-stone-400 mb-2 flex items-center gap-2 flex-wrap">
                <span>{order.items.length} item{order.items.length !== 1 ? 's' : ''}</span>
                {order.deliveryStatus && (
                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${deliveryColor(order.deliveryStatus)}`}>{order.deliveryStatus}</span>
                )}
                {order.deliveryGuy && <span className="text-[10px]">· {order.deliveryGuy}</span>}
                {order.notes && order.notes.includes('PICKUP') && <span className="text-[10px] font-bold text-amber-600">PICKUP</span>}
                {order.notes && order.notes.includes('DELIVERY') && <span className="text-[10px] font-bold text-blue-600">DELIVERY</span>}
              </div>
              <div className="flex items-center justify-between pt-2.5 border-t border-stone-100">
                <div className="text-lg font-bold">{money(order.total)}</div>
                <span className="text-xs font-medium text-gray-700">View details</span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Order Detail Modal */}
      <Modal open={!!selected} onClose={() => { setSelected(null); setEditDelivery(false) }} title="Order Details">
        {o && (
          <div className="space-y-4">
            {/* Status + Order No */}
            <div className="flex items-center justify-between">
              <div>
                <div className="text-lg font-bold">{o.orderNo}</div>
                <div className="text-xs text-gray-400">{fmtDateTime(o.date)}</div>
              </div>
              <span className={`px-4 py-1.5 rounded-full text-xs font-bold ${statusColor(o.status)}`}>{o.status}</span>
            </div>

            {/* Customer + Delivery Info */}
            <div className="bg-gray-50 rounded-xl p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="text-xs text-gray-400 uppercase tracking-wider font-semibold">Customer & Delivery</div>
                {!editDelivery && (
                  <button onClick={() => startEditDelivery(o)} className="text-xs font-semibold text-gray-500 hover:text-gray-800 transition">Edit</button>
                )}
              </div>

              {editDelivery ? (
                <div className="space-y-3">
                  <div>
                    <label className="text-[11px] text-gray-400 block mb-1">Name</label>
                    <input className="w-full h-10 px-3 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-gray-400" value={editName} onChange={e => setEditName(e.target.value)} placeholder="Customer name" />
                  </div>
                  <div>
                    <label className="text-[11px] text-gray-400 block mb-1">Phone</label>
                    <input className="w-full h-10 px-3 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-gray-400" value={editPhone} onChange={e => setEditPhone(e.target.value)} placeholder="0XX XXX XXXX" />
                  </div>
                  <div>
                    <label className="text-[11px] text-gray-400 block mb-1">Delivery Address</label>
                    <textarea className="w-full h-20 px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-gray-400 resize-none" value={editAddress} onChange={e => setEditAddress(e.target.value)} placeholder="Region, city, area, landmark..." />
                  </div>
                  <div>
                    <label className="text-[11px] text-gray-400 block mb-1">Notes (optional)</label>
                    <input className="w-full h-10 px-3 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-gray-400" value={editNotes} onChange={e => setEditNotes(e.target.value)} placeholder="Special instructions..." />
                  </div>
                  <div className="flex gap-2 pt-1">
                    <button onClick={saveDeliveryDetails} className="flex-1 h-10 bg-gray-900 text-white rounded-lg text-sm font-semibold active:scale-[.98] transition">Save</button>
                    <button onClick={() => setEditDelivery(false)} className="flex-1 h-10 bg-white border border-gray-200 text-gray-600 rounded-lg text-sm font-semibold active:scale-[.98] transition">Cancel</button>
                  </div>
                </div>
              ) : (
                <div>
                  <div className="text-sm font-bold">{o.customerName || 'No name'}</div>
                  <div className="text-sm text-gray-500">{o.customerPhone || 'No phone'}</div>
                  {o.address ? (
                    <div className="text-sm font-semibold text-gray-700 mt-2 bg-white rounded-lg p-3 border border-gray-100">{o.address}</div>
                  ) : (
                    <button onClick={() => startEditDelivery(o)} className="mt-2 w-full h-10 bg-white border-2 border-dashed border-gray-200 rounded-lg text-sm text-gray-400 font-medium hover:border-gray-300 hover:text-gray-500 transition">
                      + Add delivery address
                    </button>
                  )}
                  {o.notes && o.notes !== 'Invoice from POS' && o.notes !== 'USSD order' && <div className="text-xs text-gray-400 mt-2 italic">{o.notes}</div>}
                </div>
              )}
            </div>

            {/* Items */}
            <div className="bg-gray-50 rounded-xl overflow-hidden">
              <div className="px-4 py-2.5 border-b border-gray-200/50">
                <div className="text-xs text-gray-400 uppercase tracking-wider font-semibold">Items ({o.items.length})</div>
              </div>
              {o.items.map((it, i) => (
                <div key={i} className="flex justify-between items-center px-4 py-3 border-b border-gray-100 last:border-0">
                  <div>
                    <div className="text-sm font-semibold">{it.name}</div>
                    <div className="text-xs text-gray-400">{it.qty} × {money(it.price)}</div>
                  </div>
                  <div className="text-sm font-bold">{money(it.lineTotal || it.price * it.qty)}</div>
                </div>
              ))}
              <div className="flex justify-between px-4 py-3 bg-gray-100/50">
                <span className="text-sm font-bold">Total</span>
                <span className="text-lg font-bold">{money(o.total)}</span>
              </div>
            </div>

            {/* USSD Payment Code */}
            {o.ussdCode && (
              <div className="bg-gray-50 rounded-xl p-4 border border-gray-200">
                <div className="text-xs text-gray-500 uppercase tracking-wider mb-2 font-semibold">USSD Payment Code</div>
                <div className="flex items-center justify-between">
                  <div className="text-lg font-bold text-gray-900 font-mono tracking-wider">*920*141*{o.ussdCode}#</div>
                  <button onClick={(e) => { e.stopPropagation(); navigator.clipboard?.writeText(`*920*141*${o.ussdCode}#`); toast.success('USSD code copied!') }}
                    className="h-9 px-4 bg-gray-500 text-white rounded-lg text-xs font-bold active:scale-95 transition">Copy</button>
                </div>
              </div>
            )}

            {/* Payment Info */}
            {o.paystackRef && (
              <div className="bg-gray-50 rounded-xl p-4">
                <div className="text-xs text-gray-400 uppercase tracking-wider mb-2 font-semibold">Payment</div>
                <div className="text-sm text-gray-600">Paystack Ref: <span className="font-mono font-semibold">{o.paystackRef}</span></div>
                {o.paidAt && <div className="text-sm text-gray-500 mt-1">Paid: {fmtDateTime(o.paidAt)}</div>}
              </div>
            )}

            {/* Processed Info */}
            {o.processedBy && (
              <div className="bg-gray-50 rounded-xl p-4">
                <div className="text-xs text-gray-400 uppercase tracking-wider mb-2 font-semibold">Processed</div>
                <div className="text-sm text-gray-600">By: <span className="font-semibold">{o.processedBy}</span></div>
                {o.processedAt && <div className="text-sm text-gray-500 mt-1">{fmtDateTime(o.processedAt)}</div>}
              </div>
            )}

            {/* Delivery Tracking Pipeline */}
            {o.trackingNo && (
              <div className="bg-gray-50 rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="text-xs text-gray-400 uppercase tracking-wider font-semibold">Delivery Tracking</div>
                  <div className="text-xs font-bold font-mono text-gray-500">{o.trackingNo}</div>
                </div>

                {/* Pipeline steps */}
                <div className="flex items-center gap-1 mb-3">
                  {(() => {
                    const ds = o.deliveryStatus || ''
                    const isPickup = ds === 'Picked Up'
                    const steps = isPickup
                      ? ['Paid', 'Packaged', 'Picked Up']
                      : ['Paid', 'Packaged', 'Dispatched', 'Delivered']
                    const stageMap = isPickup
                      ? { '': 0, 'Packaged': 1, 'Picked Up': 2 }
                      : { '': 0, 'Packaged': 1, 'Out for Delivery': 2, 'Delivered': 3 }
                    const currentIdx = stageMap[ds] ?? 0
                    return steps.map((label, i) => (
                      <div key={label} className="flex-1 flex flex-col items-center">
                        <div className={`w-full h-[4px] rounded-full ${i <= currentIdx ? 'bg-gray-900' : 'bg-gray-200'}`} />
                        <div className={`text-[9px] mt-1 font-semibold ${i <= currentIdx ? 'text-gray-900' : 'text-gray-300'}`}>{label}</div>
                      </div>
                    ))
                  })()}
                </div>

                {/* Current status detail */}
                <div className="flex items-center justify-between">
                  <span className={`px-2.5 py-1 rounded-lg text-[10px] font-bold ${deliveryColor(o.deliveryStatus)}`}>
                    {o.deliveryStatus || 'Awaiting packaging'}
                  </span>
                  <div className="text-right">
                    {o.deliveryGuy && <div className="text-[11px] text-gray-500">By: {o.deliveryGuy}</div>}
                    {o.deliveredAt && <div className="text-[10px] text-gray-400">{fmtDateTime(o.deliveredAt)}</div>}
                  </div>
                </div>
              </div>
            )}

            {/* Actions */}
            {o.status === 'Pending' && (
              <div className="space-y-2 pt-2">
                <button onClick={() => resendInvoice(o)} className="w-full h-12 bg-[#25d366] text-white rounded-xl text-sm font-bold active:scale-[.98] transition">Resend Invoice</button>
                <div className="flex gap-2">
                  <button onClick={() => copyLink(o)} className="flex-1 h-11 bg-gray-100 text-gray-700 rounded-xl text-sm font-semibold active:scale-[.98] transition">Copy Link</button>
                  {o.ussdCode && <button onClick={() => { navigator.clipboard?.writeText(`*920*141*${o.ussdCode}#`); toast.success('USSD code copied!') }} className="flex-1 h-11 bg-gray-800 text-white rounded-xl text-sm font-semibold active:scale-[.98] transition">Copy USSD</button>}
                  <button onClick={() => cancel(o.id)} className="flex-1 h-11 bg-white text-red-500 rounded-xl text-sm font-semibold active:scale-[.98] transition border border-red-200">Cancel</button>
                </div>
              </div>
            )}

            {(o.status === 'Paid' || o.status === 'Completed') && (
              <div className="space-y-2 pt-2">

                {/* Step 1: Process & Package */}
                {(!o.deliveryStatus || o.deliveryStatus === '') && o.status === 'Paid' && (
                  <button onClick={() => { markPackaged(o.id); complete(o.id) }} className="w-full h-12 bg-gray-900 text-white rounded-xl text-sm font-bold active:scale-[.98] transition">Process & Package</button>
                )}
                {(!o.deliveryStatus || o.deliveryStatus === '') && o.status === 'Completed' && (
                  <button onClick={() => markPackaged(o.id)} className="w-full h-12 bg-gray-900 text-white rounded-xl text-sm font-bold active:scale-[.98] transition">Mark as Packaged</button>
                )}

                {/* Step 2: Choose dispatch method */}
                {o.deliveryStatus === 'Packaged' && (
                  <>
                    <p className="text-[11px] text-gray-400 font-medium pt-1">How is this order leaving?</p>
                    <button onClick={() => {
                      const guy = prompt('Delivery person name:')
                      if (guy) markDispatched(o.id, guy)
                    }} className="w-full h-11 bg-gray-900 text-white rounded-xl text-sm font-bold active:scale-[.98] transition">Send with our delivery</button>
                    <div className="flex gap-2">
                      <button onClick={() => markPickedUp(o.id, 'self')} className="flex-1 h-11 bg-gray-100 text-gray-800 rounded-xl text-sm font-semibold active:scale-[.98] transition">Customer pickup</button>
                      <button onClick={() => markPickedUp(o.id, 'rider')} className="flex-1 h-11 bg-gray-100 text-gray-800 rounded-xl text-sm font-semibold active:scale-[.98] transition">Rider pickup</button>
                    </div>
                  </>
                )}

                {/* Step 3: Out for delivery — show status + print sticker */}
                {o.deliveryStatus === 'Out for Delivery' && (
                  <div className="bg-gray-50 rounded-xl p-4 text-center border border-gray-100">
                    <div className="text-sm font-semibold text-gray-700">Out for delivery</div>
                    <div className="text-xs text-gray-400 mt-1">With: {o.deliveryGuy || 'delivery personnel'}</div>
                    <div className="text-[11px] text-gray-300 mt-1">Awaiting QR scan confirmation at destination</div>
                  </div>
                )}

                {/* Final: Delivered or Picked Up */}
                {(o.deliveryStatus === 'Delivered' || o.deliveryStatus === 'Picked Up') && (
                  <div className="bg-gray-50 rounded-xl p-4 text-center border border-gray-100">
                    <div className="text-sm font-semibold text-gray-900">{o.deliveryStatus === 'Picked Up' ? 'Collected' : 'Delivered'}</div>
                    <div className="text-xs text-gray-400 mt-1">
                      {o.deliveryGuy && `By: ${o.deliveryGuy}`}
                      {o.deliveredAt && ` · ${fmtDateTime(o.deliveredAt)}`}
                    </div>
                  </div>
                )}

                {/* Print Sticker — available from packaged until delivered */}
                {o.deliveryStatus && o.deliveryStatus !== '' && o.deliveryStatus !== 'Delivered' && o.deliveryStatus !== 'Picked Up' && (
                  <button onClick={() => printSticker(o)} className="w-full h-10 bg-white text-gray-600 rounded-xl text-[13px] font-semibold active:scale-[.98] transition border border-gray-200">Print delivery sticker</button>
                )}
              </div>
            )}

            {o.status === 'Cancelled' && (
              <div className="pt-2">
                <div className="w-full py-3 bg-gray-50 text-gray-400 rounded-xl text-sm font-medium text-center border border-gray-100">Order cancelled</div>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  )
}
