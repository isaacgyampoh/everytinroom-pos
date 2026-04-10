import { money, fmtDateTime, SHOP } from '../lib/utils'

export default function ReceiptPreview({ sale, onClose }) {
  if (!sale) return null

  const items = Array.isArray(sale.items) ? sale.items : []

  const doPrint = () => {
    const content = document.getElementById('receipt-content')?.innerHTML
    if (!content) return
    const w = window.open('', '_blank', 'width=400,height=700')
    if (!w) return
    w.document.write(`<!DOCTYPE html><html><head><style>
      *{margin:0;padding:0;color:#000!important;box-sizing:border-box}
      body{width:80mm;font-family:'Arial','Helvetica',sans-serif;font-size:13px;line-height:1.5;padding:4mm 5mm;margin:0 auto}
      .hdr{text-align:center;padding-bottom:5mm;border-bottom:2px dashed #000}
      .shop-name{font-size:22px;font-weight:900;letter-spacing:1px;text-transform:uppercase}
      .shop-info{font-size:11px;font-weight:700;margin-top:2px}
      .title{text-align:center;font-size:16px;font-weight:900;margin:5mm 0;letter-spacing:3px;text-transform:uppercase}
      .meta{margin:4mm 0;font-size:12px;border-bottom:2px dashed #000;padding-bottom:4mm}
      .meta-row{display:flex;justify-content:space-between;padding:2px 0;font-weight:700}
      .items{padding:4mm 0;border-bottom:2px dashed #000}
      .item{margin-bottom:4mm}
      .item-name{font-weight:900;font-size:13px}
      .item-detail{display:flex;justify-content:space-between;font-size:12px;padding-left:3mm;font-weight:700;margin-top:1px}
      .totals{padding:4mm 0}
      .total-row{display:flex;justify-content:space-between;font-size:13px;padding:2px 0;font-weight:700}
      .grand-total{font-size:20px;font-weight:900;border-top:2px dashed #000;padding-top:4mm;margin-top:4mm}
      .footer{text-align:center;border-top:2px dashed #000;padding-top:4mm;margin-top:5mm;font-size:12px;font-weight:700}
      .footer p{margin:2px 0}
      .promo-msg{text-align:center;padding:3mm 2mm;margin:3mm 0;border:2px dashed #000;border-radius:2mm;font-size:11px;font-weight:900;line-height:1.4}
      @media print{@page{size:80mm auto;margin:0mm 3mm}}
    </style></head><body>${content}</body></html>`)
    w.document.close()
    setTimeout(() => { w.focus(); w.print(); setTimeout(() => w.close(), 1000) }, 300)
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/70 z-[499]" onClick={onClose} />
      <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[340px] max-h-[90vh] overflow-y-auto bg-white rounded-2xl shadow-lg z-[500]">
        <button onClick={onClose} className="absolute top-3 right-3 w-8 h-8 bg-gray-100 hover:bg-gray-200 rounded-lg text-sm flex items-center justify-center transition z-10">✕</button>

        <div id="receipt-content" className="p-5 text-black">
          {/* Header */}
          <div className="hdr text-center pb-4 border-b-2 border-dashed border-gray-800">
            <div className="shop-name text-xl font-black tracking-wide uppercase">{SHOP.name}</div>
            {SHOP.tagline && <div className="shop-info text-xs font-bold text-gray-700 mt-1">{SHOP.tagline}</div>}
            <div className="shop-info text-xs font-bold text-gray-700">{SHOP.address}</div>
            <div className="shop-info text-xs font-bold text-gray-700">Tel: {SHOP.phone}</div>
            <div className="shop-info text-xs font-bold text-gray-700">{SHOP.website}</div>
          </div>

          {/* Seasonal Message */}
          {SHOP.promoMsg && (
            <div className="text-center py-2.5 my-2 border-2 border-dashed border-gray-800 rounded-lg bg-gray-50">
              <p className="text-xs font-extrabold text-gray-800 leading-snug px-2">{SHOP.promoMsg}</p>
            </div>
          )}

          {/* Title */}
          <div className="title text-center font-black text-base tracking-[3px] uppercase my-3">SALES RECEIPT</div>

          {/* Meta */}
          <div className="meta border-b-2 border-dashed border-gray-800 pb-3 mb-3 space-y-1">
            <div className="meta-row flex justify-between text-sm"><span className="font-bold text-gray-600">Receipt:</span><span className="font-extrabold">{sale.receiptNo}</span></div>
            <div className="meta-row flex justify-between text-sm"><span className="font-bold text-gray-600">Date:</span><span className="font-extrabold">{fmtDateTime(sale.date)}</span></div>
            <div className="meta-row flex justify-between text-sm"><span className="font-bold text-gray-600">Customer:</span><span className="font-extrabold">{sale.customer}</span></div>
            <div className="meta-row flex justify-between text-sm"><span className="font-bold text-gray-600">Cashier:</span><span className="font-extrabold">{sale.cashier}</span></div>
            <div className="meta-row flex justify-between text-sm"><span className="font-bold text-gray-600">Payment:</span><span className="font-extrabold">{sale.payment === 'Paystack' ? 'Momo' : sale.payment}</span></div>
            <div className="meta-row flex justify-between text-sm"><span className="font-bold text-gray-600">Type:</span><span className="font-extrabold">{sale.type || 'Retail'}</span></div>
          </div>

          {/* Items */}
          <div className="items border-b-2 border-dashed border-gray-800 pb-3 mb-3">
            <div className="flex justify-between text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">
              <span>Item</span><span>Amount</span>
            </div>
            {items.map((it, i) => (
              <div key={i} className="item mb-2.5">
                <div className="item-name text-sm font-extrabold">{it.name}</div>
                <div className="item-detail flex justify-between text-sm pl-2 mt-0.5">
                  <span className="font-bold text-gray-600">{it.qty} × {money(it.price)}</span>
                  <span className="font-extrabold">{money(it.lineTotal)}</span>
                </div>
              </div>
            ))}
          </div>

          {/* Totals */}
          <div className="totals space-y-1.5">
            <div className="total-row flex justify-between text-sm"><span className="font-bold text-gray-600">Subtotal</span><span className="font-extrabold">{money((sale.total || 0) + (sale.discount || 0))}</span></div>
            {(sale.discount || 0) > 0 && <div className="total-row flex justify-between text-sm"><span className="font-bold text-gray-600">Discount</span><span className="font-extrabold text-red-600">-{money(sale.discount)}</span></div>}
            {sale.payment === 'Split' && sale.splitCash > 0 && <div className="total-row flex justify-between text-sm"><span className="font-bold text-gray-600">Cash</span><span className="font-extrabold">{money(sale.splitCash)}</span></div>}
            {sale.payment === 'Split' && sale.splitMomo > 0 && <div className="total-row flex justify-between text-sm"><span className="font-bold text-gray-600">Momo</span><span className="font-extrabold">{money(sale.splitMomo)}</span></div>}
            <div className="grand-total flex justify-between text-xl border-t-2 border-dashed border-gray-800 pt-3 mt-3">
              <span className="font-black">TOTAL</span>
              <span className="font-black">{money(sale.total)}</span>
            </div>
          </div>

          {/* Footer */}
          <div className="footer text-center border-t-2 border-dashed border-gray-800 pt-3 mt-4">
            <p className="text-sm font-bold">Thank you for shopping with us!</p>
            <p className="text-xs font-bold text-gray-500 mt-1">{SHOP.website}</p>
            {SHOP.promoMsg && <p className="text-xs font-bold text-gray-600 mt-2">Happy Ghana Month!</p>}
            <p className="text-xs text-gray-400 mt-1">Goods sold are not returnable</p>
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-2 px-5 pb-5">
          <button onClick={doPrint} className="flex-1 h-12 bg-brand-500 hover:bg-brand-600 text-white rounded-xl text-sm font-bold active:scale-95 transition">Print Receipt</button>
          <button onClick={onClose} className="h-12 px-5 bg-gray-100 hover:bg-gray-200 rounded-xl text-sm font-semibold text-gray-600 transition">Close</button>
        </div>
      </div>
    </>
  )
}
