import { useStore } from '../hooks/useStore'
import { money, today, weekStartDate, monthStart, isoDate, fmtDate } from '../lib/utils'

export default function Dashboard() {
  const { sales, expenses, products, customers, refunds, user, setPage } = useStore()
  const t = today(), ws = weekStartDate(), ms = monthStart()

  const todaySales = sales.filter(s => !s.voided && isoDate(s.date) === t)
  const weekSales = sales.filter(s => !s.voided && isoDate(s.date) >= ws && isoDate(s.date) <= t)
  const monthSales = sales.filter(s => !s.voided && isoDate(s.date) >= ms && isoDate(s.date) <= t)
  const todayRev = todaySales.reduce((a, s) => a + s.total, 0)
  const weekRev = weekSales.reduce((a, s) => a + s.total, 0)
  const monthRev = monthSales.reduce((a, s) => a + s.total, 0)
  const todayProfit = todaySales.reduce((a, s) => a + s.profit, 0)
  const todayExp = expenses.filter(e => isoDate(e.date) === t).reduce((a, e) => a + e.amount, 0)
  const lowStock = products.filter(p => p.quantity <= 5)
  const recentSales = sales.slice(0, 6)

  const QuickAction = ({ icon, label, color, onClick }) => (
    <button onClick={onClick} className="flex flex-col items-center gap-2 p-4 bg-white rounded-2xl border border-gray-100 hover:shadow-lg hover:scale-105 active:scale-95 transition-all">
      <span className={`w-12 h-12 rounded-xl flex items-center justify-center text-2xl text-white ${color}`}>{icon}</span>
      <span className="text-xs md:text-sm font-semibold text-gray-600">{label}</span>
    </button>
  )

  return (
    <div className="animate-fade">
      {/* Greeting */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl md:text-3xl font-extrabold text-gray-900">
            Good {new Date().getHours() < 12 ? 'Morning' : new Date().getHours() < 17 ? 'Afternoon' : 'Evening'}, {user?.name || 'Boss'} 👋
          </h1>
          <p className="text-sm md:text-base text-gray-400 mt-1">Here's how your shop is doing today</p>
        </div>
        <div className="hidden md:block text-right">
          <div className="text-sm font-bold text-gray-600">{new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' })}</div>
        </div>
      </div>

      {/* Main Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="brand-gradient-green rounded-2xl p-5 md:p-6 text-white relative overflow-hidden">
          <div className="absolute -right-4 -top-4 w-20 h-20 bg-white/10 rounded-full" />
          <div className="text-sm font-medium opacity-80">Today's Revenue</div>
          <div className="text-2xl md:text-3xl font-extrabold mt-2">{money(todayRev)}</div>
          <div className="text-xs font-medium opacity-70 mt-1">{todaySales.length} transactions</div>
        </div>
        <div className="brand-gradient rounded-2xl p-5 md:p-6 text-white relative overflow-hidden">
          <div className="absolute -right-4 -top-4 w-20 h-20 bg-white/10 rounded-full" />
          <div className="text-sm font-medium opacity-80">Today's Profit</div>
          <div className="text-2xl md:text-3xl font-extrabold mt-2">{money(todayProfit)}</div>
          <div className="text-xs font-medium opacity-70 mt-1">Net: {money(todayProfit - todayExp)}</div>
        </div>
        <div className="brand-gradient-orange rounded-2xl p-5 md:p-6 text-white relative overflow-hidden">
          <div className="absolute -right-4 -top-4 w-20 h-20 bg-white/10 rounded-full" />
          <div className="text-sm font-medium opacity-80">This Week</div>
          <div className="text-2xl md:text-3xl font-extrabold mt-2">{money(weekRev)}</div>
          <div className="text-xs font-medium opacity-70 mt-1">{weekSales.length} sales</div>
        </div>
        <div className="brand-gradient-blue rounded-2xl p-5 md:p-6 text-white relative overflow-hidden">
          <div className="absolute -right-4 -top-4 w-20 h-20 bg-white/10 rounded-full" />
          <div className="text-sm font-medium opacity-80">This Month</div>
          <div className="text-2xl md:text-3xl font-extrabold mt-2">{money(monthRev)}</div>
          <div className="text-xs font-medium opacity-70 mt-1">{monthSales.length} sales</div>
        </div>
      </div>

      {/* Quick Stats Row */}
      <div className="grid grid-cols-4 gap-3 mb-6">
        {[
          { label: 'Products', value: products.length, icon: '📦', color: 'text-sky-500' },
          { label: 'Customers', value: customers.length, icon: '💛', color: 'text-gold-500' },
          { label: 'Low Stock', value: lowStock.length, icon: '⚠️', color: 'text-accent-500' },
          { label: 'Expenses', value: money(todayExp), icon: '💸', color: 'text-red-500' },
        ].map((s, i) => (
          <div key={i} className="bg-white rounded-2xl p-4 md:p-5 text-center border border-gray-100">
            <span className="text-2xl">{s.icon}</span>
            <div className={`text-xl md:text-2xl font-extrabold mt-1 ${s.color}`}>{s.value}</div>
            <div className="text-xs text-gray-400 font-medium mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Quick Actions */}
      <div className="mb-6">
        <h3 className="text-lg font-bold text-gray-800 mb-3">Quick Actions</h3>
        <div className="grid grid-cols-4 md:grid-cols-6 gap-3">
          <QuickAction icon="🛍️" label="New Sale" color="brand-gradient-green" onClick={() => setPage('pos')} />
          <QuickAction icon="📦" label="Products" color="brand-gradient-blue" onClick={() => setPage('products')} />
          <QuickAction icon="📈" label="Reports" color="brand-gradient-orange" onClick={() => setPage('reports')} />
          <QuickAction icon="💸" label="Expenses" color="brand-gradient" onClick={() => setPage('expenses')} />
          <QuickAction icon="📋" label="Stock Take" color="bg-violet-500" onClick={() => setPage('stocktakes')} />
          <QuickAction icon="🧾" label="Receipts" color="bg-gray-700" onClick={() => setPage('receipts')} />
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-5">
        {/* Recent Sales */}
        <div className="bg-white rounded-2xl p-5 md:p-6 border border-gray-100">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-bold text-gray-800">Recent Sales</h3>
            <button onClick={() => setPage('receipts')} className="text-sm font-semibold text-brand-500 hover:underline">View all →</button>
          </div>
          <div className="space-y-3">
            {recentSales.length === 0 && <p className="text-gray-400 text-sm py-4 text-center">No sales today</p>}
            {recentSales.map(s => (
              <div key={s.id} className="flex items-center gap-3 p-3 rounded-xl bg-gray-50/80 hover:bg-gray-100/80 transition">
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center text-sm font-bold text-white ${s.payment === 'Cash' ? 'bg-green-500' : s.payment === 'Momo' ? 'bg-amber-500' : 'bg-violet-500'}`}>
                  {s.payment === 'Cash' ? '💵' : '📱'}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-gray-800">{s.receiptNo}</div>
                  <div className="text-xs text-gray-400">{s.customer} • {s.cashier}</div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-bold text-gray-800">{money(s.total)}</div>
                  <div className="text-xs text-gray-400">{fmtDate(s.date)}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Low Stock Alert */}
        <div className="bg-white rounded-2xl p-5 md:p-6 border border-gray-100">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-bold text-gray-800">⚠️ Low Stock Items</h3>
            <span className="px-3 py-1 bg-accent-50 text-accent-600 rounded-full text-xs font-bold">{lowStock.length} items</span>
          </div>
          <div className="space-y-2.5">
            {lowStock.length === 0 && <p className="text-gray-400 text-sm py-4 text-center">All stocked up! 🎉</p>}
            {lowStock.slice(0, 6).map(p => (
              <div key={p.id} className="flex items-center gap-3 p-3 rounded-xl bg-gray-50/80">
                <div className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center overflow-hidden flex-shrink-0">
                  {p.image ? <img src={p.image} alt="" className="w-full h-full object-cover" /> : <span className="text-lg">📦</span>}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-gray-800 truncate">{p.name}</div>
                  <div className="text-xs text-gray-400">{p.category || '-'}</div>
                </div>
                <span className={`px-3 py-1.5 rounded-lg text-xs font-bold ${p.quantity === 0 ? 'bg-red-50 text-red-500' : 'bg-amber-50 text-amber-600'}`}>
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
