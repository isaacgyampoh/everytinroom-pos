import { useEffect, useState } from 'react'
import { useStore } from '../hooks/useStore'
import { getSupabase } from '../lib/supabase'
import { money } from '../lib/utils'

export default function Dashboard() {
  const { waOrders } = useStore()
  const [data, setData] = useState({ todaySales: 0, todayProfit: 0, todayCount: 0, pendingOrders: 0, paystackOrders: 0 })

  useEffect(() => {
    (async () => {
      const sb = getSupabase(); if (!sb) return
      try {
        const { data: d } = await sb.rpc('get_dashboard')
        if (d) setData(d)
      } catch {}
    })()
  }, [waOrders])

  const stats = [
    { icon: '💰', label: 'Today Sales', value: money(data.todaySales) },
    { icon: '💵', label: 'Today Profit', value: money(data.todayProfit) },
    { icon: '📱', label: 'Pending Orders', value: data.pendingOrders },
    { icon: '💳', label: 'Paystack Orders', value: data.paystackOrders },
  ]

  return (
    <div className="animate-fade">
      <div className="mb-7"><h1 className="text-3xl font-extrabold">Dashboard</h1><p className="text-gray-500 text-[15px]">Business overview</p></div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {stats.map((s, i) => (
          <div key={i} className="bg-white rounded-3xl p-6 shadow-md shadow-brand-500/5">
            <div className="text-4xl mb-4">{s.icon}</div>
            <div className="text-[13px] font-semibold text-gray-400 uppercase">{s.label}</div>
            <div className="text-2xl font-extrabold mt-1">{s.value}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
