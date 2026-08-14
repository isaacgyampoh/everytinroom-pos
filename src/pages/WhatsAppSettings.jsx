import { useState, useEffect } from 'react'
import { getSupabase } from '../lib/supabase'
import toast from 'react-hot-toast'

// WhatsApp AI agent settings. Shows connection status + master on/off.
// The WaSender + OpenAI keys live in Supabase secrets (never in the browser) —
// this page checks the agent is reachable and lets you flip the master switch.
const AGENT_URL = 'https://noiiuwkovoojkcwzupye.supabase.co/functions/v1/wa-agent'

export default function WhatsAppSettings() {
  const sb = getSupabase()
  const [masterOn, setMasterOn] = useState(true)
  const [status, setStatus] = useState('checking')  // checking | online | offline
  const [convoCount, setConvoCount] = useState(0)
  const [loading, setLoading] = useState(true)

  const check = async () => {
    // 1. Is the agent function deployed & reachable?
    try {
      const r = await fetch(AGENT_URL + '?action=ping')
      setStatus(r.ok ? 'online' : 'offline')
    } catch { setStatus('offline') }
    // 2. Master switch + conversation count from DB
    try {
      const { data } = await sb.from('wa_agent_settings').select('value').eq('key', 'agent_master_enabled').maybeSingle()
      setMasterOn(data?.value === 'true')
      const { count } = await sb.from('wa_conversations').select('*', { count: 'exact', head: true })
      setConvoCount(count || 0)
    } catch {}
    setLoading(false)
  }
  useEffect(() => { check() }, []) // eslint-disable-line

  const toggleMaster = async () => {
    const next = !masterOn
    const { error } = await sb.from('wa_agent_settings').update({ value: next ? 'true' : 'false' }).eq('key', 'agent_master_enabled')
    if (error) { toast.error('Could not update. Run the agent SQL setup first.'); return }
    setMasterOn(next)
    toast.success(next ? 'AI agent turned ON' : 'AI agent turned OFF')
  }

  const Dot = ({ ok }) => <span className={`inline-block w-2.5 h-2.5 rounded-full ${ok ? 'bg-green-500' : 'bg-red-400'}`} />

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-6">
        <h1 className="text-[22px] md:text-[26px] font-bold">WhatsApp AI Agent</h1>
        <p className="text-xs text-gray-500 mt-1">Connection status and controls for your automated WhatsApp sales rep</p>
      </div>

      {loading ? <p className="text-sm text-gray-400 py-10 text-center">Checking connection…</p> : (
      <div className="space-y-4">
        {/* Status card */}
        <div className="bg-white rounded-2xl p-5 shadow-md">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-bold text-gray-800">Agent status</div>
              <div className="text-xs text-gray-400 mt-0.5">Is the WhatsApp agent deployed and reachable?</div>
            </div>
            <div className="flex items-center gap-2">
              <Dot ok={status === 'online'} />
              <span className={`text-sm font-bold ${status === 'online' ? 'text-green-600' : 'text-red-500'}`}>{status === 'online' ? 'Online' : status === 'checking' ? 'Checking…' : 'Not reachable'}</span>
            </div>
          </div>
          {status === 'offline' && (
            <div className="mt-3 text-[11px] text-red-500 bg-red-50 rounded-lg p-3">
              The agent function isn't reachable. Make sure the <b>wa-agent</b> function is deployed in Supabase with <b>Verify JWT off</b>, and that the WaSender + OpenAI secrets are set.
            </div>
          )}
        </div>

        {/* Master switch */}
        <div className="bg-white rounded-2xl p-5 shadow-md flex items-center justify-between">
          <div>
            <div className="text-sm font-bold text-gray-800">AI replies</div>
            <div className="text-xs text-gray-400 mt-0.5">When ON, the agent answers customers automatically</div>
          </div>
          <button onClick={toggleMaster} className={`relative w-14 h-8 rounded-full transition ${masterOn ? 'bg-green-500' : 'bg-gray-300'}`}>
            <span className={`absolute top-1 w-6 h-6 bg-white rounded-full transition-all ${masterOn ? 'left-7' : 'left-1'}`} />
          </button>
        </div>

        {/* Stats */}
        <div className="bg-white rounded-2xl p-5 shadow-md">
          <div className="text-sm font-bold text-gray-800 mb-1">Conversations</div>
          <div className="text-3xl font-black text-gray-900">{convoCount}</div>
          <div className="text-xs text-gray-400">customers the agent remembers</div>
        </div>

        {/* Setup checklist */}
        <div className="bg-gray-50 rounded-2xl p-5 border border-gray-100">
          <div className="text-sm font-bold text-gray-700 mb-3">Connection setup</div>
          <ol className="space-y-2 text-xs text-gray-600 list-decimal list-inside">
            <li>Run the agent SQL setup in Supabase (creates memory tables).</li>
            <li>Deploy the <b>wa-agent</b> function, <b>Verify JWT off</b>.</li>
            <li>In Supabase → Edge Functions → Secrets, set <b>WASENDER_API_KEY</b> and <b>OPENAI_API_KEY</b>.</li>
            <li>In WaSender, set the webhook to the agent URL and enable "message received".</li>
            <li>Message your WhatsApp number to test — it appears under WhatsApp AI.</li>
          </ol>
          <p className="mt-3 text-[11px] text-gray-400">Your API keys are stored securely in Supabase and never shown here.</p>
        </div>

        <button onClick={() => { setLoading(true); check() }} className="w-full h-11 border border-gray-200 rounded-xl text-sm font-semibold text-gray-600">Re-check connection</button>
      </div>
      )}
    </div>
  )
}
