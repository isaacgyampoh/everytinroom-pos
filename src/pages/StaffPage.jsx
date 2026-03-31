import { useState } from 'react'
import { useStore } from '../hooks/useStore'
import { getSupabase } from '../lib/supabase'
import Modal from '../components/Modal'
import toast from 'react-hot-toast'

export default function StaffPage() {
  const { staff, refreshStaff, setLoading } = useStore()
  const [modal, setModal] = useState(false)
  const [form, setForm] = useState({ id: '', name: '', role: 'Cashier', pin: '' })

  const openNew = () => { setForm({ id: '', name: '', role: 'Cashier', pin: '' }); setModal(true) }
  const openEdit = (s) => { setForm({ id: s.id, name: s.name, role: s.role, pin: '' }); setModal(true) }

  const save = async () => {
    if (!form.name.trim() || form.pin.length !== 4) { toast.error('Name & 4-digit PIN required'); return }
    setLoading(true, 'Saving...'); const sb = getSupabase()
    const data = { name: form.name.trim(), role: form.role, active: true }
    if (form.pin) data.pin = form.pin
    if (form.id) await sb.from('staff').update(data).eq('id', form.id)
    else await sb.from('staff').insert(data)
    await refreshStaff(); setLoading(false); setModal(false); toast.success('Saved!')
  }

  const del = async (id) => {
    if (!confirm('Delete?')) return; setLoading(true); const sb = getSupabase()
    await sb.from('staff').delete().eq('id', id)
    await refreshStaff(); setLoading(false); toast.success('Deleted!')
  }

  return (
    <div className="animate-fade">
      <div className="flex justify-between items-start flex-wrap gap-4 mb-6">
        <h1 className="text-3xl font-extrabold">Staff</h1>
        <button onClick={openNew} className="h-12 px-5 bg-brand-500 text-white rounded-xl text-sm font-semibold">Add</button>
      </div>
      <div className="bg-white rounded-3xl p-6 shadow-md overflow-x-auto">
        <table className="w-full min-w-[300px]">
          <thead><tr><th className="p-3 bg-gray-50 text-left text-[11px] font-bold text-gray-500 uppercase">Name</th><th className="p-3 bg-gray-50 text-left text-[11px] font-bold text-gray-500 uppercase">Role</th><th className="p-3 bg-gray-50 text-[11px] font-bold text-gray-500 uppercase">Actions</th></tr></thead>
          <tbody>{staff.map(s => (
            <tr key={s.id} className="border-b border-gray-50">
              <td className="p-3 text-sm font-semibold">{s.name}</td>
              <td className="p-3"><span className={`px-2.5 py-1 rounded-lg text-[11px] font-bold ${s.role === 'Admin' ? 'bg-gray-100 text-gray-600' : 'bg-green-50 text-green-500'}`}>{s.role}</span></td>
              <td className="p-3"><div className="flex gap-2 justify-center"><button onClick={() => openEdit(s)} className="h-9 px-3 border border-stone-300 rounded-lg text-xs font-medium text-stone-600 hover:bg-stone-100 transition">Edit</button><button onClick={() => del(s.id)} className="h-9 px-3 bg-red-500 text-white rounded-lg text-xs font-medium hover:bg-red-600 transition">Delete</button></div></td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      <Modal open={modal} onClose={() => setModal(false)} title={form.id ? 'Edit Staff' : 'Add Staff'}
        footer={<><button onClick={() => setModal(false)} className="h-12 px-5 border border-stone-300 rounded-xl text-sm font-semibold text-stone-600">Cancel</button><button onClick={save} className="flex-1 h-12 bg-brand-500 text-white rounded-xl text-sm font-bold">Save</button></>}>
        <div className="space-y-4">
          <div><label className="block text-xs font-semibold text-gray-500 mb-2">Name</label><input className="w-full h-13 px-4 bg-gray-50 border-2 border-gray-200 rounded-xl text-base" value={form.name} onChange={e => setForm({...form, name: e.target.value})} /></div>
          <div><label className="block text-xs font-semibold text-gray-500 mb-2">Role</label><select className="w-full h-13 px-4 bg-gray-50 border-2 border-gray-200 rounded-xl text-base" value={form.role} onChange={e => setForm({...form, role: e.target.value})}><option>Cashier</option><option>Admin</option></select></div>
          <div><label className="block text-xs font-semibold text-gray-500 mb-2">PIN (4 digits)</label><input type="tel" maxLength={4} className="w-full h-13 px-4 bg-gray-50 border-2 border-gray-200 rounded-xl text-base" value={form.pin} onChange={e => setForm({...form, pin: e.target.value})} /></div>
        </div>
      </Modal>
    </div>
  )
}
