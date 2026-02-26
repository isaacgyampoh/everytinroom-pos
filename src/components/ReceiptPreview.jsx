import { money, fmtDateTime, SHOP } from '../lib/utils'

export default function ReceiptPreview({ sale, onClose }) {
  if (!sale) return null

  const items = Array.isArray(sale.items) ? sale.items : []

  const doPrint = () => {
    const content = document.getElementById('receipt-content')?.innerHTML
    if (!content) return
    const w = window.open('', '_blank', 'width=400,height=700')
    if (!w) return
    w.document.write(`<!DOCTYPE html><html><head><style>*{margin:0;padding:0;color:#000!important}body{width:72mm;font-family:"Courier New",monospace;font-size:14px;font-weight:900;line-height:1.6;padding:3mm 4mm;margin:0 auto}.hdr{text-align:center;padding-bottom:4mm;border-bottom:3px solid #000}.logo{font-size:24px;font-weight:900;letter-spacing:2px}.inf{font-size:13px;font-weight:900}.ttl{text-align:center;font-size:18px;font-weight:900;margin:4mm 0;letter-spacing:3px}.meta{margin:3mm 0;font-size:13px;border-bottom:3px solid #000;padding-bottom:3mm}.meta div{display:flex;justify-content:space-between;padding:1mm 0;font-weight:900}.items{padding:3mm 0;border-bottom:3px solid #000}.it{margin-bottom:3mm}.itn{font-weight:900;font-size:14px}.itd{display:flex;justify-content:space-between;font-size:13px;padding-left:2mm;font-weight:900}.tots{padding:3mm 0}.row{display:flex;justify-content:space-between;font-size:14px;padding:1mm 0;font-weight:900}.row.total{font-size:18px;border-top:3px solid #000;padding-top:3mm;margin-top:3mm}.ft{text-align:center;border-top:3px solid #000;padding-top:3mm;margin-top:4mm;font-size:12px;font-weight:900}@media print{@page{size:80mm auto;margin:0mm 4mm}}</style></head><body><b>${content}</b></body></html>`)
    w.document.close()
    setTimeout(() => { w.focus(); w.print(); setTimeout(() => w.close(), 1000) }, 300)
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/70 z-[499]" onClick={onClose} />
      <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-80 max-h-[90vh] overflow-y-auto bg-white rounded-xl shadow-2xl z-[500] p-2.5">
        <button onClick={onClose} className="absolute top-1.5 right-1.5 w-7 h-7 bg-gray-100 rounded-lg text-base flex items-center justify-center">✕</button>

        <div id="receipt-content" className="font-mono text-xs leading-tight text-black">
          <div className="hdr text-center pb-1 border-b border-dashed border-black">
            <div className="logo text-base font-bold tracking-wider">{SHOP.name}</div>
            <div className="inf text-[10px] font-bold">{SHOP.tagline}</div>
            <div className="inf text-[10px]">{SHOP.address}</div>
            <div className="inf text-[10px]">Tel: {SHOP.phone}</div>
            <div className="inf text-[10px]">{SHOP.website}</div>
          </div>
          <div className="ttl text-center font-bold text-[13px] my-1 tracking-[2px]">SALES RECEIPT</div>
          <div className="meta my-1 text-[10px] border-b border-dashed border-black pb-1">
            <div className="flex justify-between py-[1px]"><span>Receipt:</span><span>{sale.receiptNo}</span></div>
            <div className="flex justify-between py-[1px]"><span>Date:</span><span>{fmtDateTime(sale.date)}</span></div>
            <div className="flex justify-between py-[1px]"><span>Customer:</span><span>{sale.customer}</span></div>
            <div className="flex justify-between py-[1px]"><span>Cashier:</span><span>{sale.cashier}</span></div>
            <div className="flex justify-between py-[1px]"><span>Payment:</span><span>{sale.payment}</span></div>
          </div>
          <div className="items py-1 border-b border-dashed border-black">
            {items.map((it, i) => (
              <div key={i} className="it mb-0.5">
                <div className="itn font-bold text-[11px]">{it.name}</div>
                <div className="itd flex justify-between text-[10px] pl-2">
                  <span>{it.qty} x {money(it.price)}</span><span>{money(it.lineTotal)}</span>
                </div>
              </div>
            ))}
          </div>
          <div className="tots py-1">
            <div className="row flex justify-between text-[11px] py-[1px]"><span>Subtotal:</span><span>{money((sale.total || 0) + (sale.discount || 0))}</span></div>
            {(sale.discount || 0) > 0 && <div className="row flex justify-between text-[11px] py-[1px]"><span>Discount:</span><span>-{money(sale.discount)}</span></div>}
            <div className="row total flex justify-between text-[13px] font-bold border-t border-dashed border-black pt-1 mt-0.5"><span>TOTAL:</span><span>{money(sale.total)}</span></div>
          </div>
          <div className="ft text-center border-t border-dashed border-black pt-1 mt-1 text-[9px]">
            <p>Thank you for shopping!</p>
            <p>{SHOP.website}</p>
          </div>
        </div>
        <div className="flex gap-2.5 justify-center p-3">
          <button onClick={doPrint} className="flex-1 h-12 bg-indigo-500 text-white rounded-xl text-sm font-bold active:scale-95 transition">🖨️ Print</button>
        </div>
      </div>
    </>
  )
}
