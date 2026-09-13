import { useState, useRef, useEffect } from 'react'
import { useStore } from '../hooks/useStore'
import { getSupabase } from '../lib/supabase'
import { Logo } from './Logo'
import Numpad from './Numpad'
import { rememberSignIn, offlineSignIn, knownOfflineUsers } from '../lib/offlineStore'

export default function Login() {
  const [pins, setPins] = useState(['', '', '', ''])
  const [error, setError] = useState(false)
  const [blocked, setBlocked] = useState('')
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

  // On-screen keypad. A till with no keyboard has no other way in.
  const padKey = (d) => {
    if (loading) return
    const i = pins.findIndex(p => !p)
    if (i === -1) return
    const p = [...pins]; p[i] = d; setPins(p)
    if (i < 3) refs[i + 1].current?.focus()
    else tryLogin(p.join(''))
  }

  const padBack = () => {
    if (loading) return
    const filledCount = pins.filter(Boolean).length
    if (filledCount === 0) return
    const i = filledCount - 1
    const p = [...pins]; p[i] = ''; setPins(p)
    refs[i].current?.focus()
  }

  const tryLogin = async (pin) => {
    setLoading(true)

    // No connection: verify_pin is unreachable, so fall back to whoever has
    // signed in on this machine before. Without this a till that reboots
    // during an outage shows a login screen nobody can get past.
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      const u = await offlineSignIn(pin)
      if (u) {
        try { if (!document.fullscreenElement && document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen() } catch {}
        login(u, u.role === 'Admin', null)
        setPage(u.role === 'Admin' ? 'dash' : 'pos')
        return
      }
      setLoading(false)
      setBlocked(knownOfflineUsers().length
        ? 'No internet. Only staff who have signed in on this till before can sign in now.'
        : 'No internet, and nobody has signed in on this till yet.')
      setPins(['', '', '', '']); refs[0].current?.focus()
      setTimeout(() => setBlocked(''), 5000)
      return
    }

    try {
      const sb = getSupabase()
      const { data } = await sb.rpc('verify_pin', { p_pin: pin })
      if (data?.success === false && data?.error) {
        // Brute-force throttle tripped — say so instead of "incorrect PIN".
        setLoading(false); setBlocked(data.error); setPins(['', '', '', ''])
        refs[0].current?.focus(); setTimeout(() => setBlocked(''), 4000)
        return
      }
      if (data?.success) {
        const isAdmin = data.role === 'Admin'
        // Go fullscreen on the cashier screen — the login tap is the user
        // gesture browsers require. Removes the title bar / close button so the
        // POS runs like a kiosk until the machine is powered off. No keyboard needed.
        try { if (!document.fullscreenElement && document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen() } catch {}
        const u = { id: data.id, name: data.name, role: data.role, permissions: data.permissions || [] }
        // So this person can still open the till if the line is down tomorrow.
        rememberSignIn(pin, u)
        login(u, isAdmin, data.token)
        setPage(isAdmin ? 'dash' : 'pos')
        return
      }
    } catch {
      // The request itself failed — treat it as an outage, not a wrong PIN.
      const u = await offlineSignIn(pin)
      if (u) {
        login(u, u.role === 'Admin', null)
        setPage(u.role === 'Admin' ? 'dash' : 'pos')
        return
      }
    }
    setLoading(false)
    setError(true); setPins(['', '', '', '']); refs[0].current?.focus()
    setTimeout(() => setError(false), 2000)
  }

  const filled = pins.filter(p => p).length

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-[#f6f6f5] px-6 py-6 overflow-y-auto">
      <div className="w-full max-w-[330px] text-center my-auto">

        {/* Logo */}
        <div className="mb-8 flex justify-center">
          <Logo height={72} tagline={true} />
        </div>

        {/* PIN */}
        <div>
          <p className="text-[#5e6b62] text-[14px] mb-5 font-medium">Enter your staff PIN</p>

          {/* Fixed-height slot. Without it the whole keypad jumped down the
              screen the moment a PIN was mistyped, under the cashier's finger. */}
          <div className="h-[42px] mb-2 flex items-center justify-center">
            {(error || blocked) && (
              <div className="w-full bg-[#fbeae6] text-[#c0492f] px-4 py-2.5 rounded-xl text-[13px] font-semibold">
                {blocked || 'Incorrect PIN — try again'}
              </div>
            )}
          </div>

          <div className="flex gap-3.5 justify-center mb-7">
            {pins.map((v, i) => (
              <div key={i} className="relative">
                <input
                  ref={refs[i]}
                  type="tel"
                  inputMode="numeric"
                  maxLength={1}
                  value={v}
                  className="w-[52px] h-[52px] rounded-[14px] text-center border-2 focus:outline-none transition-all duration-200"
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
                    <div className="w-2 h-2 rounded-full bg-white" />
                  </div>
                )}
              </div>
            ))}
          </div>

          {loading ? (
            <div className="flex justify-center h-[248px] items-start pt-8">
              <div className="w-6 h-6 border-[2.5px] border-[#dde2dc] border-t-[#16181d] rounded-full animate-spin" />
            </div>
          ) : (
            <div className="max-w-[264px] mx-auto">
              <Numpad onKey={padKey} onBackspace={padBack} onClear={() => { setPins(['', '', '', '']); refs[0].current?.focus() }} />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
