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
    const newPins = [...pins]
    newPins[i] = val.slice(-1)
    setPins(newPins)
    if (val && i < 3) refs[i + 1].current?.focus()
    if (i === 3 && val) {
      const pin = newPins.join('')
      tryLogin(pin)
    }
  }

  const handleKeyDown = (i, e) => {
    if (e.key === 'Backspace' && !pins[i] && i > 0) refs[i - 1].current?.focus()
  }

  const tryLogin = (pin) => {
    let u = staff.find(s => String(s.pin) === pin && s.active)
    if (!u && pin === ADMIN_PIN) u = { name: 'Admin', role: 'Admin' }
    if (u) {
      const isAdmin = u.role === 'Admin'
      login(u, isAdmin)
      setPage(isAdmin ? 'dash' : 'pos')
      setError(false)
    } else {
      setError(true)
      setPins(['', '', '', ''])
      refs[0].current?.focus()
    }
  }

  return (
    <div className="fixed inset-0 bg-gray-900 flex items-center justify-center p-6 z-[1000]">
      <div className="text-center">
        <img src="/logo.png" alt="Everytin Room" className="w-36 h-36 rounded-3xl mx-auto mb-6 object-contain" />
        <h1 className="text-white text-3xl font-heading font-extrabold tracking-tight mb-1">Everytin Room</h1>
        <p className="text-white/80 text-sm mb-10">Your One Stop Shop • Point of Sale</p>

        <div className="bg-white rounded-3xl p-10 max-w-[380px] shadow-2xl">
          <h2 className="text-2xl font-bold mb-2">Welcome Back!</h2>
          <p className="text-gray-400 mb-8">Enter your 4-digit PIN</p>

          {error && (
            <div className="bg-red-50 text-red-600 p-3.5 rounded-xl mb-5 text-sm font-semibold animate-fade">
              Invalid PIN. Try again.
            </div>
          )}

          <div className="flex gap-3.5 justify-center mb-6">
            {pins.map((v, i) => (
              <input key={i} ref={refs[i]} type="tel" maxLength={1} value={v}
                className="w-[60px] h-[70px] border-[3px] border-gray-200 rounded-2xl text-3xl font-bold text-center bg-gray-50 focus:outline-none focus:border-brand-500 transition"
                onChange={e => handleInput(i, e.target.value)}
                onKeyDown={e => handleKeyDown(i, e)} />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
