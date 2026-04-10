import { useState } from 'react'
import { saveConfig } from '../lib/supabase'
import toast from 'react-hot-toast'

export default function ConfigModal({ onConnect }) {
  const [url, setUrl] = useState('')
  const [key, setKey] = useState('')

  const handleSave = () => {
    if (!url.trim() || !key.trim()) { toast.error('Enter both URL and key'); return }
    saveConfig(url.trim(), key.trim())
    onConnect()
  }

  return (
    <div className="fixed inset-0 z-[500] flex items-center justify-center p-6 bg-black/50">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-lg animate-fade">
        <div className="p-6 border-b border-gray-100">
          <h3 className="text-xl font-bold">⚙️ Supabase Setup</h3>
        </div>
        <div className="p-6 space-y-4">
          <p className="text-gray-500 text-sm">Enter your Supabase credentials (Settings → API)</p>
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-2">Project URL</label>
            <input className="w-full h-13 px-4 bg-gray-50 border-2 border-gray-200 rounded-xl text-base font-medium focus:outline-none focus:border-gray-400" placeholder="https://xxxxx.supabase.co" value={url} onChange={e => setUrl(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-2">Anon Key</label>
            <input className="w-full h-13 px-4 bg-gray-50 border-2 border-gray-200 rounded-xl text-base font-medium focus:outline-none focus:border-gray-400" placeholder="eyJhbGciOiJIUzI1NiIs..." value={key} onChange={e => setKey(e.target.value)} />
          </div>
        </div>
        <div className="p-6 border-t border-gray-100">
          <button onClick={handleSave} className="w-full h-14 bg-gray-800 text-white rounded-xl text-base font-bold hover:bg-gray-700 active:scale-[.97] transition">Connect</button>
        </div>
      </div>
    </div>
  )
}
