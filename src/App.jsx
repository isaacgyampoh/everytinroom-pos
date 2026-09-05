import { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react'
import { Toaster } from 'react-hot-toast'
import { getSupabase } from './lib/supabase'
import { useStore } from './hooks/useStore'
import { useCustomerDisplayBroadcast, broadcastDisplay } from './hooks/useCustomerDisplay'
import Loader from './components/Loader'
import Login from './components/Login'
import Navigation from './components/Navigation'
import CartDrawer from './components/CartDrawer'
import ReceiptPreview from './components/ReceiptPreview'
import { startAutoFlush, pendingCount, onPendingChange, flush } from './lib/offlineQueue'
import { getSettings } from './lib/hardware'
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
const StockInsights = lazy(() => import('./pages/StockInsights'))
const TerminalPage = lazy(() => import('./pages/TerminalPage'))
const InvoicePay = lazy(() => import('./pages/InvoicePay'))
const Catalog = lazy(() => import('./pages/Catalog'))
const DeliveryConfirm = lazy(() => import('./pages/DeliveryConfirm'))
const DeliveryDetails = lazy(() => import('./pages/DeliveryDetails'))
const CustomerDisplay = lazy(() => import('./pages/CustomerDisplay'))

// How long the till may sit untouched before it locks. Read per terminal from
// Terminal & printer, so a counter and a back-office machine can differ without
// a deploy. Defaults to an hour.
const idleMs = () => {
  const m = Number(getSettings().idleMinutes)
  return (Number.isFinite(m) && m > 0 ? m : 60) * 60 * 1000
}

// What each restricted page requires. 'admin' means admin only; anything else
// is a permission key a cashier can be granted. Pages absent from this map are
// open to any signed-in staff member (pos, receipts, refunds, whatsapp).
//
// This replaces a split ADMIN_PAGES / PAGE_PERMISSIONS pair where the guard only
// ever consulted ADMIN_PAGES — so `reports`, `receiving`, `dash`, `customers`,
// `expenses`, `performance` and `wachats` were merely HIDDEN in the nav and
// stayed reachable, and the `reports` permission was never actually enforced.
// Every internal page id that a deep link may target. Kept next to PAGE_ACCESS
// so the two cannot drift apart.
const PAGES_BY_ID = new Set([
  'dash','pos','whatsapp','wachats','receiving','wasettings','receipts','products',
  'staff','expenses','customers','bundles','performance','refunds','reports',
  'promos','invoices','stocktakes','stockadjustments','restock','terminal','stockinsights',
])

const PAGE_ACCESS = {
  dash: 'admin',
  customers: 'admin',
  bundles: 'admin',
  promos: 'admin',
  invoices: 'admin',
  expenses: 'admin',
  performance: 'admin',
  wachats: 'admin',
  wasettings: 'admin',
  staff: 'admin',
  products: 'product_management',
  restock: 'product_receiving',
  receiving: 'product_receiving',
  stocktakes: 'stock_taking',
  stockinsights: 'inventory_view',
  stockadjustments: 'stock_taking',
  reports: 'reports',
  refunds: 'refunds',
}

export default function App() {
  const { user, page, setPage, loading, loadAll, logout, isAdmin, can, darkMode } = useStore()
  const [cartOpen, setCartOpen] = useState(false)
  const [receipt, setReceipt] = useState(null)
  const lastActivityRef = useRef(Date.now())
  const [salePopup, setSalePopup] = useState(null)
  const [queued, setQueued] = useState(pendingCount())
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine)

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

  // Offline sale queue: drain it whenever the connection comes back, and keep
  // the count on screen so nobody closes the till with sales still unfiled.
  useEffect(() => {
    startAutoFlush()
    const off = onPendingChange(setQueued)
    const up = () => { setOnline(true); flush().then(r => { if (r.sent) { toast.success(`${r.sent} offline sale${r.sent > 1 ? 's' : ''} filed`); loadAll() } }) }
    const down = () => setOnline(false)
    window.addEventListener('online', up)
    window.addEventListener('offline', down)
    return () => { off(); window.removeEventListener('online', up); window.removeEventListener('offline', down) }
  }, []) // eslint-disable-line

  useEffect(() => { loadAll(); setupRealtime() }, [])

  // Global image fallback: any product image that fails to load (e.g. dead
  // Cloudinary links) is swapped for a clean neutral placeholder instead of
  // the browser's broken-image icon. Applies app-wide via error capture.
  useEffect(() => {
    const PLACEHOLDER = 'data:image/svg+xml;utf8,' + encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><rect width="96" height="96" fill="#f1f0ee"/><path d="M30 62l12-14 8 9 6-7 10 12H30z" fill="#d6d3ce"/><circle cx="38" cy="36" r="6" fill="#d6d3ce"/></svg>'
    )
    // One failed load used to swap the image for a grey placeholder permanently,
    // for the rest of the session. On a shop connection that drops constantly
    // that turns a momentary blip into a POS full of grey boxes. Retry once
    // before giving up, and only give up on the retry.
    const onErr = (e) => {
      const t = e.target
      if (!t || t.tagName !== 'IMG' || t.src === PLACEHOLDER) return
      if (!t.dataset.retried) {
        t.dataset.retried = '1'
        const src = t.src
        // Cache-bust the retry so a poisoned entry isn't served straight back.
        setTimeout(() => { t.src = src + (src.includes('?') ? '&' : '?') + 'r=1' }, 800)
        return
      }
      t.src = PLACEHOLDER
      t.style.objectFit = 'cover'
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
  const resetActivity = useCallback(() => { lastActivityRef.current = Date.now() }, [])

  useEffect(() => {
    if (!user) return
    lastActivityRef.current = Date.now()
    const events = ['mousedown', 'keydown', 'touchstart', 'scroll']
    events.forEach(e => window.addEventListener(e, resetActivity, { passive: true }))
    const timer = setInterval(() => {
      if (Date.now() - lastActivityRef.current > idleMs()) {
        logout()
        toast('Logged out — enter your PIN to continue')
      }
    }, 10000) // check every 10s
    return () => {
      events.forEach(e => window.removeEventListener(e, resetActivity))
      clearInterval(timer)
    }
  }, [user, logout, resetActivity])

  // Deep links. The desktop app's jump-list shortcuts (right-click the taskbar
  // icon) and any bookmarked link arrive as #/pos, #/whatsapp, #/terminal. The
  // app otherwise navigates through store state, so without this a shortcut
  // just opened the default page and looked broken.
  useEffect(() => {
    if (!user) return
    const apply = () => {
      const id = (window.location.hash || '').replace(/^#\/?/, '').split('?')[0]
      if (!id || !PAGES_BY_ID.has(id)) return
      const needed = PAGE_ACCESS[id]
      if (needed && !isAdmin && (needed === 'admin' || !can(needed))) return
      setPage(id)
    }
    apply()
    window.addEventListener('hashchange', apply)
    return () => window.removeEventListener('hashchange', apply)
  }, [user, isAdmin, can, setPage])

  // Guard restricted pages — admins pass, everyone else needs the page's permission.
  useEffect(() => {
    if (!user || isAdmin) return
    const needed = PAGE_ACCESS[page]
    if (!needed) return                 // open page
    if (needed !== 'admin' && can(needed)) return
    setPage('pos')
    toast.error('You do not have access to this page')
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
    stockadjustments: <StockAdjustmentsPage />,
    restock: <RestockPage />,
    stockinsights: <StockInsights />,
    terminal: <TerminalPage />,
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

      {/* Connection / unfiled-sales indicator. A till that has been offline for
          an hour must not look identical to one that is fine. */}
      {(!online || queued > 0) && (
        <button onClick={() => setPage('terminal')}
          className={`fixed bottom-[calc(150px+env(safe-area-inset-bottom))] md:bottom-24 right-4 md:right-6 z-[98] h-10 px-3.5 rounded-xl text-[11px] font-bold shadow-lg flex items-center gap-2 ${online ? 'bg-amber-500 text-white' : 'bg-red-600 text-white'}`}>
          <span className="w-2 h-2 rounded-full bg-white/90 animate-pulse" />
          {online ? `${queued} sale${queued > 1 ? 's' : ''} to file` : queued > 0 ? `Offline · ${queued} saved` : 'Offline'}
        </button>
      )}

      <main className="pt-14 md:pt-0 pb-24 md:pb-10 min-h-screen transition-all duration-200 content-shell">
        <div className="px-3 sm:px-4 md:px-7 lg:px-9 py-3 md:py-5 max-w-[1600px] mx-auto">
          <Suspense fallback={<div className="flex items-center justify-center py-20"><div className="w-7 h-7 border-[2.5px] border-stone-200 border-t-gray-800 rounded-full animate-spin" /></div>}>
            {pages[page] || <POS />}
          </Suspense>
        </div>
      </main>
    </div>
  )
}
