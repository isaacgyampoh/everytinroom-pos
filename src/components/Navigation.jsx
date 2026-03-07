import { useState } from 'react'
import { useStore } from '../hooks/useStore'

const NAV_ITEMS = [
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
const MOBILE_NAV = [
  { id: 'pos', icon: '🛒', label: 'Sale' },
  { id: 'whatsapp', icon: '📱', label: 'WA', wa: true },
  { id: 'receipts', icon: '🧾', label: 'Receipts' },
  { id: 'refunds', icon: '↩️', label: 'Refund' },
  { id: 'dash', icon: '📊', label: 'More', admin: true },
]

export default function Navigation({ onOpenCart }) {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const { page, setPage, user, isAdmin, logout, waOrders, cart } = useStore()
  const pendingWA = waOrders.filter(o => o.status === 'Pending').length
  const cartCount = cart.reduce((a, c) => a + c.qty, 0)
  const go = (pg) => {
    const ap = ['dash','products','bundles','staff','expenses','reports','customers','performance','promos','invoices','stocktakes','restock']
    if (!isAdmin && ap.includes(pg)) return; setPage(pg); setDrawerOpen(false)
  }
  return (<>
    {/* Desktop Nav */}
    <nav className="hidden md:flex fixed top-0 left-0 right-0 h-[72px] glass border-b border-gray-200/50 px-6 items-center z-[100]">
      <div className="flex items-center gap-3 font-heading text-xl font-extrabold tracking-tight"><img src="/logo.png" alt="" className="w-11 h-11 rounded-2xl object-contain" />Everytin Room</div>
      <div className="flex gap-1 ml-6 flex-wrap">{NAV_ITEMS.filter(n=>!n.admin||isAdmin).map(n=>(
        <button key={n.id} onClick={()=>go(n.id)} className={`px-3 py-2 rounded-xl text-[12px] font-semibold relative transition-all duration-200 ${page===n.id?(n.wa?'bg-wa text-white shadow-md shadow-wa/20':'bg-gray-900 text-white shadow-md shadow-gray-900/20'):'text-gray-500 hover:bg-gray-100 hover:text-gray-700'}`}>
          {n.icon} {n.label}{n.wa&&pendingWA>0&&<span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] bg-red-500 rounded-full text-[10px] font-bold text-white flex items-center justify-center">{pendingWA}</span>}
        </button>))}</div>
      <div className="ml-auto flex items-center gap-3">
        <div className="flex items-center gap-3 py-2 px-4 pl-2 bg-gray-50 rounded-2xl"><div className="w-[38px] h-[38px] bg-gradient-to-br from-brand-500 to-brand-600 rounded-xl flex items-center justify-center text-white font-bold shadow-md shadow-brand-500/20">{user?.name?.charAt(0)}</div><span className="text-sm font-semibold">{user?.name}</span></div>
        <button onClick={logout} className="py-2.5 px-5 bg-red-50 rounded-xl text-[13px] font-semibold text-red-500 hover:bg-red-100 transition">Sign Out</button>
      </div>
    </nav>

    {/* Mobile Header */}
    <header className="flex md:hidden fixed top-0 left-0 right-0 h-16 safe-top glass px-4 items-center gap-3 z-[100] border-b border-gray-200/30">
      <div className="flex items-center gap-2.5 font-heading text-lg font-extrabold tracking-tight flex-1"><img src="/logo.png" alt="" className="w-10 h-10 rounded-xl object-contain" />Everytin Room</div>
      <button onClick={()=>go('whatsapp')} className="w-11 h-11 rounded-xl bg-wa/10 flex items-center justify-center text-xl relative">📱{pendingWA>0&&<span className="absolute top-0.5 right-0.5 min-w-[18px] h-[18px] bg-red-500 rounded-full text-[10px] font-bold text-white flex items-center justify-center">{pendingWA}</span>}</button>
      <button onClick={()=>setDrawerOpen(true)} className="w-11 h-11 rounded-xl bg-gray-100 flex items-center justify-center text-xl">☰</button>
    </header>

    {/* Cart FAB */}
    <button onClick={onOpenCart} className="fixed bottom-[calc(100px+env(safe-area-inset-bottom))] md:bottom-8 right-5 md:right-8 w-16 h-16 bg-gradient-to-br from-brand-500 to-brand-600 rounded-2xl flex items-center justify-center text-3xl text-white z-[99] shadow-xl shadow-brand-500/30 active:scale-90 transition-all duration-200">🛒{cartCount>0&&<span className="absolute -top-1 -right-1 min-w-[24px] h-6 bg-gray-900 rounded-full text-xs font-bold text-white flex items-center justify-center border-[3px] border-white">{cartCount}</span>}</button>

    {/* Mobile Bottom Nav */}
    <nav className="flex md:hidden fixed bottom-0 left-0 right-0 glass safe-bottom px-4 pt-2.5 z-[100] border-t border-gray-200/30">{MOBILE_NAV.filter(n=>!n.admin||isAdmin).map(n=>(
      <button key={n.id} onClick={()=>go(n.id)} className={`flex-1 flex flex-col items-center gap-1 py-1.5 rounded-xl text-[10px] font-semibold relative transition-all duration-200 ${page===n.id?(n.wa?'text-wa bg-wa/10':'text-brand-500 bg-brand-50'):'text-gray-400'}`}>
        <span className="text-xl">{n.icon}</span>{n.label}{n.wa&&pendingWA>0&&<span className="absolute top-0 right-1/2 translate-x-3.5 min-w-[16px] h-4 bg-red-500 rounded-full text-[9px] font-bold text-white flex items-center justify-center">{pendingWA}</span>}
      </button>))}</nav>

    {/* Mobile Drawer Overlay */}
    {drawerOpen&&<div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[200]" onClick={()=>setDrawerOpen(false)}/>}

    {/* Mobile Drawer */}
    <div className={`fixed top-0 right-0 bottom-0 w-80 max-w-[85%] bg-white z-[201] flex flex-col transition-transform duration-300 ease-out ${drawerOpen?'translate-x-0':'translate-x-full'}`}>
      <div className="flex items-center justify-between p-5 safe-top border-b border-gray-100"><h3 className="font-heading text-lg font-bold">Menu</h3><button onClick={()=>setDrawerOpen(false)} className="w-11 h-11 bg-gray-100 rounded-xl flex items-center justify-center text-xl">✕</button></div>
      <div className="flex-1 overflow-y-auto p-5">
        <div className="bg-gradient-to-br from-brand-500 to-brand-600 rounded-3xl p-6 text-center text-white mb-6 shadow-xl shadow-brand-500/20"><div className="w-16 h-16 bg-white/20 rounded-2xl flex items-center justify-center text-2xl font-bold mx-auto mb-3">{user?.name?.charAt(0)}</div><h4 className="font-heading text-lg font-bold">{user?.name}</h4><span className="inline-block mt-2 px-3.5 py-1.5 bg-white/20 rounded-full text-[11px] font-bold">{user?.role?.toUpperCase()}</span></div>
        <div className="space-y-1">{NAV_ITEMS.filter(n=>!n.admin||isAdmin).map(n=>(
          <button key={n.id} onClick={()=>go(n.id)} className={`flex items-center gap-3.5 w-full p-4 rounded-2xl text-[15px] font-semibold relative text-left transition-all duration-200 ${page===n.id?(n.wa?'bg-wa text-white shadow-md':'bg-gray-900 text-white shadow-md'):'text-gray-500 hover:bg-gray-50'}`}>
            <span className="text-xl w-7">{n.icon}</span>{n.label}{n.wa&&pendingWA>0&&<span className="absolute right-4 min-w-[24px] h-6 bg-red-500 rounded-full text-xs font-bold text-white flex items-center justify-center">{pendingWA}</span>}
          </button>))}</div>
      </div>
      <div className="p-5 safe-bottom border-t border-gray-100"><button onClick={()=>{logout();setDrawerOpen(false)}} className="w-full p-4 bg-red-50 rounded-2xl text-[15px] font-semibold text-red-500 hover:bg-red-100 transition">🚪 Sign Out</button></div>
    </div>
  </>)
}
