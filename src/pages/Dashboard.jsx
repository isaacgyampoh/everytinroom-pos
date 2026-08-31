import { useStore } from '../hooks/useStore'
import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { money, moneyShort, today, weekStartDate, monthStart, isoDate } from '../lib/utils'

// The previous version computed a 7-day trend, an hourly distribution, a
// low-stock list and a recent-sales list — and rendered none of them. What it
// showed instead was a greeting, a line of filler copy, and eight identical
// rectangles. This renders the data that was already being calculated, and
// answers the questions a shopkeeper actually opens this page to ask:
// is today good, when is the shop busy, and what needs doing.

const Spark = ({ days, max }) => {
  const w = 100 / days.length
  return (
    <svg viewBox="0 0 100 34" preserveAspectRatio="none" className="w-full h-[46px]" aria-hidden="true">
      {days.map((d, i) => {
        const h = max > 0 ? Math.max(1.5, (d.revenue / max) * 30) : 1.5
        const isToday = i === days.length - 1
        return (
          <rect key={i} x={i * w + w * 0.22} y={32 - h} width={w * 0.56} height={h} rx="1"
            fill={isToday ? '#16181d' : 'rgba(22,24,29,.17)'} />
        )
      })}
    </svg>
  )
}

export default function Dashboard() {
  const { sales, expenses, products, waOrders, setPage, shopOpen, shopSettingLoaded, fetchShopOpen, setShopOpen } = useStore()
  const [toggling, setToggling] = useState(false)
  useEffect(() => { fetchShopOpen() }, []) // eslint-disable-line

  const onToggleShop = async () => {
    setToggling(true)
    const next = !shopOpen
    const res = await setShopOpen(next)
    setToggling(false)
    if (res?.ok) toast.success(next ? 'Online shop is now OPEN' : 'Online shop is now CLOSED')
    else toast.error('Could not save: ' + (res?.error || 'unknown error'))
  }

  const t = today(), ws = weekStartDate(), ms = monthStart()
  const live = sales.filter(s => !s.voided)
  const todaySales = live.filter(s => isoDate(s.date) === t)
  const weekSales = live.filter(s => isoDate(s.date) >= ws)
  const monthSales = live.filter(s => isoDate(s.date) >= ms)

  const todayRev = todaySales.reduce((a, s) => a + s.total, 0)
  const weekRev = weekSales.reduce((a, s) => a + s.total, 0)
  const monthRev = monthSales.reduce((a, s) => a + s.total, 0)
  const todayProfit = todaySales.reduce((a, s) => a + s.profit, 0)
  const monthProfit = monthSales.reduce((a, s) => a + s.profit, 0)
  const todayExp = expenses.filter(e => isoDate(e.date) === t).reduce((a, e) => a + e.amount, 0)
  const monthExp = expenses.filter(e => isoDate(e.date) >= ms).reduce((a, e) => a + e.amount, 0)

  // Last 7 days, oldest first. Today is the last bar.
  const last7 = []
  for (let i = 6; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i)
    const ds = d.toISOString().slice(0, 10)
    const day = live.filter(s => isoDate(s.date) === ds)
    last7.push({
      label: d.toLocaleDateString('en-GB', { weekday: 'narrow' }),
      full: d.toLocaleDateString('en-GB', { weekday: 'short' }),
      date: ds,
      revenue: day.reduce((a, s) => a + s.total, 0),
      count: day.length,
    })
  }
  const maxRev = Math.max(...last7.map(d => d.revenue), 1)

  // "Is today good?" needs a baseline, not just a number. Compare against the
  // average of the six days before it, ignoring days the shop took nothing.
  const priorDays = last7.slice(0, 6).filter(d => d.revenue > 0)
  const baseline = priorDays.length ? priorDays.reduce((a, d) => a + d.revenue, 0) / priorDays.length : 0
  const delta = baseline > 0 ? ((todayRev - baseline) / baseline) * 100 : null

  // Trading pattern — when the shop is actually busy. Useful for rostering.
  const hourMap = {}
  todaySales.forEach(s => { const h = new Date(s.date).getHours(); hourMap[h] = (hourMap[h] || 0) + 1 })
  const hours = Array.from({ length: 13 }, (_, i) => i + 7) // 07:00–19:00
  const maxHour = Math.max(...hours.map(h => hourMap[h] || 0), 1)
  const peak = hours.reduce((best, h) => (hourMap[h] || 0) > (hourMap[best] || 0) ? h : best, hours[0])

  const monthCash = monthSales.filter(s => s.payment === 'Cash').reduce((a, s) => a + s.total, 0)
  const monthMomo = monthSales.filter(s => s.payment === 'Momo' || s.payment === 'Paystack').reduce((a, s) => a + s.total, 0)
  const monthSplit = monthSales.filter(s => s.payment === 'Split').reduce((a, s) => a + s.total, 0)
  const margin = monthRev > 0 ? (monthProfit / monthRev) * 100 : 0

  const outOfStock = products.filter(p => p.quantity === 0)
  const lowStock = products.filter(p => p.quantity > 0 && p.quantity <= 5).sort((a, b) => a.quantity - b.quantity)
  const pendingOrders = waOrders.filter(o => o.status === 'Pending' || o.status === 'Paid')
  const stockValue = products.reduce((a, p) => a + p.price * p.quantity, 0)

  // Top movers this week, by units.
  const movers = {}
  for (const s of weekSales) {
    for (const it of (s.items || [])) {
      const n = it.name || 'Unknown'
      movers[n] = (movers[n] || 0) + Number(it.qty || 0)
    }
  }
  const topMovers = Object.entries(movers).sort((a, b) => b[1] - a[1]).slice(0, 5)

  const recent = live.slice(0, 6)
  const dateLine = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })

  return (
    <div className="max-w-[1180px]">

      {/* ── Header: what day it is, and whether the online shop is taking orders.
             The shop toggle used to be a full-width card of its own; it is a
             switch, so it lives inline. ─────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4 flex-wrap mb-6">
        <div>
          <h1 className="text-[24px] md:text-[28px] font-bold tracking-tight leading-none">Today</h1>
          <p className="text-[13px] text-gray-400 mt-1.5">{dateLine}</p>
        </div>
        <button onClick={onToggleShop} disabled={toggling || !shopSettingLoaded}
          className="panel flex items-center gap-3 h-11 pl-3.5 pr-2 disabled:opacity-50 transition hover:border-gray-300">
          <span className={`w-2 h-2 rounded-full ${shopOpen ? 'bg-emerald-500' : 'bg-gray-300'}`} />
          <span className="text-[13px] font-semibold text-gray-700">
            {!shopSettingLoaded ? 'Checking…' : shopOpen ? 'Online shop open' : 'Online shop closed'}
          </span>
          <span className={`relative w-11 h-6 rounded-full transition-colors ${shopOpen ? 'bg-[#16181d]' : 'bg-gray-300'}`}>
            <span className={`absolute top-[3px] w-[18px] h-[18px] bg-white rounded-full shadow-sm transition-all ${shopOpen ? 'left-[23px]' : 'left-[3px]'}`} />
          </span>
        </button>
      </div>

      <div className="grid lg:grid-cols-3 gap-4 mb-4">

        {/* ── The headline. One number, at a size you can read standing up,
               with the context that makes it mean something. ────────────── */}
        <div className="panel panel-pad lg:col-span-2 flex flex-col justify-between">
          <div className="flex items-start justify-between gap-6">
            <div>
              <div className="panel-head">Taken today</div>
              <div className="flex items-baseline gap-2.5 mt-2.5">
                <span className="text-[13px] font-semibold text-gray-400">GHS</span>
                <span className="figure text-[42px] md:text-[54px] text-gray-900">{moneyShort(todayRev)}</span>
              </div>
              <div className="flex items-center gap-2.5 mt-3 text-[12px]">
                <span className="text-gray-500 font-medium">{todaySales.length} sale{todaySales.length === 1 ? '' : 's'}</span>
                {delta !== null && (
                  <>
                    <span className="text-gray-300">·</span>
                    <span className={`font-semibold ${delta >= 0 ? 'text-emerald-600' : 'text-[#b3402b]'}`}>
                      {delta >= 0 ? '▲' : '▼'} {Math.abs(delta).toFixed(0)}%
                    </span>
                    <span className="text-gray-400">vs usual day</span>
                  </>
                )}
              </div>
            </div>
            <div className="text-right shrink-0">
              <div className="panel-head">Profit</div>
              <div className="figure text-[24px] mt-2 text-gray-900">{money(todayProfit)}</div>
              <div className={`text-[12px] font-semibold mt-1.5 ${todayProfit - todayExp >= 0 ? 'text-gray-500' : 'text-[#b3402b]'}`}>
                {money(todayProfit - todayExp)} after expenses
              </div>
            </div>
          </div>

          {/* Seven days, today highlighted. This is the trend the old page
              calculated and then discarded. */}
          <div className="mt-6">
            <Spark days={last7} max={maxRev} />
            <div className="flex mt-1.5">
              {last7.map((d, i) => (
                <div key={i} className="flex-1 text-center">
                  <div className={`text-[10px] font-bold ${i === last7.length - 1 ? 'text-gray-900' : 'text-gray-300'}`}>{d.full}</div>
                  <div className={`text-[10px] tnum ${i === last7.length - 1 ? 'text-gray-500' : 'text-gray-300'}`}>{d.revenue ? moneyShort(d.revenue) : '–'}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── Things that need a person. Named, not counted: "4 low stock" is
               a statistic, "Fluffy doormat — 2 left" is an instruction. ─── */}
        <div className="panel panel-pad">
          <div className="panel-head mb-3.5">Needs attention</div>

          {pendingOrders.length === 0 && outOfStock.length === 0 && lowStock.length === 0 ? (
            <div className="flex items-center gap-2.5 py-6 text-[13px] text-gray-400">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Nothing outstanding
            </div>
          ) : (
            <div className="space-y-2.5">
              {pendingOrders.length > 0 && (
                <button onClick={() => setPage('whatsapp')} className="w-full flex items-center justify-between gap-3 py-2 text-left group">
                  <span className="text-[13px] font-semibold text-gray-800 group-hover:text-black">
                    {pendingOrders.length} order{pendingOrders.length === 1 ? '' : 's'} to pack
                  </span>
                  <span className="text-[11px] text-gray-400 group-hover:text-gray-600">Open →</span>
                </button>
              )}

              {outOfStock.length > 0 && (
                <div className="rule pt-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[12px] font-bold text-[#b3402b]">{outOfStock.length} out of stock</span>
                    <button onClick={() => setPage('products')} className="text-[11px] text-gray-400 hover:text-gray-600">Restock →</button>
                  </div>
                  <div className="mt-1.5 space-y-1">
                    {outOfStock.slice(0, 3).map(p => (
                      <div key={p.id} className="text-[12px] text-gray-500 truncate">{p.name}</div>
                    ))}
                    {outOfStock.length > 3 && <div className="text-[11px] text-gray-300">+{outOfStock.length - 3} more</div>}
                  </div>
                </div>
              )}

              {lowStock.length > 0 && (
                <div className="rule pt-2.5">
                  <span className="text-[12px] font-bold text-amber-600">{lowStock.length} running low</span>
                  <div className="mt-1.5 space-y-1">
                    {lowStock.slice(0, 4).map(p => (
                      <div key={p.id} className="flex items-center justify-between gap-3 text-[12px]">
                        <span className="text-gray-500 truncate">{p.name}</span>
                        <span className="tnum font-bold text-gray-700 shrink-0">{p.quantity}</span>
                      </div>
                    ))}
                    {lowStock.length > 4 && <div className="text-[11px] text-gray-300">+{lowStock.length - 4} more</div>}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Period figures. A compact strip, not four more big cards. ───── */}
      <div className="panel mb-4 grid grid-cols-2 md:grid-cols-4 divide-x divide-y md:divide-y-0 divide-[rgba(16,24,29,.07)]">
        {[
          { label: 'This week', value: money(weekRev), sub: `${weekSales.length} sales` },
          { label: 'This month', value: money(monthRev), sub: `${monthSales.length} sales` },
          { label: 'Month margin', value: margin.toFixed(1) + '%', sub: money(monthProfit) + ' profit', tone: margin >= 30 ? 'text-emerald-600' : margin >= 15 ? 'text-amber-600' : 'text-[#b3402b]' },
          { label: 'Stock on hand', value: money(stockValue), sub: `${products.length} products` },
        ].map((c, i) => (
          <div key={i} className="px-5 py-4">
            <div className="panel-head">{c.label}</div>
            <div className={`figure text-[19px] mt-2 ${c.tone || 'text-gray-900'}`}>{c.value}</div>
            <div className="text-[11px] text-gray-400 mt-1">{c.sub}</div>
          </div>
        ))}
      </div>

      <div className="grid lg:grid-cols-3 gap-4">

        {/* ── When the shop is busy. Also previously computed, never shown. */}
        <div className="panel panel-pad">
          <div className="flex items-baseline justify-between mb-4">
            <span className="panel-head">Trading pattern</span>
            {todaySales.length > 0 && (
              <span className="text-[11px] font-semibold text-gray-500">busiest {String(peak).padStart(2, '0')}:00</span>
            )}
          </div>
          {todaySales.length === 0 ? (
            <p className="text-[13px] text-gray-400 py-6">No sales yet today.</p>
          ) : (
            <>
              <div className="flex items-end gap-[3px] h-[70px]">
                {hours.map(h => {
                  const n = hourMap[h] || 0
                  return (
                    <div key={h} className="flex-1 flex flex-col justify-end h-full" title={`${h}:00 — ${n} sale${n === 1 ? '' : 's'}`}>
                      <div className={`w-full rounded-[2px] ${n ? (h === peak ? 'bg-[#16181d]' : 'bg-gray-300') : 'bg-gray-100'}`}
                        style={{ height: `${Math.max(3, (n / maxHour) * 100)}%` }} />
                    </div>
                  )
                })}
              </div>
              <div className="flex justify-between mt-2 text-[10px] text-gray-300 font-medium">
                <span>7am</span><span>1pm</span><span>7pm</span>
              </div>
            </>
          )}
        </div>

        {/* ── What is actually moving. ─────────────────────────────────── */}
        <div className="panel panel-pad">
          <div className="panel-head mb-3.5">Top sellers this week</div>
          {topMovers.length === 0 ? (
            <p className="text-[13px] text-gray-400 py-6">Nothing sold yet this week.</p>
          ) : (
            <div className="space-y-2.5">
              {topMovers.map(([name, qty], i) => (
                <div key={name} className="flex items-center gap-3">
                  <span className="text-[11px] font-bold text-gray-300 w-3 tnum">{i + 1}</span>
                  <span className="flex-1 text-[13px] text-gray-700 truncate">{name}</span>
                  <span className="text-[13px] font-bold text-gray-900 tnum">{qty}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── How the money came in, and what it cost to run the month. ── */}
        <div className="panel panel-pad">
          <div className="panel-head mb-3.5">How customers paid</div>
          {monthRev === 0 ? (
            <p className="text-[13px] text-gray-400 py-6">No sales this month yet.</p>
          ) : (
            <>
              <div className="flex h-2.5 rounded-full overflow-hidden bg-gray-100 mb-3.5">
                {[
                  { v: monthCash, c: '#16181d' },
                  { v: monthMomo, c: '#5f6163' },
                  { v: monthSplit, c: '#b8bab8' },
                ].map((seg, i) => seg.v > 0 && (
                  <div key={i} style={{ width: `${(seg.v / monthRev) * 100}%`, background: seg.c }} />
                ))}
              </div>
              <div className="space-y-2">
                {[
                  { label: 'Cash', v: monthCash, c: '#16181d' },
                  { label: 'MoMo', v: monthMomo, c: '#5f6163' },
                  { label: 'Split', v: monthSplit, c: '#b8bab8' },
                ].map(r => (
                  <div key={r.label} className="flex items-center gap-2.5 text-[12px]">
                    <span className="w-2 h-2 rounded-sm shrink-0" style={{ background: r.c }} />
                    <span className="flex-1 text-gray-500">{r.label}</span>
                    <span className="tnum font-semibold text-gray-800">{money(r.v)}</span>
                  </div>
                ))}
              </div>
              <div className="rule mt-3.5 pt-3 space-y-1.5">
                <div className="flex justify-between text-[12px]">
                  <span className="text-gray-400">Expenses</span>
                  <span className="tnum font-semibold text-[#b3402b]">−{money(monthExp)}</span>
                </div>
                <div className="flex justify-between text-[13px]">
                  <span className="font-semibold text-gray-600">Net this month</span>
                  <span className={`tnum font-bold ${monthProfit - monthExp >= 0 ? 'text-gray-900' : 'text-[#b3402b]'}`}>
                    {money(monthProfit - monthExp)}
                  </span>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Latest sales. Was computed and discarded. ──────────────────── */}
      {recent.length > 0 && (
        <div className="panel mt-4">
          <div className="flex items-center justify-between px-5 pt-4 pb-3">
            <span className="panel-head">Latest sales</span>
            <button onClick={() => setPage('receipts')} className="text-[11px] font-semibold text-gray-400 hover:text-gray-700">All receipts →</button>
          </div>
          <div className="rule">
            {recent.map(s => (
              <div key={s.id} className="flex items-center gap-4 px-5 py-2.5 border-b border-[rgba(16,24,29,.05)] last:border-0">
                <span className="text-[12px] font-mono text-gray-400 w-[104px] shrink-0 truncate">{s.receiptNo}</span>
                <span className="text-[12px] text-gray-500 flex-1 truncate">{s.cashier || '—'}</span>
                <span className="text-[11px] text-gray-400 w-16 shrink-0">{s.payment}</span>
                <span className="text-[13px] font-bold text-gray-900 tnum shrink-0">{money(s.total)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
