import { useState } from 'react'
import { useStore } from '../hooks/useStore'
import { getSupabase } from '../lib/supabase'
import { money, num, fmtDate, today, monthStart, isoDate } from '../lib/utils'
import Modal from '../components/Modal'
import toast from 'react-hot-toast'

export default function ExpensesPage() {
  const { expenses, refreshExpenses, setLoading } = useStore()
  const [modal, setModal] = useState(false)
  const [form, setForm] = useState({ date: '', category: 'Utilities', description: '', amount: '' })
  const moTotal = expenses.filter(e => isoDate(e.date) >= monthStart()).reduce((a, e) => a + e.amount, 0)

  const save = async () => {
    if (!num(form.amount)) { toast.error('Enter amount'); return }
    setLoading(true, 'Saving...'); const sb = getSupabase()
    await sb.from('expenses').insert({ date: form.date, category: form.category, description: form.description.trim(), amount: num(form.amount) })
    await refreshExpenses(); setLoading(false); setModal(false); toast.success('Added!')
  }
  const del = async (id) => {
    if (!confirm('Delete?')) return; setLoading(true); const sb = getSupabase()
    await sb.from('expenses').delete().eq('id', id)
    await refreshExpenses(); setLoading(false); toast.success('Deleted!')
  }

  return (
    <div >
      <div className="flex justify-between items-start flex-wrap gap-4 mb-6">
        <h1 className="text-[22px] md:text-[26px] font-bold">Expenses</h1>
        <button onClick={() => { setForm({ date: today(), category: 'Utilities', description: '', amount: '' }); setModal(true) }} className="h-12 px-5 bg-gray-800 text-white rounded-xl text-sm font-semibold">Add</button>
      </div>
      <div className="bg-gray-800 rounded-2xl p-5 text-white mb-6"><small className="text-sm opacity-80">This Month</small><strong className="block text-[22px] md:text-[26px] font-bold mt-2">{money(moTotal)}</strong></div>
      <div className="bg-white rounded-2xl p-6 shadow-md overflow-x-auto">
        <table className="w-full min-w-[400px]">
          <thead><tr><th className="p-3 bg-gray-50 text-left text-[11px] font-bold text-gray-500 uppercase">Date</th><th className="p-3 bg-gray-50 text-left text-[11px] font-bold text-gray-500 uppercase">Category</th><th className="p-3 bg-gray-50 text-left text-[11px] font-bold text-gray-500 uppercase">Description</th><th className="p-3 bg-gray-50 text-left text-[11px] font-bold text-gray-500 uppercase">Amount</th><th className="p-3 bg-gray-50"></th></tr></thead>
          <tbody>{expenses.length === 0 ? <tr><td colSpan={5} className="text-center py-12 text-gray-400">No expenses</td></tr> : expenses.map(e => (
            <tr key={e.id} className="border-b border-gray-50"><td className="p-3 text-sm">{fmtDate(e.date)}</td><td className="p-3"><span className="px-2.5 py-1 bg-red-50 text-red-500 rounded-lg text-[11px] font-bold">{e.category}</span></td><td className="p-3 text-sm">{e.description}</td><td className="p-3 text-sm font-bold text-red-500">{money(e.amount)}</td><td className="p-3"><button onClick={() => del(e.id)} className="h-9 px-3 bg-gray-800 text-white rounded-lg text-xs font-medium hover:bg-red-600 transition">Delete</button></td></tr>
          ))}</tbody>
        </table>
      </div>
      <Modal open={modal} onClose={() => setModal(false)} title="Add Expense"
        footer={<><button onClick={() => setModal(false)} className="h-12 px-5 border border-stone-300 rounded-xl text-sm font-semibold text-stone-600">Cancel</button><button onClick={save} className="flex-1 h-12 bg-gray-800 text-white rounded-xl text-sm font-bold">Add</button></>}>
        <div className="space-y-4">
          <div><label className="block text-xs font-semibold text-gray-500 mb-2">Date</label><input type="date" className="w-full h-13 px-4 bg-gray-50 border-2 border-gray-200 rounded-xl text-base" value={form.date} onChange={e => setForm({...form, date: e.target.value})} /></div>
          <div><label className="block text-xs font-semibold text-gray-500 mb-2">Category</label><select className="w-full h-13 px-4 bg-gray-50 border-2 border-gray-200 rounded-xl text-base" value={form.category} onChange={e => setForm({...form, category: e.target.value})}><option>Utilities</option><option>Rent</option><option>Supplies</option><option>Transport</option><option>Salaries</option><option>Other</option></select></div>
          <div><label className="block text-xs font-semibold text-gray-500 mb-2">Description</label><input className="w-full h-13 px-4 bg-gray-50 border-2 border-gray-200 rounded-xl text-base" value={form.description} onChange={e => setForm({...form, description: e.target.value})} /></div>
          <div><label className="block text-xs font-semibold text-gray-500 mb-2">Amount (GHS)</label><input type="number" className="w-full h-13 px-4 bg-gray-50 border-2 border-gray-200 rounded-xl text-base" value={form.amount} onChange={e => setForm({...form, amount: e.target.value})} /></div>
        </div>
      </Modal>
    </div>
  )
}
