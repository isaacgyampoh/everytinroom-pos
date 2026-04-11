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

  return (
    <div className="fixed inset-0 z-[1000] flex flex-col overflow-hidden">
      
      {/* Top section — vibrant gradient with logo */}
      <div className="relative flex-1 flex flex-col items-center justify-center px-6" style={{
        background: 'linear-gradient(145deg, #FF8C42 0%, #FF6B35 25%, #E85D26 50%, #D4472A 75%, #C13525 100%)'
      }}>
        {/* Soft overlay shapes */}
        <div className="absolute top-[-20%] right-[-15%] w-[60vw] h-[60vw] rounded-full" style={{ background: 'radial-gradient(circle, rgba(255,200,100,0.3) 0%, transparent 70%)' }} />
        <div className="absolute bottom-[-10%] left-[-20%] w-[50vw] h-[50vw] rounded-full" style={{ background: 'radial-gradient(circle, rgba(255,107,53,0.4) 0%, transparent 70%)' }} />
        
        <div className="relative z-10 text-center">
          <div className="w-[120px] h-[120px] mx-auto mb-6 rounded-[28px] overflow-hidden bg-white/20 backdrop-blur-sm p-1">
            <img src="/logo.png" alt="EverytnRoom" className="w-full h-full rounded-[24px] object-cover" />
          </div>
          <h1 className="text-white text-[28px] font-bold tracking-[-0.02em] drop-shadow-sm" style={{ fontFamily: 'Outfit, sans-serif' }}>
            EverytnRoom
          </h1>
          <p className="text-white/70 text-[14px] mt-1 font-medium">Your One Stop Shop</p>
        </div>
      </div>

      {/* Bottom section — white card with PIN */}
      <div className="bg-white rounded-t-[32px] -mt-6 relative z-20 px-6 pt-8 pb-10 safe-bottom">
        <div className="max-w-[360px] mx-auto">
          
          <h2 className="text-[20px] font-bold text-gray-900 text-center mb-1" style={{ fontFamily: 'Outfit, sans-serif' }}>Welcome back</h2>
          <p className="text-gray-400 text-[14px] text-center mb-7">Enter your staff PIN to continue</p>

          {error && (
            <div className="bg-red-50 border border-red-100 text-red-500 px-4 py-3 rounded-2xl mb-5 text-[13px] font-medium text-center">
              Incorrect PIN. Please try again.
            </div>
          )}

          {/* PIN inputs */}
          <div className="flex gap-3.5 justify-center mb-6">
            {pins.map((v, i) => (
              <div key={i} className="relative">
                <input
                  ref={refs[i]}
                  type="tel"
                  inputMode="numeric"
                  maxLength={1}
                  value={v}
                  className="w-[62px] h-[62px] rounded-2xl text-[22px] font-bold text-center bg-gray-50 border-2 focus:outline-none transition-all duration-200"
                  style={{
                    borderColor: v ? '#FF6B35' : i === filled ? '#FFB088' : '#f0f0f0',
                    color: 'transparent',
                    caretColor: 'transparent',
                    background: v ? '#FFF5F0' : '#f8f8f7',
                  }}
                  onChange={e => handleInput(i, e.target.value)}
                  onKeyDown={e => handleKeyDown(i, e)}
                />
                {v && (
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <div className="w-[14px] h-[14px] rounded-full" style={{ background: '#FF6B35' }} />
                  </div>
                )}
                {!v && i === filled && (
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <div className="w-[2px] h-6 rounded-full animate-pulse" style={{ background: '#FFB088' }} />
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Progress */}
          <div className="flex justify-center gap-1.5 mb-2">
            {[0,1,2,3].map(i => (
              <div key={i} className="h-[4px] rounded-full transition-all duration-300" style={{
                width: pins[i] ? 28 : 14,
                background: pins[i] ? '#FF6B35' : '#f0f0f0'
              }} />
            ))}
          </div>

          {loading && (
            <div className="flex justify-center mt-6">
              <div className="w-6 h-6 border-[2.5px] border-orange-100 border-t-[#FF6B35] rounded-full animate-spin" />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
