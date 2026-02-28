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
        if (splitMode && extraData.splitCash !== undefined) {
          await sb.from('sales').update({ split_cash: num(extraData.splitCash), split_momo: num(extraData.splitMomo) }).eq('receipt_no', data.receiptNo)
        }
        deductStock(cart)
        return { receiptNo: data.receiptNo, date: new Date().toISOString(), customer: phone.trim() || 'Walk-in', cashier: user?.name || '', payment: paymentMethod, type: mode === 'wholesale' ? 'Wholesale' : 'Retail', items: cart, total: data.total, discount: data.discount, splitCash: extraData.splitCash, splitMomo: extraData.splitMomo }
      } else { toast.error(data?.error || error?.message || 'Error'); return null }
    } catch (e) { toast.error('Error: ' + e.message); return null }
  }

  const finishSale = (saleData) => {
    clearCart(); setDiscount(0); setPhone(''); setPayOpen(false); setSplitMode(false); setSplitCash(''); setMomoStep('idle'); setMomoMessage(''); setMomoRef('')
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
    if (!phone.trim() || phone.trim().length < 9) { toast.error('Enter customer phone for Momo'); return }
    setMomoStep('charging'); setMomoMessage('Initializing payment...')
    try {
      const momoAmount = splitMode ? splitRemainder : total
      const res = await fetch(CHARGE_URL + '?action=initialize', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: phone.trim(), amount: momoAmount, callbackUrl: window.location.origin }),
      })
      const data = await res.json()
      if (!data.success || !data.authorizationUrl) { setMomoStep('failed'); setMomoMessage(data.error || 'Failed to initialize'); return }
      setMomoRef(data.reference); setMomoStep('waiting'); setMomoMessage('Customer completing payment...')
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
          clearInterval(pollRef.current); setMomoStep('failed'); setMomoMessage('Payment not completed.'); return
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
    setMomoStep('success'); setMomoMessage('Payment received!')
    const extra = splitMode ? { splitCash: num(splitCash), splitMomo: splitRemainder } : {}
    const saleData = await recordSale(splitMode ? 'Split' : 'Momo', extra)
    if (saleData) { toast.success('Momo confirmed! ' + saleData.receiptNo); finishSale(saleData) }
    else { setMomoStep('failed'); setMomoMessage('Payment received but recording failed.') }
  }

  const cancelMomo = () => { if (pollRef.current) clearInterval(pollRef.current); setMomoStep('idle'); setMomoMessage(''); setMomoRef('') }

  const holdCart = () => {
    if (!cart.length) return
    setHeldCarts(prev => [...prev, { id: Date.now(), items: [...cart], phone: phone.trim(), discount: num(discount), time: new Date().toLocaleTimeString() }])
    clearCart(); setDiscount(0); setPhone('')
    toast.success('Cart held!')
  }

  const recallCart = (held) => {
    if (cart.length && !confirm('Replace current cart?')) return
    clearCart()
    const { addToCart } = useStore.getState()
    for (const item of held.items) { for (let i = 0; i < item.qty; i++) addToCart({ ...item, qty: undefined, lineTotal: undefined }) }
    setPhone(held.phone || ''); setDiscount(held.discount || 0)
    setHeldCarts(prev => prev.filter(h => h.id !== held.id))
    setShowHeld(false)
    toast.success('Cart recalled!')
  }

  const deleteHeld = (id) => { setHeldCarts(prev => prev.filter(h => h.id !== id)) }

  const completeSale = () => {
    if (splitMode) {
      if (num(splitCash) < 0 || num(splitCash) > total) { toast.error('Invalid cash amount'); return }
      if (splitRemainder > 0 && (!phone.trim() || phone.trim().length < 9)) { toast.error('Enter phone for Momo portion'); return }
      if (splitRemainder > 0) startMomoPayment(); else completeCashSale()
    } else if (payMethod === 'Cash') completeCashSale()
    else startMomoPayment()
  }

  return (
    <>
      {open && <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[300]" onClick={onClose} />}
      <div className={`fixed bottom-0 left-0 right-0 md:left-auto md:top-0 md:w-[400px] bg-white md:border-l border-gray-200 max-h-[92vh] md:max-h-full z-[301] flex flex-col transition-transform duration-300 ${open ? 'translate-y-0 md:translate-x-0' : 'translate-y-full md:translate-y-0 md:translate-x-full'} md:rounded-none rounded-t-2xl shadow-2xl`}>

        {/* Header */}
        <div className="md:hidden w-10 h-1 bg-gray-200 rounded-full mx-auto mt-2.5" />
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2.5">
            <h3 className="text-lg font-bold text-gray-800">Cart</h3>
            {cnt > 0 && <span className="bg-brand-500 text-white h-6 min-w-[24px] px-1.5 rounded-full text-xs font-bold flex items-center justify-center">{cnt}</span>}
          </div>
          <div className="flex gap-1.5">
            <button onClick={() => setShowHeld(true)} className="h-9 px-3 rounded-lg text-xs font-semibold bg-gray-50 text-gray-500 border border-gray-200 hover:bg-gray-100 transition relative">
              ⏸ Held{heldCarts.length > 0 && <span className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-amber-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center">{heldCarts.length}</span>}
            </button>
            <button onClick={holdCart} disabled={!cart.length} className="h-9 px-3 rounded-lg text-xs font-semibold bg-gray-50 text-gray-500 border border-gray-200 hover:bg-gray-100 transition disabled:opacity-30">⏸ Hold</button>
            <button onClick={() => { if (cart.length && confirm('Clear cart?')) clearCart() }} className="h-9 px-3 rounded-lg text-xs font-semibold bg-red-50 text-red-500 border border-red-100 hover:bg-red-100 transition">Clear</button>
          </div>
        </div>

        {/* Cart Items */}
        <div className="flex-1 overflow-y-auto px-5 py-3">
          {cnt === 0 ? (
            <div className="text-center py-14">
              <div className="text-5xl mb-3 opacity-20">🛒</div>
              <p className="text-gray-400 text-sm font-medium">Your cart is empty</p>
              <p className="text-gray-300 text-xs mt-1">Add products from the POS page</p>
            </div>
          ) : (
            <div className="space-y-2">
              {cart.map((c, i) => (
                <div key={i} className="flex items-center gap-3 p-3 rounded-xl bg-gray-50/80 border border-gray-100 hover:bg-gray-50 transition">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-gray-800 leading-tight">{c.name}</div>
                    <div className="text-xs text-gray-400 mt-0.5">{money(c.price)} each</div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button onClick={() => updateCartQty(i, -1)} className="w-8 h-8 rounded-lg bg-white border border-gray-200 text-gray-500 text-sm font-bold flex items-center justify-center hover:bg-gray-50 active:scale-90 transition">−</button>
                    <span className="text-sm font-bold w-7 text-center">{c.qty}</span>
                    <button onClick={() => { if (!updateCartQty(i, 1)) toast.error('Not enough stock') }} className="w-8 h-8 rounded-lg bg-white border border-gray-200 text-gray-500 text-sm font-bold flex items-center justify-center hover:bg-gray-50 active:scale-90 transition">+</button>
                  </div>
                  <span className="text-sm font-bold text-gray-800 min-w-[70px] text-right">{money(c.lineTotal)}</span>
                  <button onClick={() => removeFromCart(i)} className="w-8 h-8 rounded-lg text-red-400 hover:bg-red-50 hover:text-red-500 text-sm flex items-center justify-center transition">✕</button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-gray-100 bg-white safe-bottom">
          <div className="space-y-2 mb-3">
            <div className="flex justify-between text-sm"><span className="text-gray-400">Subtotal</span><span className="font-semibold text-gray-700">{money(sub)}</span></div>
            <div className="flex justify-between items-center text-sm">
              <span className="text-gray-400">Discount</span>
              <input type="number" className="w-20 h-8 px-2 bg-gray-50 border border-gray-200 rounded-lg text-sm font-semibold text-right focus:outline-none focus:border-brand-400" value={discount} min={0} onChange={e => setDiscount(e.target.value)} />
            </div>
            <div className="flex justify-between items-baseline pt-2 border-t border-dashed border-gray-200">
              <span className="text-base font-bold text-gray-800">Total</span>
              <span className="text-xl font-extrabold text-brand-500">{money(total)}</span>
            </div>
          </div>

          <input type="tel" className="w-full h-11 px-4 bg-gray-50 border border-gray-200 rounded-xl text-sm font-medium mb-3 focus:outline-none focus:border-brand-400 placeholder:text-gray-300"
            placeholder="📱 Customer phone (required for Momo)" value={phone} onChange={e => setPhone(e.target.value)} />

          <button onClick={() => cnt > 0 && setPayOpen(true)} disabled={cnt === 0}
            className="w-full h-12 bg-brand-500 hover:bg-brand-600 rounded-xl text-white text-base font-bold disabled:opacity-30 active:scale-[.98] transition-all shadow-sm shadow-brand-500/20">
            Complete Sale — {money(total)}
          </button>
        </div>
      </div>

      {/* Payment Modal */}
      <Modal open={payOpen} onClose={() => { if (momoStep === 'idle' || momoStep === 'failed') { setPayOpen(false); cancelMomo() } }} title="Payment">
        <div className="space-y-4">
          {(momoStep === 'idle' || momoStep === 'failed') && (<>
            {/* Amount */}
            <div className="bg-gray-50 rounded-xl p-5 text-center border border-gray-100">
              <div className="text-xs text-gray-400 font-medium">Amount Due</div>
              <div className="text-3xl font-extrabold text-gray-900 mt-1">{money(total)}</div>
            </div>

            {/* Payment Methods */}
            <div>
              <label className="block text-xs font-semibold text-gray-400 mb-2.5">Payment Method</label>
              <div className="grid grid-cols-3 gap-2.5">
                {[
                  { id: 'Cash', icon: '💵', label: 'Cash', color: 'bg-green-500', border: 'border-green-500' },
                  { id: 'Momo', icon: '📱', label: 'Momo', color: 'bg-amber-500', border: 'border-amber-500' },
                  { id: 'Split', icon: '✂️', label: 'Split', color: 'bg-violet-500', border: 'border-violet-500' },
                ].map(m => {
                  const active = m.id === 'Split' ? splitMode : (!splitMode && payMethod === m.id)
                  return (
                    <button key={m.id} onClick={() => { if (m.id === 'Split') { setSplitMode(true); setSplitCash('') } else { setPayMethod(m.id); setSplitMode(false) } }}
                      className={`h-20 rounded-xl text-sm font-bold border-2 flex flex-col items-center justify-center gap-1 transition-all ${active ? m.color + ' text-white ' + m.border + ' shadow-md' : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300'}`}>
                      <span className="text-xl">{m.icon}</span>{m.label}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Split Details */}
            {splitMode && (
              <div className="bg-violet-50 rounded-xl p-4 border border-violet-100 space-y-3">
                <div className="text-sm font-bold text-violet-700">Split Payment — {money(total)}</div>
                <div>
                  <label className="block text-xs font-semibold text-violet-600 mb-1.5">💵 Cash Amount</label>
                  <input type="number" className="w-full h-11 px-4 bg-white border border-violet-200 rounded-xl text-sm font-bold focus:outline-none focus:border-violet-400" placeholder="0.00" value={splitCash} min={0} max={total} onChange={e => setSplitCash(e.target.value)} />
                </div>
                <div className="flex justify-between items-center pt-2 border-t border-violet-200">
                  <span className="text-sm font-semibold text-amber-600">📱 Momo Portion</span>
                  <span className="text-lg font-extrabold text-amber-600">{money(Math.max(0, splitRemainder))}</span>
                </div>
              </div>
            )}

            {/* Warnings */}
            {!splitMode && payMethod === 'Momo' && !phone.trim() && <div className="bg-amber-50 rounded-xl p-3.5 text-amber-700 text-sm font-medium border border-amber-100">⚠️ Enter customer phone number above</div>}
            {momoStep === 'failed' && <div className="bg-red-50 rounded-xl p-3.5 text-red-600 text-sm font-medium border border-red-100">❌ {momoMessage}</div>}

            <button onClick={completeSale}
              disabled={processing || (!splitMode && payMethod === 'Momo' && (!phone.trim() || phone.trim().length < 9)) || (splitMode && splitRemainder > 0 && (!phone.trim() || phone.trim().length < 9))}
              className="w-full h-12 bg-brand-500 hover:bg-brand-600 text-white rounded-xl text-base font-bold disabled:opacity-30 active:scale-[.98] transition-all shadow-sm">
              {processing ? 'Processing...' : splitMode ? '✂️ Confirm Split' : payMethod === 'Cash' ? '💵 Confirm Cash' : '📱 Pay with Momo'}
            </button>
          </>)}

          {momoStep === 'charging' && <div className="text-center py-10"><div className="w-14 h-14 border-4 border-amber-100 border-t-amber-500 rounded-full animate-spin mx-auto mb-4" /><h3 className="text-lg font-bold mb-1">Initializing...</h3><p className="text-gray-400 text-sm">{momoMessage}</p></div>}
          {momoStep === 'waiting' && (
            <div className="text-center py-6">
              <div className="w-16 h-16 bg-amber-50 rounded-full flex items-center justify-center text-3xl mx-auto mb-4 animate-pulse">📱</div>
              <h3 className="text-lg font-bold mb-1">Waiting for Payment</h3>
              <p className="text-gray-400 text-sm mb-4">Paystack checkout window is open</p>
              <div className="bg-amber-50 rounded-xl p-4 mb-4 border border-amber-100">
                <div className="text-lg font-extrabold text-amber-700">{money(splitMode ? splitRemainder : total)}</div>
                <div className="text-sm text-amber-600 mt-0.5">{phone}</div>
              </div>
              <div className="flex items-center justify-center gap-1.5 text-amber-500 mb-4">
                <div className="w-1.5 h-1.5 bg-amber-400 rounded-full animate-bounce" style={{ animationDelay: '0s' }} />
                <div className="w-1.5 h-1.5 bg-amber-400 rounded-full animate-bounce" style={{ animationDelay: '0.15s' }} />
                <div className="w-1.5 h-1.5 bg-amber-400 rounded-full animate-bounce" style={{ animationDelay: '0.3s' }} />
                <span className="text-xs font-medium ml-1.5">Verifying</span>
              </div>
              <button onClick={() => { cancelMomo(); setMomoStep('idle') }} className="h-10 px-5 bg-gray-100 rounded-xl text-sm font-semibold text-gray-500 hover:bg-gray-200 transition">Cancel</button>
            </div>
          )}
          {momoStep === 'success' && <div className="text-center py-10"><div className="w-16 h-16 bg-green-50 rounded-full flex items-center justify-center text-3xl mx-auto mb-4">✅</div><h3 className="text-lg font-bold text-green-600 mb-1">Payment Received!</h3><p className="text-gray-400 text-sm">Recording sale...</p></div>}
        </div>
      </Modal>

      {/* Held Carts */}
      <Modal open={showHeld} onClose={() => setShowHeld(false)} title={'Held Carts (' + heldCarts.length + ')'}>
        <div className="space-y-2.5">
          {heldCarts.length === 0 && <div className="text-center py-10 text-gray-300"><div className="text-4xl mb-2 opacity-30">⏸</div><p className="text-sm">No held carts</p></div>}
          {heldCarts.map(h => (
            <div key={h.id} className="rounded-xl border border-gray-100 bg-gray-50/50 overflow-hidden">
              <div className="p-3.5">
                <div className="flex justify-between items-center mb-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-gray-700">{h.items.length} items</span>
                    <span className="text-xs text-gray-400">{h.time}</span>
                    {h.phone && <span className="text-xs text-gray-400">📱 {h.phone}</span>}
                  </div>
                  <span className="text-base font-extrabold text-brand-500">{money(h.items.reduce((a, c) => a + c.lineTotal, 0))}</span>
                </div>
                <div className="text-xs text-gray-400 leading-relaxed">{h.items.map(i => i.name).join(', ')}</div>
              </div>
              <div className="flex border-t border-gray-100">
                <button onClick={() => recallCart(h)} className="flex-1 h-10 text-sm font-semibold text-brand-500 hover:bg-brand-50 transition">↩ Recall</button>
                <button onClick={() => deleteHeld(h.id)} className="h-10 px-4 text-sm font-semibold text-red-400 hover:bg-red-50 border-l border-gray-100 transition">🗑</button>
              </div>
            </div>
          ))}
        </div>
      </Modal>
    </>
  )
}
