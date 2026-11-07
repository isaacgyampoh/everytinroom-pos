import { useState } from 'react'
import { useStore } from '../hooks/useStore'
import { money, fmtDate } from '../lib/utils'
import toast from 'react-hot-toast'

// How many more to pull in when somebody asks for older receipts. list_sales
// caps at 1000 server-side, so this is the whole ledger for this shop.
const DEEPER = 1000

export default function Receipts({ onPrintReceipt }) {
  const { sales, salesLimit, refreshSales, setLoading } = useStore()
  const [query, setQuery] = useState('')
  const [shown, setShown] = useState(50)
  const [loadedAll, setLoadedAll] = useState(false)

  const q = query.trim().toLowerCase()
  const matches = sales.filter(s =>
    !q
    || (s.receiptNo || '').toLowerCase().includes(q)
    || (s.customer || '').toLowerCase().includes(q)
    || (s.cashier || '').toLowerCase().includes(q))
  const filtered = matches.slice(0, shown)

  // The search only ever looked at the sales already in memory — 300 of them.
  // A customer at the counter with a receipt from two months ago got "No
  // receipts", and the cashier had no way to know the search simply had not
  // been given those rows. Now it says so, and offers to go and get them.
  const maybeMore = !loadedAll && sales.length >= salesLimit

  const loadOlder = async () => {
    setLoading(true, 'Loading older receipts...')
    await refreshSales(DEEPER)
    setLoading(false)
    setLoadedAll(true)
    toast.success('Older receipts loaded')
  }

  return (
    <div >
      <h1 className="text-[22px] md:text-[26px] font-bold mb-6">Receipts</h1>
      <div className="bg-white rounded-2xl p-6 shadow-md">
          <input className="w-full h-13 px-4 bg-gray-50 border-2 border-gray-200 rounded-xl text-base mb-3" placeholder="Search receipt, customer, staff..." value={query} onChange={e => { setQuery(e.target.value); setShown(50) }} />

          {/* What the search actually covered. It only ever looked at the sales
              already in memory, so a receipt from two months ago came back "No
              receipts" and the cashier had no way to tell that the rows simply
              had not been fetched. */}
          <div className="flex items-center justify-between gap-3 flex-wrap mb-5">
            <p className="text-[12px] text-gray-400">
              {q
                ? `${matches.length} ${matches.length === 1 ? 'match' : 'matches'} in the ${sales.length} receipts loaded`
                : `${sales.length} receipts loaded`}
            </p>
            {maybeMore && (
              <button onClick={loadOlder}
                className="h-9 px-3.5 rounded-lg border-2 border-gray-200 text-[12px] font-bold text-gray-600 hover:border-gray-900 hover:text-gray-900 transition">
                Load older receipts
              </button>
            )}
          </div>
        <div className="overflow-x-auto rtable-wrap">
          <table className="rtable w-full min-w-[650px]">
            <thead><tr className="text-left">
              <th className="p-3 bg-gray-50 text-[11px] font-bold text-gray-500 uppercase">Receipt</th>
              <th className="p-3 bg-gray-50 text-[11px] font-bold text-gray-500 uppercase">Date</th>
              <th className="p-3 bg-gray-50 text-[11px] font-bold text-gray-500 uppercase">Customer</th>
              <th className="p-3 bg-gray-50 text-[11px] font-bold text-gray-500 uppercase">Type</th>
              <th className="p-3 bg-gray-50 text-[11px] font-bold text-gray-500 uppercase">Issued By</th>
              <th className="p-3 bg-gray-50 text-[11px] font-bold text-gray-500 uppercase">Total</th>
              <th className="p-3 bg-gray-50 text-[11px] font-bold text-gray-500 uppercase"></th>
            </tr></thead>
            <tbody>
              {filtered.length === 0 && (
                <tr><td colSpan={7} className="text-center py-12">
                  <div className="text-gray-400 text-sm">
                    {q ? `Nothing matching “${query}” in the ${sales.length} receipts loaded` : 'No receipts'}
                  </div>
                  {q && maybeMore && (
                    <button onClick={loadOlder}
                      className="mt-3 h-10 px-4 rounded-xl bg-gray-900 text-white text-[12.5px] font-bold">
                      Search older receipts too
                    </button>
                  )}
                </td></tr>
              )}
              {filtered.map(s => (
                <tr key={s.id} className={`border-b border-gray-50 ${s.voided ? 'opacity-50' : ''}`}>
                  <td data-label="Receipt" className="p-3 text-sm"><b className="text-gray-600">{s.receiptNo}</b>{s.voided && <span className="ml-1.5 px-2 py-0.5 bg-red-50 text-red-500 rounded text-[10px] font-bold">VOID</span>}</td>
                  <td data-label="Date" className="p-3 text-sm">{fmtDate(s.date)}</td>
                  <td data-label="Customer" className="p-3 text-sm">{s.customer}</td>
                  <td data-label="Type" className="p-3 text-sm">
                    <span className={`px-2.5 py-1 rounded-lg text-[11px] font-bold ${s.type === 'WhatsApp' ? 'bg-wa/10 text-wa' : s.type === 'Wholesale' ? 'bg-amber-50 text-amber-500' : 'bg-green-50 text-green-500'}`}>{s.type}</span>
                    {''}<span className={`px-2.5 py-1 rounded-lg text-[11px] font-bold ${s.payment === 'Cash' ? 'bg-gray-100 text-gray-700' : s.payment === 'Momo' ? 'bg-gray-100 text-gray-700' : 'bg-gray-100 text-gray-700'}`}>{s.payment}</span>
                  </td>
                  <td data-label="Issued By" className="p-3 text-sm"><span className="px-2.5 py-1 bg-gray-100 rounded-lg text-[11px] font-bold text-gray-600">{s.cashier || 'Unknown'}</span></td>
                  <td data-label="Total" className="p-3 text-sm font-bold">{money(s.total)}</td>
                  <td data-label="" className="p-3"><button onClick={() => onPrintReceipt(s)} className="h-9 px-3 bg-gray-800 text-white rounded-lg text-xs font-semibold hover:bg-gray-800 transition">View</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {matches.length > filtered.length && (
          <button onClick={() => setShown(n => n + 100)}
            className="mt-4 w-full h-11 rounded-xl border-2 border-dashed border-gray-200 text-[12.5px] font-bold text-gray-500 hover:border-gray-400 transition">
            Show {Math.min(100, matches.length - filtered.length)} more of {matches.length}
          </button>
        )}
      </div>
    </div>
  )
}
