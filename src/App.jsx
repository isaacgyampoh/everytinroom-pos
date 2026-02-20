import { useState, useEffect } from 'react'
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

export default function App() {
  const { user, page, loading, loadAll } = useStore()
  const [cartOpen, setCartOpen] = useState(false)
  const [receipt, setReceipt] = useState(null)

  useEffect(() => {
    loadAll()
    setupRealtime()
  }, [])

  const setupRealtime = () => {
    const sb = getSupabase()
    if (!sb) return
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
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-sky-50 to-blue-100 text-sky-950 font-outfit">
      <Toaster position="top-center" toastOptions={{ duration: 2500, style: { borderRadius: '50px', padding: '16px 32px', fontWeight: 600 } }} />
      <Navigation onOpenCart={() => setCartOpen(true)} />
      <CartDrawer open={cartOpen} onClose={() => setCartOpen(false)} onReceipt={setReceipt} />
      {receipt && <ReceiptPreview sale={receipt} onClose={() => setReceipt(null)} />}
      <main className="pt-16 md:pt-[72px] pb-24 md:pb-10 min-h-screen">
        <div className="px-4 md:px-10 py-6 max-w-[1200px] mx-auto">
          {pages[page] || <POS />}
        </div>
      </main>
    </div>
  )
}
