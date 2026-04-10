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
        <div className="bg-amber-400 rounded-2xl p-4 text-black">
          <div className="text-xs font-medium opacity-60">Pending</div><div className="text-[22px] font-bold mt-0.5">{pending}</div>
        </div>
        <div className="bg-emerald-500 rounded-2xl p-4 text-white">
          <div className="text-xs font-medium opacity-70">Paid</div><div className="text-[22px] font-bold mt-0.5">{paid}</div>
        </div>
        <div className="bg-brand-600 rounded-2xl p-4 text-white">
          <div className="text-xs font-medium opacity-70">Completed</div><div className="text-[22px] font-bold mt-0.5">{completed}</div>
        </div>
      </div>

      {/* Search + Filters */}
      <input className="w-full h-10 px-4 bg-white rounded-xl text-sm placeholder:text-stone-300 border border-gray-100 focus:outline-none focus:ring-2 focus:ring-[#3d8b6a]/30 mb-4" placeholder="Search by name, phone, or order #..." value={search} onChange={e => setSearch(e.target.value)} />

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
          <div key={order.id} onClick={() => setSelected(order)} className="bg-white rounded-2xl overflow-hidden cursor-pointer hover:bg-stone-50/50 transition border border-transparent hover:border-stone-200">
            <div className="p-4">
              <div className="flex items-center justify-between mb-2.5">
                <div>
                  <div className="text-sm font-bold">{order.customerName || 'Customer'}</div>
                  <div className="text-xs text-stone-400 mt-0.5">{order.orderNo} · {fmtDateTime(order.date)}</div>
                </div>
                <span className={`px-3 py-1.5 rounded-lg text-[11px] font-bold ${statusColor(order.status)}`}>{order.status}</span>
              </div>
              <div className="text-xs text-stone-400 mb-2">{order.items.length} item{order.items.length !== 1 ? 's' : ''}{order.address ? ' · Delivery filled' : ' · No delivery details'}{order.ussdCode ? ` · USSD: *920*141*${order.ussdCode}#` : ''}</div>
              <div className="flex items-center justify-between pt-2.5 border-t border-stone-100">
                <div className="text-lg font-bold">{money(order.total)}</div>
                <span className="text-xs font-medium text-brand-600">View details</span>
              </div>
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
                <div className="text-lg font-bold">{o.orderNo}</div>
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
                <span className="text-lg font-bold">{money(o.total)}</span>
              </div>
            </div>

            {/* USSD Payment Code */}
            {o.ussdCode && (
              <div className="bg-amber-50 rounded-xl p-4 border border-amber-200">
                <div className="text-xs text-amber-600 uppercase tracking-wider mb-2 font-semibold">USSD Payment Code</div>
                <div className="flex items-center justify-between">
                  <div className="text-lg font-bold text-amber-900 font-mono tracking-wider">*920*141*{o.ussdCode}#</div>
                  <button onClick={(e) => { e.stopPropagation(); navigator.clipboard?.writeText(`*920*141*${o.ussdCode}#`); toast.success('USSD code copied!') }}
                    className="h-9 px-4 bg-amber-500 text-white rounded-lg text-xs font-bold active:scale-95 transition">Copy</button>
                </div>
                <p className="text-[11px] text-amber-600 mt-2">Customer dials this code → confirms amount → pays via MoMo</p>
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

            {/* Actions */}
            {o.status === 'Pending' && (
              <div className="space-y-2 pt-2">
                <button onClick={() => resendInvoice(o)} className="w-full h-12 bg-[#25d366] text-white rounded-xl text-sm font-bold active:scale-[.98] transition">Resend Invoice</button>
                <div className="flex gap-2">
                  <button onClick={() => copyLink(o)} className="flex-1 h-11 bg-stone-200 text-stone-700 rounded-xl text-sm font-semibold active:scale-[.98] transition">Copy Link</button>
                  {o.ussdCode && <button onClick={() => { navigator.clipboard?.writeText(`*920*141*${o.ussdCode}#`); toast.success('USSD code copied!') }} className="flex-1 h-11 bg-amber-400 text-black rounded-xl text-sm font-semibold active:scale-[.98] transition">Copy USSD</button>}
                  <button onClick={() => cancel(o.id)} className="flex-1 h-11 bg-red-500 text-white rounded-xl text-sm font-semibold active:scale-[.98] transition">Cancel</button>
                </div>
              </div>
            )}
            {o.status === 'Paid' && (
              <div className="space-y-2 pt-2">
                <button onClick={() => complete(o.id)} className="w-full h-12 bg-brand-600 text-white rounded-xl text-sm font-bold active:scale-[.98] transition">Process Order</button>
                <button onClick={() => copyLink(o)} className="w-full h-11 bg-stone-200 text-stone-700 rounded-xl text-sm font-semibold active:scale-[.98] transition">Copy Link</button>
              </div>
            )}
            {o.status === 'Completed' && (
              <div className="pt-2">
                <div className="w-full h-11 bg-brand-50 text-brand-700 rounded-xl text-sm font-semibold flex items-center justify-center border border-brand-200">Order completed</div>
              </div>
            )}
            {o.status === 'Cancelled' && (
              <div className="pt-2">
                <div className="w-full h-11 bg-red-50 text-red-600 rounded-xl text-sm font-semibold flex items-center justify-center border border-red-200">Order cancelled</div>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  )
}
