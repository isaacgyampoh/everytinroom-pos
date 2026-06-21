import { useState } from 'react'
import { useStore } from '../hooks/useStore'
import { money, num, today, weekStartDate, monthStart, isoDate, fmtDate } from '../lib/utils'

const Section = ({ title, children, icon }) => (
  <div className="bg-white rounded-2xl p-5 md:p-6 border border-gray-100 shadow-sm">
    <h3 className="text-base md:text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">{icon && <span>{icon}</span>}{title}</h3>
    {children}
  </div>
)

const Stat = ({ label, value, sub, color = 'text-gray-900' }) => (
  <div className="text-center p-3 md:p-4 bg-gray-50 rounded-xl">
    <div className="text-xs md:text-sm text-gray-400 font-medium">{label}</div>
    <div className={`text-lg md:text-2xl font-bold mt-1 ${color}`}>{value}</div>
    {sub && <div className="text-[11px] md:text-xs text-gray-400 mt-0.5">{sub}</div>}
  </div>
)

export default function ReportsPage() {
  const { sales, expenses, refunds, products } = useStore()
  const [tab, setTab] = useState('today')

  const t = today(), ws = weekStartDate(), ms = monthStart()

  const filterSales = (list) => {
    if (tab === 'today') return list.filter(s => isoDate(s.date) === t)
    if (tab === 'week') return list.filter(s => isoDate(s.date) >= ws && isoDate(s.date) <= t)
    if (tab === 'month') return list.filter(s => isoDate(s.date) >= ms && isoDate(s.date) <= t)
    return list // overall
  }
  const filterByDate = (list, dateFn) => {
    if (tab === 'today') return list.filter(e => dateFn(e) === t)
    if (tab === 'week') return list.filter(e => dateFn(e) >= ws && dateFn(e) <= t)
    if (tab === 'month') return list.filter(e => dateFn(e) >= ms && dateFn(e) <= t)
    return list
  }

  const fSales = filterSales(sales.filter(s => !s.voided))
  const fExpenses = filterByDate(expenses, e => isoDate(e.date))
  const fRefunds = filterByDate(refunds, r => isoDate(r.date))

  const totalRev = fSales.reduce((a, s) => a + s.total, 0)
  const totalProfit = fSales.reduce((a, s) => a + s.profit, 0)
  const totalDiscount = fSales.reduce((a, s) => a + s.discount, 0)
  const totalExp = fExpenses.reduce((a, e) => a + e.amount, 0)
  const totalRefAmt = fRefunds.reduce((a, r) => a + r.refundAmount, 0)
  const netCashFlow = totalRev - totalExp - totalRefAmt

  const cashSales = fSales.filter(s => s.payment === 'Cash')
  const momoSales = fSales.filter(s => s.payment === 'Momo' || s.payment === 'Paystack')
  const splitSales = fSales.filter(s => s.payment === 'Split')
  const cashTotal = cashSales.reduce((a, s) => a + s.total, 0) + splitSales.reduce((a, s) => a + (s.splitCash || 0), 0)
  const momoTotal = momoSales.reduce((a, s) => a + s.total, 0) + splitSales.reduce((a, s) => a + (s.splitMomo || 0), 0)

  const retailSales = fSales.filter(s => s.type === 'Retail')
  const wholesaleSales = fSales.filter(s => s.type === 'Wholesale')
  const waSales = fSales.filter(s => s.type === 'WhatsApp')

  // Top selling products
  const prodMap = {}
  fSales.forEach(s => s.items?.forEach(it => {
    const key = it.name || it.productId
    if (!prodMap[key]) prodMap[key] = { name: it.name, qty: 0, revenue: 0 }
    prodMap[key].qty += num(it.qty)
    prodMap[key].revenue += num(it.price) * num(it.qty)
  }))
  const topProducts = Object.values(prodMap).sort((a, b) => b.qty - a.qty).slice(0, 15)
  const maxQty = topProducts[0]?.qty || 1

  // Daily breakdown
  const dayMap = {}
  fSales.forEach(s => {
    const d = isoDate(s.date)
    if (!dayMap[d]) dayMap[d] = { date: d, sales: 0, revenue: 0, profit: 0, cash: 0, momo: 0 }
    dayMap[d].sales++
    dayMap[d].revenue += s.total
    dayMap[d].profit += s.profit
    if (s.payment === 'Cash') dayMap[d].cash += s.total
    else if (s.payment === 'Momo' || s.payment === 'Paystack') dayMap[d].momo += s.total
    else if (s.payment === 'Split') { dayMap[d].cash += (s.splitCash || 0); dayMap[d].momo += (s.splitMomo || 0) }
  })
  const days = Object.values(dayMap).sort((a, b) => b.date.localeCompare(a.date))

  // Expense categories
  const expCatMap = {}
  fExpenses.forEach(e => {
    const cat = e.category || 'Other'
    if (!expCatMap[cat]) expCatMap[cat] = { category: cat, total: 0, count: 0 }
    expCatMap[cat].total += e.amount
    expCatMap[cat].count++
  })
  const expCats = Object.values(expCatMap).sort((a, b) => b.total - a.total)

  // Staff performance
  const staffMap = {}
  fSales.forEach(s => {
    const name = s.cashier || 'Unknown'
    if (!staffMap[name]) staffMap[name] = { name, sales: 0, revenue: 0 }
    staffMap[name].sales++
    staffMap[name].revenue += s.total
  })
  const staffPerf = Object.values(staffMap).sort((a, b) => b.revenue - a.revenue)

  const tabs = [
    { id: 'today', label: 'Today' },
    { id: 'week', label: 'This Week' },
    { id: 'month', label: 'This Month' },
    { id: 'overall', label: 'Overall' },
  ]

  return (
    <div >
      <div className="flex justify-between items-start flex-wrap gap-3 mb-5">
        <div>
          <h1 className="text-[22px] md:text-[26px] font-bold tracking-tight">Reports</h1>
          <p className="text-gray-400 text-sm mt-0.5">Business analytics & insights</p>
        </div>
        <button onClick={() => {
          const rows = [['Date','Receipt','Customer','Staff','Payment','Type','Items','Subtotal','Discount','Total','Profit']]
          fSales.forEach(s => rows.push([isoDate(s.date), s.receiptNo, s.customer, s.cashier, s.payment, s.type, (s.items||[]).map(i=>i.name).join('; '), s.total+s.discount, s.discount, s.total, s.profit]))
          rows.push([]); rows.push(['','','','','','','TOTAL','',totalDiscount,totalRev,totalProfit])
          const csv = rows.map(r => r.map(c => '"'+String(c||'').replace(/"/g,'""')+'"').join(',')).join('\n')
          const blob = new Blob([csv], { type: 'text/csv' })
          const url = URL.createObjectURL(blob)
          const a = document.createElement('a'); a.href = url; a.download = `everytin-room-report-${tab}-${today()}.csv`; a.click()
        }} className="h-10 px-4 bg-[#16181d] text-white rounded-xl text-sm font-semibold hover:bg-[#2a2d34] active:scale-[.97] transition">
          Export CSV
        </button>
      </div>

      {/* Period Tabs */}
      <div className="flex gap-2 overflow-x-auto mb-6 pb-1 scrollbar-hide">
        {tabs.map(tb => (
          <button key={tb.id} onClick={() => setTab(tb.id)}
            className={`h-10 md:h-11 px-4 md:px-5 rounded-xl text-[13px] md:text-sm font-semibold whitespace-nowrap transition-all ${tab === tb.id ? 'bg-gray-900 text-white' : 'bg-white border border-gray-200 text-gray-500 hover:border-gray-300'}`}>
            {tb.label}
          </button>
        ))}
      </div>

      {/* Revenue Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 mb-5">
        <Stat label="Total Revenue" value={money(totalRev)} sub={fSales.length + ' sales'} color="text-gray-800" />
        <Stat label="Gross Profit" value={money(totalProfit)} color="text-green-600" />
        <Stat label="Expenses" value={money(totalExp)} sub={fExpenses.length + ' entries'} color="text-red-500" />
        <Stat label="Net Cash Flow" value={money(netCashFlow)} color={netCashFlow >= 0 ? 'text-green-600' : 'text-red-500'} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 mb-6">
        <Stat label="Cash Collected" value={money(cashTotal)} sub={cashSales.length + ' cash sales'} color="text-green-600" />
        <Stat label="Momo Collected" value={money(momoTotal)} sub={momoSales.length + ' momo sales'} color="text-amber-600" />
        <Stat label="Refunds" value={money(totalRefAmt)} sub={fRefunds.length + ' refunds'} color="text-violet-500" />
        <Stat label="Discounts Given" value={money(totalDiscount)} color="text-gray-500" />
      </div>

      <div className="grid md:grid-cols-2 gap-5 mb-5">
        {/* Payment Breakdown */}
        <Section title="Payment Breakdown" icon="">
          <div className="space-y-3">
            {[
              { label: 'Cash', count: cashSales.length, amount: cashTotal, color: 'bg-gray-800', pct: totalRev ? (cashTotal / totalRev * 100) : 0 },
              { label: 'Mobile Money', count: momoSales.length, amount: momoTotal, color: 'bg-gray-500', pct: totalRev ? (momoTotal / totalRev * 100) : 0 },
              { label: 'Split', count: splitSales.length, amount: splitSales.reduce((a, s) => a + s.total, 0), color: 'bg-gray-300', pct: totalRev ? (splitSales.reduce((a, s) => a + s.total, 0) / totalRev * 100) : 0 },
            ].map((p, i) => (
              <div key={i}>
                <div className="flex justify-between text-sm mb-1.5">
                  <span className="font-semibold text-gray-700">{p.label} <span className="text-gray-400 font-normal">({p.count})</span></span>
                  <span className="font-bold">{money(p.amount)} <span className="text-gray-400 text-xs">({p.pct.toFixed(0)}%)</span></span>
                </div>
                <div className="w-full h-2.5 bg-gray-100 rounded-full overflow-hidden">
                  <div className={`h-full rounded-full ${p.color} transition-all`} style={{ width: Math.max(1, p.pct) + '%' }} />
                </div>
              </div>
            ))}
          </div>
        </Section>

        {/* Sales Type Breakdown */}
        <Section title="Sales Type" icon="">
          <div className="space-y-3">
            {[
              { label: 'Retail', count: retailSales.length, amount: retailSales.reduce((a, s) => a + s.total, 0), color: 'bg-gray-800' },
              { label: 'Wholesale', count: wholesaleSales.length, amount: wholesaleSales.reduce((a, s) => a + s.total, 0), color: 'bg-amber-500' },
              { label: 'WhatsApp', count: waSales.length, amount: waSales.reduce((a, s) => a + s.total, 0), color: 'bg-green-500' },
            ].map((p, i) => (
              <div key={i} className="flex items-center justify-between p-3 bg-gray-50 rounded-xl">
                <div className="flex items-center gap-3">
                  <div className={`w-3 h-3 rounded-full ${p.color}`} />
                  <span className="text-sm font-semibold text-gray-700">{p.label}</span>
                </div>
                <div className="text-right">
                  <div className="text-sm font-bold">{money(p.amount)}</div>
                  <div className="text-xs text-gray-400">{p.count} sales</div>
                </div>
              </div>
            ))}
          </div>
        </Section>
      </div>

      <div className="grid md:grid-cols-2 gap-5 mb-5">
        {/* Top Selling Products */}
        <Section title="Top Selling Products" icon="">
          {topProducts.length === 0 ? <p className="text-gray-400 text-sm text-center py-4">No sales data</p> : (
            <div className="space-y-2.5">
              {topProducts.map((p, i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold ${i < 3 ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-500'}`}>{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-baseline mb-1">
                      <span className="text-sm font-semibold text-gray-700 truncate pr-2">{p.name}</span>
                      <span className="text-xs text-gray-400 whitespace-nowrap">{p.qty} sold • {money(p.revenue)}</span>
                    </div>
                    <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full bg-gray-800 rounded-full transition-all" style={{ width: (p.qty / maxQty * 100) + '%' }} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Section>

        {/* Expense Breakdown */}
        <Section title="Expense Categories" icon="">
          {expCats.length === 0 ? <p className="text-gray-400 text-sm text-center py-4">No expenses</p> : (
            <div className="space-y-2.5">
              {expCats.map((c, i) => (
                <div key={i} className="flex items-center justify-between p-3 bg-gray-50 rounded-xl">
                  <div>
                    <div className="text-sm font-semibold text-gray-700">{c.category}</div>
                    <div className="text-xs text-gray-400">{c.count} entries</div>
                  </div>
                  <span className="text-sm font-bold text-red-500">{money(c.total)}</span>
                </div>
              ))}
              <div className="flex justify-between p-3 bg-red-50 rounded-xl border border-red-100">
                <span className="text-sm font-bold text-red-600">Total Expenses</span>
                <span className="text-sm font-bold text-red-600">{money(totalExp)}</span>
              </div>
            </div>
          )}
        </Section>
      </div>

      <div className="grid md:grid-cols-2 gap-5 mb-5">
        {/* Staff Performance */}
        <Section title="Staff Performance" icon="">
          {staffPerf.length === 0 ? <p className="text-gray-400 text-sm text-center py-4">No data</p> : (
            <div className="space-y-2.5">
              {staffPerf.map((s, i) => (
                <div key={i} className="flex items-center justify-between p-3 bg-gray-50 rounded-xl">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full bg-gray-100 flex items-center justify-center text-gray-800 text-sm font-bold">{s.name.charAt(0)}</div>
                    <div>
                      <div className="text-sm font-semibold text-gray-700">{s.name}</div>
                      <div className="text-xs text-gray-400">{s.sales} sales</div>
                    </div>
                  </div>
                  <span className="text-sm font-bold text-gray-800">{money(s.revenue)}</span>
                </div>
              ))}
            </div>
          )}
        </Section>

        {/* Refund Summary */}
        <Section title="Refunds">
          {fRefunds.length === 0 ? <p className="text-gray-400 text-sm text-center py-4">No refunds</p> : (
            <div className="space-y-2.5">
              {fRefunds.slice(0, 8).map((r, i) => (
                <div key={i} className="flex items-center justify-between p-3 bg-gray-50 rounded-xl">
                  <div>
                    <div className="text-sm font-semibold text-violet-600">{r.refundNo}</div>
                    <div className="text-xs text-gray-400">{r.reason || '-'} • {fmtDate(r.date)}</div>
                  </div>
                  <span className="text-sm font-bold text-red-500">-{money(r.refundAmount)}</span>
                </div>
              ))}
              <div className="flex justify-between p-3 bg-gray-50 rounded-xl border border-gray-100">
                <span className="text-sm font-bold text-violet-600">Total Refunds</span>
                <span className="text-sm font-bold text-violet-600">{money(totalRefAmt)}</span>
              </div>
            </div>
          )}
        </Section>
      </div>

      {/* Daily Breakdown Table */}
      <Section title="Daily Breakdown">
        <div className="overflow-x-auto -mx-2">
          <table className="w-full min-w-[600px]">
            <thead>
              <tr>
                {['Date', 'Sales', 'Revenue', 'Cash', 'Momo', 'Profit'].map(h => (
                  <th key={h} className="p-3 bg-gray-50 text-left text-[11px] md:text-xs font-bold text-gray-400 uppercase tracking-wide first:rounded-l-xl last:rounded-r-xl">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {days.length === 0 && <tr><td colSpan={6} className="text-center py-8 text-gray-400 text-sm">No data for this period</td></tr>}
              {days.map((d, i) => (
                <tr key={i} className="border-b border-gray-50 hover:bg-gray-50/50 transition">
                  <td className="p-3 text-sm font-semibold text-gray-700">{fmtDate(d.date)}</td>
                  <td className="p-3"><span className="px-2.5 py-1 bg-gray-50 text-gray-800 rounded-lg text-xs font-bold">{d.sales}</span></td>
                  <td className="p-3 text-sm font-bold text-gray-800">{money(d.revenue)}</td>
                  <td className="p-3 text-sm font-semibold text-green-600">{money(d.cash)}</td>
                  <td className="p-3 text-sm font-semibold text-amber-600">{money(d.momo)}</td>
                  <td className="p-3 text-sm font-bold text-green-600">{money(d.profit)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {days.length > 0 && (
          <div className="flex flex-wrap gap-4 mt-4 pt-4 border-t border-gray-100">
            <div className="text-sm"><span className="text-gray-400">Total Days:</span> <span className="font-bold">{days.length}</span></div>
            <div className="text-sm"><span className="text-gray-400">Avg Revenue/Day:</span> <span className="font-bold text-gray-800">{money(totalRev / days.length)}</span></div>
            <div className="text-sm"><span className="text-gray-400">Avg Sales/Day:</span> <span className="font-bold">{(fSales.length / days.length).toFixed(1)}</span></div>
            <div className="text-sm"><span className="text-gray-400">Avg Profit/Day:</span> <span className="font-bold text-green-600">{money(totalProfit / days.length)}</span></div>
          </div>
        )}
      </Section>
    </div>
  )
}
