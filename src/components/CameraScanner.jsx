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
        video: { facingMode: 'environment', width: { ideal: 640 }, height: { ideal: 480 } }
      })
      setStream(s)
      if (videoRef.current) {
        videoRef.current.srcObject = s
        videoRef.current.play()
      }
      setStatus('Point camera at the product and tap Scan')
    } catch (e) {
      setStatus('Camera access denied. Please allow camera access.')
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
    canvas.width = 640
    canvas.height = 480
    const ctx = canvas.getContext('2d')
    ctx.drawImage(video, 0, 0, 640, 480)
    const imageData = canvas.toDataURL('image/jpeg', 0.7).split(',')[1]

    // Build product list for AI
    const productList = products.map(p => `- ${p.name} (${p.category || 'General'})`).join('\n')

    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 300,
          messages: [{
            role: 'user',
            content: [
              {
                type: 'image',
                source: { type: 'base64', media_type: 'image/jpeg', data: imageData }
              },
              {
                type: 'text',
                text: `You are a product identification system for a home furnishing store called EVERYTINROOM. Look at this image and identify which product(s) from the store's inventory it matches.

Here are ALL the products in the store:
${productList}

Rules:
- Return ONLY a JSON array of the top 1-3 most likely matching product names from the list above
- Match EXACTLY as spelled in the list
- If you're not sure, return your best 2-3 guesses
- If the image doesn't match any product, return an empty array []
- Return ONLY the JSON array, nothing else

Example response: ["16 pieces dinner set white", "16 pieces dinner set black"]`
              }
            ]
          }]
        })
      })

      const data = await res.json()
      const text = data.content?.[0]?.text || '[]'
      const clean = text.replace(/```json|```/g, '').trim()
      
      let matches = []
      try { matches = JSON.parse(clean) } catch { matches = [] }

      if (matches.length > 0) {
        const matched = matches.map(name => products.find(p => p.name === name)).filter(Boolean)
        if (matched.length === 1) {
          setStatus(`Found: ${matched[0].name}`)
          setSuggestions(matched)
        } else if (matched.length > 1) {
          setStatus('Select the correct product:')
          setSuggestions(matched)
        } else {
          setStatus('Could not identify. Try again or search manually.')
        }
      } else {
        setStatus('Could not identify. Try again or search manually.')
      }
    } catch (e) {
      setStatus('Error identifying. Check your connection.')
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
        
        {/* Scan frame overlay */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="w-64 h-64 border-2 border-white/40 rounded-3xl relative">
            <div className="absolute -top-0.5 -left-0.5 w-8 h-8 border-t-3 border-l-3 border-white rounded-tl-2xl" />
            <div className="absolute -top-0.5 -right-0.5 w-8 h-8 border-t-3 border-r-3 border-white rounded-tr-2xl" />
            <div className="absolute -bottom-0.5 -left-0.5 w-8 h-8 border-b-3 border-l-3 border-white rounded-bl-2xl" />
            <div className="absolute -bottom-0.5 -right-0.5 w-8 h-8 border-b-3 border-r-3 border-white rounded-br-2xl" />
          </div>
        </div>

        {/* Close button */}
        <button onClick={() => { stopCamera(); onClose() }} className="absolute top-5 right-5 w-10 h-10 bg-black/40 backdrop-blur rounded-xl flex items-center justify-center text-white safe-top">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </button>
      </div>

      {/* Bottom panel */}
      <div className="bg-[#0f1a15] px-5 pt-4 pb-6 safe-bottom">
        <p className="text-white/60 text-sm text-center mb-4">{status}</p>

        {/* Suggestions */}
        {suggestions.length > 0 && (
          <div className="space-y-2 mb-4">
            {suggestions.map(p => (
              <button key={p.id} onClick={() => selectProduct(p)}
                className="w-full flex items-center gap-3 p-3 bg-white/10 rounded-xl text-left active:bg-white/20 transition">
                <div className="w-12 h-12 bg-white/10 rounded-lg overflow-hidden flex-shrink-0">
                  {p.image ? <img src={p.image + '?width=100&quality=60'} alt="" className="w-full h-full object-cover" /> : <div className="w-full h-full" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-white text-sm font-semibold truncate">{p.name}</div>
                  <div className="text-white/40 text-xs">{p.category}</div>
                </div>
                <div className="text-white font-bold text-sm">Add</div>
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
