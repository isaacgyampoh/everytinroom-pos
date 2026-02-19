// src/pages/Receipts.jsx
import { useState } from 'react'
import { useStore } from '../hooks/useStore'
import { money, fmtDate } from '../lib/utils'

export default function Receipts({ onPrintReceipt }) {
  const { sales } = useStore()
  const [query, setQuery] = useState('')
  const filtered = sales.filter(s => s.receiptNo.toLowerCase().includes(query.toLowerCase()) || s.customer.toLowerCase().includes(query.toLowerCase())).slice(0, 50)

  return (
    <div className="animate-fade">
      <h1 className="text-3xl font-extrabold mb-6">Receipts</h1>
      <div className="bg-white rounded-3xl p-6 shadow-md">
        <input className="w-full h-13 px-4 bg-gray-50 border-2 border-gray-200 rounded-xl text-base mb-5" placeholder="🔍 Search..." value={query} onChange={e => setQuery(e.target.value)} />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[500px]">
            <thead><tr className="text-left"><th className="p-3 bg-gray-50 text-[11px] font-bold text-gray-500 uppercase">Receipt</th><th className="p-3 bg-gray-50 text-[11px] font-bold text-gray-500 uppercase">Date</th><th className="p-3 bg-gray-50 text-[11px] font-bold text-gray-500 uppercase">Customer</th><th className="p-3 bg-gray-50 text-[11px] font-bold text-gray-500 uppercase">Type</th><th className="p-3 bg-gray-50 text-[11px] font-bold text-gray-500 uppercase">Total</th><th className="p-3 bg-gray-50 text-[11px] font-bold text-gray-500 uppercase"></th></tr></thead>
            <tbody>
              {filtered.length === 0 && <tr><td colSpan={6} className="text-center py-12 text-gray-400">No receipts</td></tr>}
              {filtered.map(s => (
                <tr key={s.id} className={`border-b border-gray-50 ${s.voided ? 'opacity-50' : ''}`}>
                  <td className="p-3 text-sm"><b className="text-brand-500">{s.receiptNo}</b>{s.voided && <span className="ml-1.5 px-2 py-0.5 bg-red-50 text-red-500 rounded text-[10px] font-bold">VOID</span>}</td>
                  <td className="p-3 text-sm">{fmtDate(s.date)}</td>
                  <td className="p-3 text-sm">{s.customer}</td>
                  <td className="p-3 text-sm"><span className={`px-2.5 py-1 rounded-lg text-[11px] font-bold ${s.type === 'WhatsApp' ? 'bg-wa/10 text-wa' : s.type === 'Wholesale' ? 'bg-amber-50 text-amber-500' : 'bg-green-50 text-green-500'}`}>{s.type}</span> <span className={`px-2.5 py-1 rounded-lg text-[11px] font-bold ${s.payment === 'Cash' ? 'bg-green-50 text-green-500' : 'bg-amber-50 text-amber-500'}`}>{s.payment}</span></td>
                  <td className="p-3 text-sm font-bold">{money(s.total)}</td>
                  <td className="p-3"><button onClick={() => onPrintReceipt(s)} className="h-9 px-3 bg-indigo-500 text-white rounded-lg text-xs font-semibold">🖨️</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
