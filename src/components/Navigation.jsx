import { useState, useEffect } from 'react'
import { useStore } from '../hooks/useStore'
import { LogoMark } from './Logo'
import { getRegisterId, openCustomerScreenManual } from '../hooks/useCustomerDisplay'
import toast from 'react-hot-toast'

// Clean minimal SVG icons
const I = ({ d, ...p }) => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d={d} /></svg>

const icons = {
  dash: <I d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />,
  pos: <I d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4zM3 6h18M16 10a4 4 0 0 1-8 0" />,
  whatsapp: <I d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />,
  receipts: <I d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M16 13H8M16 17H8M10 9H8" />,
  refunds: <I d="M3 10h10a8 8 0 0 1 8 8v2M3 10l6 6M3 10l6-6" />,
  performance: <I d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />,
  products: <I d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />,
  promos: <I d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82zM7 7h.01" />,
  restock: <I d="M1 3h15v13H1zM16 8h4l3 3v5h-7V8zM5.5 21a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM18.5 21a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z" />,
  stocktakes: <I d="M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />,
  invoices: <I d="M4 4h16v16H4zM4 9h16M9 4v16" />,
  customers: <I d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z" />,
  expenses: <I d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />,
  reports: <I d="M18 20V10M12 20V4M6 20v-6" />,
  staff: <I d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />,
}

const NAV = [
  { id: 'dash', label: 'Dashboard', admin: true },
  { id: 'pos', label: 'POS' },
  { id: 'whatsapp', label: 'WhatsApp', wa: true },
  { id: 'wachats', label: 'WhatsApp AI', admin: true },
  { id: 'wasettings', label: 'WhatsApp Setup', admin: true },
  { id: 'receipts', label: 'Receipts' },
  { id: 'refunds', label: 'Refunds' },
  { id: 'sep1', sep: true },
  { id: 'performance', label: 'Staff Sales', admin: true },
  { id: 'products', label: 'Products', perm: 'product_management' },
  { id: 'promos', label: 'Promos & Bundles', admin: true },
  { id: 'restock', label: 'Restock', perm: 'product_receiving' },
  { id: 'receiving', label: 'Receiving', perm: 'product_receiving' },
  { id: 'stocktakes', label: 'Stock & Adjust', perm: 'stock_taking' },
  { id: 'sep2', sep: true },
  { id: 'invoices', label: 'Invoices', admin: true },
  { id: 'customers', label: 'Customers', admin: true },
  { id: 'expenses', label: 'Expenses', admin: true },
  { id: 'reports', label: 'Reports', perm: 'reports' },
  { id: 'staff', label: 'Staff', admin: true },
]

const MOB = [
  { id: 'pos', label: 'Sale' },
  { id: 'whatsapp', label: 'WA', wa: true },
  { id: 'receipts', label: 'Receipts' },
  { id: 'refunds', label: 'Refund' },
  { id: 'dash', label: 'More', admin: true },
]

const AP = ['dash','products','bundles','staff','expenses','reports','customers','performance','promos','invoices','stocktakes','restock','stockadjustments']

