import { useStore } from '../hooks/useStore'

const NAV_ITEMS = [
  { id: 'dashboard', icon: '📊', label: 'Dashboard' },
  { id: 'pos', icon: '🛍️', label: 'POS' },
  { id: 'wholesale', icon: '🏭', label: 'Wholesale' },
  { id: 'receipts', icon: '🧾', label: 'Receipts' },
  { id: 'refunds', icon: '↩️', label: 'Refunds' },
  { id: 'staff-sales', icon: '👥', label: 'Staff Sales' },
  { id: 'products', icon: '📦', label: 'Products', admin: true },
  { id: 'bundles', icon: '🎁', label: 'Bundles' },
  { id: 'promos', icon: '🏷️', label: 'Promos', admin: true },
  { id: 'stocktakes', icon: '📋', label: 'Stock Takes', admin: true },
  { id: 'invoices', icon: '🧾', label: 'Invoices', admin: true },
  { id: 'customers', icon: '💛', label: 'Customers' },
  { id: 'expenses', icon: '💸', label: 'Expenses' },
  { id: 'reports', icon: '📈', label: 'Reports' },
  { id: 'staff', icon: '🔐', label: 'Staff', admin: true },
]

export default function Navigation() {
  const { page, setPage, isAdmin, user, logout, cart } = useStore()
  const items = NAV_ITEMS.filter(n => !n.admin || isAdmin)
  const mobileItems = items.slice(0, 5)

  return (
    <>
      {/* Desktop - Dark Navy Sidebar */}
      <aside className="hidden md:flex flex-col w-[260px] h-screen brand-gradient fixed left-0 top-0 z-40 border-r border-white/5">
        {/* Logo */}
        <div className="flex items-center gap-3 px-5 py-5 border-b border-white/10">
          <img src="/logo.png" alt="" className="w-12 h-12 rounded-xl object-contain" />
          <div>
            <div className="text-base font-extrabold"><span className="text-brand-400">Everytin</span> <span className="text-accent-400">Room</span></div>
            <div className="text-[10px] text-gold-500 font-semibold">Your One Stop Shop</div>
          </div>
        </div>

        {/* Nav Items */}
        <nav className="flex-1 overflow-y-auto py-3 px-3 scrollbar-hide">
          {items.map(n => (
            <button key={n.id} onClick={() => setPage(n.id)}
              className={`w-full flex items-center gap-3 h-11 px-4 rounded-xl text-sm font-medium mb-1 transition-all ${page === n.id ? 'bg-brand-500/20 text-brand-400 font-semibold' : 'text-navy-200 hover:bg-white/5 hover:text-white'}`}>
              <span className="text-lg w-6 text-center">{n.icon}</span>
              <span>{n.label}</span>
              {n.id === 'pos' && cart.length > 0 && <span className="ml-auto w-5 h-5 bg-accent-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">{cart.length}</span>}
            </button>
          ))}
        </nav>

        {/* User / Logout */}
        <div className="px-4 py-4 border-t border-white/10">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-full bg-brand-500/30 flex items-center justify-center text-brand-400 text-sm font-bold">{(user?.name || 'S').charAt(0)}</div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-bold text-white truncate">{user?.name || 'Staff'}</div>
              <div className="text-[11px] text-navy-300">{isAdmin ? '🔐 Admin' : '👤 Staff'}</div>
            </div>
          </div>
          <button onClick={logout} className="w-full h-10 rounded-xl bg-white/5 border border-white/10 text-navy-300 text-sm font-medium hover:bg-red-500/20 hover:text-red-400 hover:border-red-500/30 transition-all">🚪 Lock Screen</button>
        </div>
      </aside>

      {/* Desktop Content Offset */}
      <div className="hidden md:block w-[260px] flex-shrink-0" />

      {/* Mobile Header */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-40 brand-gradient safe-top">
        <div className="flex items-center justify-between px-4 h-14">
          <div className="flex items-center gap-2.5">
            <img src="/logo.png" alt="" className="w-10 h-10 rounded-xl object-contain" />
            <div className="text-lg font-extrabold"><span className="text-brand-400">Everytin</span> <span className="text-accent-400">Room</span></div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setPage('pos')} className="relative w-10 h-10 bg-white/10 rounded-xl flex items-center justify-center text-lg">
              🛒{cart.length > 0 && <span className="absolute -top-1 -right-1 w-5 h-5 bg-accent-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">{cart.length}</span>}
            </button>
            <button onClick={logout} className="w-10 h-10 bg-white/10 rounded-xl flex items-center justify-center text-lg">🚪</button>
          </div>
        </div>
      </div>

      {/* Mobile Bottom Navigation */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 glass safe-bottom border-t border-gray-200/50">
        <div className="flex items-center justify-around h-16 px-2">
          {mobileItems.map(n => (
            <button key={n.id} onClick={() => setPage(n.id)}
              className={`flex flex-col items-center justify-center gap-0.5 min-w-[56px] h-14 rounded-2xl transition-all ${page === n.id ? 'text-brand-600 bg-brand-50' : 'text-gray-400'}`}>
              <span className={`text-xl ${page === n.id ? 'scale-110' : ''} transition-transform`}>{n.icon}</span>
              <span className="text-[10px] font-bold">{n.label}</span>
            </button>
          ))}
          <button onClick={() => {
            const p = prompt('Go to:\n' + items.map((n, i) => (i + 1) + '. ' + n.label).join('\n'))
            const idx = parseInt(p) - 1
            if (items[idx]) setPage(items[idx].id)
          }} className="flex flex-col items-center justify-center gap-0.5 min-w-[56px] h-14 rounded-2xl text-gray-400">
            <span className="text-xl">•••</span>
            <span className="text-[10px] font-bold">More</span>
          </button>
        </div>
      </nav>

      {/* Mobile Spacers */}
      <div className="md:hidden h-14" />
    </>
  )
}
