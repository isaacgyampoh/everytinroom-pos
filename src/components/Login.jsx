import { useState, useRef, useEffect } from 'react'
import { useStore } from '../hooks/useStore'
import { getSupabase } from '../lib/supabase'

export default function Login() {
  const [pins, setPins] = useState(['', '', '', ''])
  const [error, setError] = useState(false)
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
    setError(true); setPins(['', '', '', '']); refs[0].current?.focus()
    setTimeout(() => setError(false), 2000)
  }

  return (
    <div className="fixed inset-0 bg-[#122c23] flex items-center justify-center p-6 z-[1000] overflow-hidden">

      {/* Subtle background */}
      <div className="absolute inset-0 bg-gradient-to-br from-[#122c23] via-[#1a3d30] to-[#0f241c]" />

      {/* Content */}
      <div className="text-center w-full max-w-[360px] relative z-10">
        <div className="mb-8">
          
          <h1 className="text-white text-4xl font-extrabold tracking-tight italic" style={{ fontFamily: 'Outfit, sans-serif' }}>Welcome Back</h1>
          <p className="text-white/40 text-sm mt-2">EVERYTINROOM & BEDTIME</p>
        </div>

        <div className="bg-white/10 backdrop-blur-md rounded-3xl p-8 border border-white/10">

          {error && (
            <div className="bg-red-500/20 border border-red-400/30 text-red-300 p-3 rounded-xl mb-5 text-sm font-semibold animate-fade">
              Invalid PIN. Try again.
            </div>
          )}

          <p className="text-white/50 text-sm mb-5">Enter your 4-digit staff PIN</p>

          <div className="flex gap-3.5 justify-center mb-6">
            {pins.map((v, i) => (
              <input key={i} ref={refs[i]} type="tel" inputMode="numeric" maxLength={1} value={v}
                className="w-[62px] h-[70px] border-2 border-white/15 rounded-2xl text-2xl font-bold text-center bg-white/5 text-white focus:outline-none focus:border-[#f97316] focus:bg-white/10 transition caret-[#f97316] placeholder:text-white/10"
                placeholder="·"
                onChange={e => handleInput(i, e.target.value)}
                onKeyDown={e => handleKeyDown(i, e)} />
            ))}
          </div>

          {/* PIN progress dots */}
          <div className="flex justify-center gap-2.5 mb-1">
            {pins.map((v, i) => (
              <div key={i} className={`w-2.5 h-2.5 rounded-full transition-all duration-200 ${v ? 'bg-[#f97316] scale-110' : 'bg-white/15'}`} />
            ))}
          </div>
        </div>

        <p className="text-white/20 text-xs mt-8 tracking-wider">Point of Sale System</p>
      </div>
    </div>
  )
}
