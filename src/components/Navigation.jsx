import { useState } from 'react'
import { useStore } from '../hooks/useStore'

const NAV = [
  { id: 'dash', icon: '📊', label: 'Dashboard', admin: true },
  { id: 'pos', icon: '🛒', label: 'POS' },
  { id: 'whatsapp', icon: '📱', label: 'WhatsApp', wa: true },
  { id: 'receipts', icon: '🧾', label: 'Receipts' },
  { id: 'refunds', icon: '↩️', label: 'Refunds' },
  { id: 'sep1', sep: true },
  { id: 'performance', icon: '👥', label: 'Staff Sales', admin: true },
  { id: 'products', icon: '📦', label: 'Products', admin: true },
  { id: 'promos', icon: '🏷️', label: 'Promos & Bundles', admin: true },
  { id: 'restock', icon: '🚚', label: 'Restock', admin: true },
  { id: 'stocktakes', icon: '📋', label: 'Stock & Adjust', admin: true },
  { id: 'sep2', sep: true },
  { id: 'invoices', icon: '🧾', label: 'Invoices', admin: true },
  { id: 'customers', icon: '👤', label: 'Customers', admin: true },
  { id: 'expenses', icon: '💸', label: 'Expenses', admin: true },
  { id: 'reports', icon: '📈', label: 'Reports', admin: true },
  { id: 'staff', icon: '🔑', label: 'Staff', admin: true },
]
const MOB = [
  { id: 'pos', icon: '🛒', label: 'Sale' },
  { id: 'whatsapp', icon: '📱', label: 'WA', wa: true },
  { id: 'receipts', icon: '🧾', label: 'Receipts' },
  { id: 'refunds', icon: '↩️', label: 'Refund' },
  { id: 'dash', icon: '📊', label: 'More', admin: true },
]

const AP = ['dash','products','bundles','staff','expenses','reports','customers','performance','promos','invoices','stocktakes','restock','stockadjustments']

