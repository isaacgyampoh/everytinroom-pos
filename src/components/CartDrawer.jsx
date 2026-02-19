import { useState } from 'react'
import { useStore } from '../hooks/useStore'
import { getSupabase } from '../lib/supabase'
import { money, num } from '../lib/utils'
import Modal from './Modal'
import toast from 'react-hot-toast'

export default function CartDrawer({ open, onClose, onReceipt }) {
  const { cart, updateCartQty, removeFromCart, clearCart, deductStock, user, mode } = useStore()
  const [discount, setDiscount] = useState(0)
  const [phone, setPhone] = useState('')
  const [payOpen, setPayOpen] = useState(false)
  const [payMethod, setPayMethod] = useState('Cash')
  const [processing, setProcessing] = useState(false)

  const sub = cart.reduce((a, c) => a + c.lineTotal, 0)
  const total = Math.max(0, sub - num(discount))
  const cnt = cart.reduce((a, c) => a + c.qty, 0)

  const completeSale = async () => {
    const sb = getSupabase()
    if (!sb) return
    setProcessing(true)
    try {
      const { data, error } = await sb.rpc('record_sale', {
        p_items: cart,
        p_customer: phone.trim() || 'Walk-in',
        p_payment: payMethod,
        p_discount: num(discount),
        p_type: mode === 'wholesale' ? 'Wholesale' : 'Retail',
        p_cashier: user?.name || '',
      })
      if (data?.success) {
        deductStock(cart)
        toast.success('Sale done! ' + data.receiptNo)
        const saleData = {
          receiptNo: data.receiptNo, date: new Date().toISOString(),
          customer: phone.trim() || 'Walk-in', cashier: user?.name || '',
          payment: payMethod, type: mode === 'wholesale' ? 'Wholesale' : 'Retail',
          items: cart, total: data.total, discount: data.discount,
        }
        clearCart(); setDiscount(0); setPhone(''); setPayOpen(false); onClose()
        if (onReceipt) onReceipt(saleData)
      } else {
        toast.error(data?.error || error?.message || 'Error')
      }
    } catch (e) { toast.error('Error: ' + e.message) }
    setProcessing(false)
  }

  return (
    <>
      {open && <div className="fixed inset-0 bg-black/60 z-[300]" onClick={onClose} />}
      <div className={`fixed bottom-0 left-0 right-0 md:left-auto md:top-0 md:w-[440px] md:rounded-l-3xl md:rounded-tr-none bg-white rounded-t-3xl max-h-[92vh] md:max-h-full z-[301] flex flex-col transition-transform duration-300 ${open ? 'translate-y-0 md:translate-x-0' : 'translate-y-full md:translate-y-0 md:translate-x-full'}`}>
        <div className="w-12 h-1.5 bg-gray-200 rounded-full mx-auto mt-3.5 md:hidden" />
        <div className="flex items-center justify-between px-6 pb-5 border-b border-gray-100">
          <h3 className="text-xl font-extrabold">🛒 Cart <span className="bg-brand-500 text-white py-1.5 px-3.5 rounded-full text-sm font-bold">{cnt}</span></h3>
          <button onClick={() => { if (cart.length && confirm('Clear cart?')) clearCart() }} className="h-10 px-3.5 bg-red-50 text-red-600 rounded-lg text-[13px] font-semibold">Clear</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 md:max-h-[40vh]">
          {cnt === 0 ? (
            <div className="text-center py-10 text-gray-400"><span className="text-5xl block mb-3 opacity-40">🛒</span>Cart is empty</div>
          ) : cart.map((c, i) => (
            <div key={i} className="flex items-center gap-3 p-3.5 bg-gray-50 rounded-xl mb-2.5">
              <div className="flex-1"><div className="text-sm font-semibold">{c.name}</div></div>
              <div className="flex items-center gap-2">
                <button onClick={() => updateCartQty(i, -1)} className="w-9 h-9 rounded-lg bg-white border-2 border-gray-200 text-lg font-semibold flex items-center justify-center">−</button>
                <span className="text-[15px] font-bold min-w-[24px] text-center">{c.qty}</span>
                <button onClick={() => { if (!updateCartQty(i, 1)) toast.error('Not enough stock') }} className="w-9 h-9 rounded-lg bg-white border-2 border-gray-200 text-lg font-semibold flex items-center justify-center">+</button>
              </div>
              <span className="text-sm font-bold text-brand-500">{money(c.lineTotal)}</span>
              <button onClick={() => removeFromCart(i)} className="w-9 h-9 rounded-lg bg-red-50 text-red-500 text-base flex items-center justify-center">✕</button>
            </div>
          ))}
        </div>

        <div className="p-5 safe-bottom border-t border-gray-100 bg-gray-50">
          <div className="mb-4 space-y-2.5">
            <div className="flex justify-between text-sm text-gray-500"><span>Subtotal</span><b className="text-gray-900">{money(sub)}</b></div>
            <div className="flex justify-between items-center text-sm text-gray-500">
              <span>Discount</span>
              <input type="number" className="w-20 h-10 px-2.5 bg-white border-2 border-gray-200 rounded-lg text-sm font-semibold text-right" value={discount} min={0} onChange={e => setDiscount(e.target.value)} />
            </div>
            <div className="flex justify-between text-xl font-extrabold pt-3 border-t-2 border-dashed border-gray-200">
              <span>Total</span><b className="text-brand-500">{money(total)}</b>
            </div>
          </div>
          <input type="tel" className="w-full h-[50px] px-4 bg-white border-2 border-gray-200 rounded-xl text-[15px] mb-3" placeholder="📱 Customer phone" value={phone} onChange={e => setPhone(e.target.value)} />
          <button onClick={() => cnt > 0 && setPayOpen(true)} disabled={cnt === 0} className="w-full h-14 bg-green-500 rounded-xl text-white text-[17px] font-bold disabled:opacity-50 active:scale-[.97] transition">✓ Complete Sale</button>
        </div>
      </div>

      <Modal open={payOpen} onClose={() => setPayOpen(false)} title="💳 Payment"
        footer={<button onClick={completeSale} disabled={processing} className="flex-1 h-14 bg-green-500 text-white rounded-xl text-base font-bold disabled:opacity-50">{processing ? 'Processing...' : '✓ Confirm'}</button>}>
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-2">Payment Method</label>
            <select className="w-full h-13 px-4 bg-gray-50 border-2 border-gray-200 rounded-xl text-base font-medium" value={payMethod} onChange={e => setPayMethod(e.target.value)}>
              <option value="Cash">💵 Cash</option>
              <option value="Momo">📱 Mobile Money</option>
            </select>
          </div>
          <div className="bg-brand-500 rounded-2xl p-6 text-white mt-5">
            <small className="text-sm opacity-80">Amount Due</small>
            <strong className="block text-4xl font-extrabold mt-2">{money(total)}</strong>
          </div>
        </div>
      </Modal>
    </>
  )
}
