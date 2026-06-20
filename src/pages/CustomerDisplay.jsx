import { useState, useEffect, useRef } from 'react'
import { getSupabase } from '../lib/supabase'
import { money, thumb } from '../lib/utils'

const EMPTY = { items: [], count: 0, subtotal: 0, total: 0, status: 'shopping', receiptNo: null }

export default function CustomerDisplay() {
  const [s, setS] = useState(EMPTY)
  const [flash, setFlash] = useState(false)
  const prevCount = useRef(0)

  useEffect(() => {
    const sb = getSupabase(); if (!sb) return
    const ch = sb.channel('customer-display', { config: { broadcast: { self: true } } })
    ch.on('broadcast', { event: 'state' }, ({ payload }) => {
      setS(prev => ({ ...EMPTY, ...payload }))
      // flash the total when item count rises
      if ((payload.count || 0) > prevCount.current) { setFlash(true); setTimeout(() => setFlash(false), 350) }
      prevCount.current = payload.count || 0
      // auto-reset after a paid/thank-you screen
      if (payload.status === 'paid') {
        setTimeout(() => { setS(EMPTY); prevCount.current = 0 }, 6000)
      }
    })
    ch.subscribe()
    return () => { sb.removeChannel(ch) }
  }, [])

  // ─── PAID / THANK YOU ───
  if (s.status === 'paid') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-900 text-white px-6">
        <div className="w-28 h-28 rounded-full bg-green-500 flex items-center justify-center mb-8 animate-fade">
          <svg width="60" height="60" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
        </div>
        <h1 className="text-5xl md:text-6xl font-bold mb-4 font-heading">Thank You!</h1>
        <p className="text-xl text-white/60 mb-2">Payment received</p>
        <div className="text-4xl font-bold mt-4">{money(s.total)}</div>
        {s.receiptNo && <p className="text-white/40 mt-3 text-sm">Receipt {s.receiptNo}</p>}
        <p className="text-white/30 mt-10 text-sm">EVERYTINROOM · See you again soon</p>
      </div>
    )
  }

  // ─── SHOPPING / IDLE ───
  const empty = !s.items || s.items.length === 0

  return (
    <div className="min-h-screen flex flex-col bg-stone-50">
      {/* Header */}
      <header className="flex items-center gap-3 px-8 py-5 bg-gray-900 text-white">
        <img src="/logo.png" alt="" className="w-9 h-9 rounded-lg" onError={e => { e.target.style.display = 'none' }} />
        <span className="font-heading text-lg font-bold tracking-tight">EVERYTINROOM</span>
        {s.status === 'paying' && <span className="ml-auto text-sm font-semibold bg-blue-500 px-4 py-1.5 rounded-full">Complete payment on terminal</span>}
      </header>

      {empty ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center px-6">
          <img src="/logo.png" alt="" className="w-24 h-24 rounded-3xl mb-8 opacity-90" onError={e => { e.target.style.display = 'none' }} />
          <h1 className="text-4xl md:text-5xl font-bold font-heading text-gray-900 mb-4">Welcome</h1>
          <p className="text-xl text-stone-400">Your items will appear here as they're scanned</p>
        </div>
      ) : (
        <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
          {/* Items */}
          <div className="flex-1 overflow-y-auto p-6 lg:p-8">
            <div className="space-y-3 max-w-3xl mx-auto">
              {s.items.map((it, i) => (
                <div key={i} className="flex items-center gap-4 bg-white rounded-2xl p-4 shadow-sm">
                  <div className="w-16 h-16 lg:w-20 lg:h-20 rounded-xl bg-stone-100 overflow-hidden flex-shrink-0">
                    {it.image ? <img src={thumb(it.image, 200)} alt="" className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center text-stone-300 text-2xl">□</div>}
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

          {/* Total panel */}
          <div className="lg:w-96 bg-gray-900 text-white p-8 flex flex-col justify-end">
            <div className="space-y-3">
              <div className="flex justify-between text-white/50 text-lg">
                <span>Items</span><span>{s.count}</span>
              </div>
              <div className="h-px bg-white/10 my-2" />
              <div className="text-white/50 text-lg">Total</div>
              <div className={`text-6xl lg:text-7xl font-bold tabular-nums transition-transform duration-300 ${flash ? 'scale-110' : 'scale-100'}`}>{money(s.total)}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
