import { useEffect, useRef } from 'react'
import { money, fmtDateTime, SHOP } from '../lib/utils'
import { printReceipt, kickDrawer, getSettings } from '../lib/hardware'
import toast from 'react-hot-toast'

export default function ReceiptPreview({ sale, onClose }) {
  const printedRef = useRef(false)

  const items = Array.isArray(sale?.items) ? sale.items : []

  // Printing, paper width, drawer kick and the choice between the browser
  // dialog and raw ESC/POS all live in the hardware layer, configured per
  // terminal. This component just says "print this sale".
  const doPrint = async () => {
    const r = await printReceipt(sale, { force: true })
    if (!r.ok) toast.error(r.error || 'Could not print')
    else if (r.warning) toast('Printed via the browser — ' + r.warning, { icon: '!' })
  }

  const openDrawer = async () => {
    const r = await kickDrawer()
    if (!r.ok) toast.error(r.error)
  }

  // Auto-print once, for any completed sale — not just cash. A customer paying
  // by MoMo still expects a receipt, and the old rule quietly denied them one.
  useEffect(() => {
    if (!sale || printedRef.current) return
    if (!getSettings().autoPrint) return
    printedRef.current = true
    const t = setTimeout(() => { printReceipt(sale) }, 250)
    return () => clearTimeout(t)
  }, [sale]) // eslint-disable-line

  if (!sale) return null

  return (
    <>
      <div className="fixed inset-0 bg-black/70 z-[499]" onClick={onClose} />
      <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[min(340px,calc(100vw-2rem))] max-h-[88vh] overflow-y-auto bg-white rounded-2xl shadow-lg z-[500]">
        <button onClick={onClose} className="absolute top-3 right-3 w-8 h-8 bg-gray-100 hover:bg-gray-200 rounded-lg text-sm flex items-center justify-center transition z-10">✕</button>

        <div id="receipt-content" className="p-5 text-black">
          {/* Header */}
          <div className="text-center pb-4 border-b-2 border-dashed border-gray-800">
            <div className="text-lg font-black tracking-wide uppercase">{SHOP.name}</div>
            <div className="text-[11px] font-bold text-gray-600">{SHOP.address}</div>
            <div className="text-[11px] font-bold text-gray-600">Tel: {SHOP.phone}</div>
            <div className="text-[11px] font-bold text-gray-600">{SHOP.website}</div>
          </div>

          {/* Title */}
          <div className="text-center font-black text-sm tracking-[3px] uppercase my-3">SALES RECEIPT</div>

          {/* Meta */}
          <div className="border-b-2 border-dashed border-gray-800 pb-3 mb-3 space-y-0.5">
            <div className="flex justify-between text-[12px]"><span className="text-gray-500">Receipt:</span><span className="font-bold">{sale.receiptNo}</span></div>
            <div className="flex justify-between text-[12px]"><span className="text-gray-500">Date:</span><span className="font-bold">{fmtDateTime(sale.date)}</span></div>
            <div className="flex justify-between text-[12px]"><span className="text-gray-500">Customer:</span><span className="font-bold">{sale.customer || 'Walk-in'}</span></div>
            <div className="flex justify-between text-[12px]"><span className="text-gray-500">Cashier:</span><span className="font-bold">{sale.cashier}</span></div>
            <div className="flex justify-between text-[12px]"><span className="text-gray-500">Payment:</span><span className="font-bold">{sale.payment === 'Paystack' ? 'Momo' : sale.payment}</span></div>
            <div className="flex justify-between text-[12px]"><span className="text-gray-500">Type:</span><span className="font-bold">{sale.type || 'Retail'}</span></div>
          </div>

          {/* Items */}
          <div className="border-b-2 border-dashed border-gray-800 pb-3 mb-3">
            <div className="flex justify-between text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">
              <span>Item</span><span>Amount</span>
            </div>
            {items.map((it, i) => (
              <div key={i} className="mb-2.5">
                <div className="text-[12px] font-bold">{it.name}</div>
                <div className="flex justify-between text-[11px] pl-2 mt-0.5">
                  <span className="text-gray-500">{it.qty} x GHS {Number(it.price).toFixed(2)}</span>
                  <span className="font-bold">GHS {Number(it.lineTotal).toFixed(2)}</span>
                </div>
              </div>
            ))}
          </div>

          {/* Totals */}
          <div className="space-y-1">
            <div className="flex justify-between text-[12px]"><span className="text-gray-500">Subtotal</span><span className="font-bold">GHS {Number((sale.total || 0) + (sale.discount || 0)).toFixed(2)}</span></div>
            {(sale.discount || 0) > 0 && <div className="flex justify-between text-[12px]"><span className="text-gray-500">Discount</span><span className="font-bold text-red-600">-GHS {Number(sale.discount).toFixed(2)}</span></div>}
            <div className="flex justify-between text-lg border-t-2 border-dashed border-gray-800 pt-3 mt-3">
              <span className="font-black">TOTAL</span>
              <span className="font-black">GHS {Number(sale.total).toFixed(2)}</span>
            </div>
          </div>

          {/* Footer */}
          <div className="text-center border-t-2 border-dashed border-gray-800 pt-3 mt-4">
            <p className="text-[12px] font-bold">Thank you for shopping with us!</p>
            <p className="text-[11px] text-gray-500 mt-1">{SHOP.website}</p>
            <p className="text-[10px] text-gray-400 mt-1">Goods sold are not returnable</p>
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-wrap gap-2 px-5 pb-5 safe-bottom">
          <button onClick={doPrint} className="flex-1 min-w-[130px] h-12 bg-gray-800 hover:bg-gray-700 text-white rounded-xl text-sm font-bold active:scale-95 transition">Print Receipt</button>
          <button onClick={openDrawer} title="Open cash drawer" className="h-12 px-4 bg-gray-100 hover:bg-gray-200 rounded-xl text-sm font-semibold text-gray-600 transition">Drawer</button>
          <button onClick={onClose} className="h-12 px-5 bg-gray-100 hover:bg-gray-200 rounded-xl text-sm font-semibold text-gray-600 transition">Close</button>
        </div>
      </div>
    </>
  )
}
