import { useState, useRef, useEffect } from 'react'
import { useStore } from '../hooks/useStore'
import { getSupabase } from '../lib/supabase'
import { Logo } from './Logo'
import Numpad from './Numpad'
import { rememberSignIn, offlineSignIn, knownOfflineUsers } from '../lib/offlineStore'
import { getSettings, saveSettings } from '../lib/hardware'
import { SHOP } from '../lib/utils'

// Does this machine's primary input have a fingertip on the end of it?
//
// `pointer: coarse` describes the PRIMARY pointer, so a touchscreen laptop
// with a trackpad still reports fine and gets the typing layout, which is what
// somebody with a keyboard wants. The counter till reports coarse and keeps
// its keypad.
//
// This is a DEFAULT, never a lock-in. Get it wrong on a machine with no
// keyboard and nobody can sign in at all, so there is always a way to summon
// the pad, and the choice sticks on that terminal once made.
const prefersKeypad = () => {
  const saved = getSettings().loginKeypad
  if (saved === 'always') return true
  if (saved === 'never') return false
  try { return window.matchMedia('(pointer: coarse)').matches } catch { return true }
}

export default function Login() {
  const [pins, setPins] = useState(['', '', '', ''])
  const [error, setError] = useState(false)
  const [blocked, setBlocked] = useState('')
  const [loading, setLoading] = useState(false)
  const refs = [useRef(), useRef(), useRef(), useRef()]
  const [keypad, setKeypad] = useState(prefersKeypad)
  const showKeypad = (on) => { setKeypad(on); saveSettings({ loginKeypad: on ? 'always' : 'never' }) }
  const { login, setPage } = useStore()

  // Focus the first box only where somebody can actually type into it.
  // Focusing a text input on a touchscreen summons the operating system's own
  // keyboard, which on the counter till slides up over the keypad this screen
  // just drew. The keypad writes the digits itself and needs no focus.
  useEffect(() => { if (!keypad) refs[0].current?.focus() }, [keypad]) // eslint-disable-line

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
  const terminal = (getSettings().terminalName || '').trim()

  return (
    // ========================================================================
    // THE LOCK SCREEN
    //
    // It was a pale grey page with a centred column and a white calculator
    // pinned to it — the same screen any admin template ships with, and on a
    // wide monitor a small box marooned in empty space.
    //
    // It is the shop's ink now, edge to edge. A locked till should not look
    // like a working one: dark means not trading, and the moment a PIN lands
    // the app comes up light. On a laptop the brand takes the left and the
    // entry takes the right, so the width is used rather than padded around.
    //
    // The keypad only appears where there is no keyboard — see prefersKeypad.
    // ========================================================================
    <div className="fixed inset-0 z-[1000] overflow-y-auto bg-[#101116] text-white">
      {/* A warm lift behind the brand so the ink reads as a surface, not a void. */}
      <div aria-hidden className="pointer-events-none fixed inset-0"
        style={{ background: 'radial-gradient(1100px 620px at 50% -12%, rgba(154,157,163,.16), transparent 62%)' }} />

      <div className="relative min-h-full flex flex-col lg:flex-row">

        {/* Brand. A band on a phone, half the screen on a laptop. */}
        <div className="lg:w-[46%] lg:min-h-full flex flex-col items-center justify-center text-center px-8 pt-12 pb-6 lg:py-16 lg:border-r border-white/10">
          <Logo height={64} color="#ffffff" accent="#9a9da3" tagline={false} className="lg:hidden" />
          <Logo height={92} color="#ffffff" accent="#9a9da3" tagline={false} className="hidden lg:block" />
          {/* Which shop, and which till. A cashier walking up to one of several
              counters should not have to guess, and it is the one thing this
              screen knows that the working app hides behind a settings page. */}
          <p className="mt-6 text-[12px] tracking-[.18em] uppercase text-white/35 hidden lg:block">{SHOP.address}</p>
          {terminal && (
            <span className="mt-5 inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-white/12 text-[11px] font-semibold tracking-wide text-white/55">
              <span className="w-1.5 h-1.5 rounded-full bg-[#8fb39e]" />
              {terminal}
            </span>
          )}
        </div>

        {/* Entry. */}
        <div className="flex-1 flex items-center justify-center px-6 pb-10 lg:py-16">
          <div className="w-full max-w-[320px]">
            <p className="text-center text-[13px] tracking-[.16em] uppercase text-white/45 mb-7">Enter your staff PIN</p>

            {/* Four dots, not four boxes. A PIN is a secret of a known length,
                which is all this needs to say. */}
            <div className="flex gap-4 justify-center mb-6">
              {pins.map((v, i) => (
                <div key={i} className="relative">
                  <input
                    ref={refs[i]}
                    type="tel" inputMode="numeric" maxLength={1} value={v}
                    aria-label={`PIN digit ${i + 1}`}
                    className="peer w-[46px] h-[54px] rounded-2xl text-center bg-transparent border-0 focus:outline-none"
                    style={{ color: 'transparent', caretColor: 'transparent' }}
                    onChange={e => handleInput(i, e.target.value)}
                    onKeyDown={e => handleKeyDown(i, e)}
                  />
                  <span aria-hidden className={`pointer-events-none absolute inset-0 rounded-2xl border transition-all duration-200
                    ${v ? 'border-white/0 bg-white/[.10]' : i === filled ? 'border-[#8fb39e]/70' : 'border-white/12'}`} />
                  <span aria-hidden className={`pointer-events-none absolute inset-0 flex items-center justify-center transition-all duration-200
                    ${v ? 'scale-100 opacity-100' : 'scale-50 opacity-0'}`}>
                    <span className="w-2.5 h-2.5 rounded-full bg-white" />
                  </span>
                </div>
              ))}
            </div>

            {/* Reserved so a wrong PIN never shifts the keypad under a finger
                that is already on its way down. */}
            <div className="h-[44px] mb-3 flex items-start justify-center">
              {(error || blocked) && (
                <div className="w-full text-center bg-[#b3402b]/15 border border-[#b3402b]/35 text-[#f0b4a6] px-4 py-2.5 rounded-xl text-[12.5px] font-semibold">
                  {blocked || 'Incorrect PIN — try again'}
                </div>
              )}
            </div>

            {loading ? (
              <div className="flex justify-center h-[248px] items-start pt-10">
                <div className="w-6 h-6 border-[2.5px] border-white/20 border-t-white rounded-full animate-spin" />
              </div>
            ) : keypad ? (
              <>
                <div className="max-w-[270px] mx-auto">
                  <Numpad surface="dark" onKey={padKey} onBackspace={padBack}
                    onClear={() => { setPins(['', '', '', '']); refs[0].current?.focus() }} />
                </div>
                <button type="button" onClick={() => showKeypad(false)}
                  className="mt-6 w-full text-[11.5px] font-semibold tracking-wide text-white/30 hover:text-white/60 transition">
                  Hide the keypad — I have a keyboard
                </button>
              </>
            ) : (
              <div className="text-center">
                <p className="text-[12.5px] text-white/35">Type your PIN, or</p>
                {/* The escape hatch. If the guess about this machine is wrong,
                    a keyboard-less till would otherwise have no way in. */}
                <button type="button" onClick={() => { showKeypad(true); refs[filled < 4 ? filled : 3].current?.focus() }}
                  className="mt-1.5 h-10 px-4 rounded-xl border border-white/15 text-[12.5px] font-semibold text-white/75 hover:bg-white/[.06] transition">
                  use the on-screen keypad
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
