import { useState, useEffect, useCallback, lazy, Suspense } from 'react'
import { Toaster } from 'react-hot-toast'
import { getSupabase } from './lib/supabase'
import { useStore } from './hooks/useStore'
import { useCustomerDisplayBroadcast, broadcastDisplay } from './hooks/useCustomerDisplay'
import Loader from './components/Loader'
import Login from './components/Login'
import Navigation from './components/Navigation'
import CartDrawer from './components/CartDrawer'
import ReceiptPreview from './components/ReceiptPreview'
import toast from 'react-hot-toast'

// Lazy load all pages — only loads when needed
const Dashboard = lazy(() => import('./pages/Dashboard'))
const POS = lazy(() => import('./pages/POS'))
const WhatsAppOrders = lazy(() => import('./pages/WhatsAppOrders'))
const WhatsAppChats = lazy(() => import('./pages/WhatsAppChats'))
const ReceivingPage = lazy(() => import('./pages/ReceivingPage'))
const WhatsAppSettings = lazy(() => import('./pages/WhatsAppSettings'))
const Receipts = lazy(() => import('./pages/Receipts'))
const Products = lazy(() => import('./pages/Products'))
const StaffPage = lazy(() => import('./pages/StaffPage'))
const ExpensesPage = lazy(() => import('./pages/ExpensesPage'))
const CustomersPage = lazy(() => import('./pages/CustomersPage'))
const BundlesPage = lazy(() => import('./pages/BundlesPage'))
const PerformancePage = lazy(() => import('./pages/PerformancePage'))
const RefundsPage = lazy(() => import('./pages/RefundsPage'))
const ReportsPage = lazy(() => import('./pages/ReportsPage'))
const PromosPage = lazy(() => import('./pages/PromosPage'))
const InvoicesPage = lazy(() => import('./pages/InvoicesPage'))
const StockTakesPage = lazy(() => import('./pages/StockTakesPage'))
const StockAdjustmentsPage = lazy(() => import('./pages/StockAdjustmentsPage'))
const RestockPage = lazy(() => import('./pages/RestockPage'))
const InvoicePay = lazy(() => import('./pages/InvoicePay'))
const Catalog = lazy(() => import('./pages/Catalog'))
const DeliveryConfirm = lazy(() => import('./pages/DeliveryConfirm'))
const DeliveryDetails = lazy(() => import('./pages/DeliveryDetails'))
const CustomerDisplay = lazy(() => import('./pages/CustomerDisplay'))

const INACTIVITY_TIMEOUT = 60 * 1000 // 1 minute
const ADMIN_PAGES = ['products', 'staff', 'promos', 'invoices', 'stocktakes', 'stockadjustments', 'restock', 'wasettings']
// Pages a non-admin may access IF they hold the matching permission.
const PAGE_PERMISSIONS = {
  products: 'product_management',
  restock: 'product_receiving',
  receiving: 'product_receiving',
  stocktakes: 'stock_taking',
  stockadjustments: 'stock_taking',
  reports: 'reports',
}

