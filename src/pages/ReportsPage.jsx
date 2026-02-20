import { useStore } from '../hooks/useStore'
import { money, today, weekStartDate, monthStart, isoDate, fmtDate } from '../lib/utils'

function StatCard({ icon, label, value, color }) {
  return (
    <div className="bg-white rounded-2xl p-5 md:p-6 shadow-sm">
      <div className="text-xs md:text-sm font-bold text-gray-400 uppercase mb-1">{icon} {label}</div>
      <div className="text-xl md:text-2xl font-extrabold" style={color ? { color } : {}}>{value}</div>
    </div>
  )
}

function Section({ title, borderColor, data, exp, refundAmt }) {
  return (
    <div className="bg-white rounded-3xl p-6 md:p-8 shadow-md mb-5" style={{ borderLeft: '5px solid ' + borderColor }}>
      <h3 className="text-lg md:text-xl font-bold mb-5">{title}</h3>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <StatCard icon="💰" label="Total Sales" value={money(data.total)} />
        <StatCard icon="💵" label="Cash" value={money(data.cash)} color="#16a34a" />
        <StatCard icon="📱" label="Momo" value={money(data.momo)} color="#ca8a04" />
        <StatCard icon="🧾" label="Transactions" value={data.txn} />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard icon="📈" label="Profit" value={money(data.profit)} color="#22c55e" />
        <StatCard icon="💸" label="Expenses" value={money(exp)} color="#ef4444" />
        <StatCard icon="↩️" label="Refunds" value={money(refundAmt)} color="#8b5cf6" />
        <StatCard icon="💎" label="Net Profit" value={money(data.profit - exp)} color={data.profit - exp >= 0 ? '#22c55e' : '#ef4444'} />
      </div>
      {data.paystack > 0 && <div className="mt-3 px-3 py-2 bg-cyan-50 rounded-lg text-sm md:text-base text-cyan-600 font-semibold inline-block">💳 Paystack: {money(data.paystack)}</div>}
    </div>
  )
}

