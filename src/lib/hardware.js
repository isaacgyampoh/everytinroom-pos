// ============================================================================
// POS TERMINAL HARDWARE
//
// Everything the app needs to drive a real till: thermal receipt printer,
// cash drawer, and the per-machine settings that differ between terminals.
//
// There are two printing paths, because no single one works everywhere:
//
//   'browser'  — renders the receipt into a hidden iframe and calls print().
//                Works on every platform. Needs the printer set as the
//                default and "margins: none" ticked once in the print dialog.
//                Cannot open the cash drawer.
//
//   'escpos'   — sends raw ESC/POS bytes straight to the printer over Web
//                Serial (USB/RS-232 adapters) or WebUSB. Prints instantly with
//                no dialog and CAN kick the drawer. Chrome/Edge only, and the
//                operator has to pick the device once per machine.
//
// The old code used window.open() + print(), which silently does nothing when
// a till runs in kiosk/fullscreen mode — the popup is blocked and no receipt
// ever comes out. The iframe path has no such problem.
// ============================================================================

import { money, fmtDateTime, SHOP } from './utils'

const SETTINGS_KEY = 'pos-terminal-settings'

const DEFAULTS = {
  terminalName: '',        // which till this is, stamped on every sale
  paperWidth: 80,          // 58 or 80 (mm)
  printMode: 'browser',    // 'browser' | 'escpos' | 'off'
  autoPrint: true,         // print without asking once a sale completes
  openDrawerOnCash: true,  // kick the drawer for cash / split-cash sales
  copies: 1,
  beepOnScan: true,
  // Minutes of no touching before the till locks. Was hardcoded at one minute,
  // which meant a cashier serving a slow customer had to re-enter their PIN
  // mid-sale. An hour suits a staffed counter; drop it for an unattended one.
  idleMinutes: 60,
}

export function getSettings() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') } }
  catch { return { ...DEFAULTS } }
}

export function saveSettings(patch) {
  const next = { ...getSettings(), ...patch }
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(next))
  return next
}

// A stable id for this physical machine, so two tills never collide even
// before anyone names them.
export function terminalId() {
  let id = localStorage.getItem('pos-terminal-id')
  if (!id) {
    id = 'T-' + Math.random().toString(36).slice(2, 8).toUpperCase()
    localStorage.setItem('pos-terminal-id', id)
  }
  return id
}

export function terminalLabel() {
  const s = getSettings()
  return s.terminalName?.trim() || terminalId()
}

// ---------------------------------------------------------------------------
// ESC/POS command builder
// ---------------------------------------------------------------------------
const ESC = 0x1b, GS = 0x1d

// Characters per line at font A. This is the single number that decides
// whether a receipt looks right or wraps into mush, and it is why paper width
// is a setting rather than a guess.
const cols = (width) => (width === 58 ? 32 : 48)

class EscPos {
  constructor(width) { this.bytes = []; this.width = width; this.cols = cols(width) }
  raw(...b) { this.bytes.push(...b); return this }
  text(s) {
    // ESC/POS printers are single-byte. Fold anything else down rather than
    // emitting multi-byte UTF-8 the printer will render as garbage.
    const clean = String(s ?? '').normalize('NFKD').replace(/[^\x20-\x7E\n]/g, '')
    for (const ch of clean) this.bytes.push(ch.charCodeAt(0))
    return this
  }
  line(s = '') { return this.text(s).raw(0x0a) }
  init() { return this.raw(ESC, 0x40) }                       // ESC @
  align(a) { return this.raw(ESC, 0x61, a === 'center' ? 1 : a === 'right' ? 2 : 0) }
  bold(on) { return this.raw(ESC, 0x45, on ? 1 : 0) }
  double(on) { return this.raw(GS, 0x21, on ? 0x11 : 0x00) }  // double W+H
  feed(n = 1) { return this.raw(ESC, 0x64, n) }
  cut() { return this.raw(GS, 0x56, 0x42, 0x00) }             // partial cut
  drawer() { return this.raw(ESC, 0x70, 0x00, 0x19, 0xfa) }   // pin 2, 25/250ms
  rule(ch = '-') { return this.line(ch.repeat(this.cols)) }

  // name left, amount right, wrapping the name across lines when it is long.
  row(left, right) {
    const r = String(right ?? '')
    const room = this.cols - r.length - 1
    const l = String(left ?? '')
    if (l.length <= room) return this.line(l + ' '.repeat(this.cols - l.length - r.length) + r)
    this.line(l.slice(0, room))
    const rest = l.slice(room)
    return this.line(rest + ' '.repeat(Math.max(1, this.cols - rest.length - r.length)) + r)
  }
  build() { return new Uint8Array(this.bytes) }
}

