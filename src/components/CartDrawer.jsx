import { useState, useEffect, useRef } from 'react'
import { useStore } from '../hooks/useStore'
import { getSupabase } from '../lib/supabase'
import { money, num } from '../lib/utils'
import { broadcastDisplay } from '../hooks/useCustomerDisplay'
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
  const [splitMode, setSplitMode] = useState(false)
  const [splitCash, setSplitCash] = useState('')
  const [heldCarts, setHeldCarts] = useState(() => { try { return JSON.parse(localStorage.getItem('heldCarts') || '[]') } catch { return [] } })
  const [showHeld, setShowHeld] = useState(false)
  const [momoStep, setMomoStep] = useState('idle')
  const [momoMessage, setMomoMessage] = useState('')
  const pollRef = useRef(null)

  const sub = cart.reduce((a, c) => a + c.lineTotal, 0)
  const total = Math.max(0, sub - num(discount))
  const cnt = cart.reduce((a, c) => a + c.qty, 0)
  const splitRemainder = total - num(splitCash)
  const phoneValid = phone.trim().length >= 9

  useEffect(() => { return () => { if (pollRef.current) clearInterval(pollRef.current) } }, [])

  // Reflect checkout on the customer display (purely visual; no payment logic)
  useEffect(() => {
    if (payOpen) broadcastDisplay({ status: 'paying', total, count: cnt, subtotal: sub, items: cart.map(c => ({ name: c.name, qty: c.qty, price: c.price, lineTotal: c.lineTotal, image: c.image || '' })) })
  }, [payOpen]) // eslint-disable-line
  useEffect(() => { localStorage.setItem('heldCarts', JSON.stringify(heldCarts)) }, [heldCarts])

  const recordSale = async (paymentMethod, extraData = {}) => {
    const sb = getSupabase(); if (!sb) return null
    try {
      const { data, error } = await sb.rpc('record_sale', {
        p_items: cart, p_customer: phone.trim(), p_payment: paymentMethod,
        p_discount: num(discount), p_type: mode === 'wholesale' ? 'Wholesale' : 'Retail', p_cashier: user?.name || '',
      })
      if (data?.success) {
        if (extraData.splitCash !== undefined) {
          await sb.from('sales').update({ split_cash: num(extraData.splitCash), split_momo: num(extraData.splitMomo) }).eq('receipt_no', data.receiptNo)
        }
        deductStock(cart)
        return { receiptNo: data.receiptNo, date: new Date().toISOString(), customer: phone.trim(), cashier: user?.name || '', payment: paymentMethod, type: mode === 'wholesale' ? 'Wholesale' : 'Retail', items: cart, total: data.total, discount: data.discount, splitCash: extraData.splitCash, splitMomo: extraData.splitMomo }
      } else { toast.error(data?.error || error?.message || 'Error'); return null }
    } catch (e) { toast.error('Error: ' + e.message); return null }
  }

  const finishSale = (saleData) => {
    clearCart(); setDiscount(0); setPhone(''); setPayOpen(false); setSplitMode(false); setSplitCash(''); setMomoStep('idle'); setMomoMessage('')
    onClose()
    if (onReceipt) onReceipt(saleData)
  }

  // Cash or manual Momo — just record directly
  const completeDirectSale = async (method) => {
    setProcessing(true)
    const extra = splitMode ? { splitCash: num(splitCash), splitMomo: splitRemainder } : {}
    const saleData = await recordSale(splitMode ? 'Split' : method, extra)
    if (saleData) { toast.success('Sale done! ' + saleData.receiptNo); finishSale(saleData) }
    setProcessing(false)
  }


  const cancelPaystack = () => { if (pollRef.current) clearInterval(pollRef.current); setMomoStep('idle'); setMomoMessage('') }

  const holdCart = () => {
    if (!cart.length) return
    setHeldCarts(prev => [...prev, { id: Date.now(), items: [...cart], phone: phone.trim(), discount: num(discount), time: new Date().toLocaleTimeString() }])
    clearCart(); setDiscount(0); setPhone(''); toast.success('Cart held!')
  }

  const recallCart = (held) => {
    if (cart.length && !confirm('Replace current cart?')) return
    clearCart()
    const { addToCart } = useStore.getState()
    for (const item of held.items) { for (let i = 0; i < item.qty; i++) addToCart({ ...item, qty: undefined, lineTotal: undefined }) }
    setPhone(held.phone || ''); setDiscount(held.discount || 0)
    setHeldCarts(prev => prev.filter(h => h.id !== held.id)); setShowHeld(false); toast.success('Cart recalled!')
  }

  const deleteHeld = (id) => { setHeldCarts(prev => prev.filter(h => h.id !== id)) }

  const handleCompleteSale = () => {
    // PHONE IS REQUIRED
    if (!phoneValid) { toast.error('Phone number is required'); return }

    if (splitMode) {
      if (num(splitCash) < 0 || num(splitCash) > total) { toast.error('Invalid cash amount'); return }
      if (splitRemainder > 0) createUssdInvoice(splitRemainder, true) // USSD for momo portion of split
      else completeDirectSale('Cash') // All cash in split
    } else if (payMethod === 'Cash') completeDirectSale('Cash')
    else if (payMethod === 'Momo') completeDirectSale('Momo') // Manual momo — just record it
    else createUssdInvoice(total, false) // USSD payment
  }

  // Create a WhatsApp order with USSD code for payment
  const createUssdInvoice = async (amount, isSplit) => {
    setProcessing(true)
    setMomoStep('charging'); setMomoMessage('Creating USSD invoice...')
    try {
      const sb = getSupabase()
      const orderNo = 'POS-' + Date.now().toString(36).toUpperCase()
      const items = cart.map(c => ({ name: c.name, qty: c.qty, price: c.price, lineTotal: c.lineTotal }))
      
      // Get next USSD code
      const { data: mc } = await sb.from('whatsapp_orders').select('ussd_code').order('ussd_code', { ascending: false }).limit(1)
      const uc = (mc?.[0]?.ussd_code || 0) + 1

      // Create order
      await sb.from('whatsapp_orders').insert({
        order_no: orderNo, date: new Date().toISOString(),
        customer_name: phone.trim(), customer_phone: phone.trim(),
        items: JSON.stringify(items), subtotal: total, total: amount,
        notes: isSplit ? `Split: Cash ${money(num(splitCash))}, USSD ${money(amount)}` : 'POS USSD Payment',
        status: 'Pending', ussd_code: uc, paystack_ref: orderNo,
      })

      // Auto-send the USSD code to the customer by SMS (server-side; key stays on backend)
      let smsOk = false
      try {
        const r = await fetch('https://noiiuwkovoojkcwzupye.supabase.co/functions/v1/charge-momo?action=send-ussd-code', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ orderNo })
        })
        const j = await r.json(); smsOk = !!j.success
      } catch {}

      // MOOLRE: push the instant approve-with-PIN prompt straight to the customer's phone.
      // Toggle on by setting localStorage 'use-moolre' = '1' (lets you test without removing NaloPay).
      let moolrePrompt = false
      if (localStorage.getItem('use-moolre') === '1') {
        try {
          const mr = await fetch('https://noiiuwkovoojkcwzupye.supabase.co/functions/v1/charge-momo?action=moolre-charge', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone: phone.trim(), amount, orderNo, externalref: orderNo })
          })
          const mj = await mr.json(); moolrePrompt = !!mj.success
          if (!moolrePrompt) console.warn('Moolre charge failed:', mj.error)
        } catch (e) { console.warn('Moolre charge error:', e) }
      }

      // Record the cash portion of split immediately
      if (isSplit && num(splitCash) > 0) {
        await recordSale('Split', { splitCash: num(splitCash), splitMomo: amount })
      }

      setMomoStep('waiting')
      setMomoMessage(moolrePrompt ? `Payment prompt sent to ${phone.trim()}.\nAmount: ${money(amount)}\n\nCustomer approves with their MoMo PIN on their phone.` : (smsOk ? `USSD code sent to ${phone.trim()} by SMS.\nCode: *920*141*${uc}#\nAmount: ${money(amount)}\n\nCustomer dials it to pay via MoMo.` : `USSD Code: *920*141*${uc}#\nAmount: ${money(amount)}\n\nTell customer to dial this code to pay via MoMo.`))
      
      // Poll for payment
      if (pollRef.current) clearInterval(pollRef.current)
      pollRef.current = setInterval(async () => {
        const { data } = await sb.from('whatsapp_orders').select('status').eq('ussd_code', uc).limit(1)
        if (data?.[0]?.status === 'Paid' || data?.[0]?.status === 'Completed') {
          clearInterval(pollRef.current)
          if (!isSplit) {
            const saleData = await recordSale('Momo')
            if (saleData) { toast.success('USSD Payment confirmed! ' + saleData.receiptNo); finishSale(saleData) }
          } else {
            toast.success('USSD Payment confirmed!')
            finishSale(null)
          }
        }
      }, 5000)
    } catch (e) {
      setMomoStep('failed'); setMomoMessage('Error: ' + e.message)
    }
    setProcessing(false)
  }

  // Block "Complete Sale" if no phone
  const handleOpenPayment = () => {
    if (!phoneValid) { toast.error('Enter phone number first'); return }
    if (cnt === 0) return
    setPayOpen(true)
  }

  return (
    <>
      {open && <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[300]" onClick={onClose} />}
      <div className={`cart-drawer fixed bottom-0 left-0 right-0 md:left-auto md:top-0 md:w-[400px] bg-white md:border-l border-gray-200 max-h-[92vh] md:max-h-full z-[301] flex flex-col transition-transform duration-300 ${open ? 'translate-y-0 md:translate-x-0' : 'translate-y-full md:translate-y-0 md:translate-x-full'} md:rounded-none rounded-t-2xl shadow-2xl`}>

        <div className="md:hidden w-10 h-1 bg-gray-200 rounded-full mx-auto mt-2.5" />
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2.5">
            <h3 className="text-lg font-bold text-gray-900">Cart</h3>
            {cnt > 0 && <span className="bg-gray-500 text-white h-6 min-w-[24px] px-1.5 rounded-full text-xs font-bold flex items-center justify-center">{cnt}</span>}
          </div>
          <div className="flex gap-1.5">
            <button onClick={() => setShowHeld(true)} className="h-9 px-3 rounded-lg text-xs font-semibold bg-gray-50 text-gray-500 border border-gray-200 hover:bg-gray-100 transition relative">
              Held{heldCarts.length > 0 && <span className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-gray-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center">{heldCarts.length}</span>}
            </button>
            <button onClick={holdCart} disabled={!cart.length} className="h-9 px-3 rounded-lg text-xs font-semibold bg-gray-50 text-gray-500 border border-gray-200 hover:bg-gray-100 transition disabled:opacity-30">Hold</button>
            <button onClick={() => { if (cart.length && confirm('Clear cart?')) clearCart() }} className="h-9 px-3 rounded-lg text-xs font-semibold bg-red-50 text-red-500 border border-red-100 hover:bg-red-100 transition">Clear</button>
          </div>
        </div>

        {/* Cart Items */}
        <div className="flex-1 overflow-y-auto px-5 py-3">
          {cnt === 0 ? (
            <div className="text-center py-14">
              <div className="text-xl opacity-15">Empty cart</div>
              <p className="text-gray-400 text-sm font-medium">Your cart is empty</p>
              <p className="text-gray-300 text-xs mt-1">Add products from the POS page</p>
            </div>
          ) : (
            <div className="space-y-2">
              {cart.map((c, i) => (
                <div key={i} className="cart-item flex items-center gap-3 p-3 rounded-xl bg-gray-50/80 border border-gray-100 hover:bg-gray-50 transition">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-gray-900 leading-tight">{c.name}</div>
                    <div className="text-xs text-gray-400 mt-0.5">
                      {money(c.price)} each
                      {c.isPromo && <span className="ml-1 text-orange-500 font-bold">• Promo </span>}
                      {!c.isPromo && c.originalPrice && c.price < c.originalPrice && <span className="ml-1 text-green-600 font-bold">• Wholesale ✓</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button onClick={() => updateCartQty(i, -1)} className="w-8 h-8 rounded-lg bg-white border border-gray-200 text-gray-500 text-sm font-bold flex items-center justify-center hover:bg-gray-50 active:scale-90 transition">−</button>
                    <span className="text-sm font-bold w-7 text-center">{c.qty}</span>
                    <button onClick={() => { if (!updateCartQty(i, 1)) toast.error('Not enough stock') }} className="w-8 h-8 rounded-lg bg-white border border-gray-200 text-gray-500 text-sm font-bold flex items-center justify-center hover:bg-gray-50 active:scale-90 transition">+</button>
                  </div>
                  <span className="text-sm font-bold text-gray-900 min-w-[70px] text-right">{money(c.lineTotal)}</span>
                  <button onClick={() => removeFromCart(i)} className="w-8 h-8 rounded-lg text-red-400 hover:bg-red-50 hover:text-red-500 text-sm flex items-center justify-center transition">✕</button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-gray-100 bg-white safe-bottom">
          <div className="space-y-2 mb-3">
            <div className="flex justify-between text-sm"><span className="text-gray-400">Subtotal</span><span className="font-semibold text-gray-900">{money(sub)}</span></div>
            <div className="flex justify-between items-center text-sm">
              <span className="text-gray-400">Discount</span>
              <input type="number" className="w-20 h-8 px-2 bg-gray-50 border border-gray-200 rounded-lg text-sm font-semibold text-right focus:outline-none focus:border-gray-400" value={discount} min={0} onChange={e => setDiscount(e.target.value)} />
            </div>
            <div className="flex justify-between items-baseline pt-2 border-t border-dashed border-gray-200">
              <span className="text-base font-bold text-gray-900">Total</span>
              <span className="text-xl font-bold text-gray-700">{money(total)}</span>
            </div>
          </div>

          {/* Phone - REQUIRED */}
          <div className="relative mb-3">
            <input type="tel" className={`w-full h-11 px-4 bg-gray-50 border rounded-xl text-sm font-medium focus:outline-none placeholder:text-gray-300 ${phoneValid ? 'border-green-300 bg-green-50/30' : 'border-red-300 bg-red-50/30'}`}
              placeholder="Customer phone number (required)" value={phone} onChange={e => setPhone(e.target.value)} />
            {phoneValid && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-green-500 text-sm">✓</span>}
          </div>
          {!phoneValid && phone.length > 0 && <p className="text-red-500 text-xs font-medium mb-2 -mt-1">Enter at least 9 digits</p>}

          <button onClick={handleOpenPayment} disabled={cnt === 0 || !phoneValid}
            className="w-full h-12 bg-gray-900 hover:bg-gray-800 rounded-xl text-white text-base font-bold disabled:opacity-30 active:scale-[.98] transition-all ">
            Complete Sale · {money(total)}
          </button>

          {/* WhatsApp Invoice Button */}
          <button onClick={async () => {
            if (!phoneValid) { toast.error('Enter phone number first!'); return }
            if (cnt === 0) return
            setProcessing(true)
            try {
              const sb = getSupabase()
              const orderNo = 'WA-' + Date.now().toString(36).toUpperCase()
              const orderItems = cart.map(c => ({ name: c.name, qty: c.qty, price: c.price, lineTotal: c.lineTotal }))
              const { data, error } = await sb.from('whatsapp_orders').insert({
                order_no: orderNo,
                date: new Date().toISOString(),
                customer_name: '',
                customer_phone: phone.trim(),
                items: orderItems,
                subtotal: sub,
                delivery_fee: 0,
                total: total,
                status: 'Pending',
                notes: 'Invoice from POS'
              }).select('id,ussd_code').single()
              if (error) { toast.error('Failed to create invoice'); setProcessing(false); return }

              const link = window.location.origin + '/#/pay/' + data.id
              const ussd = data.ussd_code ? `\n\nOr dial *920*141*${data.ussd_code}# to pay via USSD` : ''
              const lines = ['Hi, your order from EVERYTINROOM is ready.', '']
              orderItems.forEach(it => lines.push(`${it.qty}x ${it.name} - GHS ${Number(it.lineTotal).toFixed(2)}`))
              lines.push('', `Total: GHS ${Number(total).toFixed(2)}`, '', 'Please click the link below to make payment and fill in your delivery details:', link)
              if (ussd) lines.push(ussd)
              lines.push('', 'Thank you.')
              const msg = lines.join('\n')

              // Copy message to clipboard first
              try { await navigator.clipboard.writeText(msg) } catch {}

              // Try to open WhatsApp
              const waPhone = phone.trim().replace(/^0/, '233')
              const isMobile = /Android|iPhone|iPad/i.test(navigator.userAgent)

              if (isMobile) {
                // Mobile: use WhatsApp deep link
                window.location.href = `whatsapp://send?phone=${waPhone}&text=${encodeURIComponent(msg)}`
              } else {
                // Desktop: open WhatsApp Web
                window.open(`https://web.whatsapp.com/send?phone=${waPhone}&text=${encodeURIComponent(msg)}`, '_blank')
              }

              toast.success('Invoice created! Message copied to clipboard.\nPaste in WhatsApp if it didn\'t open automatically.', { duration: 5000 })
              clearCart(); setPhone(''); setDiscount(''); onClose()
              const store = useStore.getState()
              store.refreshWAOrders()
            } catch (e) { toast.error('Error creating invoice') }
            setProcessing(false)
          }} disabled={cnt === 0 || !phoneValid || processing}
            className="w-full h-12 bg-[#25d366] hover:bg-[#1ebe5d] rounded-xl text-white text-base font-bold disabled:opacity-30 active:scale-[.98] transition-all shadow-sm mt-2 flex items-center justify-center gap-2">
            Send Invoice · {money(total)}
          </button>

        </div>
      </div>

      {/* Payment Modal */}
      <Modal open={payOpen} onClose={() => { if (momoStep === 'idle' || momoStep === 'failed') { setPayOpen(false); cancelPaystack() } }} title="Payment">
        <div className="space-y-4">
          {(momoStep === 'idle' || momoStep === 'failed') && (<>
            <div className="bg-gray-50 rounded-xl p-5 text-center border border-gray-100">
              <div className="text-xs text-gray-400 font-medium">Amount Due</div>
              <div className="text-3xl font-bold text-gray-900 mt-1">{money(total)}</div>
              <div className="text-xs text-gray-400 mt-1">{phone}</div>
            </div>

            {/* Payment Methods — Cash & USSD only */}
            <div>
              <label className="block text-xs font-semibold text-gray-400 mb-2.5">Payment Method</label>
              <div className="grid grid-cols-2 gap-2.5">
                {[
                  { id: 'Cash', label: 'Cash', sub: 'Pay at counter', color: 'bg-[#16181d]', border: 'border-[#16181d]',
                    icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 12h.01M18 12h.01"/></svg> },
                  { id: 'USSD', label: 'USSD', sub: 'MoMo prompt', color: 'bg-[#16181d]', border: 'border-[#16181d]',
                    icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="2" width="14" height="20" rx="2.5"/><path d="M11 18h2"/></svg> },
                ].map(m => {
                  const active = !splitMode && payMethod === m.id
                  return (
                    <button key={m.id} onClick={() => { setPayMethod(m.id); setSplitMode(false) }}
                      className={`h-24 rounded-2xl text-sm font-bold border-2 flex flex-col items-center justify-center gap-1.5 transition-all ${active ? m.color + ' text-white ' + m.border + ' shadow-md' : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300'}`}>
                      <span>{m.icon}</span>
                      <span>{m.label}</span>
                      <span className={`text-[10px] font-medium ${active ? 'opacity-70' : 'opacity-40'}`}>{m.sub}</span>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* USSD Info */}
            {!splitMode && payMethod === 'USSD' && (
              <div className="bg-[#f1f5f2] rounded-xl p-3.5 border border-[#bcd1c5]">
                <div className="text-sm font-bold text-[#16181d] mb-1">USSD Payment</div>
                <div className="text-xs text-gray-500">A USSD code is generated and sent to the customer by SMS. They dial it to pay via MoMo. The receipt prints once payment is confirmed.</div>
              </div>
            )}

            {momoStep === 'failed' && <div className="bg-red-50 rounded-xl p-3.5 text-red-600 text-sm font-medium border border-red-100"> {momoMessage}</div>}

            <button onClick={handleCompleteSale} disabled={processing}
              className="w-full h-12 bg-gray-900 hover:bg-gray-800 text-white rounded-xl text-base font-bold disabled:opacity-30 active:scale-[.98] transition-all shadow-sm">
              {processing ? 'Processing...' : payMethod === 'Cash' ? 'Confirm Cash Payment' : 'Generate & Send USSD Code'}
            </button>
          </>)}

          {momoStep === 'charging' && <div className="text-center py-10"><div className="w-14 h-14 border-4 border-blue-100 border-t-blue-500 rounded-full animate-spin mx-auto mb-4" /><h3 className="text-lg font-bold mb-1">Creating Invoice...</h3><p className="text-gray-400 text-sm">{momoMessage}</p></div>}
          {momoStep === 'waiting' && (
            <div className="text-center py-6">
              <div className="bg-blue-50 border-2 border-blue-200 rounded-2xl p-6 mb-4">
                <p className="text-xs uppercase tracking-wider text-blue-600 font-semibold mb-2">USSD Payment Code</p>
                <p className="text-3xl font-bold text-blue-900 font-mono tracking-wider mb-2" style={{ whiteSpace: 'pre-line' }}>{momoMessage.split('\n')[0]?.replace('USSD Code: ', '')}</p>
                <p className="text-sm text-blue-700 font-semibold">{momoMessage.split('\n')[1]}</p>
                <button onClick={() => { navigator.clipboard?.writeText(momoMessage.split('\n')[0]?.replace('USSD Code: ', '')); toast.success('Copied!') }} className="mt-3 px-4 py-2 bg-[#16181d] text-white rounded-lg text-xs font-bold">Copy Code</button>
              </div>
              <p className="text-xs text-gray-500 mb-2">Tell the customer to dial the code above</p>
              <div className="flex items-center justify-center gap-2 text-xs text-gray-400">
                <div className="w-3 h-3 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin" />
                Waiting for payment confirmation...
              </div>
              <button onClick={() => { if (pollRef.current) clearInterval(pollRef.current); setMomoStep('idle'); setMomoMessage('') }} className="mt-4 text-xs text-gray-400 hover:text-gray-600">Cancel</button>
            </div>
          )}
          {momoStep === 'success' && <div className="text-center py-10"><div className="w-16 h-16 bg-green-50 rounded-full flex items-center justify-center mx-auto mb-4"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5"/></svg></div><h3 className="text-lg font-bold text-green-600 mb-1">Payment Confirmed!</h3><p className="text-gray-400 text-sm">Recording sale...</p></div>}
        </div>
      </Modal>

      {/* Held Carts */}
      <Modal open={showHeld} onClose={() => setShowHeld(false)} title={'Held Carts (' + heldCarts.length + ')'}>
        <div className="space-y-2.5">
          {heldCarts.length === 0 && <div className="text-center py-10 text-gray-300"><div className="text-4xl mb-2 opacity-30"></div><p className="text-sm">No held carts</p></div>}
          {heldCarts.map(h => (
            <div key={h.id} className="rounded-xl border border-gray-100 bg-gray-50/50 overflow-hidden">
              <div className="p-3.5">
                <div className="flex justify-between items-center mb-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-gray-900">{h.items.length} items</span>
                    <span className="text-xs text-gray-400">{h.time}</span>
                    {h.phone && <span className="text-xs text-gray-400">{h.phone}</span>}
                  </div>
                  <span className="text-base font-bold text-gray-700">{money(h.items.reduce((a, c) => a + c.lineTotal, 0))}</span>
                </div>
                <div className="text-xs text-gray-400 leading-relaxed">{h.items.map(i => i.name).join(', ')}</div>
              </div>
              <div className="flex border-t border-gray-100">
                <button onClick={() => recallCart(h)} className="flex-1 h-10 text-sm font-semibold text-gray-700 hover:bg-gray-50 transition">Recall</button>
                <button onClick={() => deleteHeld(h.id)} className="h-10 px-4 text-red-400 hover:bg-red-50 border-l border-gray-100 transition flex items-center justify-center"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6"/></svg></button>
              </div>
            </div>
          ))}
        </div>
      </Modal>
    </>
  )
}
