import { useState, useEffect } from 'react'
import { useStore } from '../hooks/useStore'
import { getSupabase } from '../lib/supabase'
import { money, num } from '../lib/utils'
import {
  getSettings, saveSettings, terminalId, terminalLabel,
  pairPrinter, printReceipt, kickDrawer, escposSupported,
} from '../lib/hardware'
import { pendingCount, flush, onPendingChange } from '../lib/offlineQueue'
import toast from 'react-hot-toast'

// Per-machine settings. These live in this browser only — two tills in the same
// shop each keep their own paper width, printer pairing and till name.
export default function TerminalPage() {
  const { user, token, sales } = useStore()
  const [s, setS] = useState(getSettings())
  const [queued, setQueued] = useState(pendingCount())
  const [drawer, setDrawer] = useState(null)
  const [counted, setCounted] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => onPendingChange(setQueued), [])

  const set = (patch) => setS(saveSettings(patch))

  const testPrint = async () => {
    const r = await printReceipt({
      receiptNo: 'TEST-0001', date: new Date().toISOString(),
      customer: 'Walk-in', cashier: user?.name || 'Test', payment: 'Cash',
      items: [
        { name: 'Test item — long name to check wrapping', qty: 2, price: 12.5, lineTotal: 25 },
        { name: 'Second item', qty: 1, price: 8, lineTotal: 8 },
      ],
      total: 33, discount: 0,
    }, { force: true, openDrawer: false })
    if (!r.ok) toast.error(r.error || 'Print failed')
    else toast.success('Sent to printer via ' + r.via)
  }

  const pair = async () => {
    const r = await pairPrinter()
    if (r.ok) { toast.success('Printer paired over ' + r.via); set({ printMode: 'escpos' }) }
    else toast.error(r.error || 'Pairing cancelled')
  }

  const testDrawer = async () => {
    const r = await kickDrawer()
    if (!r.ok) toast.error(r.error)
    else toast.success('Drawer pulse sent')
  }

  const doFlush = async () => {
    setBusy(true)
    const r = await flush()
    setBusy(false)
    if (r.offline) toast.error('Still offline')
    else if (r.sent) toast.success(`${r.sent} sale(s) filed`)
    else if (r.left) toast.error(`${r.left} still waiting — server not reachable`)
    else toast.success('Nothing waiting')
  }

  // ---- cash drawer session -------------------------------------------------
  const loadDrawer = async () => {
    const { data } = await getSupabase().from('drawer_sessions')
      .select('*').is('closed_at', null).eq('terminal', terminalLabel())
      .order('opened_at', { ascending: false }).limit(1)
    setDrawer(data?.[0] || null)
  }
  useEffect(() => { loadDrawer() }, []) // eslint-disable-line

  const openDrawerSession = async () => {
    const float = prompt('Opening float in the drawer (GHS)?', '0')
    if (float === null) return
    const { error } = await getSupabase().from('drawer_sessions').insert({
      terminal: terminalLabel(), opened_by: user?.name || '', opening_float: num(float),
    })
    if (error) { toast.error(error.message); return }
    toast.success('Drawer opened'); loadDrawer()
  }

  const closeDrawerSession = async () => {
    if (!drawer) return
    if (counted === '') { toast.error('Count the cash first'); return }
    setBusy(true)
    const { data, error } = await getSupabase().rpc('close_drawer', {
      p_token: token, p_session_id: drawer.id, p_counted: num(counted), p_note: '',
    })
    setBusy(false)
    if (error || !data?.success) { toast.error(data?.error || error?.message || 'Failed'); return }
    const v = Number(data.variance)
    toast[v === 0 ? 'success' : 'error'](
      v === 0 ? 'Drawer balances exactly' : `${v > 0 ? 'Over' : 'Short'} by ${money(Math.abs(v))}`,
      { duration: 6000 })
    setCounted(''); loadDrawer()
  }

  // Stacks on a phone: a long explanatory hint next to a three-button control
  // squeezes both into unreadable columns at 375px.
  const Row = ({ label, hint, children }) => (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 sm:gap-4 py-3.5 border-b border-gray-100 last:border-0">
      <div className="min-w-0">
        <div className="text-sm font-semibold text-gray-800">{label}</div>
        {hint && <div className="text-[11px] text-gray-400 mt-0.5 leading-snug">{hint}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )

  const Toggle = ({ on, onClick }) => (
    <button onClick={onClick} className={`w-12 h-7 rounded-full transition relative ${on ? 'bg-emerald-500' : 'bg-gray-300'}`}>
      <span className={`absolute top-1 w-5 h-5 rounded-full bg-white transition-all ${on ? 'left-6' : 'left-1'}`} />
    </button>
  )

  const card = 'bg-white rounded-2xl p-5 md:p-6 shadow-md mb-5'

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-6">
        <h1 className="text-[22px] md:text-[26px] font-bold">Terminal</h1>
        <p className="text-xs text-gray-500 mt-1">
          Printer, cash drawer and till settings for <b>this machine</b> ({terminalId()})
        </p>
      </div>

      {/* ---- till identity ---- */}
      <div className={card}>
        <h2 className="text-sm font-bold text-gray-800 mb-1">This till</h2>
        <p className="text-[11px] text-gray-400 mb-3">Stamped on every sale, so a shop with two counters can tell them apart in reports and drawer counts.</p>
        <input
          className="w-full h-12 px-4 bg-gray-50 border-2 border-gray-200 rounded-xl text-base"
          placeholder="e.g. Front Counter"
          value={s.terminalName}
          onChange={e => set({ terminalName: e.target.value })}
        />
      </div>

      {/* ---- printing ---- */}
      <div className={card}>
        <h2 className="text-sm font-bold text-gray-800 mb-3">Receipt printer</h2>

        <Row label="Paper width" hint="58mm is the small handheld roll; 80mm is the standard counter printer. Getting this wrong wraps every line.">
          <div className="flex gap-2">
            {[58, 80].map(w => (
              <button key={w} onClick={() => set({ paperWidth: w })}
                className={`h-10 px-4 rounded-xl text-xs font-bold border-2 transition ${s.paperWidth === w ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-200 text-gray-500'}`}>
                {w}mm
              </button>
            ))}
          </div>
        </Row>

        <Row label="How to print" hint={escposSupported()
          ? 'Direct sends raw ESC/POS to the printer — no dialog, and it can open the cash drawer. Browser uses the normal print dialog and works everywhere.'
          : 'This browser has no Web Serial or WebUSB, so Direct is unavailable. Use Chrome or Edge on the till for drawer support.'}>
          <div className="flex gap-2">
            {[['browser', 'Browser'], ['escpos', 'Direct'], ['off', 'Off']].map(([id, label]) => (
              <button key={id} onClick={() => set({ printMode: id })}
                disabled={id === 'escpos' && !escposSupported()}
                className={`h-10 px-3.5 rounded-xl text-xs font-bold border-2 transition disabled:opacity-30 ${s.printMode === id ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-200 text-gray-500'}`}>
                {label}
              </button>
            ))}
          </div>
        </Row>

        <Row label="Print automatically" hint="Print the receipt as soon as a sale completes, without anyone tapping Print.">
          <Toggle on={s.autoPrint} onClick={() => set({ autoPrint: !s.autoPrint })} />
        </Row>

        <Row label="Copies" hint="Two is common when the shop keeps one and the customer takes one.">
          <div className="flex gap-2">
            {[1, 2].map(n => (
              <button key={n} onClick={() => set({ copies: n })}
                className={`w-10 h-10 rounded-xl text-xs font-bold border-2 transition ${s.copies === n ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-200 text-gray-500'}`}>{n}</button>
            ))}
          </div>
        </Row>

        <div className="flex flex-wrap gap-2 mt-4">
          {s.printMode === 'escpos' && (
            <button onClick={pair} className="h-11 px-4 bg-gray-900 text-white rounded-xl text-xs font-bold">Pair printer</button>
          )}
          <button onClick={testPrint} className="h-11 px-4 border-2 border-gray-200 text-gray-600 rounded-xl text-xs font-bold">Test print</button>
        </div>

        {s.printMode === 'browser' && (
          <p className="text-[11px] text-gray-400 mt-3 leading-relaxed">
            In the print dialog, set the thermal printer as default and margins to <b>None</b> once — the browser remembers it.
            Tick "background graphics" off to save ribbon.
          </p>
        )}
      </div>

      {/* ---- cash drawer ---- */}
      <div className={card}>
        <h2 className="text-sm font-bold text-gray-800 mb-3">Cash drawer</h2>

        <Row label="Open on cash sales" hint="The drawer is wired to the printer and opens on an ESC/POS pulse — this needs Direct print mode.">
          <Toggle on={s.openDrawerOnCash} onClick={() => set({ openDrawerOnCash: !s.openDrawerOnCash })} />
        </Row>

        <div className="pt-4">
          {drawer ? (
            <div className="bg-gray-50 rounded-xl p-4">
              <div className="text-xs text-gray-500 mb-2">
                Open since {new Date(drawer.opened_at).toLocaleString('en-GB')} · float {money(drawer.opening_float)} · by {drawer.opened_by || '—'}
              </div>
              <div className="flex flex-col sm:flex-row gap-2">
                <input type="number" inputMode="decimal" placeholder="Cash counted in drawer"
                  className="flex-1 h-12 px-4 bg-white border-2 border-gray-200 rounded-xl text-base"
                  value={counted} onChange={e => setCounted(e.target.value)} />
                <button onClick={closeDrawerSession} disabled={busy}
                  className="h-12 px-5 bg-gray-900 text-white rounded-xl text-sm font-bold disabled:opacity-40">Close & count</button>
              </div>
              <p className="text-[11px] text-gray-400 mt-2">
                Expected = opening float + every cash and split-cash sale rung on this till since it opened. The difference is reported as over or short.
              </p>
            </div>
          ) : (
            <button onClick={openDrawerSession} className="h-11 px-4 bg-gray-900 text-white rounded-xl text-xs font-bold">Open drawer for this shift</button>
          )}
        </div>

        <button onClick={testDrawer} className="h-11 px-4 border-2 border-gray-200 text-gray-600 rounded-xl text-xs font-bold mt-3">Test drawer pulse</button>
      </div>

      {/* ---- scanner ---- */}
      <div className={card}>
        <h2 className="text-sm font-bold text-gray-800 mb-3">Barcode scanner</h2>
        <Row label="Beep on scan" hint="A short tone confirms the item landed in the cart, so the cashier need not look up at the screen.">
          <Toggle on={s.beepOnScan} onClick={() => set({ beepOnScan: !s.beepOnScan })} />
        </Row>
        <p className="text-[11px] text-gray-400 mt-3 leading-relaxed">
          Any USB or Bluetooth scanner in keyboard mode works — no setup needed. Scan anywhere on the Point of Sale screen and the item is added.
          A product only scans once its barcode has been saved on the Products page.
        </p>
      </div>

      {/* ---- offline ---- */}
      <div className={card}>
        <h2 className="text-sm font-bold text-gray-800 mb-1">Unfiled sales</h2>
        <p className="text-[11px] text-gray-400 mb-3">
          Cash sales made while the internet was down are held on this machine until it can reach the server. They file themselves automatically.
          <b> Do not clear this browser's data while any are waiting.</b>
        </p>
        <div className="flex items-center gap-3">
          <div className={`text-2xl font-bold ${queued ? 'text-amber-600' : 'text-emerald-600'}`}>{queued}</div>
          <button onClick={doFlush} disabled={busy || !queued}
            className="h-11 px-4 bg-gray-900 text-white rounded-xl text-xs font-bold disabled:opacity-30">
            {busy ? 'Sending…' : 'Send now'}
          </button>
        </div>
      </div>

      <div className={card}>
        <h2 className="text-sm font-bold text-gray-800 mb-1">Today on this till</h2>
        <p className="text-[11px] text-gray-400 mb-3">Sales stamped with <b>{terminalLabel()}</b>.</p>
        <div className="text-2xl font-bold">
          {money(sales.filter(x => !x.voided && String(x.date || '').slice(0, 10) === new Date().toISOString().slice(0, 10)).reduce((a, x) => a + x.total, 0))}
        </div>
      </div>
    </div>
  )
}
