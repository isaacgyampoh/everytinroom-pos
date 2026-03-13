import { useState } from 'react'
import { useStore } from '../hooks/useStore'

const NAV = [
  { id: 'dash', icon: '📊', label: 'Dashboard', admin: true },
  { id: 'whatsapp', icon: '📱', label: 'WhatsApp', wa: true },
  { id: 'pos', icon: '🛒', label: 'POS' },
  { id: 'receipts', icon: '🧾', label: 'Receipts' },
  { id: 'refunds', icon: '↩️', label: 'Refunds' },
  { id: 'performance', icon: '👥', label: 'Staff Sales', admin: true },
  { id: 'products', icon: '📦', label: 'Products', admin: true },
  { id: 'bundles', icon: '🎁', label: 'Bundles', admin: true },
  { id: 'promos', icon: '🏷️', label: 'Promos', admin: true },
  { id: 'restock', icon: '🚚', label: 'Restock', admin: true },
  { id: 'stocktakes', icon: '📋', label: 'Stock Takes', admin: true },
  { id: 'stockadjustments', icon: '🔧', label: 'Adjustments', admin: true },
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

const AP = ['dash','products','bundles','staff','expenses','reports','customers','performance','promos','invoices','stocktakes','restock']

export default function Navigation({ onOpenCart }) {
  const [open, setOpen] = useState(false)
  const { page, setPage, user, isAdmin, logout, waOrders, cart, darkMode, toggleDark } = useStore()
  const wa = waOrders.filter(o => o.status === 'Pending').length
  const cc = cart.reduce((a, c) => a + c.qty, 0)
  const go = (p) => { if (!isAdmin && AP.includes(p)) return; setPage(p); setOpen(false) }

  return (<>
    {/* Desktop */}
    <nav className="hidden md:flex fixed top-0 left-0 right-0 h-16 glass border-b border-stone-200/50 px-5 items-center z-[100]">
      <div className="flex items-center gap-2.5 font-heading text-lg font-extrabold tracking-tight"><img src="/logo.png" alt="" className="w-9 h-9 rounded-xl object-contain" />Everytin Room</div>
      <div className="flex gap-0.5 ml-5 flex-wrap">{NAV.filter(n=>!n.admin||isAdmin).map(n=>(
        <button key={n.id} onClick={()=>go(n.id)} className={`px-2.5 py-1.5 rounded-xl text-[11px] font-semibold relative transition ${page===n.id ? 'bg-brand-700 text-white' : 'text-stone-400 hover:text-stone-700 hover:bg-stone-100'}`}>
          {n.label}{n.wa&&wa>0&&<span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full text-[9px] font-bold text-white flex items-center justify-center">{wa}</span>}
        </button>))}</div>
      <div className="ml-auto flex items-center gap-3">
        <button onClick={toggleDark} className="w-8 h-8 rounded-full bg-stone-100 dark:bg-gray-800 flex items-center justify-center text-sm transition hover:scale-110" title="Toggle dark mode">{darkMode ? '☀️' : '🌙'}</button>
        <div className="flex items-center gap-2 py-1.5 px-3 pl-1.5 bg-white rounded-full"><div className="w-8 h-8 bg-brand-700 rounded-full flex items-center justify-center text-white text-xs font-bold">{user?.name?.charAt(0)}</div><span className="text-xs font-semibold text-stone-600">{user?.name}</span></div>
        <button onClick={logout} className="text-xs font-semibold text-stone-400 hover:text-red-500 transition">Sign Out</button>
      </div>
    </nav>

    {/* Mobile header */}
    <header className="flex md:hidden fixed top-0 left-0 right-0 h-14 safe-top glass px-4 items-center gap-2 z-[100] border-b border-stone-200/30">
      <div className="flex items-center gap-2 font-heading text-base font-extrabold tracking-tight flex-1"><img src="/logo.png" alt="" className="w-8 h-8 rounded-lg object-contain" />Everytin Room</div>
      <button onClick={()=>setOpen(true)} className="w-9 h-9 rounded-xl bg-gray-900 flex items-center justify-center text-white text-sm">☰</button>
    </header>

    {/* Cart FAB - only on POS */}
    {page === 'pos' && <button onClick={onOpenCart} className="fixed bottom-[calc(90px+env(safe-area-inset-bottom))] md:bottom-6 right-4 md:right-6 w-14 h-14 bg-brand-700 rounded-2xl flex items-center justify-center text-2xl text-white z-[99] shadow-lg active:scale-90 transition">🛒{cc>0&&<span className="absolute -top-1.5 -right-1.5 min-w-[20px] h-5 bg-accent-lime rounded-full text-[10px] font-bold text-black flex items-center justify-center">{cc}</span>}</button>}

    {/* Mobile bottom nav */}
    <nav className="flex md:hidden fixed bottom-0 left-0 right-0 glass safe-bottom px-3 pt-2 z-[100] border-t border-stone-200/30">{MOB.filter(n=>!n.admin||isAdmin).map(n=>(
      <button key={n.id} onClick={()=>go(n.id)} className={`flex-1 flex flex-col items-center gap-0.5 py-1.5 rounded-xl text-[10px] font-semibold relative transition ${page===n.id ? 'text-gray-900' : 'text-stone-300'}`}>
        <span className="text-lg">{n.icon}</span>{n.label}{n.wa&&wa>0&&<span className="absolute top-0 right-1/4 w-3.5 h-3.5 bg-red-500 rounded-full text-[8px] font-bold text-white flex items-center justify-center">{wa}</span>}
      </button>))}</nav>

    {/* Drawer */}
    {open&&<div className="fixed inset-0 bg-black/40 z-[200]" onClick={()=>setOpen(false)}/>}
    <div className={`fixed top-0 right-0 bottom-0 w-72 bg-white z-[201] flex flex-col transition-transform duration-200 ${open?'translate-x-0':'translate-x-full'}`}>
      <div className="flex items-center justify-between p-4 safe-top"><h3 className="font-heading text-base font-bold">Menu</h3><button onClick={()=>setOpen(false)} className="w-8 h-8 bg-stone-100 rounded-lg flex items-center justify-center text-sm">✕</button></div>
      <div className="flex-1 overflow-y-auto px-3 pb-3">
        <div className="bg-brand-700 rounded-2xl p-5 text-center text-white mb-4"><div className="w-12 h-12 bg-white/15 rounded-xl flex items-center justify-center text-lg font-bold mx-auto mb-2">{user?.name?.charAt(0)}</div><div className="text-sm font-bold">{user?.name}</div><div className="text-[10px] text-white/50 mt-1">{user?.role?.toUpperCase()}</div></div>
        <div className="space-y-0.5">{NAV.filter(n=>!n.admin||isAdmin).map(n=>(
          <button key={n.id} onClick={()=>go(n.id)} className={`flex items-center gap-3 w-full px-3 py-3 rounded-xl text-sm font-medium text-left transition ${page===n.id ? 'bg-brand-700 text-white' : 'text-stone-500 hover:bg-stone-50'}`}>
            <span className="text-base w-6">{n.icon}</span>{n.label}
          </button>))}</div>
      </div>
      <div className="p-3 safe-bottom border-t border-stone-200/30 space-y-2">
        <button onClick={toggleDark} className="w-full py-3 bg-stone-100 rounded-xl text-sm font-semibold flex items-center justify-center gap-2">{darkMode ? '☀️ Light Mode' : '🌙 Dark Mode'}</button>
        <button onClick={()=>{logout();setOpen(false)}} className="w-full py-3 bg-red-50 rounded-xl text-sm font-semibold text-red-500">Sign Out</button>
      </div>
    </div>
  </>)
}