export default function Navigation({ onOpenCart }) {
  const [expanded, setExpanded] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const { page, setPage, user, isAdmin, logout, waOrders, cart, darkMode, toggleDark } = useStore()
  const wa = waOrders.filter(o => o.status === 'Pending').length
  const cc = cart.reduce((a, c) => a + c.qty, 0)
  const go = (p) => { if (!isAdmin && AP.includes(p)) return; setPage(p); setMobileOpen(false) }

  const items = NAV.filter(n => n.sep || !n.admin || isAdmin)

  return (<>
    {/* ===== DESKTOP SIDEBAR ===== */}
    <aside
      className="hidden md:flex fixed top-0 left-0 bottom-0 z-[100] flex-col transition-all duration-300 ease-out"
      style={{ width: expanded ? 220 : 64 }}
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={() => setExpanded(false)}
    >
      {/* Background */}
      <div className="absolute inset-0 bg-white border-r border-stone-200/60 dark-sidebar" />

      {/* Logo */}
      <div className="relative z-10 flex items-center gap-3 px-4 h-16 flex-shrink-0">
        <img src="/logo.png" alt="" className="w-8 h-8 rounded-xl object-contain flex-shrink-0" />
        <div className={`overflow-hidden transition-all duration-300 ${expanded ? 'opacity-100 w-auto' : 'opacity-0 w-0'}`}>
          <div className="font-heading text-sm font-extrabold tracking-tight whitespace-nowrap">Everytin Room</div>
          <div className="text-[10px] text-stone-400 whitespace-nowrap">POS System</div>
        </div>
      </div>

      {/* Nav Items */}
      <nav className="relative z-10 flex-1 overflow-y-auto overflow-x-hidden px-2 py-2 scrollbar-hide">
        {items.map(n => {
          if (n.sep) return <div key={n.id} className="my-2 mx-2 h-px bg-stone-200/60" />
          const active = page === n.id
          return (
            <button key={n.id} onClick={() => go(n.id)}
              className={`w-full flex items-center gap-3 h-10 px-3 rounded-xl mb-0.5 transition-all duration-150 relative group ${
                active ? 'bg-brand-600 text-white' : 'text-stone-500 hover:bg-stone-100 hover:text-stone-800'
              }`}>
              <span className="text-base flex-shrink-0 w-5 text-center">{n.icon}</span>
              <span className={`text-[13px] font-medium whitespace-nowrap overflow-hidden transition-all duration-300 ${expanded ? 'opacity-100 w-auto' : 'opacity-0 w-0'}`}>
                {n.label}
              </span>
              {n.wa && wa > 0 && <span className="absolute top-1 right-1 w-4 h-4 bg-red-500 rounded-full text-[8px] font-bold text-white flex items-center justify-center">{wa}</span>}
              {/* Tooltip when collapsed */}
              {!expanded && (
                <div className="absolute left-full ml-2 px-2.5 py-1 bg-gray-900 text-white text-xs font-medium rounded-lg whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50">
                  {n.label}
                </div>
              )}
            </button>
          )
        })}
      </nav>

      {/* Bottom: Dark mode + User + Logout */}
      <div className="relative z-10 px-2 pb-3 flex-shrink-0 space-y-0.5">
        <div className="my-2 mx-2 h-px bg-stone-200/60" />

        {/* Dark mode toggle */}
        <button onClick={toggleDark}
          className="w-full flex items-center gap-3 h-10 px-3 rounded-xl text-stone-500 hover:bg-stone-100 hover:text-stone-800 transition">
          <span className="text-base flex-shrink-0 w-5 text-center">{darkMode ? '☀️' : '🌙'}</span>
          <span className={`text-[13px] font-medium whitespace-nowrap overflow-hidden transition-all duration-300 ${expanded ? 'opacity-100 w-auto' : 'opacity-0 w-0'}`}>
            {darkMode ? 'Light mode' : 'Dark mode'}
          </span>
        </button>

        {/* User */}
        <div className="flex items-center gap-3 h-10 px-3 rounded-xl">
          <div className="w-7 h-7 bg-brand-600 rounded-lg flex items-center justify-center text-white text-xs font-bold flex-shrink-0">{user?.name?.charAt(0)}</div>
          <span className={`text-[13px] font-medium whitespace-nowrap overflow-hidden transition-all duration-300 ${expanded ? 'opacity-100 w-auto' : 'opacity-0 w-0'}`}>
            {user?.name}
          </span>
        </div>

        {/* Logout */}
        <button onClick={logout}
          className="w-full flex items-center gap-3 h-10 px-3 rounded-xl text-stone-400 hover:bg-red-50 hover:text-red-500 transition">
          <span className="text-base flex-shrink-0 w-5 text-center">🚪</span>
          <span className={`text-[13px] font-medium whitespace-nowrap overflow-hidden transition-all duration-300 ${expanded ? 'opacity-100 w-auto' : 'opacity-0 w-0'}`}>
            Sign out
          </span>
        </button>
      </div>
    </aside>

    {/* ===== CART FAB — only on POS ===== */}
    {page === 'pos' && <button onClick={onOpenCart} className="fixed bottom-[calc(90px+env(safe-area-inset-bottom))] md:bottom-6 right-4 md:right-6 w-14 h-14 bg-brand-700 rounded-2xl flex items-center justify-center text-2xl text-white z-[99] shadow-lg active:scale-90 transition">🛒{cc>0&&<span className="absolute -top-1.5 -right-1.5 min-w-[20px] h-5 bg-brand-400 rounded-full text-[10px] font-bold text-white flex items-center justify-center">{cc}</span>}</button>}

    {/* ===== MOBILE HEADER ===== */}
    <header className="flex md:hidden fixed top-0 left-0 right-0 h-14 safe-top glass px-4 items-center gap-2 z-[100] border-b border-stone-200/30">
      <div className="flex items-center gap-2 font-heading text-base font-extrabold tracking-tight flex-1">
        <img src="/logo.png" alt="" className="w-8 h-8 rounded-lg object-contain" />Everytin Room
      </div>
      <button onClick={() => setMobileOpen(true)} className="w-9 h-9 rounded-xl bg-brand-700 flex items-center justify-center text-white text-sm">☰</button>
    </header>

    {/* ===== MOBILE BOTTOM NAV ===== */}
    <nav className="flex md:hidden fixed bottom-0 left-0 right-0 glass safe-bottom px-3 pt-2 z-[100] border-t border-stone-200/30">
      {MOB.filter(n => !n.admin || isAdmin).map(n => (
        <button key={n.id} onClick={() => go(n.id)} className={`flex-1 flex flex-col items-center gap-0.5 py-1.5 rounded-xl text-[10px] font-semibold relative transition ${page === n.id ? 'text-brand-700' : 'text-stone-300'}`}>
          <span className="text-lg">{n.icon}</span>{n.label}
          {n.wa && wa > 0 && <span className="absolute top-0 right-1/4 w-3.5 h-3.5 bg-red-500 rounded-full text-[8px] font-bold text-white flex items-center justify-center">{wa}</span>}
        </button>
      ))}
    </nav>

    {/* ===== MOBILE DRAWER ===== */}
    {mobileOpen && <div className="fixed inset-0 bg-black/40 z-[200]" onClick={() => setMobileOpen(false)} />}
    <div className={`fixed top-0 right-0 bottom-0 w-72 bg-white z-[201] flex flex-col transition-transform duration-200 ${mobileOpen ? 'translate-x-0' : 'translate-x-full'}`}>
      <div className="flex items-center justify-between p-4 safe-top">
        <h3 className="font-heading text-base font-bold">Menu</h3>
        <button onClick={() => setMobileOpen(false)} className="w-8 h-8 bg-stone-100 rounded-lg flex items-center justify-center text-sm">✕</button>
      </div>
      <div className="flex-1 overflow-y-auto px-3 pb-3">
        <div className="bg-brand-700 rounded-2xl p-5 text-center text-white mb-4 relative overflow-hidden">
          <div className="absolute -right-4 -top-4 w-16 h-16 rounded-full border-[2px] border-white/10" />
          <div className="absolute -right-1 -top-1 w-9 h-9 rounded-full border-[2px] border-white/10" />
          <div className="relative z-10">
            <div className="w-12 h-12 bg-white/15 rounded-xl flex items-center justify-center text-lg font-bold mx-auto mb-2">{user?.name?.charAt(0)}</div>
            <div className="text-sm font-bold">{user?.name}</div>
            <div className="text-[10px] text-white/50 mt-1">{user?.role?.toUpperCase()}</div>
          </div>
        </div>
        <div className="space-y-0.5">
          {NAV.filter(n => !n.sep && (!n.admin || isAdmin)).map(n => (
            <button key={n.id} onClick={() => go(n.id)} className={`flex items-center gap-3 w-full px-3 py-3 rounded-xl text-sm font-medium text-left transition ${page === n.id ? 'bg-brand-600 text-white' : 'text-stone-500 hover:bg-stone-50'}`}>
              <span className="text-base w-6">{n.icon}</span>{n.label}
            </button>
          ))}
        </div>
      </div>
      <div className="p-3 safe-bottom space-y-2 border-t border-stone-100">
        <button onClick={toggleDark} className="w-full py-3 bg-stone-100 rounded-xl text-sm font-semibold flex items-center justify-center gap-2">{darkMode ? '☀️ Light Mode' : '🌙 Dark Mode'}</button>
        <button onClick={() => { logout(); setMobileOpen(false) }} className="w-full py-3 bg-red-50 rounded-xl text-sm font-semibold text-red-500">Sign Out</button>
      </div>
    </div>
  </>)
}
