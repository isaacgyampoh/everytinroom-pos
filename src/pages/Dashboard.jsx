import { useStore } from '../hooks/useStore'
import { money, today, weekStartDate, monthStart, isoDate, fmtDate } from '../lib/utils'

export default function Dashboard() {
  const { sales, expenses, products, customers, refunds, user, setPage } = useStore()
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
  const todayExp = expenses.filter(e => isoDate(e.date) === t).reduce((a, e) => a + e.amount, 0)
  const lowStock = products.filter(p => p.quantity <= 5)
  const recentSales = sales.filter(s => !s.voided).slice(0, 8)

  const greetHour = new Date().getHours()
  const greet = greetHour < 12 ? 'Good Morning' : greetHour < 17 ? 'Good Afternoon' : 'Good Evening'

  return (
    <div className="animate-fade">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight">{greet}, {user?.name || 'Boss'} 👋</h1>
          <p className="text-gray-400 text-sm mt-0.5">Here's your business overview</p>
        </div>
        <div className="hidden md:block text-right text-sm text-gray-400 font-medium">
          {new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
        </div>
      </div>

      {/* Revenue Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 mb-5">
        {[
          { label: "Today's Revenue", value: money(todayRev), sub: todaySales.length + ' sales', color: 'bg-brand-500' },
          { label: "This Week", value: money(weekRev), sub: weekSales.length + ' sales', color: 'bg-amber-500' },
          { label: "This Month", value: money(monthRev), sub: monthSales.length + ' sales', color: 'bg-green-600' },
          { label: "All Time", value: money(allRev), sub: allSales.length + ' total', color: 'bg-gray-800' },
        ].map((c, i) => (
          <div key={i} className={`${c.color} rounded-2xl p-4 md:p-5 text-white`}>
            <div className="text-xs md:text-sm font-medium opacity-80">{c.label}</div>
            <div className="text-xl md:text-2xl font-extrabold mt-1.5">{c.value}</div>
            <div className="text-[11px] md:text-xs font-medium opacity-60 mt-1">{c.sub}</div>
          </div>
        ))}
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-4 gap-3 mb-5">
        {[
          { label: "Today's Profit", value: money(todayProfit), color: 'text-green-600' },
          { label: 'Expenses Today', value: money(todayExp), color: 'text-red-500' },
          { label: 'Low Stock', value: lowStock.length, color: 'text-amber-500' },
          { label: 'Customers', value: customers.length, color: 'text-brand-500' },
        ].map((s, i) => (
          <div key={i} className="bg-white rounded-2xl p-3 md:p-4 text-center border border-gray-100">
            <div className="text-[10px] md:text-xs text-gray-400 font-medium">{s.label}</div>
            <div className={`text-lg md:text-xl font-extrabold mt-1 ${s.color}`}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Quick Actions */}
      <div className="mb-5">
        <h3 className="text-base font-bold text-gray-800 mb-3">Quick Actions</h3>
        <div className="grid grid-cols-4 md:grid-cols-6 gap-2 md:gap-3">
          {[
            { icon: '🛍️', label: 'New Sale', page: 'pos' },
            { icon: '📦', label: 'Products', page: 'products' },
            { icon: '📈', label: 'Reports', page: 'reports' },
            { icon: '💸', label: 'Expenses', page: 'expenses' },
            { icon: '📋', label: 'Stock Take', page: 'stocktakes' },
            { icon: '🧾', label: 'Receipts', page: 'receipts' },
          ].map((a, i) => (
            <button key={i} onClick={() => setPage(a.page)} className="bg-white rounded-xl p-3 md:p-4 text-center border border-gray-100 hover:shadow-md hover:border-brand-200 active:scale-95 transition-all">
              <span className="text-2xl block mb-1">{a.icon}</span>
              <span className="text-[10px] md:text-xs font-semibold text-gray-600">{a.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        {/* Recent Sales */}
        <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
          <div className="flex justify-between items-center p-4 md:p-5 border-b border-gray-50">
            <h3 className="text-base font-bold text-gray-800">Recent Sales</h3>
            <button onClick={() => setPage('receipts')} className="text-sm font-semibold text-brand-500">View all →</button>
          </div>
          <div className="divide-y divide-gray-50">
            {recentSales.length === 0 && <div className="p-8 text-center text-gray-300 text-sm">No sales yet</div>}
            {recentSales.map(s => (
              <div key={s.id} className="flex items-center gap-3 p-3.5 md:p-4 hover:bg-gray-50/50 transition">
                <div className={`w-9 h-9 rounded-lg flex items-center justify-center text-sm font-bold text-white flex-shrink-0 ${s.payment === 'Cash' ? 'bg-green-500' : s.payment === 'Momo' ? 'bg-amber-500' : 'bg-violet-500'}`}>
                  {s.payment === 'Cash' ? '💵' : s.payment === 'Momo' ? '📱' : '✂️'}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-gray-800">{s.receiptNo}</div>
                  <div className="text-xs text-gray-400">{s.customer} • {s.cashier}</div>
                </div>
                <div className="text-sm font-bold text-gray-800">{money(s.total)}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Low Stock */}
        <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
          <div className="flex justify-between items-center p-4 md:p-5 border-b border-gray-50">
            <h3 className="text-base font-bold text-gray-800">⚠️ Low Stock</h3>
            <span className="px-2.5 py-1 bg-amber-50 text-amber-600 rounded-lg text-xs font-bold">{lowStock.length}</span>
          </div>
          <div className="divide-y divide-gray-50">
            {lowStock.length === 0 && <div className="p-8 text-center text-gray-300 text-sm">All stocked up! 🎉</div>}
            {lowStock.slice(0, 8).map(p => (
              <div key={p.id} className="flex items-center gap-3 p-3.5 md:p-4">
                <div className="w-9 h-9 rounded-lg bg-gray-50 flex items-center justify-center overflow-hidden flex-shrink-0">
                  {p.image ? <img src={p.image} alt="" className="w-full h-full object-cover" /> : <span className="text-lg">📦</span>}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-gray-800">{p.name}</div>
                  <div className="text-xs text-gray-400">{p.category || '-'}</div>
                </div>
                <span className={`px-2.5 py-1 rounded-lg text-xs font-bold ${p.quantity === 0 ? 'bg-red-50 text-red-500' : 'bg-amber-50 text-amber-600'}`}>
                  {p.quantity === 0 ? 'OUT' : p.quantity + ' left'}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
