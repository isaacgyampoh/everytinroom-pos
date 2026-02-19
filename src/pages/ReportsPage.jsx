import { useStore } from '../hooks/useStore'
import { money, num, today, weekStartDate, monthStart, isoDate } from '../lib/utils'

export default function ReportsPage() {
  const { sales } = useStore()
  const t = today(), ws = weekStartDate(), ms = monthStart()
  const calc = (arr) => { let total = 0, cash = 0, momo = 0, profit = 0, txn = 0; for (const s of arr) { if (s.voided) continue; total += s.total; profit += s.profit; txn++; if (s.payment === 'Cash') cash += s.total; else momo += s.total }; return { total, cash, momo, profit, txn } }
  const tb = calc(sales.filter(s => isoDate(s.date) === t))
  const wb = calc(sales.filter(s => isoDate(s.date) >= ws && isoDate(s.date) <= t))
  const mb = calc(sales.filter(s => isoDate(s.date) >= ms && isoDate(s.date) <= t))

  const Section = ({ title, color, data }) => (
    <div className="bg-white rounded-3xl p-6 shadow-md mb-4" style={{ borderLeft: `5px solid ${color}` }}>
      <h3 className="text-lg font-bold mb-5 flex items-center gap-2.5">{title}</h3>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {data.map(([label, value, vc], i) => (
          <div key={i} className="bg-white rounded-3xl p-6 shadow-sm"><h4 className="text-sm font-semibold text-gray-500 mb-2">{label}</h4><div className="text-2xl font-extrabold" style={vc ? { color: vc } : {}}>{value}</div></div>
        ))}
      </div>
    </div>
  )

  return (
    <div className="animate-fade">
      <h1 className="text-3xl font-extrabold mb-6">📈 Reports</h1>
      <Section title="📅 Today" color="#0ea5e9" data={[['💰 Sales', money(tb.total)], ['💵 Cash', money(tb.cash), '#16a34a'], ['📱 Momo', money(tb.momo), '#ca8a04'], ['🧾 Transactions', tb.txn]]} />
      <Section title="📆 This Week" color="#22c55e" data={[['💰 Sales', money(wb.total)], ['💵 Profit', money(wb.profit), '#22c55e']]} />
      <Section title="📊 This Month" color="#f59e0b" data={[['💰 Sales', money(mb.total)], ['💵 Profit', money(mb.profit), '#22c55e']]} />
    </div>
  )
}
