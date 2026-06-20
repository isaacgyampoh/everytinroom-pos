import { useState } from 'react'
import { useStore } from '../hooks/useStore'
import { money, num, today, weekStartDate, monthStart, isoDate } from '../lib/utils'

export default function PerformancePage() {
  const { sales, staff, perfPeriod, setPerfPeriod } = useStore()
  const [expanded, setExpanded] = useState(null)

  const range = perfPeriod === 'today' ? { from: today(), to: today() }
    : perfPeriod === 'week' ? { from: weekStartDate(), to: today() }
    : perfPeriod === 'month' ? { from: monthStart(), to: today() }
    : { from: '2000-01-01', to: today() }

  const names = new Set()
  sales.forEach(s => { if (s.cashier) names.add(s.cashier) })
  staff.forEach(s => names.add(s.name))

  const getProductsSold = (staffSales) => {
    const map = {}
    for (const s of staffSales) {
      for (const it of (Array.isArray(s.items) ? s.items : [])) {
        const key = it.name || it.productId || 'Unknown'
        if (!map[key]) map[key] = { name: key, qty: 0, revenue: 0 }
        map[key].qty += num(it.qty || 1)
        map[key].revenue += num(it.price) * num(it.qty || 1)
      }
    }
    return Object.values(map).sort((a, b) => b.qty - a.qty)
  }

  const staffData = [...names].map(name => {
    const ss = sales.filter(s => !s.voided && isoDate(s.date) >= range.from && isoDate(s.date) <= range.to && s.cashier === name)
    return { name, sales: ss, count: ss.length, revenue: ss.reduce((a, s) => a + s.total, 0), profit: ss.reduce((a, s) => a + s.profit, 0), cash: ss.filter(s => s.payment === 'Cash').reduce((a, s) => a + s.total, 0), momo: ss.filter(s => s.payment === 'Momo' || s.payment === 'Paystack').reduce((a, s) => a + s.total, 0) }
  }).filter(s => s.count > 0 || staff.find(st => st.name === s.name)).sort((a, b) => b.revenue - a.revenue)

  const totalRevAll = staffData.reduce((a, s) => a + s.revenue, 0)

  return (
    <div >
      <h1 className="text-[22px] md:text-[26px] font-bold mb-1 tracking-tight">Staff Sales</h1>
      <p className="text-gray-400 text-sm mb-5">Performance & sales breakdown per staff member</p>

      {/* Period Tabs */}
      <div className="flex gap-2 overflow-x-auto mb-6 pb-1 scrollbar-hide">
        {[['today', 'Today'], ['week', 'This Week'], ['month', 'This Month'], ['overall', 'Overall']].map(([p, l]) => (
          <button key={p} onClick={() => setPerfPeriod(p)}
            className={`h-10 md:h-11 px-4 md:px-5 rounded-xl text-[13px] md:text-sm font-semibold whitespace-nowrap transition-all ${perfPeriod === p ? 'bg-gray-700 text-white shadow-md shadow-gray-500/20' : 'bg-white border border-gray-200 text-gray-500 hover:border-gray-200'}`}>
            {l}
          </button>
        ))}
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        <div className="bg-white rounded-2xl p-4 md:p-5 text-center border border-gray-100">
          <div className="text-xs md:text-sm text-gray-400 font-medium">Total Staff</div>
          <div className="text-[22px] md:text-[26px] font-bold mt-1">{staffData.length}</div>
        </div>
        <div className="bg-white rounded-2xl p-4 md:p-5 text-center border border-gray-100">
          <div className="text-xs md:text-sm text-gray-400 font-medium">Total Sales</div>
          <div className="text-[22px] md:text-[26px] font-bold mt-1">{staffData.reduce((a, s) => a + s.count, 0)}</div>
        </div>
        <div className="bg-white rounded-2xl p-4 md:p-5 text-center border border-gray-100">
          <div className="text-xs md:text-sm text-gray-400 font-medium">Total Revenue</div>
          <div className="text-xl md:text-2xl font-bold text-gray-600 mt-1">{money(totalRevAll)}</div>
        </div>
      </div>

      {/* Staff Cards */}
      {staffData.length === 0 && <div className="text-center py-16 text-gray-300"><span className="text-xl opacity-15">—</span>No sales data for this period</div>}

      <div className="space-y-4">
        {staffData.map((s, idx) => {
          const isOpen = expanded === s.name
          const productsSold = isOpen ? getProductsSold(s.sales) : []
          const revPct = totalRevAll ? (s.revenue / totalRevAll * 100) : 0

          return (
            <div key={s.name} className="bg-white rounded-2xl border border-gray-100 overflow-hidden shadow-sm">
              {/* Header */}
              <div className="p-4 md:p-5">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className={`w-11 h-11 md:w-12 md:h-12 rounded-xl flex items-center justify-center text-lg md:text-xl font-bold text-white ${idx === 0 ? 'bg-gray-700' : idx === 1 ? 'bg-amber-500' : 'bg-gray-400'}`}>
                      {s.name.charAt(0)}
                    </div>
                    <div>
                      <div className="text-base md:text-lg font-bold text-gray-800">{s.name}</div>
                      <div className="text-xs md:text-sm text-gray-400">{s.count} transactions • {revPct.toFixed(0)}% of revenue</div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-lg md:text-xl font-bold text-gray-600">{money(s.revenue)}</div>
                  </div>
                </div>

                {/* Stats Grid */}
                <div className="grid grid-cols-4 gap-2 md:gap-3">
                  {[
                    { label: 'Revenue', value: money(s.revenue), color: 'text-gray-600' },
                    { label: 'Profit', value: money(s.profit), color: 'text-green-600' },
                    { label: 'Cash', value: money(s.cash), color: 'text-gray-700' },
                    { label: 'Momo', value: money(s.momo), color: 'text-amber-600' },
                  ].map((stat, i) => (
                    <div key={i} className="bg-gray-50 rounded-xl p-2.5 md:p-3 text-center">
                      <div className="text-[10px] md:text-xs text-gray-400 font-medium">{stat.label}</div>
                      <div className={`text-sm md:text-base font-bold mt-0.5 ${stat.color}`}>{stat.value}</div>
                    </div>
                  ))}
                </div>

                {/* Revenue Bar */}
                <div className="mt-3">
                  <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full bg-gray-700 rounded-full transition-all" style={{ width: Math.max(1, revPct) + '%' }} />
                  </div>
                </div>
              </div>

              {/* Toggle Products */}
              <button onClick={() => setExpanded(isOpen ? null : s.name)}
                className={`w-full h-11 border-t text-sm font-semibold transition-all ${isOpen ? 'bg-gray-800 text-white border-gray-800' : 'bg-gray-50 text-gray-500 border-gray-100 hover:bg-gray-100'}`}>
                {isOpen ? '▲ Hide Products Sold' : '▼ View Products Sold'}
              </button>

              {/* Products Table */}
              {isOpen && (
                <div className="border-t border-gray-100">
                  {productsSold.length === 0 ? (
                    <div className="text-center py-6 text-gray-400 text-sm">No product data</div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead>
                          <tr className="bg-gray-50">
                            <th className="p-3 text-left text-[11px] md:text-xs font-bold text-gray-400 uppercase tracking-wide">#</th>
                            <th className="p-3 text-left text-[11px] md:text-xs font-bold text-gray-400 uppercase tracking-wide">Product</th>
                            <th className="p-3 text-center text-[11px] md:text-xs font-bold text-gray-400 uppercase tracking-wide">Qty</th>
                            <th className="p-3 text-right text-[11px] md:text-xs font-bold text-gray-400 uppercase tracking-wide">Revenue</th>
                          </tr>
                        </thead>
                        <tbody>
                          {productsSold.map((p, i) => (
                            <tr key={i} className="border-b border-gray-50">
                              <td className="p-3 text-sm text-gray-400">{i + 1}</td>
                              <td className="p-3 text-sm font-semibold text-gray-700">{p.name}</td>
                              <td className="p-3 text-center"><span className="px-2.5 py-1 bg-gray-50 text-gray-700 rounded-lg text-xs font-bold">{p.qty}</span></td>
                              <td className="p-3 text-right text-sm font-bold text-gray-800">{money(p.revenue)}</td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr className="bg-gray-50">
                            <td colSpan={2} className="p-3 text-sm font-bold text-gray-600">Total</td>
                            <td className="p-3 text-center text-sm font-bold text-gray-700">{productsSold.reduce((a, p) => a + p.qty, 0)}</td>
                            <td className="p-3 text-right text-sm font-bold text-gray-700">{money(productsSold.reduce((a, p) => a + p.revenue, 0))}</td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
