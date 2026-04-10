import { useState, useRef, useEffect } from 'react'
import { useStore } from '../hooks/useStore'
import { getSupabase } from '../lib/supabase'

export default function Login() {
  const [pins, setPins] = useState(['', '', '', ''])
  const [error, setError] = useState(false)
  const [loading, setLoading] = useState(false)
  const refs = [useRef(), useRef(), useRef(), useRef()]
  const { login, setPage } = useStore()

  useEffect(() => { refs[0].current?.focus() }, [])

  const handleInput = (i, val) => {
    if (!/^\d*$/.test(val)) return
    const p = [...pins]; p[i] = val.slice(-1); setPins(p)
    if (val && i < 3) refs[i + 1].current?.focus()
    if (i === 3 && val) tryLogin(p.join(''))
  }

  const handleKeyDown = (i, e) => {
    if (e.key === 'Backspace' && !pins[i] && i > 0) refs[i - 1].current?.focus()
  }

  const tryLogin = async (pin) => {
    setLoading(true)
    try {
      const sb = getSupabase()
      const { data } = await sb.rpc('verify_pin', { p_pin: pin })
      if (data?.success) {
        const isAdmin = data.role === 'Admin'
        login({ id: data.id, name: data.name, role: data.role }, isAdmin)
        setPage(isAdmin ? 'dash' : 'pos')
        return
      }
    } catch {}
    setLoading(false)
    setError(true); setPins(['', '', '', '']); refs[0].current?.focus()
    setTimeout(() => setError(false), 2000)
  }

  const filled = pins.filter(p => p).length

  return (
    <div className="fixed inset-0 z-[1000] flex flex-col" style={{ background: '#0A0A0A' }}>
      <div className="flex-1 flex flex-col items-center justify-end pb-8 px-6">
        <div className="w-[72px] h-[72px] mb-5">
          <img src="/logo.png" alt="EverytnRoom" className="w-full h-full rounded-[18px] object-cover" />
        </div>
        <h1 className="text-white text-[22px] font-semibold tracking-[-0.02em]" style={{ fontFamily: 'Outfit, sans-serif' }}>
          EVERYTINROOM
        </h1>
        <p className="text-[#666666] text-[13px] mt-1.5 font-medium">Point of Sale</p>
      </div>

      <div className="bg-[#161616] rounded-t-[28px] px-6 pt-8 pb-10 safe-bottom">
        <div className="max-w-[340px] mx-auto">
          <p className="text-[#888888] text-[14px] font-medium text-center mb-6">Enter your staff PIN</p>

          {error && (
            <div className="bg-[#3D1F1F] text-[#F87171] px-4 py-2.5 rounded-xl mb-5 text-[13px] font-medium text-center">
              Incorrect PIN
            </div>
          )}

          <div className="flex gap-3 justify-center mb-6">
            {pins.map((v, i) => (
              <div key={i} className="relative">
                <input ref={refs[i]} type="tel" inputMode="numeric" maxLength={1} value={v}
                  className="w-[60px] h-[60px] rounded-2xl text-[24px] font-semibold text-center text-transparent bg-[#1E1E1E] border-2 focus:outline-none transition-all duration-200"
                  style={{ borderColor: v ? '#ffffff' : i === filled ? '#404040' : '#2A2A2A', caretColor: 'transparent' }}
                  onChange={e => handleInput(i, e.target.value)}
                  onKeyDown={e => handleKeyDown(i, e)} />
                {v && <div className="absolute inset-0 flex items-center justify-center pointer-events-none"><div className="w-3 h-3 rounded-full bg-white" /></div>}
              </div>
            ))}
          </div>

          <div className="flex justify-center gap-1.5">
            {[0,1,2,3].map(i => (
              <div key={i} className="h-[3px] rounded-full transition-all duration-300" style={{ width: pins[i] ? 24 : 16, background: pins[i] ? '#ffffff' : '#2A2A2A' }} />
            ))}
          </div>

          {loading && <div className="flex justify-center mt-5"><div className="w-5 h-5 border-2 border-[#2A2A2A] border-t-[#ffffff] rounded-full animate-spin" /></div>}
        </div>
      </div>
    </div>
  )
}
