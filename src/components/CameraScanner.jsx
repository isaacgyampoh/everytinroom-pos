import { useState, useRef, useEffect } from 'react'

export default function CameraScanner({ products, onMatch, onClose }) {
  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const [scanning, setScanning] = useState(false)
  const [status, setStatus] = useState('Starting camera...')
  const [stream, setStream] = useState(null)
  const [suggestions, setSuggestions] = useState([])

  useEffect(() => {
    startCamera()
    return () => stopCamera()
  }, [])

  const startCamera = async () => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'environment',
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          focusMode: { ideal: 'continuous' },
          autoGainControl: true,
          exposureMode: { ideal: 'continuous' }
        }
      })
      setStream(s)
      if (videoRef.current) {
        videoRef.current.srcObject = s
        videoRef.current.play()
      }
      setStatus('Point camera at the product and tap Scan')
    } catch (e) {
      setStatus('Camera access denied. Please allow camera access in your browser settings.')
    }
  }

  const stopCamera = () => {
    if (stream) stream.getTracks().forEach(t => t.stop())
  }

  const captureAndIdentify = async () => {
    if (!videoRef.current || !canvasRef.current) return
    setScanning(true)
    setSuggestions([])
    setStatus('Identifying product...')

    const canvas = canvasRef.current
    const video = videoRef.current
    // Capture at video's actual resolution
    canvas.width = video.videoWidth || 1280
    canvas.height = video.videoHeight || 720
    const ctx = canvas.getContext('2d')
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
    const imageData = canvas.toDataURL('image/jpeg', 0.85).split(',')[1]

    // Build product list for matching
    const productList = products.slice(0, 200).map(p => p.name + (p.category ? ` (${p.category})` : '')).join(', ')

    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 200,
          messages: [{
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: imageData } },
              { type: 'text', text: `You are a product scanner for a store called EVERYTINROOM. Look at this image carefully.

First, read ANY text visible in the image - product labels, tags, stickers, handwriting, printed names, price tags, packaging text.

Then match what you see (text OR the product itself) to these store products: ${productList}

Return ONLY a JSON array of 1-3 matching product names EXACTLY as listed above. If no match, return [].` }
            ]
          }]
        })
      })

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}))
        throw new Error(errData.error?.message || `API error ${res.status}`)
      }

      const data = await res.json()
      const text = (data.content?.[0]?.text || '[]').replace(/```json|```/g, '').trim()

      let matches = []
      try { matches = JSON.parse(text) } catch {
        // Try to extract product names from text
        const found = products.filter(p => text.toLowerCase().includes(p.name.toLowerCase()))
        matches = found.slice(0, 3).map(p => p.name)
      }

      if (Array.isArray(matches) && matches.length > 0) {
        const matched = matches.map(name => products.find(p => p.name === name || p.name.toLowerCase() === name.toLowerCase())).filter(Boolean)
        if (matched.length >= 1) {
          setStatus(matched.length === 1 ? `Found: ${matched[0].name}` : 'Select the correct product:')
          setSuggestions(matched)
        } else {
          setStatus('Product not recognized. Try moving closer or adjusting the angle.')
        }
      } else {
        setStatus('Product not recognized. Try again.')
      }
    } catch (e) {
      console.error('Scan error:', e)
      setStatus('Could not identify. Try again.')
    }
    setScanning(false)
  }

  const selectProduct = (p) => {
    onMatch(p)
    stopCamera()
    onClose()
  }

  return (
    <div className="fixed inset-0 bg-black z-[500] flex flex-col">
      {/* Camera feed */}
      <div className="flex-1 relative overflow-hidden">
        <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
        <canvas ref={canvasRef} className="hidden" />

        {/* Scan frame */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="w-72 h-72 relative">
            <div className="absolute -top-0.5 -left-0.5 w-10 h-10 border-t-[3px] border-l-[3px] border-white rounded-tl-2xl" />
            <div className="absolute -top-0.5 -right-0.5 w-10 h-10 border-t-[3px] border-r-[3px] border-white rounded-tr-2xl" />
            <div className="absolute -bottom-0.5 -left-0.5 w-10 h-10 border-b-[3px] border-l-[3px] border-white rounded-bl-2xl" />
            <div className="absolute -bottom-0.5 -right-0.5 w-10 h-10 border-b-[3px] border-r-[3px] border-white rounded-br-2xl" />
            {scanning && <div className="absolute top-0 left-0 right-0 h-0.5 bg-[#f97316] animate-pulse" />}
          </div>
        </div>

        {/* Close */}
        <button onClick={() => { stopCamera(); onClose() }} className="absolute top-5 right-5 w-10 h-10 bg-black/50 backdrop-blur-sm rounded-xl flex items-center justify-center text-white">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </button>

        {/* Tip */}
        <div className="absolute top-5 left-5 right-16 safe-top">
          <div className="bg-black/50 backdrop-blur-sm rounded-xl px-3 py-2">
            <p className="text-white/80 text-xs">Point at the product or its name tag, then tap Scan</p>
          </div>
        </div>
      </div>

      {/* Bottom panel */}
      <div className="bg-[#0f1a15] px-5 pt-4 pb-6 safe-bottom">
        <p className="text-white/60 text-sm text-center mb-4">{status}</p>

        {/* Suggestions */}
        {suggestions.length > 0 && (
          <div className="space-y-2 mb-4 max-h-44 overflow-y-auto">
            {suggestions.map(p => (
              <button key={p.id} onClick={() => selectProduct(p)}
                className="w-full flex items-center gap-3 p-3 bg-white/10 rounded-xl text-left active:bg-white/20 transition">
                <div className="w-12 h-12 bg-white/10 rounded-lg overflow-hidden flex-shrink-0">
                  {p.image ? <img src={p.image + '?width=100&quality=60'} alt="" className="w-full h-full object-cover" /> : null}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-white text-sm font-semibold truncate">{p.name}</div>
                  <div className="text-white/40 text-xs">{p.category || ''}</div>
                </div>
                <div className="text-[#f97316] font-bold text-sm flex-shrink-0">Add</div>
              </button>
            ))}
          </div>
        )}

        {/* Scan button */}
        <button onClick={captureAndIdentify} disabled={scanning}
          className="w-full h-14 bg-[#f97316] text-white rounded-2xl text-base font-bold flex items-center justify-center gap-2 active:scale-[.98] transition disabled:opacity-50">
          {scanning ? (
            <><div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Identifying...</>
          ) : (
            <><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg> Scan Product</>
          )}
        </button>
      </div>
    </div>
  )
}
