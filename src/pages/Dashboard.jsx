import { useStore } from '../hooks/useStore'
import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { money, today, weekStartDate, monthStart, isoDate, fmtDate } from '../lib/utils'

export default function Dashboard() {
  const { sales, expenses, products, customers, refunds, stockAdjustments, user, setPage, shopOpen, shopSettingLoaded, fetchShopOpen, setShopOpen } = useStore()
  const [toggling, setToggling] = useState(false)
  useEffect(() => { fetchShopOpen() }, [])
  const onToggleShop = async () => {
    setToggling(true)
    const next = !shopOpen
    const res = await setShopOpen(next)
    setToggling(false)
    if (res?.ok) toast.success(next ? 'Online shop is now OPEN' : 'Online shop is now CLOSED')
    else toast.error('Could not save: ' + (res?.error || 'unknown error'))
  }
  const t = today(), ws = weekStartDate(), ms = monthStart()

  const todaySales = sales.filter(s => !s.voided && isoDate(s.date) === t)
  const weekSales = sales.filter(s => !s.voided && isoDate(s.date) >= ws)
  const monthSales = sales.filter(s => !s.voided && isoDate(s.date) >= ms)
  const allSales = sales.filter(s => !s.voided)
  const todayRev = todaySales.reduce((a, s) => a + s.total, 0)
  const weekRev = weekSales.reduce((a, s) => a + s.total, 0)
  const monthRev = monthSales.reduce((a, s) => a + s.total, 0)
  const allRev = allSales.reduce((a, s) => a + s.total, 0)
  const todayProfit = todaySales.reduce((a, s) => a + s.profit, 0)
  const monthProfit = monthSales.reduce((a, s) => a + s.profit, 0)
  const todayExp = expenses.filter(e => isoDate(e.date) === t).reduce((a, e) => a + e.amount, 0)
  const monthExp = expenses.filter(e => isoDate(e.date) >= ms).reduce((a, e) => a + e.amount, 0)
  const lowStock = products.filter(p => p.quantity <= 5)
  const recentSales = sales.filter(s => !s.voided).slice(0, 6)

  // Last 7 days trend
  const last7 = []
  for (let i = 6; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i)
    const ds = d.toISOString().slice(0, 10)
    const daySales = allSales.filter(s => isoDate(s.date) === ds)
    const dayLabel = d.toLocaleDateString('en-GB', { weekday: 'short' })
    last7.push({ label: dayLabel, date: ds, revenue: daySales.reduce((a, s) => a + s.total, 0), count: daySales.length })
  }
  const maxRev = Math.max(...last7.map(d => d.revenue), 1)

  // Hourly distribution today
  const hourMap = {}
  todaySales.forEach(s => {
    const h = new Date(s.date).getHours()
    hourMap[h] = (hourMap[h] || 0) + 1
  })
  const maxHour = Math.max(...Object.values(hourMap), 1)

  // Payment split this month
  const monthCash = monthSales.filter(s => s.payment === 'Cash').reduce((a, s) => a + s.total, 0)
  const monthMomo = monthSales.filter(s => s.payment === 'Momo' || s.payment === 'Paystack').reduce((a, s) => a + s.total, 0)
  const monthSplit = monthSales.filter(s => s.payment === 'Split').reduce((a, s) => a + s.total, 0)

  // Profit margin
  const profitMargin = monthRev > 0 ? ((monthProfit / monthRev) * 100).toFixed(1) : 0

  // Stock value
  const stockValue = products.reduce((a, p) => a + p.price * p.quantity, 0)
  const stockCost = products.reduce((a, p) => a + p.costPrice * p.quantity, 0)

  const greetHour = new Date().getHours()
  const greet = greetHour < 12 ? 'Good Morning' : greetHour < 17 ? 'Good Afternoon' : 'Good Evening'

  return (
    <div>
      <div className="flex items-center justify-between mb-7">
        <div>
          <h1 className="text-[26px] md:text-[30px] font-bold tracking-tight text-gray-900">{greet}, {user?.name || 'Boss'}</h1>
          <p className="text-gray-400 text-sm mt-1">Here's what's happening in your shop today</p>
        </div>
      </div>

      {/* Online shop on/off */}
      <div className="bg-white border border-gray-200 rounded-2xl p-4 mb-4 flex items-center gap-4">
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${shopOpen ? 'bg-[#16181d]' : 'bg-gray-200'}`}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={shopOpen ? '#fff' : '#8a8d92'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l1-5h16l1 5M4 9v10a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V9M3 9h18"/></svg>
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[15px] font-bold text-gray-900">Online Shop</div>
          <div className="text-[13px] text-gray-400">
            {!shopSettingLoaded ? 'Checking…' : shopOpen ? 'Open — customers can order on erbliving.shop' : 'Closed — customers see a "back soon" page'}
          </div>
        </div>
        <button onClick={onToggleShop} disabled={toggling || !shopSettingLoaded}
          className={`relative w-14 h-8 rounded-full transition-colors flex-shrink-0 disabled:opacity-50 ${shopOpen ? 'bg-[#16181d]' : 'bg-gray-300'}`}>
          <span className={`absolute top-1 w-6 h-6 bg-white rounded-full shadow transition-all ${shopOpen ? 'left-7' : 'left-1'}`} />
        </button>
      </div>

      {/* Alerts */}


      {/* Revenue Cards — Cleara style: light, airy, one teal feature card */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5 mb-3.5">
        {[
          { label: "Today", value: money(todayRev), sub: todaySales.length + ' sales', feature: true },
          { label: "This Week", value: money(weekRev), sub: weekSales.length + ' sales', feature: false },
          { label: "This Month", value: money(monthRev), sub: monthSales.length + ' sales', feature: false },
          { label: "All Time", value: money(allRev), sub: allSales.length + ' total', feature: false },
        ].map((c, i) => (
          <div key={i} className={`rounded-2xl p-5 ${c.feature ? 'bg-[#0e7c86] text-white' : 'bg-white border border-gray-200/70 text-gray-900'}`}>
              <div className={`text-xs font-medium ${c.feature ? 'text-white/70' : 'text-gray-400'}`}>{c.label}</div>
              <div className="text-[24px] md:text-[26px] font-bold mt-2 tracking-tight">{c.value}</div>
              <div className={`text-[11px] font-medium mt-1 ${c.feature ? 'text-white/50' : 'text-gray-400'}`}>{c.sub}</div>
          </div>
        ))}
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5 mb-5">
        {[
          { label: "Today's Profit", value: money(todayProfit), color: 'text-gray-900' },
          { label: 'Net Today', value: money(todayProfit - todayExp), color: todayProfit - todayExp >= 0 ? 'text-gray-900' : 'text-red-500' },
          { label: 'Profit Margin', value: profitMargin + '%', color: Number(profitMargin) >= 30 ? 'text-[#0e7c86]' : Number(profitMargin) >= 15 ? 'text-amber-500' : 'text-red-500' },
          { label: 'Stock Value', value: money(stockValue), color: 'text-gray-900' },
        ].map((s, i) => (
          <div key={i} className="bg-white rounded-2xl p-4 border border-gray-200/70">
              <div className="text-[11px] text-gray-400 font-medium">{s.label}</div>
              <div className={`text-[20px] font-bold mt-1 tracking-tight ${s.color}`}>{s.value}</div>
          </div>
        ))}
      </div>

      <div className="mb-5">
        {/* Payment Split */}
        <div className="bg-white rounded-2xl p-5 border border-gray-100">
          <h3 className="text-sm font-bold text-gray-800 mb-4">Payment Split (This Month)</h3>
          <div className="space-y-3">
            {[
              { label: 'Cash', amount: monthCash, color: 'bg-[#0e7c86]', pct: monthRev ? (monthCash / monthRev * 100) : 0 },
              { label: 'Momo', amount: monthMomo, color: 'bg-[#5bb3b9]', pct: monthRev ? (monthMomo / monthRev * 100) : 0 },
              { label: 'Split', amount: monthSplit, color: 'bg-[#b3dcdf]', pct: monthRev ? (monthSplit / monthRev * 100) : 0 },
            ].map((p, i) => (
              <div key={i}>
                <div className="flex justify-between text-xs mb-1">
                  <span className="font-semibold text-gray-600">{p.label}</span>
                  <span className="font-bold text-gray-800">{money(p.amount)} ({p.pct.toFixed(0)}%)</span>
                </div>
                <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div className={`h-full rounded-full ${p.color}`} style={{ width: Math.max(1, p.pct) + '%' }} />
                </div>
              </div>
            ))}
          </div>
          <div className="mt-4 pt-3 border-t border-gray-100 flex justify-between text-xs">
            <span className="text-gray-400">Month Expenses</span>
            <span className="font-bold text-red-500">{money(monthExp)}</span>
          </div>
          <div className="flex justify-between text-xs mt-1">
            <span className="text-gray-400">Net Profit</span>
            <span className={`font-bold ${monthProfit - monthExp >= 0 ? 'text-green-600' : 'text-red-500'}`}>{money(monthProfit - monthExp)}</span>
          </div>
        </div>
      </div>

      <div className="mb-5">
        {/* Quick Actions */}
        <div className="bg-white rounded-2xl p-5 border border-gray-100">
          <h3 className="text-sm font-bold text-gray-800 mb-3">Quick Actions</h3>
          <div className="grid grid-cols-3 gap-2">
            {[
              { icon: '', label: 'New Sale', page: 'pos' },
              { icon: '', label: 'Products', page: 'products' },
              { icon: '', label: 'Reports', page: 'reports' },
              { icon: '', label: 'Expenses', page: 'expenses' },
              { icon: '', label: 'Stock Take', page: 'stocktakes' },
              { icon: '', label: 'Receipts', page: 'receipts' },
            ].map((a, i) => (
              <button key={i} onClick={() => setPage(a.page)} className="bg-gray-50 rounded-xl p-3 text-center border border-gray-100 hover:shadow-md hover:border-gray-200 active:scale-95 transition-all">
                <span className="text-xl block mb-0.5">{a.icon}</span>
                <span className="text-[10px] md:text-xs font-semibold text-gray-600">{a.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="mb-1">
        {/* Recent Sales */}
        <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
          <div className="flex justify-between items-center p-4 border-b border-gray-50">
            <h3 className="text-sm font-bold text-gray-800">Recent Sales</h3>
            <button onClick={() => setPage('receipts')} className="text-xs font-semibold text-[#0e7c86]">View all →</button>
          </div>
          <div className="divide-y divide-gray-50">
            {recentSales.length === 0 && <div className="p-8 text-center text-gray-300 text-sm">No sales yet</div>}
            {recentSales.map(s => (
              <div key={s.id} className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50/50 transition">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold text-white flex-shrink-0 ${s.payment === 'Cash' ? 'bg-gray-700' : (s.payment === 'Momo' || s.payment === 'Paystack') ? 'bg-gray-500' : 'bg-gray-400'}`}>
                  
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-semibold text-gray-800">{s.receiptNo}</div>
                  <div className="text-[10px] text-gray-400">{s.cashier}</div>
                </div>
                <span className="text-sm font-bold text-gray-800">{money(s.total)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
