import { useStore } from '../hooks/useStore'
import { getSupabase } from '../lib/supabase'
import { money, fmtDateTime } from '../lib/utils'
import toast from 'react-hot-toast'

export default function WhatsAppOrders() {
  const { waOrders, waFilter, setWAFilter, refreshWAOrders, user, setLoading, loadAll } = useStore()
  const pending = waOrders.filter(o => o.status === 'Pending').length
  const filtered = waFilter === 'all' ? waOrders : waOrders.filter(o => o.status === waFilter)
  const sorted = [...filtered].sort((a, b) => new Date(b.date) - new Date(a.date))

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

  return (
    <div className="animate-fade">
      <div className="flex justify-between items-start flex-wrap gap-4 mb-6">
        <div><h1 className="text-3xl font-extrabold">📱 WhatsApp Orders</h1><p className="text-gray-500">Paystack pre-paid orders</p></div>
        <button onClick={refreshWAOrders} className="h-12 px-5 bg-wa text-white rounded-xl text-sm font-semibold active:scale-95 transition">🔄 Refresh</button>
      </div>

      <div className="bg-wa rounded-3xl p-7 text-white mb-6"><small className="text-sm opacity-80">Pending Orders</small><strong className="block text-4xl font-extrabold mt-2">{pending}</strong></div>

      <div className="flex gap-2.5 mb-6 overflow-x-auto">
        {['Pending', 'Completed', 'all'].map(f => (
          <button key={f} onClick={() => setWAFilter(f)}
            className={`h-11 px-5 rounded-xl text-sm font-semibold whitespace-nowrap border-2 transition ${waFilter === f ? (f === 'Pending' ? 'bg-wa text-white border-transparent' : 'bg-brand-500 text-white border-transparent') : 'bg-white border-gray-200 text-gray-500'}`}>
            {f === 'Pending' ? '🟢 Pending' : f === 'Completed' ? '✅ Completed' : '📋 All'}
          </button>
        ))}
      </div>

      <div className="space-y-4">
        {sorted.length === 0 && <div className="text-center py-12 text-gray-400"><span className="text-5xl block mb-3 opacity-30">📱</span>No orders</div>}
        {sorted.map(o => {
          const sc = o.status.toLowerCase()
          return (
            <div key={o.id} className={`bg-white rounded-3xl p-5 shadow-md border-l-4 ${sc === 'completed' ? 'border-green-500 opacity-70' : sc === 'cancelled' ? 'border-red-500 opacity-50' : 'border-wa'}`}>
              <div className="flex justify-between items-start flex-wrap gap-2.5 mb-3">
                <div><div className="text-lg font-bold">{o.orderNo}</div><div className="text-[13px] text-gray-400">{fmtDateTime(o.date)}</div></div>
              </div>
              <div className="flex gap-2 flex-wrap mb-3">
                <span className={`px-3.5 py-1.5 rounded-full text-xs font-bold ${sc === 'pending' ? 'bg-wa/10 text-wa' : sc === 'completed' ? 'bg-green-50 text-green-500' : 'bg-red-50 text-red-500'}`}>{o.status}</span>
                {o.paystackRef && <span className="px-3 py-1.5 rounded-full text-xs font-bold bg-cyan-50 text-cyan-600">💳 Paystack</span>}
              </div>
              <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl mb-3">
                <div className="w-11 h-11 bg-wa rounded-full flex items-center justify-center text-white text-xl">👤</div>
                <div><h4 className="text-[15px] font-semibold">{o.customerName || 'Customer'}</h4><p className="text-[13px] text-gray-500">{o.customerPhone}</p></div>
              </div>
              <div className="mb-3">
                {o.items.slice(0, 4).map((it, i) => (
                  <div key={i} className="flex justify-between py-2 border-b border-dashed border-gray-200 last:border-0 text-sm"><span className="text-gray-500">{it.qty}x {it.name}</span><b>{money(it.lineTotal || it.price * it.qty)}</b></div>
                ))}
              </div>
              {o.address && <div className="text-[13px] text-gray-500 bg-gray-50 p-2.5 rounded-lg mb-2.5 flex gap-2">📍 {o.address}</div>}
              {o.paystackRef && <div className="text-xs text-cyan-600 bg-cyan-50 px-3 py-1.5 rounded-lg inline-block mb-2.5">Ref: {o.paystackRef}</div>}
              <div className="flex justify-between items-center pt-3 border-t-2 border-gray-100 flex-wrap gap-3">
                <div className="text-xl font-extrabold text-brand-500">{money(o.total)}</div>
                {o.status === 'Pending' && (
                  <div className="flex gap-2">
                    <button onClick={() => complete(o.id)} className="h-10 px-4 bg-green-500 text-white rounded-lg text-[13px] font-semibold active:scale-95 transition">✅ Complete</button>
                    <button onClick={() => cancel(o.id)} className="h-10 px-4 bg-red-500 text-white rounded-lg text-[13px] font-semibold active:scale-95 transition">❌</button>
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
