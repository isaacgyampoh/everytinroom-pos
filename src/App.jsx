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
import toast from 'react-hot-toast'

const INACTIVITY_TIMEOUT = 30 * 60 * 1000 // 30 minutes
const ADMIN_PAGES = ['products', 'staff', 'promos', 'invoices', 'stocktakes', 'stockadjustments', 'restock']

export default function App() {
  const { user, page, setPage, loading, loadAll, logout, isAdmin } = useStore()
  const [cartOpen, setCartOpen] = useState(false)
  const [receipt, setReceipt] = useState(null)
  const [lastActivity, setLastActivity] = useState(Date.now())

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
        toast('Session expired — please log in again', { icon: '🔒' })
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

  const setupRealtime = () => {
    const sb = getSupabase(); if (!sb) return
    const store = useStore.getState()
    sb.channel('pos-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'whatsapp_orders' }, () => store.refreshWAOrders())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, () => store.refreshProducts())
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'sales' }, () => store.refreshSales())
      .subscribe()
  }

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
    stockadjustments: <StockAdjustmentsPage />,
    restock: <RestockPage />,
  }

  return (
    <div className="min-h-screen bg-[#f7f8fa] text-gray-900">
      <Toaster position="top-center" toastOptions={{ duration: 2500, style: { borderRadius: '14px', padding: '14px 24px', fontWeight: 600, fontSize: '14px' } }} />
      <Navigation onOpenCart={() => setCartOpen(true)} />
      <CartDrawer open={cartOpen} onClose={() => setCartOpen(false)} onReceipt={setReceipt} />
      {receipt && <ReceiptPreview sale={receipt} onClose={() => setReceipt(null)} />}
      <main className="pt-16 md:pt-[72px] pb-24 md:pb-10 min-h-screen">
        <div className="px-4 md:px-8 lg:px-10 py-5 md:py-6">
          {pages[page] || <POS />}
        </div>
      </main>
    </div>
  )
}
