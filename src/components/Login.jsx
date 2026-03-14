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
    // Admin PIN check (hardcoded for system access)
    if (pin === ADMIN_PIN) {
      login({ name: 'Admin', role: 'Admin' }, true)
      setPage('dash')
      return
    }
    // Server-side PIN verification — PIN never stored in browser
    try {
      const sb = getSupabase()
      const { data, error } = await sb.rpc('verify_pin', { p_pin: pin })
      if (data?.success) {
        const isAdmin = data.role === 'Admin'
        login({ id: data.id, name: data.name, role: data.role }, isAdmin)
        setPage(isAdmin ? 'dash' : 'pos')
        return
      }
    } catch {}
    // Failed
    setError(true); setPins(['', '', '', '']); refs[0].current?.focus()
    setTimeout(() => setError(false), 2000)
  }

  return (
    <div className="fixed inset-0 bg-brand-900 flex items-center justify-center p-6 z-[1000] overflow-hidden">
      {/* Rich decorative circles pattern */}
      {/* Top left cluster */}
      <div className="absolute -left-16 -top-16 w-72 h-72 rounded-full border border-brand-700/20" />
      <div className="absolute -left-8 -top-8 w-52 h-52 rounded-full border border-brand-700/25" />
      <div className="absolute left-12 top-12 w-32 h-32 rounded-full border border-brand-700/15" />
      <div className="absolute left-4 top-40 w-20 h-20 rounded-full bg-brand-700/10" />

      {/* Top right */}
      <div className="absolute -right-24 top-10 w-56 h-56 rounded-full border border-brand-600/10" />
      <div className="absolute right-8 -top-12 w-40 h-40 rounded-full border border-brand-600/15" />
      <div className="absolute right-20 top-32 w-16 h-16 rounded-full bg-brand-600/8" />

      {/* Middle left */}
      <div className="absolute -left-20 top-1/2 -translate-y-1/2 w-44 h-44 rounded-full border border-brand-700/15" />
      <div className="absolute left-16 top-[45%] w-24 h-24 rounded-full border border-brand-700/10" />

      {/* Middle right */}
      <div className="absolute -right-10 top-[40%] w-36 h-36 rounded-full bg-brand-700/8" />
      <div className="absolute right-24 top-[55%] w-14 h-14 rounded-full border-2 border-brand-500/10" />

      {/* Bottom left */}
      <div className="absolute -left-10 -bottom-10 w-48 h-48 rounded-full border border-brand-700/20" />
      <div className="absolute left-20 -bottom-4 w-28 h-28 rounded-full border border-brand-700/15" />
      <div className="absolute left-8 bottom-20 w-12 h-12 rounded-full bg-brand-600/10" />

      {/* Bottom right cluster */}
      <div className="absolute -right-20 -bottom-20 w-64 h-64 rounded-full border border-brand-700/20" />
      <div className="absolute -right-8 -bottom-8 w-44 h-44 rounded-full border border-brand-700/25" />
      <div className="absolute right-16 bottom-16 w-28 h-28 rounded-full border border-brand-700/15" />
      <div className="absolute right-6 bottom-40 w-10 h-10 rounded-full bg-brand-500/8" />

      {/* Center scattered */}
      <div className="absolute left-[30%] top-[15%] w-8 h-8 rounded-full border border-brand-600/12" />
      <div className="absolute right-[35%] top-[20%] w-6 h-6 rounded-full bg-brand-500/6" />
      <div className="absolute left-[25%] bottom-[20%] w-10 h-10 rounded-full border border-brand-600/10" />
      <div className="absolute right-[30%] bottom-[15%] w-7 h-7 rounded-full bg-brand-600/8" />
      <div className="absolute left-[50%] top-[10%] w-5 h-5 rounded-full bg-brand-500/10" />
      <div className="absolute left-[45%] bottom-[10%] w-6 h-6 rounded-full border border-brand-500/10" />

      {/* Dotted ring accent */}
      <div className="absolute left-[10%] top-[60%] w-20 h-20 rounded-full border-2 border-dashed border-brand-600/10" />
      <div className="absolute right-[15%] top-[30%] w-16 h-16 rounded-full border-2 border-dashed border-brand-600/8" />

      {/* Content */}
      <div className="text-center w-full max-w-[360px] relative z-10">
        <div className="mb-10">
          <img src="/logo.png" alt="" className="w-24 h-24 rounded-3xl mx-auto mb-5 object-contain shadow-lg shadow-black/20" />
          <h1 className="text-white font-heading text-3xl font-extrabold tracking-tight">Everytin Room</h1>
          <p className="text-brand-400 text-sm mt-1">Point of Sale System</p>
        </div>

        <div className="bg-brand-800/40 rounded-3xl p-8 border border-brand-700/30 backdrop-blur-sm">
          <h2 className="text-white text-xl font-bold mb-1">Welcome Back</h2>
          <p className="text-brand-400/60 text-sm mb-7">Enter your 4-digit PIN</p>

          {error && (
            <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-3 rounded-xl mb-5 text-sm font-semibold animate-fade">
              Invalid PIN
            </div>
          )}

          <div className="flex gap-3 justify-center mb-6">
            {pins.map((v, i) => (
              <input key={i} ref={refs[i]} type="tel" inputMode="numeric" maxLength={1} value={v}
                className="w-[60px] h-[68px] border-2 border-brand-700/40 rounded-2xl text-2xl font-bold text-center bg-brand-900/50 text-white focus:outline-none focus:border-brand-400 transition caret-brand-400"
                onChange={e => handleInput(i, e.target.value)}
                onKeyDown={e => handleKeyDown(i, e)} />
            ))}
          </div>

          <div className="flex justify-center gap-2 mb-2">
            {pins.map((v, i) => (
              <div key={i} className={`w-2 h-2 rounded-full transition-all duration-200 ${v ? 'bg-brand-400 scale-125' : 'bg-brand-700/40'}`} />
            ))}
          </div>
        </div>

        <p className="text-brand-700/40 text-xs mt-8">EVERYTINROOM&BEDTIME</p>
      </div>
    </div>
  )
}
