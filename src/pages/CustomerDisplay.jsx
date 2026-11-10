import { useState, useEffect, useRef } from 'react'
import { getSupabase } from '../lib/supabase'
import { money, thumb } from '../lib/utils'
import { Logo, LogoFlat, LogoMark } from '../components/Logo'

const EMPTY = { items: [], count: 0, subtotal: 0, total: 0, status: 'shopping', receiptNo: null }

// Panels that gently cycle on the idle screen
const IDLE_PANELS = [
  { k: 'welcome', title: 'Welcome', sub: 'Your items will appear here as they are scanned' },
  { k: 'pay', title: 'Pay your way', sub: 'Cash  ·  Mobile Money (USSD)' },
  { k: 'hours', title: 'Open daily', sub: 'Mon – Sat  ·  8:00am – 7:00pm' },
  { k: 'location', title: 'Find us', sub: 'Aviation Road J382, Adenta, Accra' },
  { k: 'contact', title: 'Talk to us', sub: '024 531 5581  ·  024 936 5339' },
]

export default function CustomerDisplay() {
  const [s, setS] = useState(EMPTY)
  const [flash, setFlash] = useState(false)
  const [idleIdx, setIdleIdx] = useState(0)
  const prevCount = useRef(0)

  // The customer screen is always light, independent of the cashier's theme.
  useEffect(() => {
    document.body.classList.remove('dark')
    document.body.style.background = '#ffffff'

    // Self-correct: make sure THIS window sits on the customer (non-primary /
    // smaller) screen, fullscreen. This runs even if the cashier reopened the
    // app and Windows placed windows on the wrong monitors, so the screens
    // can't stay swapped.
    ;(async () => {
      try {
        if (!('getScreenDetails' in window)) return
        const sd = await window.getScreenDetails()
        if (!sd || sd.screens.length < 2) return
        // Same deterministic pick as the opener (with manual override support).
        let customer = null
        try { const v = localStorage.getItem('customer-screen-index'); if (v != null && v !== '' && sd.screens[parseInt(v)]) customer = sd.screens[parseInt(v)] } catch {}
        if (!customer) {
          const primary = sd.screens.find(s => s.isPrimary) || sd.currentScreen
          customer = sd.screens.find(s => !s.isPrimary && s !== primary)
          if (!customer) {
            const sorted = [...sd.screens].sort((a, b) => (a.width * a.height) - (b.width * b.height))
            customer = sorted[0] !== primary ? sorted[0] : sorted[1]
          }
        }
        if (!customer) return
        // Fill the ENTIRE customer screen (full width/height, covering taskbar).
        try { window.moveTo(customer.left, customer.top); window.resizeTo(customer.width, customer.height) } catch {}
        // Try true fullscreen (may be blocked without a gesture — the tap
        // handler below is the reliable fallback).
        try { if (!document.fullscreenElement && document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen({ navigationUI: 'hide' }) } catch {}
      } catch {}
    })()

    // Reliable fallback: a single tap/click anywhere on the customer screen
    // puts it into true fullscreen (browsers allow fullscreen on a user gesture).
    // Lets the installer fullscreen it with one touch, no keyboard.
    const goFs = () => {
      try { if (!document.fullscreenElement && document.documentElement.requestFullscreen) document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => {}) } catch {}
    }
    window.addEventListener('click', goFs)
    window.addEventListener('touchend', goFs)

    return () => {
      document.body.style.background = ''
      window.removeEventListener('click', goFs)
      window.removeEventListener('touchend', goFs)
    }
  }, [])

  useEffect(() => {
    const sb = getSupabase(); if (!sb) return
    // read ?reg=<id> from the hash URL so this screen pairs only with its own POS
    let reg = ''
    try { const h = window.location.hash; const qs = h.includes('?') ? h.split('?')[1] : ''; reg = new URLSearchParams(qs).get('reg') || '' } catch {}
    const chanName = reg ? `customer-display-${reg}` : 'customer-display'
    const ch = sb.channel(chanName, { config: { broadcast: { self: true } } })
    ch.on('broadcast', { event: 'state' }, ({ payload }) => {
      setS(prev => ({ ...EMPTY, ...payload }))
      if ((payload.count || 0) > prevCount.current) { setFlash(true); setTimeout(() => setFlash(false), 350) }
      prevCount.current = payload.count || 0
      if (payload.status === 'paid') {
        setTimeout(() => { setS(EMPTY); prevCount.current = 0 }, 6000)
      }
    })
    ch.subscribe(status => {
      // when we connect, ask the cashier app to send the current cart
      if (status === 'SUBSCRIBED') ch.send({ type: 'broadcast', event: 'hello', payload: { ts: Date.now() } })
    })
    return () => { sb.removeChannel(ch) }
  }, [])

  // ─── PAID / THANK YOU ───
  if (s.status === 'paid') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#16181d] text-white px-6 relative overflow-hidden">
        <div className="absolute inset-0 opacity-[0.06]" style={{ backgroundImage: 'radial-gradient(circle at 30% 20%, #fff 0, transparent 45%), radial-gradient(circle at 70% 80%, #fff 0, transparent 40%)' }} />
        <div className="w-24 h-24 rounded-full border-2 border-white/25 flex items-center justify-center mb-9 animate-fade relative">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
        </div>
        <h1 className="text-6xl md:text-7xl font-semibold mb-5 font-heading tracking-tight">Thank you</h1>
        <p className="text-lg text-white/55 mb-1 tracking-wide">Payment received</p>
        <div className="text-5xl font-semibold mt-5 tabular-nums">{money(s.total)}</div>
        {s.receiptNo && <p className="text-white/35 mt-4 text-sm tracking-wide">Receipt {s.receiptNo}</p>}
        <p className="text-white/30 mt-12 text-xs tracking-[0.2em] uppercase">EVERYTINROOM &middot; Adenta</p>
      </div>
    )
  }

  // ─── SHOPPING / IDLE ───
  const empty = !s.items || s.items.length === 0

  // Cycle the idle info panels, but only while the screen is idle (empty).
  useEffect(() => {
    if (!empty) { setIdleIdx(0); return }
    const t = setInterval(() => setIdleIdx(i => (i + 1) % IDLE_PANELS.length), 5000)
    return () => clearInterval(t)
  }, [empty])

  return (
    <div className="fixed inset-0 bg-white overflow-hidden">
      {/* Header — fixed at top */}
      <header className="fixed top-0 left-0 right-0 z-20 flex items-center gap-3 px-8 py-5 bg-[#16181d] text-white">
        <LogoFlat height={22} color="#ffffff" accent="#9a9da3" tagline={false} />
        {s.status === 'paying' && <span className="ml-auto text-sm font-semibold bg-white text-[#16181d] px-4 py-1.5 rounded-full">Complete payment on terminal</span>}
      </header>

      {empty ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-6 bg-white overflow-hidden">
          {/* soft breathing halo behind the logo */}
          <div className="absolute w-[460px] h-[460px] rounded-full idle-halo" style={{ background: 'radial-gradient(circle, rgba(16,24,29,0.05) 0%, rgba(16,24,29,0) 70%)' }} />
          <div className="relative idle-breath">
            <Logo height={120} color="#16181d" accent="#9a9da3" tagline={true} className="mb-10" />
          </div>
          {/* crossfading info panel — re-keys on idleIdx so it re-animates */}
          <div key={idleIdx} className="idle-rise relative" style={{ minHeight: '120px' }}>
            <h1 className="text-4xl md:text-5xl font-bold text-[#16181d] mb-3 tracking-tight">{IDLE_PANELS[idleIdx].title}</h1>
            <p className="text-lg md:text-xl text-[#8a8d92] max-w-xl">{IDLE_PANELS[idleIdx].sub}</p>
          </div>
          {/* progress dots */}
          <div className="absolute bottom-12 flex gap-2 idle-drift">
            {IDLE_PANELS.map((_, i) => (
              <span key={i} className={`h-1.5 rounded-full transition-all duration-500 ${i === idleIdx ? 'w-6 bg-[#16181d]' : 'w-1.5 bg-[#d8d9d7]'}`} />
            ))}
          </div>
        </div>
      ) : (
        <>
          {/* Items — the ONLY scrolling area. Sits between fixed header and fixed total bar. */}
          <div className="absolute left-0 right-0 lg:right-96 overflow-y-auto px-6 lg:px-8 py-5" style={{ top: '76px', bottom: '0' }}>
            <div className="space-y-3 max-w-3xl mx-auto pb-40 lg:pb-5">
              {s.items.map((it, i) => (
                <div key={i} className="flex items-center gap-4 bg-white rounded-2xl p-4 shadow-sm">
                  <div className="w-16 h-16 lg:w-20 lg:h-20 rounded-xl bg-stone-100 overflow-hidden flex-shrink-0">
                    {it.image ? <img src={thumb(it.image, 200)} alt="" className="w-full h-full object-contain p-[7%]" /> : <div className="w-full h-full flex items-center justify-center text-stone-300"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg></div>}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-lg lg:text-xl font-semibold text-gray-900 truncate">{it.name}</div>
                    <div className="text-stone-400 text-sm lg:text-base">{money(it.price)} × {it.qty}</div>
                  </div>
                  <div className="text-xl lg:text-2xl font-bold text-gray-900">{money(it.lineTotal)}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Total panel — FIXED to viewport. Physically cannot scroll.
              Bottom bar on portrait/narrow; full-height right column on wide screens. */}
          <div className="fixed left-0 right-0 bottom-0 lg:left-auto lg:top-0 lg:w-96 z-20 bg-[#16181d] text-white px-8 py-6 lg:py-8 lg:flex lg:flex-col lg:justify-end shadow-[0_-8px_30px_rgba(0,0,0,0.25)] lg:shadow-none">
            <div className="flex items-center justify-between lg:block max-w-3xl mx-auto lg:mx-0 w-full">
              <div className="lg:mb-4">
                <div className="flex items-center gap-2 text-white/50 text-base lg:text-lg lg:mb-2">
                  <span>Items</span><span className="font-semibold text-white/80">{s.count}</span>
                </div>
                <div className="hidden lg:block h-px bg-white/10 my-3" />
                <div className="text-white/50 text-base lg:text-lg">Total</div>
              </div>
              <div className={`text-5xl lg:text-7xl font-bold tabular-nums transition-transform duration-300 ${flash ? 'scale-105 lg:scale-110' : 'scale-100'}`}>{money(s.total)}</div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
