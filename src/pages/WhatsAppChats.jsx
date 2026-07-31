import { useState, useEffect, useRef } from 'react'
import { getSupabase } from '../lib/supabase'
import toast from 'react-hot-toast'

// WhatsApp AI agent — chat management. See conversations, spot flagged ones,
// take over (pause AI) or hand back to the AI, and read the transcript.
export default function WhatsAppChats() {
  const [convos, setConvos] = useState([])
  const [selected, setSelected] = useState(null)
  const [messages, setMessages] = useState([])
  const [loading, setLoading] = useState(true)
  const [masterOn, setMasterOn] = useState(true)
  const [filter, setFilter] = useState('all') // all | flagged
  const pollRef = useRef(null)

  const sb = getSupabase()

  const loadConvos = async () => {
    const { data } = await sb.from('wa_conversations').select('*').order('last_message_at', { ascending: false }).limit(100)
    setConvos(data || [])
    setLoading(false)
  }
  const loadMaster = async () => {
    const { data } = await sb.from('wa_agent_settings').select('value').eq('key', 'agent_master_enabled').maybeSingle()
    setMasterOn(data?.value === 'true')
  }
  const loadMessages = async (phone) => {
    const { data } = await sb.from('wa_messages').select('*').eq('phone', phone).order('created_at', { ascending: true }).limit(200)
    setMessages(data || [])
  }

  useEffect(() => {
    loadConvos(); loadMaster()
    pollRef.current = setInterval(() => { loadConvos(); if (selected) loadMessages(selected.phone) }, 8000)
    return () => clearInterval(pollRef.current)
  }, []) // eslint-disable-line

  useEffect(() => { if (selected) loadMessages(selected.phone) }, [selected]) // eslint-disable-line

  const toggleAgentForChat = async (conv, enable) => {
    await sb.from('wa_conversations').update({ agent_enabled: enable, needs_human: enable ? false : conv.needs_human }).eq('phone', conv.phone)
    toast.success(enable ? 'AI resumed for this chat' : 'You have taken over — AI paused')
    loadConvos()
    setSelected({ ...conv, agent_enabled: enable, needs_human: enable ? false : conv.needs_human })
  }
  const clearFlag = async (conv) => {
    await sb.from('wa_conversations').update({ needs_human: false }).eq('phone', conv.phone)
    loadConvos(); setSelected({ ...conv, needs_human: false })
  }
  const toggleMaster = async () => {
    const next = !masterOn
    await sb.from('wa_agent_settings').update({ value: next ? 'true' : 'false' }).eq('key', 'agent_master_enabled')
    setMasterOn(next)
    toast.success(next ? 'AI agent turned ON (all chats)' : 'AI agent turned OFF (all chats)')
  }

  const shown = filter === 'flagged' ? convos.filter(c => c.needs_human) : convos
  const flaggedCount = convos.filter(c => c.needs_human).length

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">WhatsApp Chats</h1>
          <p className="text-xs text-gray-500">AI sales agent — {convos.length} conversations{flaggedCount > 0 ? ` · ${flaggedCount} need you` : ''}</p>
        </div>
        <button onClick={toggleMaster} className={`h-9 px-4 rounded-lg text-xs font-bold ${masterOn ? 'bg-green-600 text-white' : 'bg-gray-200 text-gray-600'}`}>
          AI Agent: {masterOn ? 'ON' : 'OFF'}
        </button>
      </div>

      <div className="flex gap-2 mb-4">
        <button onClick={() => setFilter('all')} className={`h-8 px-4 rounded-lg text-xs font-semibold ${filter === 'all' ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-500'}`}>All</button>
        <button onClick={() => setFilter('flagged')} className={`h-8 px-4 rounded-lg text-xs font-semibold ${filter === 'flagged' ? 'bg-amber-500 text-white' : 'bg-gray-100 text-gray-500'}`}>Needs you {flaggedCount > 0 && `(${flaggedCount})`}</button>
      </div>

      {loading ? <p className="text-sm text-gray-400 py-10 text-center">Loading…</p> : (
      <div className="grid md:grid-cols-[320px_1fr] gap-4">
        {/* Conversation list */}
        <div className="space-y-2 max-h-[70vh] overflow-y-auto">
          {shown.length === 0 && <p className="text-sm text-gray-400 py-8 text-center">No conversations yet</p>}
          {shown.map(c => (
            <button key={c.phone} onClick={() => setSelected(c)} className={`w-full text-left p-3 rounded-xl border transition ${selected?.phone === c.phone ? 'border-gray-900 bg-gray-50' : 'border-gray-200 hover:border-gray-300'} ${c.needs_human ? 'ring-1 ring-amber-400' : ''}`}>
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-gray-900 truncate">{c.customer_name || c.phone}</span>
                {c.needs_human && <span className="text-[9px] font-bold bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">NEEDS YOU</span>}
                {!c.agent_enabled && !c.needs_human && <span className="text-[9px] font-bold bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">YOU</span>}
              </div>
              <div className="text-[11px] text-gray-400 truncate mt-0.5">{c.phone} · {c.stage}</div>
              {c.flag_reason && c.needs_human && <div className="text-[11px] text-amber-600 mt-1 truncate">⚠ {c.flag_reason}</div>}
            </button>
          ))}
        </div>

        {/* Transcript + controls */}
        <div className="border border-gray-200 rounded-xl flex flex-col max-h-[70vh]">
          {!selected ? <div className="flex-1 flex items-center justify-center text-sm text-gray-400 p-10">Select a conversation</div> : (
            <>
              <div className="p-3 border-b border-gray-100 flex items-center justify-between flex-wrap gap-2">
                <div>
                  <div className="text-sm font-bold text-gray-900">{selected.customer_name || selected.phone}</div>
                  <a href={`https://wa.me/${selected.phone}`} target="_blank" rel="noreferrer" className="text-[11px] text-green-600 font-medium">Open in WhatsApp →</a>
                </div>
                <div className="flex gap-2">
                  {selected.needs_human && <button onClick={() => clearFlag(selected)} className="h-8 px-3 rounded-lg text-[11px] font-semibold bg-gray-100 text-gray-600">Clear flag</button>}
                  {selected.agent_enabled
                    ? <button onClick={() => toggleAgentForChat(selected, false)} className="h-8 px-3 rounded-lg text-[11px] font-bold bg-blue-600 text-white">Take over (pause AI)</button>
                    : <button onClick={() => toggleAgentForChat(selected, true)} className="h-8 px-3 rounded-lg text-[11px] font-bold bg-green-600 text-white">Hand back to AI</button>}
                </div>
              </div>
              <div className="flex-1 overflow-y-auto p-3 space-y-2 bg-gray-50">
                {messages.map(m => (
                  <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-start' : 'justify-end'}`}>
                    <div className={`max-w-[75%] px-3 py-2 rounded-2xl text-sm ${m.role === 'user' ? 'bg-white border border-gray-200 text-gray-800' : 'bg-gray-900 text-white'}`}>
                      {m.media_url && <div className="text-[10px] opacity-60 mb-1">[image]</div>}
                      {m.content}
                    </div>
                  </div>
                ))}
                {messages.length === 0 && <p className="text-xs text-gray-400 text-center py-6">No messages</p>}
              </div>
              {!selected.agent_enabled && (
                <div className="p-3 border-t border-gray-100 bg-blue-50">
                  <p className="text-[11px] text-blue-700">You're handling this chat. Reply the customer directly in WhatsApp. When done, click "Hand back to AI".</p>
                </div>
              )}
            </>
          )}
        </div>
      </div>
      )}
    </div>
  )
}
