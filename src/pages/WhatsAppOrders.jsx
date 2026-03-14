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

  const resendInvoice = (o) => {
    const link = window.location.origin + '/#/pay/' + o.id
    const msg = `Hi ${o.customerName || 'there'}!\n\nReminder: Your invoice from *EVERYTINROOM&BEDTIME*:\n\n${o.items.map(it => `• ${it.qty}x ${it.name} — ${money(it.lineTotal || it.price * it.qty)}`).join('\n')}\n\n*Total: ${money(o.total)}*\n\nPay here:\n${link}\n\nThank you!`
    const waPhone = (o.customerPhone || '').replace(/^0/, '233')
    const isMobile = /Android|iPhone|iPad/i.test(navigator.userAgent)
    if (isMobile) window.location.href = `whatsapp://send?phone=${waPhone}&text=${encodeURIComponent(msg)}`
    else window.open(`https://web.whatsapp.com/send?phone=${waPhone}&text=${encodeURIComponent(msg)}`, '_blank')
    try { navigator.clipboard.writeText(msg) } catch {}
    toast.success('Invoice resent')
  }

  const copyLink = (o) => {
    const link = window.location.origin + '/#/pay/' + o.id
    navigator.clipboard?.writeText(link)
    toast.success('Link copied')
  }

  const statusColor = (s) => {
    const sc = s?.toLowerCase()
    if (sc === 'paid') return 'bg-emerald-500 text-white'
    if (sc === 'completed') return 'bg-brand-600 text-white'
    if (sc === 'cancelled') return 'bg-red-500 text-white'
    return 'bg-amber-400 text-black'
  }

  const o = selected // shorthand for modal

  return (
    <div className="animate-fade">
      <div className="flex justify-between items-start flex-wrap gap-4 mb-5">
        <div>
          <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight">WhatsApp Invoices</h1>
          <p className="text-gray-400 text-sm mt-0.5">Send invoices, track payments</p>
        </div>
        <button onClick={refreshWAOrders} className="h-10 px-4 bg-white border border-gray-200 rounded-xl text-sm font-semibold text-gray-600 hover:bg-gray-50 transition">Refresh</button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3 mb-5">
        <div className="bg-amber-400 rounded-2xl p-4 text-black relative overflow-hidden">
          <div className="absolute -right-3 -top-3 w-14 h-14 rounded-full border border-black/5" />
          <div className="absolute -right-1 -top-1 w-8 h-8 rounded-full border border-black/5" />
          <div className="relative z-10"><div className="text-xs font-medium opacity-60">Pending</div><div className="text-2xl font-extrabold mt-0.5">{pending}</div></div>
        </div>
        <div className="bg-emerald-500 rounded-2xl p-4 text-white relative overflow-hidden">
          <div className="absolute -right-3 -top-3 w-14 h-14 rounded-full border border-white/10" />
          <div className="absolute -right-1 -top-1 w-8 h-8 rounded-full border border-white/10" />
          <div className="relative z-10"><div className="text-xs font-medium opacity-70">Paid</div><div className="text-2xl font-extrabold mt-0.5">{paid}</div></div>
        </div>
        <div className="bg-brand-600 rounded-2xl p-4 text-white relative overflow-hidden">
          <div className="absolute -right-3 -top-3 w-14 h-14 rounded-full border border-white/10" />
          <div className="absolute -right-1 -top-1 w-8 h-8 rounded-full border border-white/10" />
          <div className="relative z-10"><div className="text-xs font-medium opacity-70">Completed</div><div className="text-2xl font-extrabold mt-0.5">{completed}</div></div>
        </div>
      </div>

      {/* How it works */}
      <div className="bg-brand-50 rounded-2xl p-4 mb-5 border border-brand-100">
        <p className="text-sm font-semibold text-brand-700 mb-1">How to send a WhatsApp Invoice</p>
        <p className="text-xs text-brand-600 leading-relaxed">Go to <b>POS</b> → Add products to cart → Enter phone number → Click <b>"Send Invoice via WhatsApp"</b></p>
      </div>

      {/* Search + Filters */}
      <input className="w-full h-10 px-4 bg-white rounded-xl text-sm placeholder:text-stone-300 border border-gray-100 focus:outline-none focus:ring-2 focus:ring-brand-400/30 mb-4" placeholder="Search by name, phone, or order #..." value={search} onChange={e => setSearch(e.target.value)} />

      <div className="flex gap-1.5 mb-5 overflow-x-auto scrollbar-hide">
        {['Pending', 'Paid', 'Completed', 'Cancelled', 'all'].map(f => (
          <button key={f} onClick={() => setWAFilter(f)}
            className={`h-8 px-4 rounded-full text-xs font-semibold whitespace-nowrap transition ${waFilter === f ? (f === 'Pending' ? 'bg-amber-400 text-black' : f === 'Paid' ? 'bg-emerald-500 text-white' : 'bg-brand-600 text-white') : 'bg-white text-stone-400'}`}>
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
          <div key={order.id} onClick={() => setSelected(order)} className="bg-white rounded-2xl p-4 cursor-pointer hover:bg-gray-50/50 transition">
            <div className="flex items-center justify-between mb-2">
              <div>
                <div className="text-sm font-bold">{order.customerName || order.customerPhone || 'Customer'}</div>
                <div className="text-xs text-gray-400">{order.orderNo} · {fmtDateTime(order.date)}</div>
              </div>
              <span className={`px-3 py-1 rounded-full text-[11px] font-bold ${statusColor(order.status)}`}>{order.status}</span>
            </div>
            <div className="flex items-center justify-between">
              <div className="text-xs text-gray-400">{order.items.length} item{order.items.length !== 1 ? 's' : ''}{order.address ? ' · Delivery details filled' : ''}</div>
              <div className="text-base font-extrabold">{money(order.total)}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Order Detail Modal */}
      <Modal open={!!selected} onClose={() => setSelected(null)} title="Order Details">
        {o && (
          <div className="space-y-4">
            {/* Status + Order No */}
            <div className="flex items-center justify-between">
              <div>
                <div className="text-lg font-extrabold">{o.orderNo}</div>
                <div className="text-xs text-gray-400">{fmtDateTime(o.date)}</div>
              </div>
              <span className={`px-4 py-1.5 rounded-full text-xs font-bold ${statusColor(o.status)}`}>{o.status}</span>
            </div>

            {/* Customer Info */}
            <div className="bg-gray-50 rounded-xl p-4">
              <div className="text-xs text-gray-400 uppercase tracking-wider mb-2 font-semibold">Customer</div>
              <div className="text-sm font-bold">{o.customerName || 'Not provided'}</div>
              <div className="text-sm text-gray-500">{o.customerPhone || '—'}</div>
            </div>

            {/* Delivery Details */}
            <div className="bg-gray-50 rounded-xl p-4">
              <div className="text-xs text-gray-400 uppercase tracking-wider mb-2 font-semibold">Delivery Details</div>
              {o.address ? (
                <div>
                  <div className="text-sm font-semibold text-gray-800">{o.address}</div>
                  {o.notes && o.notes !== 'Invoice from POS' && <div className="text-sm text-gray-500 mt-1 italic">"{o.notes}"</div>}
                </div>
              ) : (
                <div className="text-sm text-gray-400">No delivery details provided yet</div>
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
                <span className="text-lg font-extrabold">{money(o.total)}</span>
              </div>
            </div>

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

            {/* Actions */}
            <div className="flex gap-2 pt-2">
              {o.status === 'Pending' && (
                <>
                  <button onClick={() => resendInvoice(o)} className="flex-1 h-11 bg-[#25d366] text-white rounded-xl text-sm font-bold active:scale-[.98] transition">Resend Invoice</button>
                  <button onClick={() => copyLink(o)} className="h-11 px-4 bg-gray-100 rounded-xl text-sm font-semibold text-gray-600">Copy Link</button>
                  <button onClick={() => cancel(o.id)} className="h-11 px-4 bg-red-50 text-red-500 rounded-xl text-sm font-semibold">Cancel</button>
                </>
              )}
              {o.status === 'Paid' && (
                <>
                  <button onClick={() => complete(o.id)} className="flex-1 h-11 bg-brand-600 text-white rounded-xl text-sm font-bold active:scale-[.98] transition">Process Order</button>
                  <button onClick={() => copyLink(o)} className="h-11 px-4 bg-gray-100 rounded-xl text-sm font-semibold text-gray-600">Copy Link</button>
                </>
              )}
              {o.status === 'Completed' && (
                <div className="flex-1 h-11 bg-brand-50 text-brand-700 rounded-xl text-sm font-semibold flex items-center justify-center">Order completed</div>
              )}
              {o.status === 'Cancelled' && (
                <div className="flex-1 h-11 bg-red-50 text-red-500 rounded-xl text-sm font-semibold flex items-center justify-center">Order cancelled</div>
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
