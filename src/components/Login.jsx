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
      {/* Decorative elements */}
      <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none">
        <div className="absolute -top-20 -right-20 w-80 h-80 bg-brand-500/10 rounded-full blur-3xl" />
        <div className="absolute -bottom-32 -left-20 w-96 h-96 bg-accent-500/10 rounded-full blur-3xl" />
        <div className="absolute top-1/4 right-1/4 w-40 h-40 bg-sky-500/8 rounded-full blur-2xl" />
      </div>

      {/* Logo */}
      <div className="relative z-10 mb-8 animate-fade">
        <div className="animate-pulse-glow rounded-3xl">
          <img src="/logo.png" alt="Everytin Room" className="w-44 h-44 md:w-52 md:h-52 rounded-3xl object-contain animate-float" />
        </div>
      </div>

      {/* Title */}
      <div className="relative z-10 text-center mb-10 animate-fade" style={{ animationDelay: '0.1s' }}>
        <h1 className="text-3xl md:text-4xl font-extrabold">
          <span className="text-brand-500">Everytin</span> <span className="text-accent-500">Room</span>
        </h1>
        <p className="text-gold-500 text-sm md:text-base font-semibold mt-1">— Your One Stop Shop —</p>
        <p className="text-navy-200 text-xs md:text-sm mt-2">Point of Sale System</p>
      </div>

      {/* PIN Card */}
      <div className="relative z-10 w-full max-w-xs animate-fade" style={{ animationDelay: '0.2s' }}>
        <div className="bg-white/10 backdrop-blur-xl rounded-3xl p-8 border border-white/10">
          <p className="text-center text-white/60 text-sm font-medium mb-5">Enter your 4-digit PIN</p>

          {/* PIN Dots */}
          <div className="flex justify-center gap-4 mb-8">
            {[0, 1, 2, 3].map(i => (
              <div key={i} className={`w-4 h-4 rounded-full transition-all duration-300 ${i < pin.length ? 'bg-brand-500 scale-125 shadow-lg shadow-brand-500/50' : 'bg-white/20 border border-white/30'}`} />
            ))}
          </div>

          {/* Number Pad */}
          <div className="grid grid-cols-3 gap-3">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9, null, 0, 'del'].map((d, i) => {
              if (d === null) return <div key={i} />
              if (d === 'del') return (
                <button key={i} onClick={handleDelete}
                  className="h-16 rounded-2xl bg-white/5 border border-white/10 text-white/60 text-lg font-semibold flex items-center justify-center hover:bg-white/10 active:scale-90 transition-all">
                  ←
                </button>
              )
              return (
                <button key={i} onClick={() => handleDigit(String(d))}
                  className="h-16 rounded-2xl bg-white/8 border border-white/10 text-white text-2xl font-bold flex items-center justify-center hover:bg-brand-500/30 hover:border-brand-500/50 active:scale-90 transition-all">
                  {d}
                </button>
              )
            })}
          </div>
        </div>

        {/* Footer */}
        <p className="text-center text-navy-300 text-xs mt-6">Adenta Aviation Road • Erbliving.shop</p>
      </div>
    </div>
  )
}
