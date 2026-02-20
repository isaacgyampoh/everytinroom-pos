import { useState, useEffect, useRef } from 'react'
import { useStore } from '../hooks/useStore'
import { getSupabase } from '../lib/supabase'
import { money, num } from '../lib/utils'
import Modal from './Modal'
import toast from 'react-hot-toast'

const CHARGE_URL = 'https://noiiuwkovoojkcwzupye.supabase.co/functions/v1/charge-momo'

export default function CartDrawer({ open, onClose, onReceipt }) {
  const { cart, updateCartQty, removeFromCart, clearCart, deductStock, user, mode } = useStore()
  const [discount, setDiscount] = useState(0)
  const [phone, setPhone] = useState('')
  const [payOpen, setPayOpen] = useState(false)
  const [payMethod, setPayMethod] = useState('Cash')
  const [processing, setProcessing] = useState(false)

  // Split payment
  const [splitMode, setSplitMode] = useState(false)
  const [splitCash, setSplitCash] = useState('')
  const [splitMomo, setSplitMomo] = useState('')

  // Hold cart
  const [heldCarts, setHeldCarts] = useState(() => {
    try { return JSON.parse(localStorage.getItem('heldCarts') || '[]') } catch { return [] }
  })
  const [showHeld, setShowHeld] = useState(false)

  // Momo states
  const [momoStep, setMomoStep] = useState('idle')
  const [momoMessage, setMomoMessage] = useState('')
  const [momoRef, setMomoRef] = useState('')
  const pollRef = useRef(null)

  const sub = cart.reduce((a, c) => a + c.lineTotal, 0)
  const total = Math.max(0, sub - num(discount))
  const cnt = cart.reduce((a, c) => a + c.qty, 0)
  const splitRemainder = total - num(splitCash)

  useEffect(() => { return () => { if (pollRef.current) clearInterval(pollRef.current) } }, [])
  useEffect(() => { localStorage.setItem('heldCarts', JSON.stringify(heldCarts)) }, [heldCarts])

  const recordSale = async (paymentMethod, extraData = {}) => {
    const sb = getSupabase(); if (!sb) return null
    try {
      const { data, error } = await sb.rpc('record_sale', {
        p_items: cart, p_customer: phone.trim() || 'Walk-in', p_payment: paymentMethod,
        p_discount: num(discount), p_type: mode === 'wholesale' ? 'Wholesale' : 'Retail', p_cashier: user?.name || '',
      })
      if (data?.success) {
        // Update split amounts if split payment
        if (splitMode && extraData.splitCash !== undefined) {
          await sb.from('sales').update({ split_cash: num(extraData.splitCash), split_momo: num(extraData.splitMomo) }).eq('receipt_no', data.receiptNo)
        }
        deductStock(cart)
        return { receiptNo: data.receiptNo, date: new Date().toISOString(), customer: phone.trim() || 'Walk-in', cashier: user?.name || '', payment: paymentMethod, type: mode === 'wholesale' ? 'Wholesale' : 'Retail', items: cart, total: data.total, discount: data.discount, splitCash: extraData.splitCash, splitMomo: extraData.splitMomo }
      } else { toast.error(data?.error || error?.message || 'Error'); return null }
    } catch (e) { toast.error('Error: ' + e.message); return null }
  }

  const finishSale = (saleData) => {
    clearCart(); setDiscount(0); setPhone(''); setPayOpen(false); setSplitMode(false); setSplitCash(''); setSplitMomo(''); setMomoStep('idle'); setMomoMessage(''); setMomoRef('')
    onClose()
    if (onReceipt) onReceipt(saleData)
  }

  const completeCashSale = async () => {
    setProcessing(true)
    const extra = splitMode ? { splitCash: num(splitCash), splitMomo: splitRemainder } : {}
    const saleData = await recordSale(splitMode ? 'Split' : 'Cash', extra)
    if (saleData) { toast.success('Sale done! ' + saleData.receiptNo); finishSale(saleData) }
    setProcessing(false)
  }

  const startMomoPayment = async () => {
    if (!phone.trim() || phone.trim().length < 9) { toast.error('Enter customer phone number for Momo'); return }
    setMomoStep('charging'); setMomoMessage('Initializing payment...')
    try {
      const momoAmount = splitMode ? splitRemainder : total
      const res = await fetch(CHARGE_URL + '?action=initialize', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: phone.trim(), amount: momoAmount, callbackUrl: window.location.origin }),
      })
      const data = await res.json()
      if (!data.success || !data.authorizationUrl) { setMomoStep('failed'); setMomoMessage(data.error || 'Failed to initialize payment'); return }
      setMomoRef(data.reference); setMomoStep('waiting'); setMomoMessage('Customer is completing payment...')
      const popup = window.open(data.authorizationUrl, 'paystack_checkout', 'width=500,height=700,scrollbars=yes')
      let attempts = 0
      pollRef.current = setInterval(async () => {
        attempts++
        if (popup && popup.closed && attempts > 10) {
          try {
            const vRes = await fetch(CHARGE_URL + '?action=verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reference: data.reference }) })
            const vData = await vRes.json()
            if (vData.paymentStatus === 'success') { clearInterval(pollRef.current); await handlePaymentSuccess(); return }
          } catch {}
          clearInterval(pollRef.current); setMomoStep('failed'); setMomoMessage('Payment was not completed.'); return
        }
        if (attempts >= 90) { clearInterval(pollRef.current); if (popup && !popup.closed) popup.close(); setMomoStep('failed'); setMomoMessage('Payment timed out.'); return }
        try {
          const vRes = await fetch(CHARGE_URL + '?action=verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reference: data.reference }) })
          const vData = await vRes.json()
          if (vData.paymentStatus === 'success') { clearInterval(pollRef.current); if (popup && !popup.closed) popup.close(); await handlePaymentSuccess() }
          else if (vData.paymentStatus === 'failed') { clearInterval(pollRef.current); if (popup && !popup.closed) popup.close(); setMomoStep('failed'); setMomoMessage('Payment failed.') }
        } catch {}
      }, 2000)
    } catch (e) { setMomoStep('failed'); setMomoMessage('Network error: ' + e.message) }
  }

  const handlePaymentSuccess = async () => {
    setMomoStep('success'); setMomoMessage('Payment received! Recording sale...')
    const extra = splitMode ? { splitCash: num(splitCash), splitMomo: splitRemainder } : {}
    const saleData = await recordSale(splitMode ? 'Split' : 'Momo', extra)
    if (saleData) { toast.success('Momo payment confirmed! ' + saleData.receiptNo); finishSale(saleData) }
    else { setMomoStep('failed'); setMomoMessage('Payment received but recording failed.') }
  }

  const cancelMomo = () => { if (pollRef.current) clearInterval(pollRef.current); setMomoStep('idle'); setMomoMessage(''); setMomoRef('') }

  // Hold cart
  const holdCart = () => {
    if (!cart.length) return
    const held = { id: Date.now(), items: [...cart], phone: phone.trim(), discount: num(discount), time: new Date().toLocaleTimeString() }
    setHeldCarts(prev => [...prev, held])
    clearCart(); setDiscount(0); setPhone('')
    toast.success('Cart held! ' + held.items.length + ' items')
  }

  const recallCart = (held) => {
    if (cart.length && !confirm('Replace current cart?')) return
    clearCart()
    // Re-add items via store
    const { addToCart } = useStore.getState()
    for (const item of held.items) { for (let i = 0; i < item.qty; i++) addToCart({ ...item, qty: undefined, lineTotal: undefined }) }
    setPhone(held.phone || ''); setDiscount(held.discount || 0)
    setHeldCarts(prev => prev.filter(h => h.id !== held.id))
    setShowHeld(false)
    toast.success('Cart recalled!')
  }

  const deleteHeld = (id) => { setHeldCarts(prev => prev.filter(h => h.id !== id)); toast.success('Removed') }

  const completeSale = () => {
    if (splitMode) {
      if (num(splitCash) < 0 || num(splitCash) > total) { toast.error('Invalid cash amount'); return }
      if (splitRemainder > 0 && (!phone.trim() || phone.trim().length < 9)) { toast.error('Enter phone for Momo portion'); return }
      if (splitRemainder > 0) startMomoPayment()
      else completeCashSale() // All cash
    } else if (payMethod === 'Cash') completeCashSale()
    else startMomoPayment()
  }

  return (
    <>
      {open && <div className="fixed inset-0 bg-black/60 z-[300]" onClick={onClose} />}
      <div className={`fixed bottom-0 left-0 right-0 md:left-auto md:top-0 md:w-[440px] md:rounded-l-3xl bg-white rounded-t-3xl max-h-[92vh] md:max-h-full z-[301] flex flex-col transition-transform duration-300 ${open ? 'translate-y-0 md:translate-x-0' : 'translate-y-full md:translate-y-0 md:translate-x-full'}`}>
        <div className="w-12 h-1.5 bg-gray-200 rounded-full mx-auto mt-3.5 md:hidden" />
        <div className="flex items-center justify-between px-6 pb-5 border-b border-gray-100">
          <h3 className="text-xl md:text-2xl font-extrabold">🛒 Cart <span className="bg-brand-500 text-white py-1.5 px-3.5 rounded-full text-sm font-bold">{cnt}</span></h3>
          <div className="flex gap-2">
            <button onClick={() => setShowHeld(true)} className="h-10 px-3 bg-amber-50 text-amber-600 rounded-lg text-sm font-semibold relative">
              ⏸️{heldCarts.length > 0 && <span className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-amber-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">{heldCarts.length}</span>}
            </button>
            <button onClick={holdCart} disabled={!cart.length} className="h-10 px-3 bg-blue-50 text-blue-600 rounded-lg text-sm font-semibold disabled:opacity-40">⏸️ Hold</button>
            <button onClick={() => { if (cart.length && confirm('Clear cart?')) clearCart() }} className="h-10 px-3.5 bg-red-50 text-red-600 rounded-lg text-sm font-semibold">Clear</button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5 md:max-h-[40vh]">
          {cnt === 0 ? <div className="text-center py-10 text-gray-400"><span className="text-5xl block mb-3 opacity-40">🛒</span>Cart is empty</div>
          : cart.map((c, i) => (
            <div key={i} className="flex items-center gap-3 p-3.5 bg-gray-50 rounded-xl mb-2.5">
              <div className="flex-1"><div className="text-sm md:text-base font-semibold">{c.name}</div></div>
              <div className="flex items-center gap-2">
                <button onClick={() => updateCartQty(i, -1)} className="w-9 h-9 rounded-lg bg-white border-2 border-gray-200 text-lg font-semibold flex items-center justify-center">−</button>
                <span className="text-base font-bold min-w-[24px] text-center">{c.qty}</span>
                <button onClick={() => { if (!updateCartQty(i, 1)) toast.error('Not enough stock') }} className="w-9 h-9 rounded-lg bg-white border-2 border-gray-200 text-lg font-semibold flex items-center justify-center">+</button>
              </div>
              <span className="text-sm md:text-base font-bold text-brand-500">{money(c.lineTotal)}</span>
              <button onClick={() => removeFromCart(i)} className="w-9 h-9 rounded-lg bg-red-50 text-red-500 text-base flex items-center justify-center">✕</button>
            </div>
          ))}
        </div>

        <div className="p-5 safe-bottom border-t border-gray-100 bg-gray-50">
          <div className="mb-4 space-y-2.5">
            <div className="flex justify-between text-sm md:text-base text-gray-500"><span>Subtotal</span><b className="text-gray-900">{money(sub)}</b></div>
            <div className="flex justify-between items-center text-sm md:text-base text-gray-500"><span>Discount</span><input type="number" className="w-24 h-10 px-2.5 bg-white border-2 border-gray-200 rounded-lg text-sm md:text-base font-semibold text-right" value={discount} min={0} onChange={e => setDiscount(e.target.value)} /></div>
            <div className="flex justify-between text-xl md:text-2xl font-extrabold pt-3 border-t-2 border-dashed border-gray-200"><span>Total</span><b className="text-brand-500">{money(total)}</b></div>
          </div>
          <input type="tel" className="w-full h-[50px] px-4 bg-white border-2 border-gray-200 rounded-xl text-base mb-3" placeholder="📱 Customer phone (required for Momo)" value={phone} onChange={e => setPhone(e.target.value)} />
          <button onClick={() => cnt > 0 && setPayOpen(true)} disabled={cnt === 0} className="w-full h-14 bg-green-500 rounded-xl text-white text-lg font-bold disabled:opacity-50 active:scale-[.97] transition">✓ Complete Sale</button>
        </div>
      </div>

      {/* Payment Modal */}
      <Modal open={payOpen} onClose={() => { if (momoStep === 'idle' || momoStep === 'failed') { setPayOpen(false); cancelMomo() } }} title="💳 Payment">
        <div className="space-y-4">
          {(momoStep === 'idle' || momoStep === 'failed') && (<>
            <div><label className="block text-xs md:text-sm font-semibold text-gray-500 mb-3">Payment Method</label>
              <div className="grid grid-cols-3 gap-3">
                <button onClick={() => { setPayMethod('Cash'); setSplitMode(false) }} className={`h-20 rounded-2xl text-base font-bold border-3 transition flex flex-col items-center justify-center gap-1 ${!splitMode && payMethod === 'Cash' ? 'bg-green-500 text-white border-green-500' : 'bg-white border-gray-200 text-gray-600'}`}><span className="text-2xl">💵</span>Cash</button>
                <button onClick={() => { setPayMethod('Momo'); setSplitMode(false) }} className={`h-20 rounded-2xl text-base font-bold border-3 transition flex flex-col items-center justify-center gap-1 ${!splitMode && payMethod === 'Momo' ? 'bg-amber-500 text-white border-amber-500' : 'bg-white border-gray-200 text-gray-600'}`}><span className="text-2xl">📱</span>Momo</button>
                <button onClick={() => { setSplitMode(true); setSplitCash(''); setSplitMomo('') }} className={`h-20 rounded-2xl text-base font-bold border-3 transition flex flex-col items-center justify-center gap-1 ${splitMode ? 'bg-violet-500 text-white border-violet-500' : 'bg-white border-gray-200 text-gray-600'}`}><span className="text-2xl">✂️</span>Split</button>
              </div>
            </div>

            {/* Split Payment */}
            {splitMode && (
              <div className="bg-violet-50 border-2 border-violet-200 rounded-xl p-4 space-y-3">
                <div className="text-sm font-bold text-violet-700">✂️ Split Payment — Total: {money(total)}</div>
                <div>
                  <label className="block text-xs font-semibold text-violet-600 mb-1">💵 Cash Amount</label>
                  <input type="number" className="w-full h-12 px-4 bg-white border-2 border-violet-200 rounded-xl text-base font-bold" placeholder="0.00" value={splitCash} min={0} max={total} onChange={e => setSplitCash(e.target.value)} />
                </div>
                <div className="flex justify-between text-sm font-semibold">
                  <span className="text-amber-600">📱 Momo Portion:</span>
                  <span className="text-amber-600 text-lg font-extrabold">{money(Math.max(0, splitRemainder))}</span>
                </div>
                {splitRemainder > 0 && !phone.trim() && <div className="text-xs text-amber-600 font-semibold">⚠️ Enter phone number for the Momo portion</div>}
              </div>
            )}

            {!splitMode && payMethod === 'Momo' && !phone.trim() && <div className="bg-amber-50 border-2 border-amber-200 rounded-xl p-4 text-amber-700 text-sm md:text-base font-semibold">⚠️ Enter customer phone number for Momo</div>}
            {!splitMode && payMethod === 'Momo' && phone.trim() && <div className="bg-amber-50 border-2 border-amber-200 rounded-xl p-4 text-sm md:text-base"><div className="font-bold text-amber-700 mb-1">📱 Mobile Money Payment</div><div className="text-amber-600">A Paystack checkout window will open for payment.</div></div>}
            {momoStep === 'failed' && <div className="bg-red-50 border-2 border-red-200 rounded-xl p-4 text-red-600 text-sm md:text-base font-semibold">❌ {momoMessage}</div>}
            <div className="bg-brand-500 rounded-2xl p-6 text-white"><small className="text-sm opacity-80">Amount Due</small><strong className="block text-4xl font-extrabold mt-2">{money(total)}</strong></div>

            <button onClick={completeSale}
              disabled={processing || (!splitMode && payMethod === 'Momo' && (!phone.trim() || phone.trim().length < 9)) || (splitMode && splitRemainder > 0 && (!phone.trim() || phone.trim().length < 9))}
              className="w-full h-14 bg-green-500 text-white rounded-xl text-lg font-bold disabled:opacity-50 active:scale-[.97] transition">
              {processing ? 'Processing...' : splitMode ? '✂️ Confirm Split Payment' : payMethod === 'Cash' ? '💵 Confirm Cash Payment' : '📱 Open Momo Payment'}
            </button>
          </>)}

          {momoStep === 'charging' && <div className="text-center py-10"><div className="w-16 h-16 border-4 border-amber-200 border-t-amber-500 rounded-full animate-spin mx-auto mb-5" /><h3 className="text-xl font-bold mb-2">Initializing Payment...</h3><p className="text-gray-500">{momoMessage}</p></div>}
          {momoStep === 'waiting' && (
            <div className="text-center py-6">
              <div className="w-20 h-20 bg-amber-100 rounded-full flex items-center justify-center text-4xl mx-auto mb-5 animate-pulse">📱</div>
              <h3 className="text-xl font-bold mb-2">Waiting for Payment...</h3>
              <p className="text-gray-500 mb-4">Customer is completing payment in the Paystack window</p>
              <div className="bg-amber-50 border-2 border-amber-200 rounded-xl p-5 mb-5">
                <div className="text-amber-700 font-bold text-lg mb-1">{money(splitMode ? splitRemainder : total)}</div>
                <div className="text-amber-600 text-sm">Phone: {phone}</div>
              </div>
              <div className="flex items-center justify-center gap-2 text-amber-500 mb-5">
                <div className="w-2 h-2 bg-amber-500 rounded-full animate-bounce" style={{ animationDelay: '0s' }} />
                <div className="w-2 h-2 bg-amber-500 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }} />
                <div className="w-2 h-2 bg-amber-500 rounded-full animate-bounce" style={{ animationDelay: '0.4s' }} />
                <span className="text-sm font-semibold ml-2">Verifying...</span>
              </div>
              <button onClick={() => { cancelMomo(); setMomoStep('idle') }} className="h-12 px-6 bg-gray-100 rounded-xl text-sm font-semibold text-gray-600">Cancel</button>
            </div>
          )}
          {momoStep === 'success' && <div className="text-center py-10"><div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center text-4xl mx-auto mb-5">✅</div><h3 className="text-xl font-bold text-green-600 mb-2">Payment Received!</h3><p className="text-gray-500">Recording sale and printing receipt...</p></div>}
        </div>
      </Modal>

      {/* Held Carts Modal */}
      <Modal open={showHeld} onClose={() => setShowHeld(false)} title={'⏸️ Held Carts (' + heldCarts.length + ')'}>
        <div className="space-y-3">
          {heldCarts.length === 0 && <div className="text-center py-8 text-gray-400">No held carts</div>}
          {heldCarts.map(h => (
            <div key={h.id} className="bg-gray-50 rounded-xl p-4">
              <div className="flex justify-between items-center mb-2">
                <div>
                  <span className="text-sm font-bold">{h.items.length} items</span>
                  <span className="text-xs text-gray-400 ml-2">{h.time}</span>
                  {h.phone && <span className="text-xs text-gray-400 ml-2">📱 {h.phone}</span>}
                </div>
                <span className="text-base font-extrabold text-brand-500">{money(h.items.reduce((a, c) => a + c.lineTotal, 0))}</span>
              </div>
              <div className="text-xs text-gray-400 mb-3">{h.items.map(i => i.name).join(', ')}</div>
              <div className="flex gap-2">
                <button onClick={() => recallCart(h)} className="flex-1 h-10 bg-brand-500 text-white rounded-lg text-sm font-semibold">↩️ Recall</button>
                <button onClick={() => deleteHeld(h.id)} className="h-10 px-4 bg-red-50 text-red-500 rounded-lg text-sm font-semibold">🗑️</button>
              </div>
            </div>
          ))}
        </div>
      </Modal>
    </>
  )
}
