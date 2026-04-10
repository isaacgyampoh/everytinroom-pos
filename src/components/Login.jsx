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
    <div className="fixed inset-0 bg-[#1a3d30] flex items-center justify-center p-6 z-[1000]">

      <div className="text-center w-full max-w-[340px]">
        <div className="mb-10">
          <img src="/logo.png" alt="EverytnRoom" className="w-20 h-20 mx-auto mb-4 rounded-2xl" />
          <p className="text-white/40 text-xs tracking-widest uppercase">Staff Login</p>
        </div>

        <div className="bg-white/[.07] rounded-2xl p-6 border border-white/[.08]">

          {error && (
            <div className="bg-red-500/20 text-red-300 p-3 rounded-xl mb-4 text-sm font-medium">
              Invalid PIN. Try again.
            </div>
          )}

          <p className="text-white/40 text-sm mb-5">Enter your 4-digit PIN</p>

          <div className="flex gap-3 justify-center mb-5">
            {pins.map((v, i) => (
              <input key={i} ref={refs[i]} type="tel" inputMode="numeric" maxLength={1} value={v}
                className="w-14 h-16 border border-white/10 rounded-xl text-2xl font-bold text-center bg-white/5 text-white focus:outline-none focus:border-white/30 focus:bg-white/10 transition"
                placeholder="·"
                onChange={e => handleInput(i, e.target.value)}
                onKeyDown={e => handleKeyDown(i, e)} />
            ))}
          </div>

          <div className="flex justify-center gap-2">
            {pins.map((v, i) => (
              <div key={i} className={`w-2 h-2 rounded-full transition ${v ? 'bg-white' : 'bg-white/15'}`} />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
