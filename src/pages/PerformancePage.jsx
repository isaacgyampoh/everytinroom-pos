import { useState } from 'react'
import { useStore } from '../hooks/useStore'
import { money, today, weekStartDate, monthStart, isoDate } from '../lib/utils'

export default function PerformancePage() {
  const { sales, staff, perfPeriod, setPerfPeriod } = useStore()
  const [expanded, setExpanded] = useState(null)
  const range = perfPeriod === 'today' ? { from: today(), to: today() } : perfPeriod === 'week' ? { from: weekStartDate(), to: today() } : { from: monthStart(), to: today() }
  const names = new Set(); sales.forEach(s => { if (s.cashier) names.add(s.cashier) }); staff.forEach(s => names.add(s.name))
  const colors = ['#0ea5e9', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899']
  let ci = 0

  // Get products sold by a staff member
  const getProductsSold = (staffSales) => {
    const map = {}
    for (const s of staffSales) {
      const items = Array.isArray(s.items) ? s.items : []
      for (const it of items) {
        const key = it.name || it.productId || 'Unknown'
        if (!map[key]) map[key] = { name: key, qty: 0, revenue: 0 }
        map[key].qty += (it.qty || 1)
        map[key].revenue += (it.price || 0) * (it.qty || 1)
      }
    }
    return Object.values(map).sort((a, b) => b.qty - a.qty)
  }

  return (
    <div className="animate-fade">
      <h1 className="text-3xl md:text-4xl font-extrabold mb-6">👥 Staff Sales</h1>
      <div className="flex gap-2.5 mb-6">
        {[['today', '📅 Today'], ['week', '📆 Week'], ['month', '📊 Month']].map(([p, l]) => (
          <button key={p} onClick={() => setPerfPeriod(p)} className={`h-12 px-6 rounded-xl text-sm md:text-base font-semibold border-2 transition ${perfPeriod === p ? 'bg-brand-500 text-white border-transparent' : 'bg-white border-gray-200 text-gray-500'}`}>{l}</button>
        ))}
      </div>
      {[...names].map(name => {
        if (!name) return null
        const ss = sales.filter(s => !s.voided && isoDate(s.date) >= range.from && isoDate(s.date) <= range.to && s.cashier === name)
        if (!ss.length && !staff.find(s => s.name === name)) return null
        let rev = 0, prof = 0, cash = 0, momo = 0
        ss.forEach(s => { rev += s.total; prof += s.profit; if (s.payment === 'Cash') cash += s.total; else momo += s.total })
        const color = colors[ci++ % colors.length]
        const isOpen = expanded === name
        const productsSold = isOpen ? getProductsSold(ss) : []

        return (
          <div key={name} className="bg-white rounded-3xl p-6 md:p-8 mb-4 shadow-md" style={{ borderLeft: `5px solid ${color}` }}>
            <div className="flex justify-between items-center flex-wrap gap-3 mb-5">
              <div className="flex items-center gap-3">
                <div className="w-14 h-14 rounded-full flex items-center justify-center text-2xl font-bold text-white" style={{ background: color }}>{name.charAt(0)}</div>
                <span className="text-xl md:text-2xl font-extrabold">{name}</span>
              </div>
              <span className="px-4 py-2 bg-brand-50 text-brand-500 rounded-xl text-sm font-bold">{ss.length} sales</span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
              {[['Revenue', money(rev), color], ['Profit', money(prof), '#22c55e'], ['💵 Cash', money(cash), null], ['📱 Momo', money(momo), null]].map(([l, v, c], i) => (
                <div key={i} className="bg-gray-50 rounded-xl p-4 md:p-5 text-center">
                  <div className="text-xs md:text-sm font-bold text-gray-400 uppercase mb-1.5">{l}</div>
                  <div className="text-xl md:text-2xl font-extrabold" style={c ? { color: c } : {}}>{v}</div>
                </div>
              ))}
            </div>

            {/* Toggle Products Sold */}
            <button onClick={() => setExpanded(isOpen ? null : name)} className={`w-full h-12 rounded-xl text-sm md:text-base font-semibold transition ${isOpen ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
              {isOpen ? '▲ Hide Products Sold' : '▼ View Products Sold (' + getProductsSold(ss).length + ')'}
            </button>

            {isOpen && productsSold.length > 0 && (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[400px]">
                  <thead>
                    <tr>
                      <th className="p-3 bg-gray-50 text-left text-xs md:text-sm font-bold text-gray-500">Product</th>
                      <th className="p-3 bg-gray-50 text-center text-xs md:text-sm font-bold text-gray-500">Qty Sold</th>
                      <th className="p-3 bg-gray-50 text-right text-xs md:text-sm font-bold text-gray-500">Revenue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {productsSold.map((p, i) => (
                      <tr key={i} className="border-b border-gray-50">
                        <td className="p-3 text-sm md:text-base font-semibold">{p.name}</td>
                        <td className="p-3 text-center">
                          <span className="px-3 py-1.5 bg-brand-50 text-brand-500 rounded-lg text-sm font-bold">{p.qty}</span>
                        </td>
                        <td className="p-3 text-right text-sm md:text-base font-bold" style={{ color }}>{money(p.revenue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {isOpen && productsSold.length === 0 && (
              <div className="mt-4 text-center py-6 text-gray-400">No product data available</div>
            )}
          </div>
        )
      })}
    </div>
  )
}
