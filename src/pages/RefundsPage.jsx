import { useState } from 'react'
import { useStore } from '../hooks/useStore'
import { getSupabase } from '../lib/supabase'
import { money, num, fmtDate, today, isoDate } from '../lib/utils'
import Modal from '../components/Modal'
import toast from 'react-hot-toast'

export default function RefundsPage() {
  const { refunds, user, setLoading, loadAll } = useStore()
  const [modal, setModal] = useState(false)
  const [receiptNo, setReceiptNo] = useState('')
  const [sale, setSale] = useState(null)
  const [saleItems, setSaleItems] = useState([])
  const [reason, setReason] = useState('')

  const todayTotal = refunds.filter(r => isoDate(r.date) === today()).reduce((a, r) => a + r.refundAmount, 0)

  const lookup = async () => {
    if (!receiptNo.trim()) { toast.error('Enter receipt'); return }
    setLoading(true, 'Searching...')
    const sb = getSupabase()
    const { data, error } = await sb.from('sales').select('*').eq('receipt_no', receiptNo.trim()).single()
    setLoading(false)
    if (error || !data) { toast.error('Sale not found'); return }
    const items = typeof data.items === 'string' ? JSON.parse(data.items) : (data.items || [])
    setSale(data)
    setSaleItems(items.map(it => ({ ...it, checked: true, refundQty: it.qty })))
  }

  const refundAmount = saleItems.filter(i => i.checked).reduce((a, i) => a + num(i.price) * Math.min(num(i.refundQty), num(i.qty)), 0)

  const processRefund = async () => {
    if (!sale) return; if (!reason.trim()) { toast.error('Enter reason'); return }
    const items = saleItems.filter(i => i.checked).map(i => ({ name: i.name, productId: i.productId || '', price: num(i.price), qty: Math.min(num(i.refundQty), num(i.qty)) }))
    if (!items.length) { toast.error('Select items'); return }
    if (!confirm('Process refund?')) return
    setLoading(true, 'Processing...')
    try {
      const sb = getSupabase()
      const { data, error } = await sb.rpc('process_refund', { p_receipt_no: receiptNo.trim(), p_items: items, p_reason: reason.trim(), p_processed_by: user?.name || '', p_customer: sale.customer || 'Walk-in' })
      setLoading(false)
      if (data?.success) { toast.success('Refund ' + data.refundNo + ' done! ' + money(data.refundAmount)); setModal(false); loadAll() }
      else toast.error(data?.error || 'Error')
    } catch (e) { setLoading(false); toast.error('Error') }
  }

  return (
    <div >
      <div className="flex justify-between items-start flex-wrap gap-4 mb-6">
        <h1 className="text-[22px] md:text-[26px] font-bold">Refunds</h1>
        <button onClick={() => { setReceiptNo(''); setSale(null); setSaleItems([]); setReason(''); setModal(true) }} className="h-12 px-5 bg-gray-800 text-white rounded-xl text-sm font-semibold">New Refund</button>
      </div>
      <div className="bg-gray-800 rounded-2xl p-5 text-white mb-6"><small className="text-sm opacity-80">Total Refunds Today</small><strong className="block text-[22px] md:text-[26px] font-bold mt-2">{money(todayTotal)}</strong></div>
      <div className="bg-white rounded-2xl p-6 shadow-md overflow-x-auto">
        <table className="w-full min-w-[500px]">
          <thead><tr><th className="p-3 bg-gray-50 text-left text-[11px] font-bold text-gray-500 uppercase">Refund #</th><th className="p-3 bg-gray-50 text-left text-[11px] font-bold text-gray-500 uppercase">Date</th><th className="p-3 bg-gray-50 text-left text-[11px] font-bold text-gray-500 uppercase">Receipt</th><th className="p-3 bg-gray-50 text-left text-[11px] font-bold text-gray-500 uppercase">Customer</th><th className="p-3 bg-gray-50 text-left text-[11px] font-bold text-gray-500 uppercase">Amount</th><th className="p-3 bg-gray-50 text-left text-[11px] font-bold text-gray-500 uppercase">Reason</th><th className="p-3 bg-gray-50 text-left text-[11px] font-bold text-gray-500 uppercase">By</th></tr></thead>
          <tbody>{refunds.length === 0 ? <tr><td colSpan={7} className="text-center py-12 text-gray-400">No refunds</td></tr> : refunds.map(r => (
            <tr key={r.id} className="border-b border-gray-50"><td className="p-3 text-sm font-bold text-violet-500">{r.refundNo}</td><td className="p-3 text-sm">{fmtDate(r.date)}</td><td className="p-3 text-sm">{r.originalReceiptNo}</td><td className="p-3 text-sm">{r.customer || '-'}</td><td className="p-3 text-sm font-bold text-red-500">{money(r.refundAmount)}</td><td className="p-3 text-sm">{r.reason || '-'}</td><td className="p-3 text-sm">{r.processedBy || '-'}</td></tr>
          ))}</tbody>
        </table>
      </div>

      <Modal open={modal} onClose={() => setModal(false)} title="Process Refund"
        footer={sale ? <button onClick={processRefund} className="flex-1 h-12 bg-gray-800 text-white rounded-xl text-sm font-bold">Refund</button> : null}>
        <div className="space-y-4">
          <div><label className="block text-xs font-semibold text-gray-500 mb-2">Receipt Number</label>
            <div className="flex gap-2.5"><input className="flex-1 h-13 px-4 bg-gray-50 border-2 border-gray-200 rounded-xl text-base" placeholder="RCP20250215-001" value={receiptNo} onChange={e => setReceiptNo(e.target.value)} /><button onClick={lookup} className="h-13 px-4 bg-gray-700 text-white rounded-xl text-sm font-semibold">Find</button></div>
          </div>
          {sale && (<>
            <div className="bg-green-50 border-2 border-green-200 rounded-2xl p-5">
              <div className="flex justify-between flex-wrap gap-2 text-sm"><span><b>Receipt:</b> {sale.receipt_no}</span><span><b>Total:</b> {money(sale.total)}</span><span><b>Customer:</b> {sale.customer}</span></div>
            </div>
            {saleItems.map((it, i) => (
              <div key={i} className="flex items-center gap-3 p-3.5 bg-gray-50 rounded-xl">
                <input type="checkbox" className="w-6 h-6 accent-violet-500" checked={it.checked} onChange={e => { const items = [...saleItems]; items[i].checked = e.target.checked; setSaleItems(items) }} />
                <div className="flex-1"><div className="font-semibold text-sm">{it.name}</div><div className="text-xs text-gray-500">{money(it.price)} each | qty: {it.qty}</div></div>
                <input type="number" className="w-12 h-8 text-center border-2 border-gray-200 rounded-lg text-sm font-semibold" value={it.refundQty} min={1} max={it.qty} onChange={e => { const items = [...saleItems]; items[i].refundQty = parseInt(e.target.value) || 1; setSaleItems(items) }} />
              </div>
            ))}
            <div><label className="block text-xs font-semibold text-gray-500 mb-2">Reason</label><textarea className="w-full h-24 px-4 py-3 bg-gray-50 border-2 border-gray-200 rounded-xl text-base resize-none" value={reason} onChange={e => setReason(e.target.value)} /></div>
            <div className="bg-gray-800 rounded-2xl p-6 text-white"><small className="text-sm opacity-80">Refund Amount</small><strong className="block text-[22px] md:text-[26px] font-bold mt-2">{money(refundAmount)}</strong></div>
          </>)}
        </div>
      </Modal>
    </div>
  )
}