export default function App() {
  const { user, page, setPage, loading, loadAll, logout, isAdmin, can, darkMode } = useStore()
  const [cartOpen, setCartOpen] = useState(false)
  const [receipt, setReceipt] = useState(null)
  const [lastActivity, setLastActivity] = useState(Date.now())
  const [salePopup, setSalePopup] = useState(null)

  // Broadcast live cart to the customer-facing display (#/customer-display)
  useCustomerDisplayBroadcast()

  // Auto-launch the customer screen on the 2nd display once a cashier is in.
  // Runs after login (which is the user gesture browsers require). Designed so
  // a non-technical client just opens the app and the customer screen appears.
  useEffect(() => {
    if (!user) return
    if (window.location.hash.includes('/customer-display')) return // don't spawn from the customer window itself
    let cancelled = false
    const launch = async () => {
      try {
        const { openCustomerScreenAuto } = await import('./hooks/useCustomerDisplay')
        if (!cancelled) await openCustomerScreenAuto()
      } catch (e) { console.warn('auto customer screen:', e) }
    }
    // slight delay so the POS UI paints first
    const t = setTimeout(launch, 600)
    // keep it alive: only relaunch if the customer window was actually closed
    const keepAlive = setInterval(async () => {
      if (cancelled || window.location.hash.includes('/customer-display')) return
      const { isCustomerScreenOpen } = await import('./hooks/useCustomerDisplay')
      if (!isCustomerScreenOpen()) launch()
    }, 15000)
    return () => { cancelled = true; clearTimeout(t); clearInterval(keepAlive) }
  }, [user])

  // Apply dark mode
  useEffect(() => {
    document.body.classList.toggle('dark', darkMode)
  }, [darkMode])

  useEffect(() => { loadAll(); setupRealtime() }, [])

  // Global image fallback: any product image that fails to load (e.g. dead
  // Cloudinary links) is swapped for a clean neutral placeholder instead of
  // the browser's broken-image icon. Applies app-wide via error capture.
  useEffect(() => {
    const PLACEHOLDER = 'data:image/svg+xml;utf8,' + encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><rect width="96" height="96" fill="#f1f0ee"/><path d="M30 62l12-14 8 9 6-7 10 12H30z" fill="#d6d3ce"/><circle cx="38" cy="36" r="6" fill="#d6d3ce"/></svg>'
    )
    const onErr = (e) => {
      const t = e.target
      if (t && t.tagName === 'IMG' && t.src !== PLACEHOLDER) { t.src = PLACEHOLDER; t.style.objectFit = 'cover' }
    }
    window.addEventListener('error', onErr, true) // capture phase catches img errors
    return () => window.removeEventListener('error', onErr, true)
  }, [])

  // App-wide payment auto-confirm: every 20s (from ANY screen, while logged in)
  // ask NaloPay which recent pending orders actually paid, and mark them Paid.
  // This means orders confirm themselves — staff shouldn't need to mark manually.
  useEffect(() => {
    if (!user) return
    const run = async () => {
      try {
        const r = await fetch('https://noiiuwkovoojkcwzupye.supabase.co/functions/v1/charge-momo?action=reconcile-payments', { method: 'POST' })
        const j = await r.json()
        if (j?.confirmed > 0) { try { loadAll() } catch {} }
      } catch {}
    }
    run()
    const iv = setInterval(run, 20000)
    return () => clearInterval(iv)
  }, [user]) // eslint-disable-line

  // Auto-logout on inactivity
  const resetActivity = useCallback(() => setLastActivity(Date.now()), [])

  useEffect(() => {
    if (!user) return
    const events = ['mousedown', 'keydown', 'touchstart', 'scroll']
    events.forEach(e => window.addEventListener(e, resetActivity))
    const timer = setInterval(() => {
      if (Date.now() - lastActivity > INACTIVITY_TIMEOUT) {
        logout()
        toast('Logged out — enter your PIN to continue')
      }
    }, 10000) // check every 10s
    return () => {
      events.forEach(e => window.removeEventListener(e, resetActivity))
      clearInterval(timer)
    }
  }, [user, lastActivity, logout, resetActivity])

  // Guard admin pages — allow if admin, or if the user holds the page's permission
  useEffect(() => {
    if (!user || isAdmin) return
    const neededPerm = PAGE_PERMISSIONS[page]
    if (neededPerm && can(neededPerm)) return  // permitted staff may enter
    if (ADMIN_PAGES.includes(page)) {
      setPage('pos')
      toast.error('You do not have access to this page')
    }
  }, [page, user, isAdmin, can, setPage])

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
      .on('postgres_changes', { event: '*', schema: 'public', table: 'whatsapp_orders' }, () => {
        store.refreshWAOrders()
        // Update PWA badge with pending + paid (unprocessed) count
        setTimeout(() => {
          const s = useStore.getState()
          const badge = s.waOrders.filter(o => o.status === 'Pending' || o.status === 'Paid').length
          updateBadge(badge)
        }, 1000)
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, () => store.refreshProducts())
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'sales' }, (payload) => {
        store.refreshSales()
        const s = payload.new
        if (s) {
          playSaleSound()
          setSalePopup({ total: s.total, customer: s.customer, payment: s.payment, cashier: s.cashier })
          setTimeout(() => setSalePopup(null), 4000)
          // show thank-you on the customer display
          broadcastDisplay({ status: 'paid', total: s.total, receiptNo: s.receipt_no || s.receiptNo || null, items: [], count: 0, subtotal: 0 })
        }
      })
      .subscribe()
  }

  // Update PWA app icon badge (shows number on app icon)
  const updateBadge = (count) => {
    try {
      if ('setAppBadge' in navigator) {
        if (count > 0) navigator.setAppBadge(count)
        else navigator.clearAppBadge()
      }
      // Also tell service worker
      if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({ type: 'UPDATE_BADGE', count })
      }
    } catch {}
  }

  // Update badge whenever waOrders changes
  const waOrders = useStore(s => s.waOrders)
  useEffect(() => {
    const badge = waOrders.filter(o => o.status === 'Pending' || o.status === 'Paid').length
    updateBadge(badge)
  }, [waOrders])

  // Public pages - no login required
  if (window.location.hash.includes('/customer-display')) return <Suspense fallback={<Loader />}><CustomerDisplay /></Suspense>
  if (window.location.hash.includes('/pay/')) return <Suspense fallback={<Loader />}><InvoicePay /></Suspense>
  if (window.location.hash.includes('/deliver/')) return <Suspense fallback={<Loader />}><DeliveryConfirm /></Suspense>
  if (window.location.hash.includes('/details/')) return <Suspense fallback={<Loader />}><DeliveryDetails /></Suspense>
  if (window.location.hash.includes('/catalog')) return <Suspense fallback={<Loader />}><Catalog /></Suspense>

  if (loading) return <><Loader /><Toaster /></>
  if (!user) return <><Login /><Toaster /></>

  const pages = {
    dash: <Dashboard />,
    pos: <POS />,
    whatsapp: <WhatsAppOrders />,
    wachats: <WhatsAppChats />,
    receiving: <ReceivingPage />,
    wasettings: <WhatsAppSettings />,
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

      {/* Sale Notification */}
      {salePopup && (
        <div className="fixed top-20 md:top-5 left-1/2 -translate-x-1/2 z-[300] animate-fade">
          <div className="bg-gray-900 text-white rounded-xl px-5 py-3 shadow-lg flex items-center gap-3 min-w-[240px]">
            <div className="w-8 h-8 bg-white/10 rounded-lg flex items-center justify-center text-[13px]">+</div>
            <div>
              <div className="text-[13px] font-semibold">GHS {Number(salePopup.total || 0).toFixed(2)}</div>
              <div className="text-[11px] text-white/50">{salePopup.cashier} · {salePopup.payment}</div>
            </div>
          </div>
        </div>
      )}

      <main className="pt-14 md:pt-0 pb-24 md:pb-10 min-h-screen transition-all duration-200 content-shell">
        <div className="px-4 md:px-7 lg:px-9 py-4 md:py-5 max-w-[1600px] mx-auto">
          <Suspense fallback={<div className="flex items-center justify-center py-20"><div className="w-7 h-7 border-[2.5px] border-stone-200 border-t-gray-800 rounded-full animate-spin" /></div>}>
            {pages[page] || <POS />}
          </Suspense>
        </div>
      </main>
    </div>
  )
}
