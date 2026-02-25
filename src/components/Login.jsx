import { useState } from 'react'
import { useStore } from '../hooks/useStore'
import toast from 'react-hot-toast'

export default function Login() {
  const { staff, login } = useStore()
  const [pin, setPin] = useState('')

  const handleDigit = (d) => {
    const newPin = pin + d
    setPin(newPin)
    if (newPin.length === 4) {
      const match = staff.find(s => s.pin === newPin && s.active)
      if (match) { login(match, match.role === 'admin'); toast.success('Welcome, ' + match.name + '!') }
      else { toast.error('Invalid PIN'); setPin('') }
    }
  }

  const handleDelete = () => setPin(pin.slice(0, -1))

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
      <div className="relative z-10 text-center mb-8">
        <h1 className="text-3xl md:text-4xl font-extrabold">
          <span className="text-brand-500">Everytin</span> <span className="text-accent-500">Room</span>
        </h1>
        <p className="text-gold-500 text-sm font-semibold mt-1">— Your One Stop Shop —</p>
      </div>

      {/* PIN Label */}
      <p className="relative z-10 text-white/50 text-sm font-medium mb-4">Enter your 4-digit PIN</p>

      {/* PIN Dots */}
      <div className="relative z-10 flex justify-center gap-5 mb-10">
        {[0, 1, 2, 3].map(i => (
          <div key={i} className={`w-5 h-5 rounded-full transition-all duration-300 ${i < pin.length ? 'bg-brand-500 scale-125 shadow-lg shadow-brand-500/50' : 'bg-white/15 border-2 border-white/20'}`} />
        ))}
      </div>

      {/* Number Pad - no card, just buttons */}
      <div className="relative z-10 w-full max-w-[280px] grid grid-cols-3 gap-3">
        {[1, 2, 3, 4, 5, 6, 7, 8, 9, null, 0, 'del'].map((d, i) => {
          if (d === null) return <div key={i} />
          if (d === 'del') return (
            <button key={i} onClick={handleDelete}
              className="h-16 md:h-18 rounded-2xl bg-white/5 text-white/50 text-xl font-semibold flex items-center justify-center hover:bg-white/10 active:scale-90 transition-all">
              ←
            </button>
          )
          return (
            <button key={i} onClick={() => handleDigit(String(d))}
              className="h-16 md:h-18 rounded-2xl bg-white/8 text-white text-2xl font-bold flex items-center justify-center hover:bg-brand-500/30 active:scale-90 transition-all">
              {d}
            </button>
          )
        })}
      </div>

      {/* Footer */}
      <p className="relative z-10 text-navy-300 text-xs mt-8">Adenta Aviation Road • Erbliving.shop</p>
    </div>
  )
}