function buildReceiptBytes(sale, settings) {
  const p = new EscPos(settings.paperWidth)
  const items = Array.isArray(sale?.items) ? sale.items : []
  const gh = n => 'GHS ' + Number(n || 0).toFixed(2)

  p.init().align('center').bold(true).double(true)
  p.line(SHOP.name)
  p.double(false)
  p.bold(false)
  p.line(SHOP.address)
  p.line('Tel: ' + SHOP.phone)
  p.line(SHOP.website)
  p.rule('=')
  p.bold(true).line('SALES RECEIPT').bold(false)
  p.align('left').rule()

  p.row('Receipt:', sale.receiptNo || '')
  p.row('Date:', fmtDateTime(sale.date))
  p.row('Customer:', sale.customer || 'Walk-in')
  p.row('Cashier:', sale.cashier || '')
  p.row('Payment:', sale.payment === 'Paystack' ? 'Momo' : (sale.payment || ''))
  if (settings.terminalName) p.row('Till:', settings.terminalName)
  p.rule()

  for (const it of items) {
    p.bold(true).line(String(it.name || '')).bold(false)
    p.row(`  ${it.qty} x ${Number(it.price || 0).toFixed(2)}`, Number(it.lineTotal || 0).toFixed(2))
  }

  p.rule()
  const discount = Number(sale.discount || 0)
  p.row('Subtotal', gh(Number(sale.total || 0) + discount))
  if (discount > 0) p.row('Discount', '-' + gh(discount))
  if (sale.payment === 'Split') {
    if (Number(sale.splitCash) > 0) p.row('Cash', gh(sale.splitCash))
    if (Number(sale.splitMomo) > 0) p.row('Momo', gh(sale.splitMomo))
  }
  p.rule('=')
  p.bold(true).double(true).row('TOTAL', Number(sale.total || 0).toFixed(2)).double(false).bold(false)
  if (Number(sale.cashReceived) > 0) {
    p.row('Cash received', gh(sale.cashReceived))
    p.row('Change', gh(Number(sale.cashReceived) - Number(sale.total || 0)))
  }
  p.rule('=')

  p.align('center')
  p.line('Thank you for shopping with us!')
  p.line(SHOP.website)
  p.line('Goods sold are not returnable')
  p.feed(3).cut()
  return p.build()
}

// ---------------------------------------------------------------------------
// Transport: Web Serial, then WebUSB.
// The chosen device is remembered by the browser, so the operator only picks
// it once per machine — but a user gesture is required the very first time.
// ---------------------------------------------------------------------------
let serialPort = null
let usbDevice = null, usbEndpoint = null

export const escposSupported = () =>
  typeof navigator !== 'undefined' && (!!navigator.serial || !!navigator.usb)

async function getSerialPort(promptIfNeeded) {
  if (serialPort?.writable) return serialPort
  if (!navigator.serial) return null
  const granted = await navigator.serial.getPorts()
  let port = granted[0]
  if (!port) {
    if (!promptIfNeeded) return null
    port = await navigator.serial.requestPort()
  }
  if (!port.writable) await port.open({ baudRate: 9600 })
  serialPort = port
  return port
}

async function getUsbPrinter(promptIfNeeded) {
  if (usbDevice?.opened && usbEndpoint != null) return usbDevice
  if (!navigator.usb) return null
  const granted = await navigator.usb.getDevices()
  let dev = granted[0]
  if (!dev) {
    if (!promptIfNeeded) return null
    // USB printer class is 7. Most thermal printers expose it.
    dev = await navigator.usb.requestDevice({ filters: [{ classCode: 7 }] })
  }
  if (!dev.opened) await dev.open()
  if (dev.configuration === null) await dev.selectConfiguration(1)

  // Find the interface and bulk-OUT endpoint to write to.
  for (const iface of dev.configuration.interfaces) {
    for (const alt of iface.alternates) {
      if (alt.interfaceClass !== 7) continue
      const out = alt.endpoints.find(e => e.direction === 'out' && e.type === 'bulk')
      if (!out) continue
      try { await dev.claimInterface(iface.interfaceNumber) } catch { /* already claimed */ }
      usbDevice = dev; usbEndpoint = out.endpointNumber
      return dev
    }
  }
  return null
}

async function writeRaw(bytes, promptIfNeeded) {
  const port = await getSerialPort(promptIfNeeded)
  if (port?.writable) {
    const writer = port.writable.getWriter()
    try { await writer.write(bytes) } finally { writer.releaseLock() }
    return true
  }
  const dev = await getUsbPrinter(promptIfNeeded)
  if (dev && usbEndpoint != null) { await dev.transferOut(usbEndpoint, bytes); return true }
  return false
}

