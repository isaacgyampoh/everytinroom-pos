import { useState } from 'react'
import { useStore } from '../hooks/useStore'
import toast from 'react-hot-toast'

export default function Login() {
  const { staff, login } = useStore()
  const [pin, setPin] = useState('')

  const handleSubmit = (e) => {
    e?.preventDefault()
    if (pin.length !== 4) { toast.error('Enter 4-digit PIN'); return }
    const match = staff.find(s => s.pin === pin && s.active)
    if (match) { login(match, match.role === 'admin'); toast.success('Welcome, ' + match.name + '!') }
    else { toast.error('Invalid PIN'); setPin('') }
  }

  const handleChange = (e) => {
    const val = e.target.value.replace(/\D/g, '').slice(0, 4)
    setPin(val)
    if (val.length === 4) {
      setTimeout(() => {
        const match = staff.find(s => s.pin === val && s.active)
        if (match) { login(match, match.role === 'admin'); toast.success('Welcome, ' + match.name + '!') }
        else { toast.error('Invalid PIN'); setPin('') }
      }, 200)
    }
  }

  return (
    <div className="fixed inset-0 brand-gradient flex flex-col items-center justify-center p-6 overflow-hidden">
      {/* Background glow */}
      <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none">
        <div className="absolute -top-20 -right-20 w-80 h-80 bg-brand-500/10 rounded-full blur-3xl" />
        <div className="absolute -bottom-32 -left-20 w-96 h-96 bg-accent-500/10 rounded-full blur-3xl" />
      </div>

      {/* Logo */}
      <div className="relative z-10 mb-6">
        <img src="/logo.png" alt="Everytin Room" className="w-40 h-40 md:w-48 md:h-48 rounded-3xl object-contain animate-float" />
      </div>

      {/* Title */}
      <div className="relative z-10 text-center mb-10">
        <h1 className="text-3xl md:text-4xl font-extrabold">
          <span className="text-brand-500">Everytin</span> <span className="text-accent-500">Room</span>
        </h1>
        <p className="text-gold-500 text-sm font-semibold mt-1">— Your One Stop Shop —</p>
      </div>

      {/* PIN Input */}
      <form onSubmit={handleSubmit} className="relative z-10 w-full max-w-[260px]">
        <p className="text-white/50 text-sm font-medium mb-3 text-center">Enter your 4-digit PIN</p>
        <input
          type="password"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={4}
          autoFocus
          value={pin}
          onChange={handleChange}
          className="w-full h-16 bg-white/10 border-2 border-white/15 rounded-2xl text-white text-center text-3xl font-bold tracking-[0.5em] placeholder:text-white/20 placeholder:tracking-[0.3em] placeholder:text-lg focus:outline-none focus:border-brand-500/60 focus:bg-white/15 transition-all"
          placeholder="••••"
        />
        <button type="submit" className="w-full h-13 mt-4 brand-gradient-green rounded-xl text-white text-base font-bold hover:opacity-90 active:scale-[.97] transition-all shadow-lg shadow-brand-500/20">
          🔓 Unlock
        </button>
      </form>

      {/* Footer */}
      <p className="relative z-10 text-navy-300 text-xs mt-10">Adenta Aviation Road • Erbliving.shop</p>
    </div>
  )
}
