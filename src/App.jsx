import { useState, useEffect, useCallback } from 'react'
import { Toaster } from 'react-hot-toast'
import { getSupabase } from './lib/supabase'
import { useStore } from './hooks/useStore'
import Loader from './components/Loader'
import Login from './components/Login'
import Navigation from './components/Navigation'
import CartDrawer from './components/CartDrawer'
import ReceiptPreview from './components/ReceiptPreview'
import Dashboard from './pages/Dashboard'
import POS from './pages/POS'
import WhatsAppOrders from './pages/WhatsAppOrders'
import Receipts from './pages/Receipts'
import Products from './pages/Products'
import StaffPage from './pages/StaffPage'
import ExpensesPage from './pages/ExpensesPage'
import CustomersPage from './pages/CustomersPage'
import BundlesPage from './pages/BundlesPage'
import PerformancePage from './pages/PerformancePage'
import RefundsPage from './pages/RefundsPage'
import ReportsPage from './pages/ReportsPage'
import PromosPage from './pages/PromosPage'
import InvoicesPage from './pages/InvoicesPage'
import StockTakesPage from './pages/StockTakesPage'
import StockAdjustmentsPage from './pages/StockAdjustmentsPage'
import RestockPage from './pages/RestockPage'
import InvoicePay from './pages/InvoicePay'
import Catalog from './pages/Catalog'
import toast from 'react-hot-toast'

const INACTIVITY_TIMEOUT = 30 * 60 * 1000 // 30 minutes
const ADMIN_PAGES = ['products', 'staff', 'promos', 'invoices', 'stocktakes', 'stockadjustments', 'restock']

export default function App() {
  const { user, page, setPage, loading, loadAll, logout, isAdmin, darkMode } = useStore()
  const [cartOpen, setCartOpen] = useState(false)
  const [receipt, setReceipt] = useState(null)
  const [lastActivity, setLastActivity] = useState(Date.now())
  const [salePopup, setSalePopup] = useState(null)

  // Apply dark mode
  useEffect(() => {
    document.body.classList.toggle('dark', darkMode)
  }, [darkMode])

  useEffect(() => { loadAll(); setupRealtime() }, [])

  // Auto-logout on inactivity
  const resetActivity = useCallback(() => setLastActivity(Date.now()), [])

  useEffect(() => {
    if (!user) return
    const events = ['mousedown', 'keydown', 'touchstart', 'scroll']
    events.forEach(e => window.addEventListener(e, resetActivity))
    const timer = setInterval(() => {
      if (Date.now() - lastActivity > INACTIVITY_TIMEOUT) {
        logout()
        toast('Session expired — please log in again', { icon: '' })
      }
    }, 60000) // Check every minute
    return () => {
      events.forEach(e => window.removeEventListener(e, resetActivity))
      clearInterval(timer)
    }
  }, [user, lastActivity, logout, resetActivity])

  // Guard admin pages — redirect non-admin users
  useEffect(() => {
    if (user && !isAdmin && ADMIN_PAGES.includes(page)) {
      setPage('pos')
      toast.error('Admin access required')
    }
  }, [page, user, isAdmin, setPage])

  const playSaleSound = () => {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)()
      const osc = ctx.createOscillator(); const gain = ctx.createGain()
      osc.connect(gain); gain.connect(ctx.destination)
      osc.frequency.setValueAtTime(800, ctx.currentTime)
      osc.frequency.setValueAtTime(1000, ctx.currentTime + 0.1)
      osc.frequency.setValueAtTime(1200, ctx.currentTime + 0.2)
      gain.gain.setValueAtTime(0.3, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5)
      osc.start(); osc.stop(ctx.currentTime + 0.5)
    } catch {}
  }

  const setupRealtime = () => {
    const sb = getSupabase(); if (!sb) return
    const store = useStore.getState()
    sb.channel('pos-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'whatsapp_orders' }, () => store.refreshWAOrders())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, () => store.refreshProducts())
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'sales' }, (payload) => {
        store.refreshSales()
        const s = payload.new
        if (s) {
          playSaleSound()
          setSalePopup({ total: s.total, customer: s.customer, payment: s.payment, cashier: s.cashier })
          setTimeout(() => setSalePopup(null), 4000)
        }
      })
      .subscribe()
  }

  // Public pages - no login required
  if (window.location.hash.includes('/pay/')) return <InvoicePay />
  if (window.location.hash.includes('/catalog')) return <Catalog />

  if (loading) return <><Loader /><Toaster /></>
  if (!user) return <><Login /><Toaster /></>

  const pages = {
    dash: <Dashboard />,
    pos: <POS />,
    whatsapp: <WhatsAppOrders />,
    receipts: <Receipts onPrintReceipt={(s) => setReceipt({ receiptNo: s.receiptNo, date: s.date, customer: s.customer, cashier: s.cashier, payment: s.payment, type: s.type, items: s.items, total: s.total, discount: s.discount })} />,
    products: <Products />,
    staff: <StaffPage />,
    expenses: <ExpensesPage />,
    customers: <CustomersPage />,
    bundles: <BundlesPage />,
    performance: <PerformancePage />,
    refunds: <RefundsPage />,
    reports: <ReportsPage />,
    promos: <PromosPage />,
    invoices: <InvoicesPage />,
    stocktakes: <StockTakesPage />,
    restock: <RestockPage />,
  }

  return (
    <div className="min-h-screen">
      <Toaster position="top-center" toastOptions={{ duration: 2000, style: { borderRadius: '14px', padding: '12px 20px', fontWeight: 600, fontSize: '13px', background: darkMode ? '#222' : '#fff', color: darkMode ? '#eee' : '#1a1a1a' } }} />
      <Navigation onOpenCart={() => setCartOpen(true)} />
      <CartDrawer open={cartOpen} onClose={() => setCartOpen(false)} onReceipt={setReceipt} />
      {receipt && <ReceiptPreview sale={receipt} onClose={() => setReceipt(null)} />}

      {/* Sale Notification Popup */}
      {salePopup && (
        <div className="fixed top-20 md:top-5 left-1/2 -translate-x-1/2 z-[300] animate-fade">
          <div className="bg-brand-800 text-white rounded-2xl px-6 py-4 shadow-2xl flex items-center gap-4 min-w-[280px]">
            <div className="w-12 h-12 bg-brand-500 rounded-xl flex items-center justify-center text-2xl flex-shrink-0"></div>
            <div>
              <div className="text-xs text-gray-400">New Sale!</div>
              <div className="text-lg font-extrabold">GHS {Number(salePopup.total || 0).toFixed(2)}</div>
              <div className="text-xs text-gray-400">{salePopup.cashier} • {salePopup.payment}</div>
            </div>
          </div>
        </div>
      )}

      <main className="pt-14 md:pt-0 md:ml-16 pb-24 md:pb-10 min-h-screen">
        <div className="px-4 md:px-8 lg:px-10 py-5 md:py-6">
          {pages[page] || <POS />}
        </div>
      </main>
    </div>
  )
}
