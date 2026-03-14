import { useState, useRef, useEffect } from 'react'
import { useStore } from '../hooks/useStore'
import { getSupabase } from '../lib/supabase'
import { ADMIN_PIN } from '../lib/utils'

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
    if (pin === ADMIN_PIN) {
      login({ name: 'Admin', role: 'Admin' }, true)
      setPage('dash')
      return
    }
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

      {/* Large colorful decorative circles */}
      <div className="absolute -left-20 -top-20 w-80 h-80 rounded-full bg-[#f97316] opacity-80" />
      <div className="absolute left-16 -top-10 w-48 h-48 rounded-full bg-[#3d8b6a] opacity-70" />
      <div className="absolute -left-10 top-32 w-36 h-36 rounded-full bg-[#fbbf24]" />
      <div className="absolute left-40 top-8 w-24 h-24 rounded-full bg-white opacity-20" />

      <div className="absolute -right-16 -top-16 w-64 h-64 rounded-full bg-[#5fa886] opacity-60" />
      <div className="absolute right-10 top-20 w-40 h-40 rounded-full bg-[#f97316] opacity-40" />
      <div className="absolute right-32 -top-8 w-20 h-20 rounded-full bg-[#fbbf24] opacity-70" />

      <div className="absolute -left-24 bottom-20 w-56 h-56 rounded-full bg-[#5fa886] opacity-50" />
      <div className="absolute left-20 -bottom-12 w-44 h-44 rounded-full bg-[#fbbf24] opacity-60" />
      <div className="absolute left-48 bottom-16 w-20 h-20 rounded-full bg-white opacity-15" />

      <div className="absolute -right-20 -bottom-20 w-72 h-72 rounded-full bg-[#f97316] opacity-60" />
      <div className="absolute right-12 bottom-8 w-40 h-40 rounded-full bg-[#3d8b6a] opacity-50" />
      <div className="absolute right-36 -bottom-6 w-28 h-28 rounded-full bg-[#fbbf24] opacity-40" />

      {/* Scattered mid circles */}
      <div className="absolute left-[15%] top-[45%] w-16 h-16 rounded-full bg-white opacity-10" />
      <div className="absolute right-[20%] top-[35%] w-12 h-12 rounded-full bg-[#5fa886] opacity-30" />
      <div className="absolute left-[40%] top-[15%] w-10 h-10 rounded-full bg-[#f97316] opacity-25" />
      <div className="absolute right-[40%] bottom-[15%] w-14 h-14 rounded-full bg-[#fbbf24] opacity-20" />
      <div className="absolute left-[60%] bottom-[25%] w-8 h-8 rounded-full bg-white opacity-10" />

      {/* Content */}
      <div className="text-center w-full max-w-[360px] relative z-10">
        <div className="mb-8">
          <img src="/logo.png" alt="" className="w-20 h-20 rounded-2xl mx-auto mb-5 object-contain shadow-2xl shadow-black/30" />
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
