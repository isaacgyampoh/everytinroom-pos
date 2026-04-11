import { useState, useRef, useEffect } from 'react'
import { useStore } from '../hooks/useStore'
import { getSupabase } from '../lib/supabase'

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
        login({ id: data.id, name: data.name, role: data.role }, isAdmin)
        setPage(isAdmin ? 'dash' : 'pos')
        return
      }
    } catch {}
    setLoading(false)
    setError(true); setPins(['', '', '', '']); refs[0].current?.focus()
    setTimeout(() => setError(false), 2000)
  }

  const filled = pins.filter(p => p).length
  const accent = '#0EA5E9'
  const accentLight = '#E0F2FE'

  return (
    <div className="fixed inset-0 z-[1000] flex flex-col md:flex-row overflow-hidden bg-white">
      
      {/* Left / Top — gradient with logo */}
      <div className="relative flex-shrink-0 h-[45vh] md:h-auto md:w-[55%] lg:w-[60%] flex items-center justify-center" style={{
        background: 'linear-gradient(160deg, #0C4A6E 0%, #0369A1 30%, #0EA5E9 60%, #38BDF8 85%, #7DD3FC 100%)'
      }}>
        {/* Ambient shapes */}
        <div className="absolute top-[10%] right-[5%] w-[40vw] md:w-[25vw] h-[40vw] md:h-[25vw] rounded-full" style={{ background: 'radial-gradient(circle, rgba(255,255,255,0.12) 0%, transparent 70%)' }} />
        <div className="absolute bottom-[5%] left-[10%] w-[30vw] md:w-[20vw] h-[30vw] md:h-[20vw] rounded-full" style={{ background: 'radial-gradient(circle, rgba(56,189,248,0.3) 0%, transparent 70%)' }} />
        <div className="absolute top-[40%] left-[20%] w-[15vw] h-[15vw] rounded-full" style={{ background: 'radial-gradient(circle, rgba(255,255,255,0.06) 0%, transparent 70%)' }} />
        
        <div className="relative z-10 text-center px-8">
          <div className="w-[100px] h-[100px] md:w-[130px] md:h-[130px] mx-auto mb-5 md:mb-7 rounded-[26px] md:rounded-[30px] overflow-hidden shadow-2xl shadow-black/20 border-2 border-white/20">
            <img src="/logo.png" alt="EverytnRoom" className="w-full h-full object-cover" />
          </div>
          <h1 className="text-white text-[24px] md:text-[32px] font-bold tracking-[-0.02em] drop-shadow-sm" style={{ fontFamily: 'Outfit, sans-serif' }}>
            EverytnRoom
          </h1>
          <p className="text-white/60 text-[13px] md:text-[15px] mt-1.5 font-medium">Your One Stop Shop</p>
        </div>
      </div>

      {/* Right / Bottom — white PIN section */}
      <div className="flex-1 flex items-start md:items-center justify-center rounded-t-[28px] md:rounded-none -mt-5 md:mt-0 relative z-20 bg-white">
        <div className="w-full max-w-[380px] px-7 pt-8 pb-10 md:py-0">
          
          <h2 className="text-[22px] md:text-[26px] font-bold text-gray-900 mb-1" style={{ fontFamily: 'Outfit, sans-serif' }}>Welcome back</h2>
          <p className="text-gray-400 text-[14px] mb-8">Enter your 4-digit staff PIN</p>

          {error && (
            <div className="bg-red-50 border border-red-100 text-red-500 px-4 py-3 rounded-xl mb-6 text-[13px] font-medium text-center">
              Incorrect PIN. Please try again.
            </div>
          )}

          {/* PIN inputs */}
          <div className="flex gap-3 md:gap-4 justify-center mb-7">
            {pins.map((v, i) => (
              <div key={i} className="relative">
                <input
                  ref={refs[i]}
                  type="tel"
                  inputMode="numeric"
                  maxLength={1}
                  value={v}
                  className="w-[60px] h-[60px] md:w-[68px] md:h-[68px] rounded-2xl text-[22px] font-bold text-center border-2 focus:outline-none transition-all duration-200"
                  style={{
                    borderColor: v ? accent : i === filled ? '#93C5FD' : '#E5E7EB',
                    color: 'transparent',
                    caretColor: 'transparent',
                    background: v ? accentLight : '#F9FAFB',
                  }}
                  onChange={e => handleInput(i, e.target.value)}
                  onKeyDown={e => handleKeyDown(i, e)}
                />
                {v && (
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <div className="w-3.5 h-3.5 rounded-full" style={{ background: accent }} />
                  </div>
                )}
                {!v && i === filled && (
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <div className="w-[2px] h-6 rounded-full animate-pulse" style={{ background: '#93C5FD' }} />
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Progress */}
          <div className="flex justify-center gap-1.5">
            {[0,1,2,3].map(i => (
              <div key={i} className="h-1 rounded-full transition-all duration-300" style={{
                width: pins[i] ? 28 : 14,
                background: pins[i] ? accent : '#E5E7EB'
              }} />
            ))}
          </div>

          {loading && (
            <div className="flex justify-center mt-7">
              <div className="w-6 h-6 border-[2.5px] rounded-full animate-spin" style={{ borderColor: accentLight, borderTopColor: accent }} />
            </div>
          )}

          {/* Footer */}
          <div className="mt-10 md:mt-14 pt-6 border-t border-gray-100 text-center">
            <p className="text-gray-300 text-[11px] tracking-wider uppercase">Secured by EverytnRoom POS</p>
          </div>
        </div>
      </div>
    </div>
  )
}
