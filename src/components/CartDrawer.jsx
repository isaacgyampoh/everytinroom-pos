import { useState, useEffect, useRef } from 'react'
import { useStore } from '../hooks/useStore'
import { getSupabase } from '../lib/supabase'
import { money, num } from '../lib/utils'
import { broadcastDisplay } from '../hooks/useCustomerDisplay'
import Modal from './Modal'
import toast from 'react-hot-toast'

const CHARGE_URL = 'https://noiiuwkovoojkcwzupye.supabase.co/functions/v1/charge-momo'

export default function CartDrawer({ open, onClose, onReceipt }) {
  const { cart, updateCartQty, removeFromCart, clearCart, deductStock, user, mode, products } = useStore()
  const [discount, setDiscount] = useState(0)
  const [phone, setPhone] = useState('')
  const [isWhatsApp, setIsWhatsApp] = useState(false)
  const [waCtx, setWaCtx] = useState(null)
  const [payOpen, setPayOpen] = useState(false)
  const [payMethod, setPayMethod] = useState('Cash')
  const [processing, setProcessing] = useState(false)
  const [splitMode, setSplitMode] = useState(false)
  const [splitCash, setSplitCash] = useState('')
  const [heldCarts, setHeldCarts] = useState(() => { try { return JSON.parse(localStorage.getItem('heldCarts') || '[]') } catch { return [] } })
  const [showHeld, setShowHeld] = useState(false)
  const [momoStep, setMomoStep] = useState('idle')
  const [waitMode, setWaitMode] = useState('ussd') // 'ussd' | 'prompt'
  const [otpValue, setOtpValue] = useState('')
  const [moolreCtx, setMoolreCtx] = useState(null)
  const [otpSubmitting, setOtpSubmitting] = useState(false)
  const [momoMessage, setMomoMessage] = useState('')
  const pollRef = useRef(null)
  const autoCloseRef = useRef(null)

  const sub = cart.reduce((a, c) => a + c.lineTotal, 0)
  const total = Math.max(0, sub - num(discount))
  const cnt = cart.reduce((a, c) => a + c.qty, 0)
  const splitRemainder = total - num(splitCash)
  const phoneValid = phone.trim().length >= 9

  useEffect(() => { return () => { if (pollRef.current) clearInterval(pollRef.current); if (autoCloseRef.current) clearTimeout(autoCloseRef.current) } }, [])

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


  const cancelPaystack = () => { if (pollRef.current) clearInterval(pollRef.current); if (autoCloseRef.current) clearTimeout(autoCloseRef.current); setMomoStep('idle'); setMomoMessage('') }

  // Submit the OTP the customer received to complete a Moolre payment.
  const submitOtp = async () => {
    if (!moolreCtx || !otpValue.trim()) return
    setOtpSubmitting(true)
    try {
      const mr = await fetch('https://noiiuwkovoojkcwzupye.supabase.co/functions/v1/charge-momo?action=moolre-charge', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: moolreCtx.phone, amount: moolreCtx.amount, orderNo: moolreCtx.orderNo, externalref: moolreCtx.externalref || moolreCtx.orderNo, otpcode: otpValue.trim() })
      })
      const mj = await mr.json()
      if (mj.success) {
        toast.success('Payment prompt sent to customer')
        setMomoStep('waiting')
        setMomoMessage(`Payment approved by OTP.\nAmount: ${money(moolreCtx.amount)}\n\nWaiting for the customer to complete on their phone.`)
      } else if (mj.otpRequired) {
        toast.error('That code was not accepted. Check the SMS and try again.')
      } else {
        toast.error(mj.error || 'OTP verification failed')
      }
    } catch (e) {
      toast.error('Network error verifying OTP')
    } finally { setOtpSubmitting(false) }
  }

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
    // WhatsApp order: needs phone, then prepares USSD code + delivery link.
    if (isWhatsApp) {
      if (!phoneValid) { toast.error('Enter the customer phone number'); return }
      createUssdInvoice(total, false); return
    }

    if (splitMode) {
      if (num(splitCash) < 0 || num(splitCash) > total) { toast.error('Invalid cash amount'); return }
      if (splitRemainder > 0) {
        // MoMo portion -> direct prompt to the customer's number.
        if (!phoneValid) { toast.error('Enter the customer MoMo number'); return }
        directPromptCharge(splitRemainder, true)
      } else {
        completeDirectSale('Cash') // all cash
      }
      return
    }

    if (payMethod === 'Cash') {
      if (!phoneValid) { toast.error('Enter the customer phone number'); return }
      completeDirectSale('Cash'); return
    }
    if (payMethod === 'Momo') {
      // Walk-in MoMo = direct prompt (no shortcode).
      if (!phoneValid) { toast.error('Enter the customer MoMo number'); return }
      directPromptCharge(total, false); return
    }
    toast.error('Select a payment method')
  }

  // WALK-IN DIRECT PROMPT: send a NaloPay prompt straight to the customer's MoMo
  // number (no shortcode). This is a pure POS sale — we do NOT create a
  // whatsapp_orders row. We poll NaloPay for the payment, then record the sale
  // ONCE (record_sale handles stock + receipt). `isSplit` = MoMo part of a split.
  const directPromptCharge = async (amount, isSplit) => {
    setProcessing(true); setMomoStep('charging'); setMomoMessage('Sending prompt to ' + phone.trim() + '...')
    try {
      const sb = getSupabase()
      const ref = 'POS-' + Date.now().toString(36).toUpperCase()
      const items = cart.map(c => ({ name: c.name, qty: c.qty, price: c.price, lineTotal: c.lineTotal, productId: c.productId }))
      // DURABLE order row FIRST — so NaloPay's callback and the 20s reconcile can
      // always find and confirm this payment even if this screen dies mid-flow.
      // stock_deducted=true because stock for POS sales is deducted by record_sale
      // (once, at receipt time) — prevents double deduction by deduct_order_stock.
      const { data: inserted, error: insErr } = await sb.from('whatsapp_orders').insert({
        order_no: ref, date: new Date().toISOString(),
        customer_name: phone.trim(), customer_phone: phone.trim(),
        items: JSON.stringify(items), subtotal: total, total: amount,
        notes: isSplit ? `Split: Cash ${money(num(splitCash))}, MoMo ${money(amount)} (direct prompt)` : 'POS direct prompt',
        status: 'Pending', paystack_ref: ref, source: 'walkin', details_filled: false, stock_deducted: true,
      }).select('id').single()
      if (insErr || !inserted?.id) { setMomoStep('failed'); setMomoMessage('Could not create order: ' + (insErr?.message || '')); setProcessing(false); return }

      const r = await fetch('https://noiiuwkovoojkcwzupye.supabase.co/functions/v1/charge-momo?action=nalopay-charge', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: phone.trim(), amount, reference: ref, orderNo: ref, orderId: inserted.id, customerName: 'Customer', description: 'POS sale ' + ref })
      })
      const j = await r.json()
      if (!j.success) { setMomoStep('failed'); setMomoMessage(j.error || 'Could not send prompt. Try again.'); setProcessing(false); return }
      setWaitMode('prompt')
      setMomoStep('waiting')
      setMomoMessage(`Prompt sent to ${phone.trim()}.\nAmount: ${money(amount)}\n\nCustomer approves with their MoMo PIN.`)

      // Poll the ORDER (callback or reconcile flips it) — durable server truth.
      // No auto-close: waits until paid or the cashier cancels (up to 10 min).
      let tries = 0
      if (pollRef.current) clearInterval(pollRef.current)
      pollRef.current = setInterval(async () => {
        tries++
        if (tries > 200) { clearInterval(pollRef.current); return }
        try {
          const { data } = await sb.from('whatsapp_orders').select('status').eq('id', inserted.id).limit(1)
          const st = data?.[0]?.status
          if (st === 'Paid' || st === 'Completed') {
            clearInterval(pollRef.current)
            const saleData = await recordSale(isSplit ? 'Split' : 'Momo', isSplit ? { splitCash: num(splitCash), splitMomo: amount } : {})
            try { fetch('https://noiiuwkovoojkcwzupye.supabase.co/functions/v1/charge-momo?action=thankyou-sms', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: phone.trim() }) }) } catch {}
            if (saleData) { toast.success('Paid! ' + saleData.receiptNo); finishSale(saleData) }
          }
        } catch {}
      }, 3000)
      setProcessing(false)
    } catch (e) { setMomoStep('failed'); setMomoMessage('Error: ' + (e?.message || '')); setProcessing(false) }
  }

  // Create a WhatsApp order with USSD code for payment
  const createUssdInvoice = async (amount, isSplit) => {
    setProcessing(true)
    setMomoStep('charging'); setMomoMessage('Creating USSD invoice...')
    try {
      const sb = getSupabase()
      const orderNo = (isWhatsApp ? 'WA-' : 'POS-') + Date.now().toString(36).toUpperCase()
      const items = cart.map(c => ({ name: c.name, qty: c.qty, price: c.price, lineTotal: c.lineTotal }))
      
      // Get next USSD code
      const { data: mc } = await sb.from('whatsapp_orders').select('ussd_code').order('ussd_code', { ascending: false }).limit(1)
      const uc = (mc?.[0]?.ussd_code || 0) + 1

      // Create order
      await sb.from('whatsapp_orders').insert({
        order_no: orderNo, date: new Date().toISOString(),
        customer_name: phone.trim(), customer_phone: phone.trim(),
        items: JSON.stringify(items), subtotal: total, total: amount,
        notes: isSplit ? `Split: Cash ${money(num(splitCash))}, USSD ${money(amount)}` : (isWhatsApp ? 'WhatsApp order' : 'POS USSD Payment'),
        status: 'Pending', ussd_code: uc, paystack_ref: orderNo, source: isWhatsApp ? 'whatsapp' : 'walkin', details_filled: false,
      })

      // USSD code SMS is PAUSED for now — it delayed the cashier at the counter.
      // Walk-in: cashier reads the code aloud from the screen.
      // WhatsApp: the code goes out via the WhatsApp "Send pay code" button.
      // To re-enable later, set localStorage 'ussd-sms' = '1'.
      let smsOk = false
      if (localStorage.getItem('ussd-sms') === '1') {
        try {
          const r = await fetch('https://noiiuwkovoojkcwzupye.supabase.co/functions/v1/charge-momo?action=send-ussd-code', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ orderNo })
          })
          const j = await r.json(); smsOk = !!j.success
        } catch {}
      }

      // MOOLRE is now the DEFAULT payment (account verified + new account number).
      // Moolre is DISABLED for now — the OTP flow wasn't reliable. Everything
      // (walk-in, WhatsApp, website) uses the USSD code flow (NaloPay). To try
      // Moolre again later, set localStorage 'use-moolre' = '1'.
      let moolrePrompt = false
      let moolreOtp = false
      let moolreError = ''
      let moolreRef = orderNo
      if (!isWhatsApp && localStorage.getItem('use-moolre') === '1') {
        try {
          const mr = await fetch('https://noiiuwkovoojkcwzupye.supabase.co/functions/v1/charge-momo?action=moolre-charge', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone: phone.trim(), amount, orderNo, externalref: orderNo })
          })
          const mj = await mr.json(); moolrePrompt = !!mj.success; moolreOtp = !!mj.otpRequired
          if (mj.reference) moolreRef = mj.reference
          if (!moolrePrompt && !moolreOtp) { moolreError = mj.error || 'unknown'; console.warn('Moolre charge failed:', mj.error) }
        } catch (e) { moolreError = String(e); console.warn('Moolre charge error:', e) }
      }

      // OTP required: stash what we need and show the OTP entry step.
      if (moolreOtp) {
        setMoolreCtx({ phone: phone.trim(), amount, orderNo, uc, externalref: moolreRef })
        setOtpValue('')
        setMomoStep('otp')
        setMomoMessage(`An OTP was sent by SMS to ${phone.trim()}.\nEnter the code the customer received to complete the GHS ${money(amount)} payment.`)
        // keep polling too, in case the callback confirms independently
        if (pollRef.current) clearInterval(pollRef.current)
        pollRef.current = setInterval(async () => {
          const { data } = await sb.from('whatsapp_orders').select('status').eq('ussd_code', uc).limit(1)
          if (data?.[0]?.status === 'Paid' || data?.[0]?.status === 'Completed') {
            clearInterval(pollRef.current)
            const saleData = await recordSale('Momo')
            if (saleData) { toast.success('Payment confirmed! ' + saleData.receiptNo); finishSale(saleData) }
          }
        }, 5000)
        return
      }

      // Record the cash portion of split immediately
      if (isSplit && num(splitCash) > 0) {
        await recordSale('Split', { splitCash: num(splitCash), splitMomo: amount })
      }

      setWaitMode('ussd')
      setMomoStep('waiting')
      setMomoMessage(moolrePrompt ? `Payment prompt sent to ${phone.trim()}.\nAmount: ${money(amount)}\n\nCustomer approves with their MoMo PIN on their phone.` : (smsOk ? `USSD code sent to ${phone.trim()} by SMS.\nCode: *920*141*${uc}#\nAmount: ${money(amount)}\n\nCustomer dials it to pay via MoMo.` : `USSD Code: *920*141*${uc}#\nAmount: ${money(amount)}\n\nTell customer to dial this code to pay via MoMo.`))

      // WhatsApp order: prepare a ready-to-send message with the pay code + the
      // delivery-details link so the customer can fill their address (no payment link).
      if (isWhatsApp) {
        const detailsLink = `${window.location.origin}/#/details/${orderNo}`
        const payMsg = `Hello! Your EVERYTINROOM order is GHS ${money(amount)}.\n\nTo PAY, simply dial:\n*920*141*${uc}#\n\nEnter your MoMo PIN to approve. Thank you!\nEVERYTINROOM & BEDTIME · 024 531 5581`
        const addrMsg = `Hi, please when you're done with the payment, just tap the link below to fill in your delivery details so we can deliver to you. Thank you.\n\n${detailsLink}`
        setWaCtx({ phone: phone.trim(), payMsg, addrMsg, link: detailsLink, code: `*920*141*${uc}#` })
      } else {
        setWaCtx(null)
      }
      
      // Poll for payment
      if (pollRef.current) clearInterval(pollRef.current)
      pollRef.current = setInterval(async () => {
        const { data } = await sb.from('whatsapp_orders').select('status').eq('ussd_code', uc).limit(1)
        if (data?.[0]?.status === 'Paid' || data?.[0]?.status === 'Completed') {
          clearInterval(pollRef.current)
          if (autoCloseRef.current) clearTimeout(autoCloseRef.current)
          if (!isSplit) {
            const saleData = await recordSale('Momo')
            if (saleData) { toast.success('USSD Payment confirmed! ' + saleData.receiptNo); finishSale(saleData) }
          } else {
            toast.success('USSD Payment confirmed!')
            finishSale(null)
          }
        }
      }, 5000)

      // Auto-close the code screen after 30s so the cashier can serve the next
      // customer. The order is already saved as Pending (with its items), so
      // when the customer dials and pays, the webhook marks it Paid and it
      // shows in the Orders list. We stop polling here to avoid completing a
      // sale against an empty cart.
      if (autoCloseRef.current) clearTimeout(autoCloseRef.current)
      if (!isWhatsApp) {
        autoCloseRef.current = setTimeout(() => {
          if (pollRef.current) clearInterval(pollRef.current)
          toast.success('Code sent — ready for next customer')
          clearCart(); setDiscount(0); setPhone(''); setPayOpen(false)
          setSplitMode(false); setSplitCash(''); setMomoStep('idle'); setMomoMessage('')
        }, 20000)
      }
    } catch (e) {
      setMomoStep('failed'); setMomoMessage('Error: ' + e.message)
    }
    setProcessing(false)
  }

  // Block "Complete Sale" if no phone
  const handleOpenPayment = () => {
    if (cnt === 0) return
    // Reset selection each time the payment sheet opens.
    setSplitMode(false); setSplitCash(''); setPhone('')
    setPayMethod(isWhatsApp ? 'WhatsApp' : '') // no method pre-selected for walk-in
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

          {/* WhatsApp order toggle — tags the order + prepares an address-form link to send */}
          <button onClick={() => setIsWhatsApp(v => !v)} className={`w-full flex items-center gap-3 h-11 px-4 rounded-xl border mb-3 transition ${isWhatsApp ? 'border-[#0e7c86] bg-[#0e7c86]/5' : 'border-gray-200 bg-gray-50'}`}>
            <div className={`w-5 h-5 rounded-md flex items-center justify-center ${isWhatsApp ? 'bg-[#0e7c86]' : 'border-2 border-gray-300'}`}>
              {isWhatsApp && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3"><path d="M20 6L9 17l-5-5"/></svg>}
            </div>
            <span className={`text-sm font-semibold ${isWhatsApp ? 'text-[#0e7c86]' : 'text-gray-500'}`}>WhatsApp delivery order</span>
            <span className="ml-auto text-[10px] text-gray-400">{isWhatsApp ? 'send code + address link' : 'walk-in'}</span>
          </button>

          <button onClick={handleOpenPayment} disabled={cnt === 0}
            className="w-full h-12 bg-gray-900 hover:bg-gray-800 rounded-xl text-white text-base font-bold disabled:opacity-30 active:scale-[.98] transition-all ">
            Complete Sale · {money(total)}
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

            {/* WALK-IN: pick a payment method (Split / Cash / Momo direct prompt) */}
            {!isWhatsApp && (
              <div>
                <label className="block text-xs font-semibold text-gray-400 mb-2.5">Payment Method</label>
                <div className="grid gap-2.5 grid-cols-3">
                  {[
                    { id: 'Split', label: 'Split', sub: 'Cash + MoMo',
                      icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12h18M8 7l-5 5 5 5M16 7l5 5-5 5"/></svg> },
                    { id: 'Cash', label: 'Cash', sub: 'At counter',
                      icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 12h.01M18 12h.01"/></svg> },
                    { id: 'Momo', label: 'MoMo', sub: 'Direct prompt',
                      icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="2" width="14" height="20" rx="2.5"/><path d="M11 18h2"/></svg> },
                  ].map(m => {
                    const active = m.id === 'Split' ? splitMode : (!splitMode && payMethod === m.id)
                    return (
                      <button key={m.id} onClick={() => { if (m.id === 'Split') { setSplitMode(true); setSplitCash('') } else { setPayMethod(m.id); setSplitMode(false) } }}
                        className={`h-24 rounded-2xl text-sm font-bold border-2 flex flex-col items-center justify-center gap-1.5 transition-all ${active ? 'bg-[#16181d] text-white border-[#16181d] shadow-md' : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300'}`}>
                        <span>{m.icon}</span>
                        <span>{m.label}</span>
                        <span className={`text-[10px] font-medium ${active ? 'opacity-70' : 'opacity-40'}`}>{m.sub}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            {/* CASH: ask for phone (needed for the receipt) */}
            {!isWhatsApp && !splitMode && payMethod === 'Cash' && (
              <div className="bg-[#f6f6f5] rounded-xl p-4 border border-gray-200 space-y-2">
                <label className="block text-xs font-semibold text-gray-500">Customer phone number</label>
                <input type="tel" inputMode="tel" autoFocus className="w-full h-12 px-4 bg-white border-2 border-gray-200 rounded-xl text-base font-semibold focus:outline-none focus:border-gray-400" placeholder="024 000 0000" value={phone} onChange={e => setPhone(e.target.value)} />
                <p className="text-xs text-gray-400">Required for the receipt.</p>
              </div>
            )}

            {/* MOMO: ask for the customer's MoMo number — direct prompt goes here */}
            {!isWhatsApp && !splitMode && payMethod === 'Momo' && (
              <div className="bg-[#0e7c86]/5 rounded-xl p-4 border border-[#0e7c86]/30 space-y-2">
                <label className="block text-xs font-semibold text-[#0e7c86]">Customer MoMo number</label>
                <input type="tel" inputMode="tel" autoFocus className="w-full h-12 px-4 bg-white border-2 border-[#0e7c86]/40 rounded-xl text-base font-bold focus:outline-none focus:border-[#0e7c86]" placeholder="024 000 0000" value={phone} onChange={e => setPhone(e.target.value)} />
                <p className="text-xs text-gray-500">A payment prompt is sent straight to this number. The customer approves with their MoMo PIN — no code to dial.</p>
              </div>
            )}

            {/* SPLIT: cash amount + phone for the MoMo portion (direct prompt) */}
            {!isWhatsApp && splitMode && (
              <div className="bg-[#f6f6f5] rounded-xl p-4 border border-gray-200 space-y-3">
                <div className="text-sm font-bold text-[#16181d]">Split Payment · {money(total)}</div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1.5">Cash Amount received</label>
                  <input type="number" inputMode="decimal" className="w-full h-11 px-4 bg-white border border-gray-200 rounded-xl text-sm font-bold focus:outline-none focus:border-gray-400" placeholder="0.00" value={splitCash} min={0} max={total} onChange={e => setSplitCash(e.target.value)} />
                </div>
                <div className="flex justify-between items-center pt-2 border-t border-gray-200">
                  <span className="text-sm font-semibold text-gray-500">MoMo (prompt) portion</span>
                  <span className="text-lg font-bold text-[#16181d]">{money(Math.max(0, splitRemainder))}</span>
                </div>
                {splitRemainder > 0 && (
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 mb-1.5">Customer MoMo number</label>
                    <input type="tel" inputMode="tel" className="w-full h-11 px-4 bg-white border-2 border-[#0e7c86]/40 rounded-xl text-sm font-bold focus:outline-none focus:border-[#0e7c86]" placeholder="024 000 0000" value={phone} onChange={e => setPhone(e.target.value)} />
                    <p className="text-xs text-gray-400 mt-1">A prompt is sent to this number for the MoMo portion.</p>
                  </div>
                )}
              </div>
            )}

            {/* WHATSAPP: ask for phone, then Complete gives Copy code + delivery link */}
            {isWhatsApp && (
              <div className="bg-[#0e7c86]/5 rounded-xl p-4 border border-[#0e7c86]/30 space-y-2">
                <label className="block text-xs font-semibold text-[#0e7c86]">Customer phone number</label>
                <input type="tel" inputMode="tel" autoFocus className="w-full h-12 px-4 bg-white border-2 border-[#0e7c86]/40 rounded-xl text-base font-bold focus:outline-none focus:border-[#0e7c86]" placeholder="024 000 0000" value={phone} onChange={e => setPhone(e.target.value)} />
                <p className="text-xs text-gray-500">A USSD code + delivery-details link will be prepared to send to the customer.</p>
              </div>
            )}

            {momoStep === 'failed' && <div className="bg-red-50 rounded-xl p-3.5 text-red-600 text-sm font-medium border border-red-100"> {momoMessage}</div>}

            <button onClick={handleCompleteSale} disabled={processing || (!isWhatsApp && !splitMode && !payMethod)}
              className="w-full h-12 bg-gray-900 hover:bg-gray-800 text-white rounded-xl text-base font-bold disabled:opacity-30 active:scale-[.98] transition-all shadow-sm">
              {processing ? 'Processing...'
                : isWhatsApp ? 'Complete · Prepare WhatsApp'
                : splitMode ? 'Confirm Split · Send Prompt'
                : payMethod === 'Cash' ? 'Confirm Cash Payment'
                : payMethod === 'Momo' ? 'Pay · Send Prompt'
                : 'Select a payment method'}
            </button>
          </>)}

          {momoStep === 'charging' && <div className="text-center py-10"><div className="w-14 h-14 border-4 border-blue-100 border-t-blue-500 rounded-full animate-spin mx-auto mb-4" /><h3 className="text-lg font-bold mb-1">Creating Invoice...</h3><p className="text-gray-400 text-sm">{momoMessage}</p></div>}
          {momoStep === 'otp' && (
            <div className="text-center py-6">
              <div className="bg-[#f6f6f5] border-2 border-gray-200 rounded-2xl p-6 mb-4">
                <p className="text-xs uppercase tracking-wider text-gray-400 font-semibold mb-2">Enter OTP</p>
                <p className="text-sm text-gray-600 mb-4" style={{ whiteSpace: 'pre-line' }}>{momoMessage}</p>
                <input
                  value={otpValue}
                  onChange={e => setOtpValue(e.target.value.replace(/\D/g, ''))}
                  inputMode="numeric"
                  placeholder="Enter code from SMS"
                  className="w-full h-14 px-4 text-center text-2xl font-bold tracking-widest bg-white border-2 border-gray-300 rounded-xl focus:outline-none focus:border-[#0e7c86]"
                  autoFocus
                />
                <button onClick={submitOtp} disabled={otpSubmitting || !otpValue.trim()} className="mt-4 w-full h-12 bg-[#0e7c86] text-white rounded-xl font-bold disabled:opacity-40">
                  {otpSubmitting ? 'Verifying...' : 'Complete Payment'}
                </button>
              </div>
              <button onClick={() => { if (pollRef.current) clearInterval(pollRef.current); if (autoCloseRef.current) clearTimeout(autoCloseRef.current); clearCart(); setDiscount(0); setPhone(''); setPayOpen(false); setSplitMode(false); setSplitCash(''); setMomoStep('idle'); setMomoMessage(''); setMoolreCtx(null); setOtpValue('') }} className="text-xs font-semibold text-gray-500 hover:text-gray-800">Cancel & start new order</button>
            </div>
          )}

          {momoStep === 'waiting' && waitMode === 'prompt' && (
            <div className="text-center py-8">
              <div className="w-14 h-14 border-4 border-gray-200 border-t-gray-700 rounded-full animate-spin mx-auto mb-5" />
              <h3 className="text-lg font-bold text-gray-900 mb-1">Waiting for payment</h3>
              <p className="text-sm text-gray-500 mb-1" style={{ whiteSpace: 'pre-line' }}>{momoMessage}</p>
              <p className="text-xs text-gray-400 mb-6">The receipt prints automatically once the customer approves on their phone.</p>
              <button onClick={() => { if (pollRef.current) clearInterval(pollRef.current); setMomoStep('idle'); setMomoMessage('') }} className="px-6 py-3 border border-gray-300 rounded-xl text-sm font-semibold text-gray-600">Cancel order</button>
            </div>
          )}

          {momoStep === 'waiting' && waitMode === 'ussd' && (
            <div className="text-center py-6">
              <div className="bg-[#f6f6f5] border-2 border-gray-200 rounded-2xl p-6 mb-4">
                <p className="text-xs uppercase tracking-wider text-gray-400 font-semibold mb-2">USSD Payment Code</p>
                <p className="text-3xl font-bold text-[#16181d] font-mono tracking-wider mb-2" style={{ whiteSpace: 'pre-line' }}>{momoMessage.split('\n')[0]?.replace('USSD Code: ', '')}</p>
                <p className="text-sm text-gray-500 font-semibold">{momoMessage.split('\n')[1]}</p>
                <button onClick={() => { navigator.clipboard?.writeText(momoMessage.split('\n')[0]?.replace('USSD Code: ', '')); toast.success('Code copied'); if (pollRef.current) clearInterval(pollRef.current); if (autoCloseRef.current) clearTimeout(autoCloseRef.current); clearCart(); setDiscount(0); setPhone(''); setPayOpen(false); setSplitMode(false); setSplitCash(''); setMomoStep('idle'); setMomoMessage(''); setIsWhatsApp(false); setWaCtx(null) }} className="mt-3 px-5 py-2.5 bg-[#16181d] text-white rounded-lg text-xs font-bold">Copy & Done</button>
              </div>
              <p className="text-sm text-gray-600 font-medium mb-2">Read the code to the customer — they also get an SMS</p>

              {waCtx && (
                <div className="bg-[#0e7c86]/5 border-2 border-[#0e7c86]/30 rounded-2xl p-4 mb-4 text-left">
                  <p className="text-xs font-bold text-[#0e7c86] mb-1 uppercase tracking-wide">WhatsApp delivery order</p>
                  <p className="text-xs text-gray-600 mb-3">Send the customer two quick messages — the pay code, then the address link:</p>
                  <button onClick={() => {
                    let wp = waCtx.phone.replace(/\D/g, ''); if (wp.startsWith('0')) wp = '233' + wp.slice(1); if (!wp.startsWith('233')) wp = '233' + wp
                    window.open(`https://wa.me/${wp}?text=${encodeURIComponent(waCtx.payMsg)}`, '_blank')
                  }} className="w-full h-11 bg-[#0e7c86] text-white rounded-xl font-bold text-sm flex items-center justify-center gap-2 mb-2">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 00-8.7 15l-1.3 4.7L7 20.4A10 10 0 1012 2zm5.8 14.2c-.2.7-1.4 1.3-2 1.4-.5.1-1.1.1-1.8-.1-.4-.1-1-.3-1.6-.6-2.9-1.3-4.8-4.2-5-4.4-.1-.2-1.1-1.5-1.1-2.9s.7-2 1-2.3c.2-.3.5-.3.7-.3h.5c.2 0 .4 0 .6.5l.8 2c.1.2.1.3 0 .5l-.3.5-.3.3c-.2.2-.3.3-.1.6.2.3.8 1.3 1.7 2.1 1.2 1 2.1 1.4 2.4 1.5.2.1.4.1.5-.1l.7-.8c.2-.2.3-.2.6-.1l1.9.9c.3.1.5.2.5.4.1.2.1.8-.1 1.3z"/></svg>
                    1. Send pay code
                  </button>
                  <button onClick={() => {
                    let wp = waCtx.phone.replace(/\D/g, ''); if (wp.startsWith('0')) wp = '233' + wp.slice(1); if (!wp.startsWith('233')) wp = '233' + wp
                    window.open(`https://wa.me/${wp}?text=${encodeURIComponent(waCtx.addrMsg)}`, '_blank')
                  }} className="w-full h-11 bg-white border-2 border-[#0e7c86] text-[#0e7c86] rounded-xl font-bold text-sm flex items-center justify-center gap-2">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 00-8.7 15l-1.3 4.7L7 20.4A10 10 0 1012 2zm5.8 14.2c-.2.7-1.4 1.3-2 1.4-.5.1-1.1.1-1.8-.1-.4-.1-1-.3-1.6-.6-2.9-1.3-4.8-4.2-5-4.4-.1-.2-1.1-1.5-1.1-2.9s.7-2 1-2.3c.2-.3.5-.3.7-.3h.5c.2 0 .4 0 .6.5l.8 2c.1.2.1.3 0 .5l-.3.5-.3.3c-.2.2-.3.3-.1.6.2.3.8 1.3 1.7 2.1 1.2 1 2.1 1.4 2.4 1.5.2.1.4.1.5-.1l.7-.8c.2-.2.3-.2.6-.1l1.9.9c.3.1.5.2.5.4.1.2.1.8-.1 1.3z"/></svg>
                    2. Send address link
                  </button>
                </div>
              )}

              <div className="flex items-center justify-center gap-2 text-xs text-gray-400">
                <div className="w-3 h-3 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin" />
                Closes automatically — ready for the next customer
              </div>
              <button onClick={() => { if (pollRef.current) clearInterval(pollRef.current); if (autoCloseRef.current) clearTimeout(autoCloseRef.current); clearCart(); setDiscount(0); setPhone(''); setPayOpen(false); setSplitMode(false); setSplitCash(''); setMomoStep('idle'); setMomoMessage(''); setIsWhatsApp(false); setWaCtx(null) }} className="mt-4 text-xs font-semibold text-gray-500 hover:text-gray-800">Close & start new order</button>
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