// Let the operator pair a printer from the settings screen, where a click is
// available to satisfy the browser's user-gesture requirement.
export async function pairPrinter() {
  if (navigator.serial) {
    try { const p = await navigator.serial.requestPort(); if (!p.writable) await p.open({ baudRate: 9600 }); serialPort = p; return { ok: true, via: 'serial' } }
    catch (e) { if (e?.name !== 'NotFoundError') return { ok: false, error: e.message } }
  }
  if (navigator.usb) {
    try { await getUsbPrinter(true); if (usbDevice) return { ok: true, via: 'usb' } }
    catch (e) { return { ok: false, error: e.message } }
  }
  return { ok: false, error: 'No Web Serial or WebUSB support in this browser' }
}

// ---------------------------------------------------------------------------
// Cash drawer
// ---------------------------------------------------------------------------
export async function kickDrawer() {
  const s = getSettings()
  if (s.printMode !== 'escpos') {
    // A drawer wired to the printer only opens on a raw ESC/POS pulse. There
    // is no way to send one through the browser's print dialog, so say so
    // rather than failing silently.
    return { ok: false, error: 'Cash drawer needs Direct (ESC/POS) print mode' }
  }
  const p = new EscPos(s.paperWidth)
  try {
    const sent = await writeRaw(p.init().drawer().build(), false)
    return sent ? { ok: true } : { ok: false, error: 'Printer not paired' }
  } catch (e) { return { ok: false, error: e.message } }
}