export default function ReportsPage() {
  const { sales, expenses, refunds } = useStore()
  const t = today(), ws = weekStartDate(), ms = monthStart()

  const calc = (arr) => {
    let total = 0, cash = 0, momo = 0, paystack = 0, profit = 0, txn = 0
    for (const s of arr) {
      if (s.voided) continue
      total += s.total; profit += s.profit; txn++
      if (s.payment === 'Cash') cash += s.total
      else if (s.payment === 'Momo') momo += s.total
      else paystack += s.total
    }
    return { total, cash, momo, paystack, profit, txn }
  }

  const expTotal = (from, to) => expenses.filter(e => isoDate(e.date) >= from && isoDate(e.date) <= to).reduce((a, e) => a + e.amount, 0)
  const refTotal = (from, to) => refunds.filter(r => isoDate(r.date) >= from && isoDate(r.date) <= to).reduce((a, r) => a + r.refundAmount, 0)

  const todayData = calc(sales.filter(s => isoDate(s.date) === t))
  const weekData = calc(sales.filter(s => isoDate(s.date) >= ws && isoDate(s.date) <= t))
  const monthData = calc(sales.filter(s => isoDate(s.date) >= ms && isoDate(s.date) <= t))

  const todayExp = expTotal(t, t), weekExp = expTotal(ws, t), monthExp = expTotal(ms, t)
  const todayRef = refTotal(t, t), weekRef = refTotal(ws, t), monthRef = refTotal(ms, t)

  // Daily breakdown for the week
  const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
  const weekDays = []
  const wsDate = new Date(ws + 'T00:00:00')
  for (let i = 0; i < 7; i++) {
    const d = new Date(wsDate); d.setDate(wsDate.getDate() + i)
    const ds = isoDate(d)
    if (ds > t) break
    const dayData = calc(sales.filter(s => isoDate(s.date) === ds))
    weekDays.push({ name: dayNames[i], date: ds, ...dayData })
  }

  // Top Selling Products (this month)
  const monthSales = sales.filter(s => !s.voided && isoDate(s.date) >= ms && isoDate(s.date) <= t)
  const productMap = {}
  for (const s of monthSales) {
    const items = Array.isArray(s.items) ? s.items : []
    for (const it of items) {
      const key = it.name || 'Unknown'
      if (!productMap[key]) productMap[key] = { name: key, qty: 0, revenue: 0 }
      productMap[key].qty += (it.qty || 1)
      productMap[key].revenue += (it.price || 0) * (it.qty || 1)
    }
  }
  const topProducts = Object.values(productMap).sort((a, b) => b.qty - a.qty).slice(0, 15)
  const maxQty = topProducts.length > 0 ? topProducts[0].qty : 1

  return (
    <div className="animate-fade">
      <h1 className="text-3xl md:text-4xl font-extrabold mb-6">📈 Reports</h1>

      <Section title="📅 Today" borderColor="#0ea5e9" data={todayData} exp={todayExp} refundAmt={todayRef} />
      <Section title="📆 This Week" borderColor="#22c55e" data={weekData} exp={weekExp} refundAmt={weekRef} />
      <Section title="📊 This Month" borderColor="#f59e0b" data={monthData} exp={monthExp} refundAmt={monthRef} />

      {/* Top Selling Products */}
      <div className="bg-white rounded-3xl p-6 md:p-8 shadow-md mb-5" style={{ borderLeft: '5px solid #22c55e' }}>
        <h3 className="text-lg md:text-xl font-bold mb-2">🔥 Top Selling Products</h3>
        <p className="text-sm md:text-base text-gray-400 mb-5">Most popular products this month — use this to know what to restock</p>
        {topProducts.length === 0 && <div className="text-center py-8 text-gray-400 md:text-lg">No sales data this month</div>}
        {topProducts.map((p, i) => {
          const barWidth = Math.max(8, (p.qty / maxQty) * 100)
          return (
            <div key={i} className="mb-3">
              <div className="flex justify-between items-center mb-1.5">
                <div className="flex items-center gap-3">
                  <span className={'w-8 h-8 md:w-10 md:h-10 rounded-lg flex items-center justify-center text-sm md:text-base font-bold text-white ' + (i < 3 ? 'bg-green-500' : 'bg-gray-400')}>{i + 1}</span>
                  <span className="text-sm md:text-base font-semibold">{p.name}</span>
                </div>
                <div className="text-right">
                  <span className="text-sm md:text-base font-extrabold text-green-600">{p.qty} sold</span>
                  <span className="text-xs md:text-sm text-gray-400 ml-2">{money(p.revenue)}</span>
                </div>
              </div>
              <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
                <div className={'h-full rounded-full transition-all ' + (i < 3 ? 'bg-green-500' : 'bg-gray-300')} style={{ width: barWidth + '%' }} />
              </div>
            </div>
          )
        })}
      </div>

      {/* Daily Breakdown */}
      <div className="bg-white rounded-3xl p-6 md:p-8 shadow-md mb-5" style={{ borderLeft: '5px solid #8b5cf6' }}>
        <h3 className="text-lg md:text-xl font-bold mb-5">📊 Daily Breakdown (This Week)</h3>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[500px]">
            <thead>
              <tr>
                <th className="p-3 bg-gray-50 text-left text-xs md:text-sm font-bold text-gray-500 uppercase">Day</th>
                <th className="p-3 bg-gray-50 text-right text-xs md:text-sm font-bold text-gray-500 uppercase">Sales</th>
                <th className="p-3 bg-gray-50 text-right text-xs md:text-sm font-bold text-gray-500 uppercase">Cash</th>
                <th className="p-3 bg-gray-50 text-right text-xs md:text-sm font-bold text-gray-500 uppercase">Momo</th>
                <th className="p-3 bg-gray-50 text-right text-xs md:text-sm font-bold text-gray-500 uppercase">Profit</th>
                <th className="p-3 bg-gray-50 text-center text-xs md:text-sm font-bold text-gray-500 uppercase">Txn</th>
              </tr>
            </thead>
            <tbody>
              {weekDays.map(d => (
                <tr key={d.date} className={'border-b border-gray-50 ' + (d.date === t ? 'bg-brand-50/50' : '')}>
                  <td className="p-3 text-sm md:text-base"><b>{d.name}</b><br /><span className="text-gray-400 text-xs md:text-sm">{fmtDate(d.date)}</span></td>
                  <td className="p-3 text-sm md:text-base text-right font-bold">{money(d.total)}</td>
                  <td className="p-3 text-sm md:text-base text-right text-green-600">{money(d.cash)}</td>
                  <td className="p-3 text-sm md:text-base text-right text-amber-600">{money(d.momo)}</td>
                  <td className="p-3 text-sm md:text-base text-right text-green-600 font-semibold">{money(d.profit)}</td>
                  <td className="p-3 text-sm md:text-base text-center"><span className="px-3 py-1.5 bg-brand-50 text-brand-500 rounded-lg text-xs md:text-sm font-bold">{d.txn}</span></td>
                </tr>
              ))}
              {weekDays.length === 0 && <tr><td colSpan={6} className="text-center py-8 text-gray-400 md:text-lg">No sales this week</td></tr>}
            </tbody>
            <tfoot>
              <tr className="bg-gray-50 font-bold">
                <td className="p-3 text-sm md:text-base">Total</td>
                <td className="p-3 text-sm md:text-base text-right">{money(weekData.total)}</td>
                <td className="p-3 text-sm md:text-base text-right text-green-600">{money(weekData.cash)}</td>
                <td className="p-3 text-sm md:text-base text-right text-amber-600">{money(weekData.momo)}</td>
                <td className="p-3 text-sm md:text-base text-right text-green-600">{money(weekData.profit)}</td>
                <td className="p-3 text-sm md:text-base text-center">{weekData.txn}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* Expenses This Month */}
      <div className="bg-white rounded-3xl p-6 md:p-8 shadow-md mb-5" style={{ borderLeft: '5px solid #ef4444' }}>
        <h3 className="text-lg md:text-xl font-bold mb-5">💸 Expenses This Month</h3>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[400px]">
            <thead>
              <tr>
                <th className="p-3 bg-gray-50 text-left text-xs md:text-sm font-bold text-gray-500 uppercase">Date</th>
                <th className="p-3 bg-gray-50 text-left text-xs md:text-sm font-bold text-gray-500 uppercase">Category</th>
                <th className="p-3 bg-gray-50 text-left text-xs md:text-sm font-bold text-gray-500 uppercase">Description</th>
                <th className="p-3 bg-gray-50 text-right text-xs md:text-sm font-bold text-gray-500 uppercase">Amount</th>
              </tr>
            </thead>
            <tbody>
              {expenses.filter(e => isoDate(e.date) >= ms).length === 0 && (
                <tr><td colSpan={4} className="text-center py-6 text-gray-400 md:text-lg">No expenses this month</td></tr>
              )}
              {expenses.filter(e => isoDate(e.date) >= ms).map(e => (
                <tr key={e.id} className="border-b border-gray-50">
                  <td className="p-3 text-sm md:text-base">{fmtDate(e.date)}</td>
                  <td className="p-3"><span className="px-2.5 py-1.5 bg-red-50 text-red-500 rounded-lg text-xs md:text-sm font-bold">{e.category}</span></td>
                  <td className="p-3 text-sm md:text-base">{e.description}</td>
                  <td className="p-3 text-sm md:text-base text-right font-bold text-red-500">{money(e.amount)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-gray-50 font-bold">
                <td colSpan={3} className="p-3 text-sm md:text-base">Total Expenses</td>
                <td className="p-3 text-sm md:text-base text-right text-red-500">{money(monthExp)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* Refunds This Month */}
      <div className="bg-white rounded-3xl p-6 md:p-8 shadow-md" style={{ borderLeft: '5px solid #8b5cf6' }}>
        <h3 className="text-lg md:text-xl font-bold mb-5">↩️ Refunds This Month</h3>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[400px]">
            <thead>
              <tr>
                <th className="p-3 bg-gray-50 text-left text-xs md:text-sm font-bold text-gray-500 uppercase">Date</th>
                <th className="p-3 bg-gray-50 text-left text-xs md:text-sm font-bold text-gray-500 uppercase">Refund #</th>
                <th className="p-3 bg-gray-50 text-left text-xs md:text-sm font-bold text-gray-500 uppercase">Reason</th>
                <th className="p-3 bg-gray-50 text-right text-xs md:text-sm font-bold text-gray-500 uppercase">Amount</th>
              </tr>
            </thead>
            <tbody>
              {refunds.filter(r => isoDate(r.date) >= ms).length === 0 && (
                <tr><td colSpan={4} className="text-center py-6 text-gray-400 md:text-lg">No refunds this month</td></tr>
              )}
              {refunds.filter(r => isoDate(r.date) >= ms).map(r => (
                <tr key={r.id} className="border-b border-gray-50">
                  <td className="p-3 text-sm md:text-base">{fmtDate(r.date)}</td>
                  <td className="p-3 text-sm md:text-base font-bold text-violet-500">{r.refundNo}</td>
                  <td className="p-3 text-sm md:text-base">{r.reason}</td>
                  <td className="p-3 text-sm md:text-base text-right font-bold text-violet-500">{money(r.refundAmount)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-gray-50 font-bold">
                <td colSpan={3} className="p-3 text-sm md:text-base">Total Refunds</td>
                <td className="p-3 text-sm md:text-base text-right text-violet-500">{money(monthRef)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  )
}
