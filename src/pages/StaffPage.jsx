import { useState } from 'react'
import { useStore } from '../hooks/useStore'
import { getSupabase } from '../lib/supabase'
import Modal from '../components/Modal'
import toast from 'react-hot-toast'

const PERMISSIONS = [
  { key: 'sales', label: 'Sales', desc: 'Create & process sales' },
  { key: 'stock_taking', label: 'Stock Taking', desc: 'Print sheets, count, submit adjustments' },
  { key: 'product_receiving', label: 'Product Receiving', desc: 'Receive supplier deliveries' },
  { key: 'product_management', label: 'Product Management', desc: 'Add & edit products' },
  { key: 'inventory_view', label: 'Inventory View', desc: 'View stock & inventory reports' },
  { key: 'reports', label: 'Reports', desc: 'View permitted reports' },
]

const emptyForm = { id: '', name: '', role: 'Cashier', pin: '', permissions: ['sales'] }

export default function StaffPage() {
  const { staff, refreshStaff, setLoading } = useStore()
  const [modal, setModal] = useState(false)
  const [form, setForm] = useState(emptyForm)

  const openNew = () => { setForm(emptyForm); setModal(true) }
  const doEdit = (s) => {
    setForm({
      id: s.id, name: s.name, role: s.role, pin: '',
      permissions: Array.isArray(s.permissions) ? s.permissions : (s.role === 'Admin' ? ['admin'] : ['sales'])
    })
    setModal(true)
  }

  const togglePerm = (key) => {
    setForm(f => ({
      ...f,
      permissions: f.permissions.includes(key) ? f.permissions.filter(p => p !== key) : [...f.permissions, key]
    }))
  }

  const isAdminRole = form.role === 'Admin'

  const save = async () => {
    if (!form.name.trim()) { toast.error('Name is required'); return }
    if (!form.id && form.pin.length !== 4) { toast.error('4-digit PIN required'); return }
    if (form.pin && form.pin.length !== 4) { toast.error('PIN must be 4 digits'); return }
    if (form.pin) {
      const clash = staff.find(s => s.id !== form.id && s.pin === form.pin)
      if (clash) { toast.error(`PIN already used by ${clash.name}`); return }
    }
    setLoading(true, 'Saving...'); const sb = getSupabase()
    const perms = isAdminRole
      ? ['sales', 'stock_taking', 'product_receiving', 'product_management', 'inventory_view', 'reports', 'admin']
      : form.permissions
    const data = { name: form.name.trim(), role: form.role, active: true, permissions: perms }
    if (form.pin) data.pin = form.pin
    let err
    if (form.id) ({ error: err } = await sb.from('staff').update(data).eq('id', form.id))
    else ({ error: err } = await sb.from('staff').insert(data))
    if (err) { toast.error('Save failed: ' + err.message); setLoading(false); return }
    await refreshStaff(); setLoading(false); setModal(false); toast.success('Saved!')
  }

  const del = async (id) => {
    if (!confirm('Delete this staff member?')) return; setLoading(true); const sb = getSupabase()
    await sb.from('staff').delete().eq('id', id)
    await refreshStaff(); setLoading(false); toast.success('Deleted!')
  }

  const permSummary = (s) => {
    if (s.role === 'Admin') return 'Full access'
    const perms = Array.isArray(s.permissions) ? s.permissions : []
    if (perms.includes('admin')) return 'Full access'
    if (perms.length === 0) return 'No permissions'
    return perms.map(p => PERMISSIONS.find(x => x.key === p)?.label || p).join(', ')
  }

  return (
    <div>
      <div className="flex justify-between items-start flex-wrap gap-4 mb-6">
        <div>
          <h1 className="text-[22px] md:text-[26px] font-bold">Staff</h1>
          <p className="text-xs text-gray-500 mt-1">Control exactly what each staff member can do</p>
        </div>
        <button onClick={openNew} className="h-12 px-5 bg-gray-700 text-white rounded-xl text-sm font-semibold">Add Staff</button>
      </div>
      <div className="bg-white rounded-2xl p-6 shadow-md overflow-x-auto">
        <table className="w-full min-w-[400px]">
          <thead><tr>
            <th className="p-3 bg-gray-50 text-left text-[11px] font-bold text-gray-500 uppercase">Name</th>
            <th className="p-3 bg-gray-50 text-left text-[11px] font-bold text-gray-500 uppercase">Role</th>
            <th className="p-3 bg-gray-50 text-left text-[11px] font-bold text-gray-500 uppercase">Can do</th>
            <th className="p-3 bg-gray-50 text-[11px] font-bold text-gray-500 uppercase">Actions</th>
          </tr></thead>
          <tbody>{staff.map(s => (
            <tr key={s.id} className="border-b border-gray-50">
              <td className="p-3 text-sm font-semibold">{s.name}</td>
              <td className="p-3"><span className={`px-2.5 py-1 rounded-lg text-[11px] font-bold ${s.role === 'Admin' ? 'bg-gray-100 text-gray-600' : 'bg-green-50 text-green-500'}`}>{s.role}</span></td>
              <td className="p-3 text-[11px] text-gray-500 max-w-[240px]">{permSummary(s)}</td>
              <td className="p-3"><div className="flex gap-2 justify-center"><button onClick={() => doEdit(s)} className="h-9 px-3 border border-stone-300 rounded-lg text-xs font-medium text-stone-600 hover:bg-stone-100 transition">Edit</button><button onClick={() => del(s.id)} className="h-9 px-3 bg-red-500 text-white rounded-lg text-xs font-medium hover:bg-red-600 transition">Delete</button></div></td>
            </tr>
          ))}</tbody>
        </table>
      </div>

      <Modal open={modal} onClose={() => setModal(false)} title={form.id ? 'Edit Staff' : 'Add Staff'}
        footer={<><button onClick={() => setModal(false)} className="h-12 px-5 border border-stone-300 rounded-xl text-sm font-semibold text-stone-600">Cancel</button><button onClick={save} className="flex-1 h-12 bg-gray-700 text-white rounded-xl text-sm font-bold">Save</button></>}>
        <div className="space-y-4">
          <div><label className="block text-xs font-semibold text-gray-500 mb-2">Name</label><input className="w-full h-13 px-4 bg-gray-50 border-2 border-gray-200 rounded-xl text-base" value={form.name} onChange={e => setForm({...form, name: e.target.value})} /></div>
          <div><label className="block text-xs font-semibold text-gray-500 mb-2">Role</label><select className="w-full h-13 px-4 bg-gray-50 border-2 border-gray-200 rounded-xl text-base" value={form.role} onChange={e => setForm({...form, role: e.target.value})}><option>Cashier</option><option>Admin</option></select></div>
          <div><label className="block text-xs font-semibold text-gray-500 mb-2">PIN (4 digits){form.id ? ' — leave blank to keep current' : ''}</label><input type="tel" maxLength={4} className="w-full h-13 px-4 bg-gray-50 border-2 border-gray-200 rounded-xl text-base" value={form.pin} onChange={e => setForm({...form, pin: e.target.value.replace(/\D/g,'')})} placeholder={form.id ? '••••' : ''} /></div>

          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-2">Permissions</label>
            {isAdminRole ? (
              <div className="rounded-xl bg-gray-50 border-2 border-gray-200 p-4 text-sm text-gray-600">
                Admins have <span className="font-bold">full access</span> to everything.
              </div>
            ) : (
              <div className="space-y-2">
                {PERMISSIONS.map(p => (
                  <button key={p.key} type="button" onClick={() => togglePerm(p.key)}
                    className={`w-full flex items-center gap-3 p-3 rounded-xl border-2 text-left transition ${form.permissions.includes(p.key) ? 'border-green-500 bg-green-50' : 'border-gray-200 bg-gray-50'}`}>
                    <div className={`w-5 h-5 rounded-md flex items-center justify-center shrink-0 ${form.permissions.includes(p.key) ? 'bg-green-500' : 'bg-white border-2 border-gray-300'}`}>
                      {form.permissions.includes(p.key) && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3"><path d="M20 6L9 17l-5-5"/></svg>}
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-gray-800">{p.label}</div>
                      <div className="text-[11px] text-gray-500">{p.desc}</div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </Modal>
    </div>
  )
}
