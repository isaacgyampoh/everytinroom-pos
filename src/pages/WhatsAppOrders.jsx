import { useState } from 'react'
import { useStore } from '../hooks/useStore'
import { getSupabase } from '../lib/supabase'
import { money, fmtDateTime } from '../lib/utils'
import toast from 'react-hot-toast'

export default function WhatsAppOrders() {
  const { waOrders, waFilter, setWAFilter, refreshWAOrders, user, setLoading, loadAll } = useStore()
  const [search, setSearch] = useState('')

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
      if (data?.success) { toast.success('Completed! ' + data.receiptNo); loadAll() }
      else toast.error(data?.error || error?.message || 'Error')
    } catch (e) { setLoading(false); toast.error('Error') }
  }

  const cancel = async (id) => {
    const reason = prompt('Reason for cancellation:')
    if (reason === null) return
    setLoading(true, 'Cancelling...')
    const sb = getSupabase()
    await sb.from('whatsapp_orders').update({ status: 'Cancelled', processed_by: user?.name || '', processed_at: new Date().toISOString(), notes: reason }).eq('id', id)
    setLoading(false); toast('Cancelled', { icon: '⚠️' }); refreshWAOrders()
  }

  const resendInvoice = (o) => {
    const link = window.location.origin + '/#/pay/' + o.id
    const msg = `Hi ${o.customerName || 'there'}! 🛍️\n\nReminder: Your invoice from *EVERYTINROOM&BEDTIME*:\n\n${o.items.map(it => `• ${it.qty}x ${it.name} — ${money(it.lineTotal || it.price * it.qty)}`).join('\n')}\n\n*Total: ${money(o.total)}*\n\n💳 Pay here:\n${link}\n\nThank you! 🙏`
    const waPhone = (o.customerPhone || '').replace(/^0/, '233')
    window.open(`https://wa.me/${waPhone}?text=${encodeURIComponent(msg)}`, '_blank')
    toast.success('Resending invoice...')
  }

  const copyLink = (o) => {
    const link = window.location.origin + '/#/pay/' + o.id
    navigator.clipboard?.writeText(link)
    toast.success('Invoice link copied!')
  }

  const statusColor = (s) => {
    const sc = s?.toLowerCase()
    if (sc === 'paid') return 'bg-emerald-500 text-white'
    if (sc === 'completed') return 'bg-brand-600 text-white'
    if (sc === 'cancelled') return 'bg-red-500 text-white'
    return 'bg-amber-400 text-black'
  }

  return (
    <div className="animate-fade">
      <div className="flex justify-between items-start flex-wrap gap-4 mb-5">
        <div>
          <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight">📱 WhatsApp Invoices</h1>
          <p className="text-gray-400 text-sm mt-0.5">Send invoices, track payments</p>
        </div>
        <button onClick={refreshWAOrders} className="h-10 px-4 bg-white border border-gray-200 rounded-xl text-sm font-semibold text-gray-600 hover:bg-gray-50 transition">🔄 Refresh</button>
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
        <p className="text-sm font-semibold text-brand-700 mb-2">💡 How to send a WhatsApp Invoice:</p>
        <p className="text-xs text-brand-600 leading-relaxed">Go to <b>POS</b> → Add products to cart → Enter phone number → Click <b>"📩 Send Invoice via WhatsApp"</b> → Invoice is created and sent automatically!</p>
      </div>

      {/* Search + Filters */}
      <div className="flex gap-2 mb-4 flex-wrap">
        <input className="flex-1 min-w-[200px] h-10 px-4 bg-white rounded-xl text-sm placeholder:text-stone-300 border border-gray-100 focus:outline-none focus:ring-2 focus:ring-brand-400/30" placeholder="Search by name, phone, or order #..." value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      <div className="flex gap-1.5 mb-5 overflow-x-auto scrollbar-hide">
        {['Pending', 'Paid', 'Completed', 'Cancelled', 'all'].map(f => (
          <button key={f} onClick={() => setWAFilter(f)}
            className={`h-8 px-4 rounded-full text-xs font-semibold whitespace-nowrap transition ${waFilter === f ? (f === 'Pending' ? 'bg-amber-400 text-black' : f === 'Paid' ? 'bg-emerald-500 text-white' : 'bg-brand-600 text-white') : 'bg-white text-stone-400'}`}>
            {f === 'all' ? 'All' : f}
          </button>
        ))}
      </div>

      {/* Orders */}
      <div className="space-y-3">
        {sorted.length === 0 && (
          <div className="text-center py-16">
            <div className="text-4xl mb-3 opacity-20">📱</div>
            <p className="text-stone-400 text-sm">No invoices found</p>
            <p className="text-stone-300 text-xs mt-1">Go to POS to create and send one</p>
          </div>
        )}
        {sorted.map(o => (
          <div key={o.id} className="bg-white rounded-2xl overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-gray-50">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-brand-50 rounded-xl flex items-center justify-center text-lg">📱</div>
                <div>
                  <div className="text-sm font-bold">{o.customerName || o.customerPhone || 'Customer'}</div>
                  <div className="text-xs text-gray-400">{o.orderNo} • {fmtDateTime(o.date)}</div>
                </div>
              </div>
              <span className={`px-3 py-1 rounded-full text-[11px] font-bold ${statusColor(o.status)}`}>{o.status}</span>
            </div>

            {/* Items */}
            <div className="px-4 py-2">
              {o.items.slice(0, 3).map((it, i) => (
                <div key={i} className="flex justify-between py-1.5 text-sm">
                  <span className="text-gray-500">{it.qty}× {it.name}</span>
                  <span className="font-semibold">{money(it.lineTotal || it.price * it.qty)}</span>
                </div>
              ))}
              {o.items.length > 3 && <div className="text-xs text-gray-400 py-1">+{o.items.length - 3} more items</div>}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between p-4 pt-2 border-t border-gray-50">
              <div className="text-lg font-extrabold">{money(o.total)}</div>
              <div className="flex gap-1.5">
                {o.status === 'Pending' && (
                  <>
                    <button onClick={() => resendInvoice(o)} className="h-8 px-3 bg-[#25d366] text-white rounded-lg text-xs font-bold active:scale-95 transition" title="Resend invoice via WhatsApp">📩 Resend</button>
                    <button onClick={() => copyLink(o)} className="h-8 px-3 bg-gray-100 rounded-lg text-xs font-semibold text-gray-600 active:scale-95 transition" title="Copy invoice link">🔗</button>
                    <button onClick={() => complete(o.id)} className="h-8 px-3 bg-brand-500 text-white rounded-lg text-xs font-bold active:scale-95 transition">✅</button>
                    <button onClick={() => cancel(o.id)} className="h-8 px-3 bg-red-50 text-red-500 rounded-lg text-xs font-bold active:scale-95 transition">❌</button>
                  </>
                )}
                {o.status === 'Paid' && (
                  <>
                    <button onClick={() => complete(o.id)} className="h-8 px-3 bg-brand-500 text-white rounded-lg text-xs font-bold active:scale-95 transition">✅ Process Order</button>
                    <button onClick={() => copyLink(o)} className="h-8 px-3 bg-gray-100 rounded-lg text-xs font-semibold text-gray-600" title="Copy link">🔗</button>
                  </>
                )}
                {o.status === 'Completed' && o.paystackRef && (
                  <span className="text-xs text-gray-400">Ref: {o.paystackRef}</span>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
