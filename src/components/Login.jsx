import { useState, useRef, useEffect } from 'react'
import { useStore } from '../hooks/useStore'
import { ADMIN_PIN } from '../lib/utils'

export default function Login() {
  const [pins, setPins] = useState(['', '', '', ''])
  const [error, setError] = useState(false)
  const refs = [useRef(), useRef(), useRef(), useRef()]
  const { staff, login, setPage } = useStore()

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

  const tryLogin = (pin) => {
    let u = staff.find(s => String(s.pin) === pin && s.active)
    if (!u && pin === ADMIN_PIN) u = { name: 'Admin', role: 'Admin' }
    if (u) {
      login(u, u.role === 'Admin')
      setPage(u.role === 'Admin' ? 'dash' : 'pos')
    } else {
      setError(true); setPins(['', '', '', '']); refs[0].current?.focus()
      setTimeout(() => setError(false), 2000)
    }
  }

  return (
    <div className="fixed inset-0 bg-[#0a0a0a] flex items-center justify-center p-6 z-[1000]">
      <div className="text-center w-full max-w-[360px]">
        {/* Logo */}
        <div className="mb-10">
          <img src="/logo.png" alt="" className="w-24 h-24 rounded-3xl mx-auto mb-5 object-contain" />
          <h1 className="text-white font-heading text-3xl font-extrabold tracking-tight">Everytin Room</h1>
          <p className="text-[#666] text-sm mt-1">Point of Sale System</p>
        </div>

        {/* PIN Card */}
        <div className="bg-[#141414] rounded-3xl p-8 border border-[#1e1e1e]">
          <h2 className="text-white text-xl font-bold mb-1">Welcome Back</h2>
          <p className="text-[#555] text-sm mb-7">Enter your 4-digit PIN</p>

          {error && (
            <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-3 rounded-xl mb-5 text-sm font-semibold animate-fade">
              Invalid PIN
            </div>
          )}

          <div className="flex gap-3 justify-center mb-6">
            {pins.map((v, i) => (
              <input key={i} ref={refs[i]} type="tel" inputMode="numeric" maxLength={1} value={v}
                className="w-[60px] h-[68px] border-2 border-[#252525] rounded-2xl text-2xl font-bold text-center bg-[#0a0a0a] text-white focus:outline-none focus:border-[#d4a017] transition caret-[#d4a017]"
                onChange={e => handleInput(i, e.target.value)}
                onKeyDown={e => handleKeyDown(i, e)} />
            ))}
          </div>

          {/* PIN dots indicator */}
          <div className="flex justify-center gap-2 mb-2">
            {pins.map((v, i) => (
              <div key={i} className={`w-2 h-2 rounded-full transition-all duration-200 ${v ? 'bg-[#d4a017] scale-125' : 'bg-[#333]'}`} />
            ))}
          </div>
        </div>

        {/* Footer */}
        <p className="text-[#333] text-xs mt-8">EVERYTINROOM&BEDTIME</p>
      </div>
    </div>
  )
}
