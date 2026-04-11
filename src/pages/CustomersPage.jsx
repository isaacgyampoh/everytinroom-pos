import { useState } from 'react'
import { useStore } from '../hooks/useStore'
import { money, fmtDate } from '../lib/utils'

export default function CustomersPage() {
  const { customers } = useStore()
  const [query, setQuery] = useState('')
  const filtered = customers.filter(c => c.phone.includes(query))

  return (
    <div >
      <h1 className="text-[22px] md:text-[26px] font-bold mb-6">Customers</h1>
      <div className="bg-gray-800 rounded-2xl p-5 text-white mb-6"><small className="text-sm opacity-80">Total Customers</small><strong className="block text-[22px] md:text-[26px] font-bold mt-2">{customers.length}</strong></div>
      <div className="bg-white rounded-2xl p-6 shadow-md">
        <input className="w-full h-13 px-4 bg-gray-50 border-2 border-gray-200 rounded-xl text-base mb-5" placeholder="Search..." value={query} onChange={e => setQuery(e.target.value)} />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[400px]">
            <thead><tr><th className="p-3 bg-gray-50 text-left text-[11px] font-bold text-gray-500 uppercase">Phone</th><th className="p-3 bg-gray-50 text-left text-[11px] font-bold text-gray-500 uppercase">Visits</th><th className="p-3 bg-gray-50 text-left text-[11px] font-bold text-gray-500 uppercase">Total Spent</th><th className="p-3 bg-gray-50 text-left text-[11px] font-bold text-gray-500 uppercase">Last Visit</th></tr></thead>
            <tbody>{filtered.length === 0 ? <tr><td colSpan={4} className="text-center py-12 text-gray-400">No customers</td></tr> : filtered.map(c => (
              <tr key={c.id} className="border-b border-gray-50"><td className="p-3 text-sm font-semibold">{c.phone}</td><td className="p-3"><span className="px-2.5 py-1 bg-gray-50 text-gray-600 rounded-lg text-[11px] font-bold">{c.visitCount}</span></td><td className="p-3 text-sm font-bold text-green-500">{money(c.totalSpent)}</td><td className="p-3 text-sm">{fmtDate(c.lastVisit)}</td></tr>
            ))}</tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
