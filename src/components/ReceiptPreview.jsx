import { useEffect, useRef } from 'react'
import { money, fmtDateTime, SHOP } from '../lib/utils'

export default function ReceiptPreview({ sale, onClose }) {
  const printedRef = useRef(false)

  const items = Array.isArray(sale?.items) ? sale.items : []

  const doPrint = () => {
    const w = window.open('', '_blank', 'width=400,height=700')
    if (!w) return
    w.document.write(`<!DOCTYPE html><html><head><style>
      * { margin: 0; padding: 0; color: #000 !important; box-sizing: border-box; }
      body { width: 72mm; font-family: 'Arial', sans-serif; font-size: 12px; line-height: 1.4; padding: 3mm 2mm; margin: 0 auto; }

      .hdr { text-align: center; padding-bottom: 4mm; border-bottom: 1px dashed #000; }
      .shop-name { font-size: 21px; font-weight: 900; letter-spacing: 1px; white-space: nowrap; overflow: hidden; -webkit-text-stroke: 0.4px #000; }
      .shop-info { font-size: 10px; margin-top: 1px; }

      .title { text-align: center; font-size: 13px; font-weight: 900; margin: 3mm 0; letter-spacing: 2px; }

      .meta { border-bottom: 1px dashed #000; padding-bottom: 3mm; margin-bottom: 3mm; }
      .meta-row { display: flex; justify-content: space-between; padding: 1px 0; font-size: 11px; }
      .meta-label { color: #555; }
      .meta-val { font-weight: 700; text-align: right; max-width: 55%; word-break: break-all; }

      .items-hdr { display: flex; justify-content: space-between; font-size: 10px; font-weight: 700; color: #555; text-transform: uppercase; letter-spacing: 1px; padding-bottom: 2mm; border-bottom: 1px solid #ccc; margin-bottom: 2mm; }

      .item { margin-bottom: 3mm; }
      .item-name { font-weight: 900; font-size: 12px; }
      .item-line { display: flex; justify-content: space-between; font-size: 11px; padding-left: 2mm; margin-top: 1px; }
      .item-qty { color: #555; }
      .item-amt { font-weight: 700; }

      .sep { border-top: 1px dashed #000; margin: 3mm 0; }

      .total-row { display: flex; justify-content: space-between; font-size: 12px; padding: 1px 0; }
      .total-label { color: #555; }
      .total-val { font-weight: 700; }

      .grand { display: flex; justify-content: space-between; font-size: 16px; font-weight: 900; border-top: 2px solid #000; padding-top: 3mm; margin-top: 3mm; }
      .grand-label { }
      .grand-val { }

      .footer { text-align: center; border-top: 1px dashed #000; padding-top: 3mm; margin-top: 4mm; font-size: 10px; line-height: 1.6; }

      body { position: relative; }
      .wm { position: absolute; inset: 0; z-index: 0; overflow: hidden; opacity: 0.16; font-weight: 700; font-size: 9px; letter-spacing: 1px; line-height: 20px; word-spacing: 8px; word-break: break-all; pointer-events: none; }
      .rc { position: relative; z-index: 1; }

      @media print { @page { size: 80mm auto; margin: 0; } body { width: 72mm; } }
    </style></head><body>

      <div class="wm">${'everytinroom '.repeat(700)}</div>
      <div class="rc">

      <div class="hdr">
        <div class="shop-name">EVERYTINROOM</div>
        <div class="shop-info">${SHOP.address}</div>
        <div class="shop-info">Tel: ${SHOP.phone}</div>
        <div class="shop-info">${SHOP.website}</div>
      </div>

      <div class="title">SALES RECEIPT</div>

      <div class="meta">
        <div class="meta-row"><span class="meta-label">Receipt:</span><span class="meta-val">${sale.receiptNo}</span></div>
        <div class="meta-row"><span class="meta-label">Date:</span><span class="meta-val">${fmtDateTime(sale.date)}</span></div>
        <div class="meta-row"><span class="meta-label">Customer:</span><span class="meta-val">${sale.customer || 'Walk-in'}</span></div>
        <div class="meta-row"><span class="meta-label">Cashier:</span><span class="meta-val">${sale.cashier}</span></div>
        <div class="meta-row"><span class="meta-label">Payment:</span><span class="meta-val">${sale.payment === 'Paystack' ? 'Momo' : sale.payment}</span></div>
        <div class="meta-row"><span class="meta-label">Type:</span><span class="meta-val">${sale.type || 'Retail'}</span></div>
      </div>

      <div class="items-hdr"><span>Item</span><span>Amount</span></div>

      ${items.map(it => `
        <div class="item">
          <div class="item-name">${it.name}</div>
          <div class="item-line">
            <span class="item-qty">${it.qty} x GHS ${Number(it.price).toFixed(2)}</span>
            <span class="item-amt">GHS ${Number(it.lineTotal).toFixed(2)}</span>
          </div>
        </div>
      `).join('')}

      <div class="sep"></div>

      <div class="total-row"><span class="total-label">Subtotal</span><span class="total-val">GHS ${Number((sale.total || 0) + (sale.discount || 0)).toFixed(2)}</span></div>
      ${(sale.discount || 0) > 0 ? `<div class="total-row"><span class="total-label">Discount</span><span class="total-val">-GHS ${Number(sale.discount).toFixed(2)}</span></div>` : ''}
      ${sale.payment === 'Split' && sale.splitCash > 0 ? `<div class="total-row"><span class="total-label">Cash</span><span class="total-val">GHS ${Number(sale.splitCash).toFixed(2)}</span></div>` : ''}
      ${sale.payment === 'Split' && sale.splitMomo > 0 ? `<div class="total-row"><span class="total-label">Momo</span><span class="total-val">GHS ${Number(sale.splitMomo).toFixed(2)}</span></div>` : ''}

      <div class="grand">
        <span class="grand-label">TOTAL</span>
        <span class="grand-val">GHS ${Number(sale.total).toFixed(2)}</span>
      </div>

      <div class="footer">
        <p>Thank you for shopping with us!</p>
        <p>${SHOP.website}</p>
        <p style="color:#999!important;margin-top:2mm;">Goods sold are not returnable</p>
      </div>

      </div>

    </body></html>`)
    w.document.close()
    setTimeout(() => { w.focus(); w.print(); setTimeout(() => w.close(), 1000) }, 300)
  }

  // Auto-print receipt for completed Cash sales (once)
  useEffect(() => {
    if (sale && !printedRef.current && sale.payment === 'Cash') {
      printedRef.current = true
      setTimeout(() => doPrint(), 250)
    }
  }, [sale]) // eslint-disable-line

  if (!sale) return null

  return (
    <>
      <div className="fixed inset-0 bg-black/70 z-[499]" onClick={onClose} />
      <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[340px] max-h-[90vh] overflow-y-auto bg-white rounded-2xl shadow-lg z-[500]">
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
        <div className="flex gap-2 px-5 pb-5">
          <button onClick={doPrint} className="flex-1 h-12 bg-gray-800 hover:bg-gray-700 text-white rounded-xl text-sm font-bold active:scale-95 transition">Print Receipt</button>
          <button onClick={onClose} className="h-12 px-5 bg-gray-100 hover:bg-gray-200 rounded-xl text-sm font-semibold text-gray-600 transition">Close</button>
        </div>
      </div>
    </>
  )
}
