import { useState, useRef, useEffect } from 'react'
import { useStore } from '../hooks/useStore'
import { getSupabase } from '../lib/supabase'
import { Logo } from './Logo'

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
        // Go fullscreen on the cashier screen — the login tap is the user
        // gesture browsers require. Removes the title bar / close button so the
        // POS runs like a kiosk until the machine is powered off. No keyboard needed.
        try { if (!document.fullscreenElement && document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen() } catch {}
        login({ id: data.id, name: data.name, role: data.role, permissions: data.permissions || [] }, isAdmin)
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
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-[#f6f6f5] px-6">
      <div className="w-full max-w-[380px] text-center">

        {/* Logo */}
        <div className="mb-11 flex justify-center">
          <Logo height={104} tagline={true} />
        </div>

        {/* PIN */}
        <div>
          <p className="text-[#5e6b62] text-[15px] mb-7 tracking-wide">Enter your staff PIN</p>

          {error && (
            <div className="bg-[#fbeae6] text-[#c0492f] px-4 py-3 rounded-2xl mb-6 text-[13px] font-medium">
              Incorrect PIN. Please try again.
            </div>
          )}

          <div className="flex gap-4 justify-center mb-8">
            {pins.map((v, i) => (
              <div key={i} className="relative">
                <input
                  ref={refs[i]}
                  type="tel"
                  inputMode="numeric"
                  maxLength={1}
                  value={v}
                  className="w-16 h-16 rounded-2xl text-center border-2 focus:outline-none transition-all duration-200"
                  style={{
                    borderColor: v ? '#16181d' : i === filled ? '#8fb39e' : '#dde2dc',
                    background: v ? '#16181d' : '#fafafa',
                    color: 'transparent',
                    caretColor: 'transparent',
                  }}
                  onChange={e => handleInput(i, e.target.value)}
                  onKeyDown={e => handleKeyDown(i, e)}
                />
                {v && (
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <div className="w-2.5 h-2.5 rounded-full bg-white" />
                  </div>
                )}
              </div>
            ))}
          </div>

          {loading && (
            <div className="flex justify-center">
              <div className="w-6 h-6 border-[2.5px] border-[#dde2dc] border-t-[#16181d] rounded-full animate-spin" />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