export default function Navigation({ onOpenCart }) {
  const [expanded, setExpanded] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const { page, setPage, user, isAdmin, can, logout, waOrders, cart, darkMode, toggleDark, shopOpen, shopSettingLoaded, fetchShopOpen, setShopOpen } = useStore()
  useEffect(() => { if (isAdmin) fetchShopOpen() }, [isAdmin])
  const toggleShop = async () => {
    const next = !shopOpen
    const res = await setShopOpen(next)
    if (res?.ok) toast.success(next ? 'Online shop is now OPEN' : 'Online shop is now CLOSED')
    else toast.error('Could not save: ' + (res?.error || 'unknown error'))
  }

  // Open the customer screen — on a dual-screen POS (e.g. GS-3063) put it on
  // the SECOND physical display in fullscreen. Falls back to a popup window.
  const openCustomerScreen = async () => {
    const w = await openCustomerScreenManual()
    if (w) toast.success('Customer screen opened')
    else toast.error('Could not open — check the second display is connected and popups are allowed')
  }
  const wa = waOrders.filter(o => o.status === 'Pending' || o.status === 'Paid').length
  const cc = cart.reduce((a, c) => a + c.qty, 0)
  const go = (p) => {
    const item = [...NAV, ...MOB].find(n => n.id === p)
    if (item?.perm && !can(item.perm)) return
    if (item && item.admin && !item.perm && !isAdmin) return
    setPage(p); setMobileOpen(false)
  }

  const items = NAV.filter(n => n.sep || ((!n.admin || isAdmin) && (!n.perm || can(n.perm))))

  return (<>
    {/* Desktop Sidebar */}
    <aside className="hidden md:flex fixed top-0 left-0 bottom-0 z-[100] flex-col transition-all duration-300 ease-out"
      style={{ width: expanded ? 220 : 64 }}
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={() => setExpanded(false)}>
      <div className="absolute inset-0 bg-white border-r border-stone-200/60 dark-sidebar" />

      {/* Logo */}
      <div className="relative z-10 flex items-center gap-3 px-4 h-16 flex-shrink-0">
        <LogoMark size={32} rounded={9} />
        <div className={`overflow-hidden transition-all duration-300 ${expanded ? 'opacity-100 w-auto' : 'opacity-0 w-0'}`}>
          <div className="font-heading text-[13px] font-bold tracking-tight whitespace-nowrap">EVERYTINROOM</div>
        </div>
      </div>

      {/* Nav */}
      <nav className="relative z-10 flex-1 overflow-y-auto overflow-x-hidden px-2 py-2 scrollbar-hide">
        {items.map(n => {
          if (n.sep) return <div key={n.id} className="my-2 mx-2 h-px bg-stone-200/60" />
          const active = page === n.id
          return (
            <button key={n.id} onClick={() => go(n.id)}
              className={`w-full flex items-center gap-3 h-10 px-3 rounded-xl mb-0.5 transition-all duration-150 relative group ${active ? 'bg-gray-900 text-white' : 'text-stone-400 hover:bg-stone-100 hover:text-stone-700'}`}>
              <span className="flex-shrink-0 w-5 flex justify-center">{icons[n.id] || <I d="M12 12h.01" />}</span>
              <span className={`text-[13px] font-medium whitespace-nowrap overflow-hidden transition-all duration-300 ${expanded ? 'opacity-100 w-auto' : 'opacity-0 w-0'}`}>{n.label}</span>
              {n.wa && wa > 0 && <span className="absolute top-1 right-1 w-4 h-4 bg-red-500 rounded-full text-[8px] font-bold text-white flex items-center justify-center">{wa}</span>}
              {!expanded && <div className="absolute left-full ml-2 px-2.5 py-1 bg-gray-900 text-white text-xs font-medium rounded-lg whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50">{n.label}</div>}
            </button>
          )
        })}
      </nav>

      {/* Bottom */}
      <div className="relative z-10 px-2 pb-3 flex-shrink-0 space-y-0.5">
        <div className="my-2 mx-2 h-px bg-stone-200/60" />
        <button onClick={openCustomerScreen} className="w-full flex items-center gap-3 h-10 px-3 rounded-xl text-stone-400 hover:bg-stone-100 hover:text-stone-700 transition">
          <span className="flex-shrink-0 w-5 flex justify-center"><I d="M2 3h20v14H2zM8 21h8M12 17v4" /></span>
          <span className={`text-[13px] font-medium whitespace-nowrap overflow-hidden transition-all duration-300 ${expanded ? 'opacity-100 w-auto' : 'opacity-0 w-0'}`}>Customer Screen</span>
        </button>
        {isAdmin && <button onClick={toggleShop} disabled={!shopSettingLoaded} className="w-full flex items-center gap-3 h-10 px-3 rounded-xl text-stone-400 hover:bg-stone-100 hover:text-stone-700 transition disabled:opacity-50">
          <span className="flex-shrink-0 w-5 flex justify-center"><I d="M3 9l1-5h16l1 5M4 9v10a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V9M3 9h18" /></span>
          <span className={`flex-1 flex items-center justify-between text-[13px] font-medium whitespace-nowrap overflow-hidden transition-all duration-300 ${expanded ? 'opacity-100 w-auto' : 'opacity-0 w-0'}`}>
            <span>Online Shop</span>
            <span className={`relative w-9 h-5 rounded-full transition-colors flex-shrink-0 ${shopOpen ? 'bg-[#16181d]' : 'bg-stone-300'}`}>
              <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all ${shopOpen ? 'left-[18px]' : 'left-0.5'}`} />
            </span>
          </span>
        </button>}
        {isAdmin && <button onClick={toggleDark} className="w-full flex items-center gap-3 h-10 px-3 rounded-xl text-stone-400 hover:bg-stone-100 hover:text-stone-700 transition">
          <span className="flex-shrink-0 w-5 flex justify-center">{darkMode ? <I d="M12 3v1m0 16v1m9-9h-1M4 12H3m3.34-5.66l-.7-.7m12.73 0l-.71.7M6.34 17.66l-.7.7m12.73 0l-.71-.7M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z" /> : <I d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />}</span>
          <span className={`text-[13px] font-medium whitespace-nowrap overflow-hidden transition-all duration-300 ${expanded ? 'opacity-100 w-auto' : 'opacity-0 w-0'}`}>{darkMode ? 'Light mode' : 'Dark mode'}</span>
        </button>}
        <div className="flex items-center gap-3 h-10 px-3 rounded-xl">
          <div className="w-6 h-6 bg-gray-800 rounded-lg flex items-center justify-center text-white text-[9px] font-bold flex-shrink-0">{user?.name?.charAt(0)}</div>
          <span className={`text-[13px] font-medium whitespace-nowrap overflow-hidden transition-all duration-300 ${expanded ? 'opacity-100 w-auto' : 'opacity-0 w-0'}`}>{user?.name}</span>
        </div>
        <button onClick={logout} className="w-full flex items-center gap-3 h-10 px-3 rounded-xl text-stone-400 hover:bg-red-50 hover:text-red-500 transition">
          <span className="flex-shrink-0 w-5 flex justify-center"><I d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" /></span>
          <span className={`text-[13px] font-medium whitespace-nowrap overflow-hidden transition-all duration-300 ${expanded ? 'opacity-100 w-auto' : 'opacity-0 w-0'}`}>Sign out</span>
        </button>
      </div>
    </aside>

    {/* Cart FAB */}
    {page === 'pos' && <button onClick={onOpenCart} className="fixed bottom-[calc(90px+env(safe-area-inset-bottom))] md:bottom-6 right-4 md:right-6 w-14 h-14 bg-[#16181d] rounded-2xl flex items-center justify-center text-white z-[99] shadow-lg shadow-[#16181d]/30 active:scale-90 transition hover:bg-[#2a2d34]"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>{cc>0&&<span className="absolute -top-1.5 -right-1.5 min-w-[22px] h-[22px] bg-white text-[#16181d] rounded-full text-[11px] font-bold flex items-center justify-center shadow-md">{cc}</span>}</button>}

    {/* Mobile Header */}
    <header className="flex md:hidden fixed top-0 left-0 right-0 h-14 safe-top glass px-4 items-center gap-2 z-[100] border-b border-stone-200/30">
      <div className="flex items-center gap-2 font-heading text-base font-bold tracking-tight flex-1">
        <LogoMark size={28} rounded={7} /><span className="font-heading text-[15px] font-semibold tracking-tight">EVERYTINROOM</span>
      </div>
      <button onClick={() => setMobileOpen(true)} className="w-9 h-9 rounded-xl bg-gray-900 flex items-center justify-center text-white">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 12h18M3 6h18M3 18h18"/></svg>
      </button>
    </header>

    {/* Mobile Bottom Nav */}
    <nav className="flex md:hidden fixed bottom-0 left-0 right-0 glass safe-bottom px-3 pt-2 z-[100] border-t border-stone-200/30">
      {MOB.filter(n => (!n.admin || isAdmin) && (!n.perm || can(n.perm))).map(n => (
        <button key={n.id} onClick={() => go(n.id)} className={`flex-1 flex flex-col items-center gap-0.5 py-1.5 rounded-xl text-[10px] font-semibold relative transition ${page === n.id ? 'text-gray-800' : 'text-stone-300'}`}>
          <span className="w-5 h-5 flex items-center justify-center">{icons[n.id] || <I d="M12 12h.01" />}</span>
          {n.label}
          {n.wa && wa > 0 && <span className="absolute top-0 right-1/4 w-3.5 h-3.5 bg-red-500 rounded-full text-[8px] font-bold text-white flex items-center justify-center">{wa}</span>}
        </button>
      ))}
    </nav>

    {/* Mobile Drawer */}
    {mobileOpen && <div className="fixed inset-0 bg-black/40 z-[200]" onClick={() => setMobileOpen(false)} />}
    <div className={`fixed top-0 right-0 bottom-0 w-72 bg-white z-[201] flex flex-col transition-transform duration-200 ${mobileOpen ? 'translate-x-0' : 'translate-x-full'}`}>
      <div className="flex items-center justify-between p-4 safe-top">
        <h3 className="font-heading text-base font-bold">Menu</h3>
        <button onClick={() => setMobileOpen(false)} className="w-8 h-8 bg-stone-100 rounded-lg flex items-center justify-center">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-3 pb-3">
        <div className="bg-gray-900 rounded-2xl p-5 text-center text-white mb-4 relative overflow-hidden">
          <div className="relative z-10">
            <div className="w-12 h-12 bg-white/15 rounded-xl flex items-center justify-center text-lg font-bold mx-auto mb-2">{user?.name?.charAt(0)}</div>
            <div className="text-sm font-bold">{user?.name}</div>
            <div className="text-[10px] text-white/50 mt-1">{user?.role?.toUpperCase()}</div>
          </div>
        </div>
        <div className="space-y-0.5">
          {NAV.filter(n => !n.sep && (!n.admin || isAdmin) && (!n.perm || can(n.perm))).map(n => (
            <button key={n.id} onClick={() => go(n.id)} className={`flex items-center gap-3 w-full px-3 py-3 rounded-xl text-sm font-medium text-left transition ${page === n.id ? 'bg-gray-900 text-white' : 'text-stone-500 hover:bg-stone-50'}`}>
              <span className="w-5 flex justify-center">{icons[n.id] || <I d="M12 12h.01" />}</span>{n.label}
            </button>
          ))}
        </div>
      </div>
      <div className="p-3 safe-bottom space-y-2 border-t border-stone-100">
        {isAdmin && <button onClick={toggleShop} disabled={!shopSettingLoaded} className="w-full py-3 bg-stone-100 rounded-xl text-sm font-semibold flex items-center justify-between px-4 disabled:opacity-50">
          <span className="flex items-center gap-2"><I d="M3 9l1-5h16l1 5M4 9v10a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V9M3 9h18" /> Online Shop {shopOpen ? 'Open' : 'Closed'}</span>
          <span className={`relative w-10 h-6 rounded-full transition-colors flex-shrink-0 ${shopOpen ? 'bg-[#16181d]' : 'bg-stone-300'}`}>
            <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all ${shopOpen ? 'left-[18px]' : 'left-0.5'}`} />
          </span>
        </button>}
        {isAdmin && <button onClick={toggleDark} className="w-full py-3 bg-stone-100 rounded-xl text-sm font-semibold flex items-center justify-center gap-2">
          {darkMode ? <I d="M12 3v1m0 16v1m9-9h-1M4 12H3m3.34-5.66l-.7-.7m12.73 0l-.71.7M6.34 17.66l-.7.7m12.73 0l-.71-.7M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z" /> : <I d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />}
          {darkMode ? 'Light Mode' : 'Dark Mode'}
        </button>}
        <button onClick={() => { logout(); setMobileOpen(false) }} className="w-full py-3 bg-red-50 rounded-xl text-sm font-semibold text-red-500">Sign Out</button>
      </div>
    </div>
  </>)
}
