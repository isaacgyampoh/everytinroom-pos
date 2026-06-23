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
  const outOfStock = products.filter(p => p.quantity === 0)
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
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-[22px] md:text-[26px] font-bold tracking-tight text-gray-900">{greet}, {user?.name || 'Boss'}</h1>
          <p className="text-gray-400 text-[13px] mt-0.5">{new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
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
      {outOfStock.length > 0 && (
        <div onClick={() => setPage('stocktakes')} className="bg-red-50 border border-red-100 rounded-xl p-3 mb-4 flex items-center gap-3 cursor-pointer hover:bg-red-100 transition">
          <div className="w-8 h-8 bg-red-100 rounded-lg flex items-center justify-center text-red-500 text-xs font-bold">{outOfStock.length}</div>
          <div className="flex-1 text-sm text-red-600 font-medium">Products out of stock</div>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2"><path d="M9 18l6-6-6-6"/></svg>
        </div>
      )}

      {/* Revenue Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        {[
          { label: "Today", value: money(todayRev), sub: todaySales.length + ' sales', color: 'bg-gray-900' },
          { label: "This Week", value: money(weekRev), sub: weekSales.length + ' sales', color: 'bg-gray-800' },
          { label: "This Month", value: money(monthRev), sub: monthSales.length + ' sales', color: 'bg-gray-700' },
          { label: "All Time", value: money(allRev), sub: allSales.length + ' total', color: 'bg-[#111]' },
        ].map((c, i) => (
          <div key={i} className={`${c.color} rounded-2xl p-4 md:p-5 text-white`}>
              <div className="text-[11px] md:text-xs font-medium text-white/60">{c.label}</div>
              <div className="text-[20px] md:text-[22px] font-bold mt-1 tracking-tight">{c.value}</div>
              <div className="text-[10px] md:text-[11px] font-medium text-white/40 mt-0.5">{c.sub}</div>
          </div>
        ))}
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        {[
          { label: "Today's Profit", value: money(todayProfit), color: 'text-gray-900', bg: 'bg-gray-200' },
          { label: 'Net Today', value: money(todayProfit - todayExp), color: todayProfit - todayExp >= 0 ? 'text-gray-900' : 'text-red-500', bg: 'bg-gray-200' },
          { label: 'Profit Margin', value: profitMargin + '%', color: Number(profitMargin) >= 30 ? 'text-green-600' : Number(profitMargin) >= 15 ? 'text-amber-500' : 'text-red-500', bg: 'bg-gray-400' },
          { label: 'Stock Value', value: money(stockValue), color: 'text-gray-900', bg: 'bg-gray-200' },
        ].map((s, i) => (
          <div key={i} className="bg-white rounded-2xl p-3.5 md:p-4 border border-gray-100/80">
              <div className="text-[10px] md:text-[11px] text-gray-400 font-medium">{s.label}</div>
              <div className={`text-[18px] md:text-[20px] font-bold mt-0.5 tracking-tight ${s.color}`}>{s.value}</div>
          </div>
        ))}
      </div>

      <div className="grid md:grid-cols-2 gap-4 mb-5">
        {/* 7-Day Sales Trend Chart */}
        <div className="bg-white rounded-2xl p-5 border border-gray-100 relative overflow-hidden">
          <h3 className="text-sm font-bold text-gray-800 mb-4">Last 7 Days Revenue</h3>
          <div className="flex items-end gap-2 h-32">
            {last7.map((d, i) => (
              <div key={i} className="flex-1 flex flex-col items-center gap-1">
                <div className="text-[10px] font-bold text-gray-500">{d.revenue > 0 ? money(d.revenue).replace('GHS ', '') : ''}</div>
                <div className="w-full rounded-t-lg bg-gray-200 relative overflow-hidden" style={{ height: Math.max(4, (d.revenue / maxRev) * 100) + '%' }}>
                  <div className="absolute inset-0 bg-gray-800 rounded-t-lg" style={{ opacity: d.date === t ? 1 : 0.5 }} />
                </div>
                <div className={`text-[10px] font-bold ${d.date === t ? 'text-gray-900' : 'text-gray-400'}`}>{d.label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Payment Split */}
        <div className="bg-white rounded-2xl p-5 border border-gray-100">
          <h3 className="text-sm font-bold text-gray-800 mb-4">Payment Split (This Month)</h3>
          <div className="space-y-3">
            {[
              { label: 'Cash', amount: monthCash, color: 'bg-gray-800', pct: monthRev ? (monthCash / monthRev * 100) : 0 },
              { label: 'Momo', amount: monthMomo, color: 'bg-gray-500', pct: monthRev ? (monthMomo / monthRev * 100) : 0 },
              { label: 'Split', amount: monthSplit, color: 'bg-gray-300', pct: monthRev ? (monthSplit / monthRev * 100) : 0 },
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

      <div className="grid md:grid-cols-2 gap-4 mb-5">
        {/* Today's Hourly Activity */}
        {todaySales.length > 0 && (
          <div className="bg-white rounded-2xl p-5 border border-gray-100">
            <h3 className="text-sm font-bold text-gray-800 mb-4">🕐 Today's Peak Hours</h3>
            <div className="flex items-end gap-1 h-20">
              {Array.from({ length: 14 }, (_, i) => i + 7).map(h => {
                const count = hourMap[h] || 0
                return (
                  <div key={h} className="flex-1 flex flex-col items-center gap-0.5">
                    <div className="w-full rounded-t bg-gray-900" style={{ height: Math.max(2, (count / maxHour) * 100) + '%', opacity: count > 0 ? 0.4 + (count / maxHour) * 0.6 : 0.1 }} />
                    <div className="text-[8px] text-gray-400">{h > 12 ? (h - 12) + 'p' : h + 'a'}</div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

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

      <div className="grid md:grid-cols-2 gap-4">
        {/* Recent Sales */}
        <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
          <div className="flex justify-between items-center p-4 border-b border-gray-50">
            <h3 className="text-sm font-bold text-gray-800">Recent Sales</h3>
            <button onClick={() => setPage('receipts')} className="text-xs font-semibold text-gray-900">View all →</button>
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

        {/* Low Stock */}
        <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
          <div className="flex justify-between items-center p-4 border-b border-gray-50">
            <h3 className="text-sm font-bold text-gray-800">Low Stock</h3>
            <span className="px-2 py-0.5 bg-gray-100 text-gray-700 rounded-lg text-[10px] font-bold">{lowStock.length}</span>
          </div>
          <div className="divide-y divide-gray-50">
            {lowStock.length === 0 && <div className="p-8 text-center text-gray-300 text-sm">All stocked up! </div>}
            {lowStock.slice(0, 6).map(p => (
              <div key={p.id} className="flex items-center gap-3 px-4 py-3">
                <div className="w-8 h-8 rounded-lg bg-gray-50 flex items-center justify-center overflow-hidden flex-shrink-0">
                  {p.image ? <img src={p.image} alt="" className="w-full h-full object-cover" /> : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="opacity-30"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-semibold text-gray-800">{p.name}</div>
                  <div className="text-[10px] text-gray-400">{p.category || '-'}</div>
                </div>
                <span className={`px-2 py-0.5 rounded-lg text-[10px] font-bold ${p.quantity === 0 ? 'bg-red-50 text-red-500' : 'bg-gray-100 text-gray-700'}`}>
                  {p.quantity === 0 ? 'OUT' : p.quantity}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
