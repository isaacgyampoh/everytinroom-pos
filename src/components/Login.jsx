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
    <div className="fixed inset-0 z-[1000] flex items-center justify-center" style={{ background: '#0A0A0A' }}>
      
      {/* Background pattern */}
      <div className="absolute inset-0 opacity-[0.03]" style={{
        backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='1'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
      }} />

      <div className="relative z-10 w-full max-w-[380px] mx-6">
        
        {/* Logo card */}
        <div className="text-center mb-8">
          <div className="w-[100px] h-[100px] mx-auto mb-5 rounded-[22px] overflow-hidden shadow-2xl shadow-white/5 border border-white/[0.06]">
            <img src="/logo.png" alt="EverytnRoom" className="w-full h-full object-cover" />
          </div>
          <h1 className="text-white text-[24px] font-bold tracking-[-0.02em]" style={{ fontFamily: 'Outfit, sans-serif' }}>
            EVERYTINROOM
          </h1>
          <p className="text-white/25 text-[13px] mt-1 font-medium tracking-wide">POINT OF SALE</p>
        </div>

        {/* PIN card */}
        <div className="bg-white/[0.04] border border-white/[0.06] rounded-[20px] p-7">
          
          <p className="text-white/40 text-[14px] font-medium text-center mb-6">Enter your 4-digit PIN</p>

          {error && (
            <div className="bg-red-500/10 border border-red-500/20 text-red-400 px-4 py-2.5 rounded-xl mb-5 text-[13px] font-medium text-center">
              Incorrect PIN. Try again.
            </div>
          )}

          {/* PIN inputs */}
          <div className="flex gap-3.5 justify-center mb-7">
            {pins.map((v, i) => (
              <div key={i} className="relative">
                <input
                  ref={refs[i]}
                  type="tel"
                  inputMode="numeric"
                  maxLength={1}
                  value={v}
                  className="w-[64px] h-[64px] rounded-[14px] text-[22px] font-semibold text-center text-transparent bg-white/[0.05] border-2 focus:outline-none transition-all duration-200"
                  style={{
                    borderColor: v ? '#fff' : i === filled ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.08)',
                  }}
                  onChange={e => handleInput(i, e.target.value)}
                  onKeyDown={e => handleKeyDown(i, e)}
                />
                {v && (
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <div className="w-[14px] h-[14px] rounded-full bg-white" />
                  </div>
                )}
                {!v && i === filled && (
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <div className="w-[2px] h-6 bg-white/30 animate-pulse" />
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Progress */}
          <div className="flex justify-center gap-2">
            {[0,1,2,3].map(i => (
              <div key={i} className="h-[3px] rounded-full transition-all duration-300" style={{
                width: pins[i] ? 28 : 14,
                background: pins[i] ? '#fff' : 'rgba(255,255,255,0.1)'
              }} />
            ))}
          </div>

          {loading && (
            <div className="flex justify-center mt-6">
              <div className="w-5 h-5 border-2 border-white/10 border-t-white rounded-full animate-spin" />
            </div>
          )}
        </div>

        {/* Footer */}
        <p className="text-white/10 text-[11px] text-center mt-6 tracking-wider">SECURED ACCESS</p>
      </div>
    </div>
  )
}