// ---------------------------------------------------------------------------
// Browser printing — hidden iframe, not a popup.
// ---------------------------------------------------------------------------
function printViaIframe(sale, settings) {
  const items = Array.isArray(sale?.items) ? sale.items : []
  const paper = settings.paperWidth === 58 ? { page: '58mm', body: '52mm', base: 11 }
                                           : { page: '80mm', body: '72mm', base: 12 }
  const esc = (v) => String(v ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
  const gh = n => 'GHS ' + Number(n || 0).toFixed(2)

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    * { margin:0; padding:0; color:#000 !important; box-sizing:border-box; }
    body { width:${paper.body}; font-family:'Arial',sans-serif; font-size:${paper.base}px; line-height:1.4; padding:3mm 2mm; margin:0 auto; }
    .hdr { text-align:center; padding-bottom:3mm; border-bottom:1px dashed #000; }
    .shop { font-size:${paper.base + 8}px; font-weight:900; letter-spacing:1px; }
    .sm { font-size:${paper.base - 2}px; }
    .title { text-align:center; font-size:${paper.base + 1}px; font-weight:900; margin:3mm 0; letter-spacing:2px; }
    .meta { border-bottom:1px dashed #000; padding-bottom:2mm; margin-bottom:2mm; }
    .row { display:flex; justify-content:space-between; padding:1px 0; }
    .row span:last-child { font-weight:700; text-align:right; max-width:60%; word-break:break-word; }
    .item-name { font-weight:900; }
    .item-line { display:flex; justify-content:space-between; padding-left:2mm; }
    .sep { border-top:1px dashed #000; margin:2mm 0; }
    .grand { display:flex; justify-content:space-between; font-size:${paper.base + 4}px; font-weight:900; border-top:2px solid #000; padding-top:2mm; margin-top:2mm; }
    .foot { text-align:center; border-top:1px dashed #000; padding-top:2mm; margin-top:3mm; font-size:${paper.base - 2}px; line-height:1.6; }
    @media print { @page { size:${paper.page} auto; margin:0; } body { width:${paper.body}; } }
  </style></head><body>
    <div class="hdr">
      <div class="shop">${esc(SHOP.name)}</div>
      <div class="sm">${esc(SHOP.address)}</div>
      <div class="sm">Tel: ${esc(SHOP.phone)}</div>
      <div class="sm">${esc(SHOP.website)}</div>
    </div>
    <div class="title">SALES RECEIPT</div>
    <div class="meta">
      <div class="row"><span>Receipt:</span><span>${esc(sale.receiptNo)}</span></div>
      <div class="row"><span>Date:</span><span>${esc(fmtDateTime(sale.date))}</span></div>
      <div class="row"><span>Customer:</span><span>${esc(sale.customer || 'Walk-in')}</span></div>
      <div class="row"><span>Cashier:</span><span>${esc(sale.cashier)}</span></div>
      <div class="row"><span>Payment:</span><span>${esc(sale.payment === 'Paystack' ? 'Momo' : sale.payment)}</span></div>
      ${settings.terminalName ? `<div class="row"><span>Till:</span><span>${esc(settings.terminalName)}</span></div>` : ''}
    </div>
    ${items.map(it => `<div style="margin-bottom:2mm">
      <div class="item-name">${esc(it.name)}</div>
      <div class="item-line"><span>${esc(it.qty)} x ${Number(it.price || 0).toFixed(2)}</span><span><b>${Number(it.lineTotal || 0).toFixed(2)}</b></span></div>
    </div>`).join('')}
    <div class="sep"></div>
    <div class="row"><span>Subtotal</span><span>${gh(Number(sale.total || 0) + Number(sale.discount || 0))}</span></div>
    ${Number(sale.discount || 0) > 0 ? `<div class="row"><span>Discount</span><span>-${gh(sale.discount)}</span></div>` : ''}
    ${sale.payment === 'Split' && Number(sale.splitCash) > 0 ? `<div class="row"><span>Cash</span><span>${gh(sale.splitCash)}</span></div>` : ''}
    ${sale.payment === 'Split' && Number(sale.splitMomo) > 0 ? `<div class="row"><span>Momo</span><span>${gh(sale.splitMomo)}</span></div>` : ''}
    <div class="grand"><span>TOTAL</span><span>${gh(sale.total)}</span></div>
    ${Number(sale.cashReceived) > 0 ? `
      <div class="row" style="margin-top:2mm"><span>Cash received</span><span>${gh(sale.cashReceived)}</span></div>
      <div class="row"><span>Change</span><span>${gh(Number(sale.cashReceived) - Number(sale.total || 0))}</span></div>` : ''}
    <div class="foot">
      <p>Thank you for shopping with us!</p>
      <p>${esc(SHOP.website)}</p>
      <p>Goods sold are not returnable</p>
    </div>
  </body></html>`

  return new Promise((resolve) => {
    // A same-origin iframe, not window.open. Kiosk mode and popup blockers
    // stop the popup outright, which is how receipts silently stopped
    // printing on a locked-down till.
    const frame = document.createElement('iframe')
    frame.setAttribute('aria-hidden', 'true')
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden'
    document.body.appendChild(frame)

    const cleanup = () => { try { document.body.removeChild(frame) } catch {} }

    frame.onload = () => {
      try {
        frame.contentWindow.focus()
        frame.contentWindow.print()
      } catch (e) { console.error('print failed', e) }
      // Chrome's print dialog is modal; give it room before tearing the frame
      // down, or the job is cancelled mid-spool.
      setTimeout(() => { cleanup(); resolve({ ok: true }) }, 1500)
    }

    const doc = frame.contentWindow.document
    doc.open(); doc.write(html); doc.close()
  })
}

// ---------------------------------------------------------------------------
// The one call the app makes.
// ---------------------------------------------------------------------------
export async function printReceipt(sale, opts = {}) {
  if (!sale) return { ok: false, error: 'No sale' }
  const s = getSettings()
  if (s.printMode === 'off' && !opts.force) return { ok: false, error: 'Printing is off' }

  const wantsDrawer = opts.openDrawer ??
    (s.openDrawerOnCash && (sale.payment === 'Cash' || (sale.payment === 'Split' && Number(sale.splitCash) > 0)))

  if (s.printMode === 'escpos') {
    try {
      const p = new EscPos(s.paperWidth)
      const bytes = buildReceiptBytes(sale, s)
      for (let i = 0; i < Math.max(1, s.copies); i++) {
        const sent = await writeRaw(bytes, false)
        if (!sent) throw new Error('Printer not paired — open Terminal settings')
      }
      if (wantsDrawer) await writeRaw(p.init().drawer().build(), false)
      return { ok: true, via: 'escpos' }
    } catch (e) {
      // Never lose the receipt because the cable fell out. Fall back to the
      // browser dialog so the customer still walks away with paper.
      console.error('ESC/POS print failed, falling back to browser:', e)
      const r = await printViaIframe(sale, s)
      return { ...r, via: 'browser-fallback', warning: e.message }
    }
  }

  const r = await printViaIframe(sale, s)
  return { ...r, via: 'browser' }
}

// A short beep so the cashier hears the scan land without looking up.
export function beep(ok = true) {
  if (!getSettings().beepOnScan) return
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)()
    const osc = ctx.createOscillator(), gain = ctx.createGain()
    osc.connect(gain); gain.connect(ctx.destination)
    osc.frequency.value = ok ? 2000 : 320
    gain.gain.setValueAtTime(0.14, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + (ok ? 0.09 : 0.28))
    osc.start(); osc.stop(ctx.currentTime + (ok ? 0.1 : 0.3))
    setTimeout(() => ctx.close(), 500)
  } catch {}
}
