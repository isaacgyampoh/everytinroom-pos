// Performance
import { useStore } from '../hooks/useStore'
import { money, num, today, weekStartDate, monthStart, isoDate } from '../lib/utils'

export default function PerformancePage() {
  const { sales, staff, perfPeriod, setPerfPeriod } = useStore()
  const range = perfPeriod === 'today' ? { from: today(), to: today() } : perfPeriod === 'week' ? { from: weekStartDate(), to: today() } : { from: monthStart(), to: today() }
  const names = new Set(); sales.forEach(s => { if (s.cashier) names.add(s.cashier) }); staff.forEach(s => names.add(s.name))
  const colors = ['#0ea5e9', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899']
  let ci = 0

  return (
    <div className="animate-fade">
      <h1 className="text-3xl font-extrabold mb-6">👥 Staff Sales</h1>
      <div className="flex gap-2.5 mb-6">
        {[['today', '📅 Today'], ['week', '📆 Week'], ['month', '📊 Month']].map(([p, l]) => (
          <button key={p} onClick={() => setPerfPeriod(p)} className={`h-11 px-5 rounded-xl text-sm font-semibold border-2 transition ${perfPeriod === p ? 'bg-brand-500 text-white border-transparent' : 'bg-white border-gray-200 text-gray-500'}`}>{l}</button>
        ))}
      </div>
      {[...names].map(name => {
        if (!name) return null
        const ss = sales.filter(s => !s.voided && isoDate(s.date) >= range.from && isoDate(s.date) <= range.to && s.cashier === name)
        if (!ss.length && !staff.find(s => s.name === name)) return null
        let rev = 0, prof = 0, cash = 0, momo = 0
        ss.forEach(s => { rev += s.total; prof += s.profit; if (s.payment === 'Cash') cash += s.total; else momo += s.total })
        const color = colors[ci++ % colors.length]
        return (
          <div key={name} className="bg-white rounded-3xl p-6 mb-4 shadow-md" style={{ borderLeft: `5px solid ${color}` }}>
            <div className="flex justify-between items-center flex-wrap gap-3 mb-5">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-full flex items-center justify-center text-xl font-bold text-white" style={{ background: color }}>{name.charAt(0)}</div>
                <span className="text-xl font-extrabold">{name}</span>
              </div>
              <span className="px-3 py-1 bg-brand-50 text-brand-500 rounded-lg text-xs font-bold">{ss.length} sales</span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[['Revenue', money(rev), color], ['Profit', money(prof), '#22c55e'], ['💵 Cash', money(cash), null], ['📱 Momo', money(momo), null]].map(([l, v, c], i) => (
                <div key={i} className="bg-gray-50 rounded-xl p-4 text-center">
                  <div className="text-[11px] font-bold text-gray-400 uppercase mb-1.5">{l}</div>
                  <div className="text-xl font-extrabold" style={c ? { color: c } : {}}>{v}</div>
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
