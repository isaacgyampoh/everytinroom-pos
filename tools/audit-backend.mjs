#!/usr/bin/env node
// ============================================================================
// WHAT CAN A STRANGER READ?
//
// The anon key is compiled into the browser bundle, so anyone who opens
// devtools on the storefront has it. That is fine — it is designed to be
// public — but only to the exact extent that row-level security says so. The
// whole of SECURITY.md is really one question: what does that key actually
// reach today?
//
// Answering it by reading migrations does not work. This repo has thirty-two
// of them, SECURITY.md spent weeks claiming three gaps were open when
// migration 021 had closed two of them, and it told you to stop running at 020
// — one short of the migration that closes the tables. A document drifts. This
// asks the live database instead.
//
//   npm run audit:backend
//
// Read-only. It counts rows and checks whether functions resolve; it never
// writes, and it never prints a row — a tool that dumps the thing it is
// warning you about is not a security tool.
//
// Exits non-zero if anything is exposed, so it can gate a release.
// ============================================================================

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(join(here, '..', 'src', 'lib', 'supabase.js'), 'utf8')
const fallback = (name) => (src.match(new RegExp(`${name} = '([^']+)'`)) || [])[1]

const URL_ = (process.env.VITE_SUPABASE_URL || fallback('FALLBACK_URL') || '').replace(/\/+$/, '')
const KEY = process.env.VITE_SUPABASE_ANON_KEY || fallback('FALLBACK_ANON_KEY') || ''

if (!URL_ || !KEY) {
  console.error('No backend configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.')
  process.exit(2)
}

const H = { apikey: KEY, Authorization: `Bearer ${KEY}` }
const problems = []
const notes = []
// Probes that never got an answer. These are NOT clean results: a security
// tool that reports all-clear because the network was down is worse than no
// tool at all, so any of these makes the run inconclusive and exits 2.
const unreachable = []

// --- how many rows of this table can the public key see? --------------------
// HEAD + count: the server returns the number and no data at all.
async function readable(table, column = 'id') {
  try {
    const r = await fetch(`${URL_}/rest/v1/${table}?select=${column}&limit=1`, {
      method: 'HEAD', headers: { ...H, Prefer: 'count=exact' },
    })
    if (!r.ok) return { ok: false, status: r.status }
    const range = r.headers.get('content-range') || ''
    const total = Number(range.split('/')[1])
    return { ok: true, count: Number.isFinite(total) ? total : null }
  } catch (e) { return { ok: false, reached: false, error: String(e.message || e) } }
}

async function readableWhere(table, filter) {
  try {
    const r = await fetch(`${URL_}/rest/v1/${table}?select=id&limit=1&${filter}`, {
      method: 'HEAD', headers: { ...H, Prefer: 'count=exact' },
    })
    if (!r.ok) return { ok: false, status: r.status }
    const total = Number((r.headers.get('content-range') || '').split('/')[1])
    return { ok: true, count: Number.isFinite(total) ? total : null }
  } catch (e) { return { ok: false, reached: false, error: String(e.message || e) } }
}

// --- does this function exist on the deployed schema? -----------------------
// PGRST202 is PostgREST's "no function matches these arguments".
async function fnExists(name, args) {
  try {
    const r = await fetch(`${URL_}/rest/v1/rpc/${name}`, {
      method: 'POST', headers: { ...H, 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
    })
    if (r.status === 404) {
      const body = await r.json().catch(() => ({}))
      if (body?.code === 'PGRST202') return false
    }
    return true
  } catch { return null }
}

const pad = (s, n) => String(s).padEnd(n)
const line = (icon, label, detail) => console.log(`  ${icon} ${pad(label, 34)} ${detail}`)

console.log(`\nBackend audit — ${URL_}\n${'-'.repeat(64)}`)

// ---------------------------------------------------------------------------
console.log('\nMigrations (are the gated read paths deployed?)')
// Only functions that are read-only, or that refuse an invalid session before
// touching anything, are probed. record_sale is deliberately NOT among them:
// PostgREST resolves an RPC by its exact named-argument set, so a partial probe
// reports a function that plainly works as missing — and a complete one would
// record a sale. find_by_barcode proves migration 020 just as well, for free.
const fns = [
  ['find_by_barcode',      { p_code: '__audit__' },                            '020'],
  ['reject_receiving',     { p_token: '__audit__', p_id: null, p_reason: 'x' }, '021'],
  ['list_sales',           { p_token: '__audit__', p_limit: 1 },               '031'],
  ['find_sale_by_receipt', { p_token: '__audit__', p_receipt_no: '__audit__' }, '031'],
]
for (const [name, args, mig] of fns) {
  const has = await fnExists(name, args)
  if (has === null) { line('?', name, 'could not reach the server'); unreachable.push(name); continue }
  if (has) line('✓', name, `present (migration ${mig})`)
  else { line('✗', name, `MISSING — migration ${mig} not run`); problems.push(`${name} missing — run migration ${mig}`) }
}

// ---------------------------------------------------------------------------
console.log('\nWhat the public anon key can read')
// Migration 032 does not revoke SELECT on sales — it narrows it to a two-day
// window, because the till subscribes to INSERTs through Realtime and Realtime
// applies RLS as the subscribing role. So "is it closed?" is the wrong
// question. The right one is whether the key reaches MORE than the window: if
// the total and the last-two-days count are the same number, 032 is doing its
// job; if the total is far larger, the key has the whole ledger.
const all = await readable('sales')
const since = new Date(Date.now() - 2 * 864e5).toISOString()
const recent = await readableWhere('sales', `date=gte.${since}`)
if (all.reached === false) {
  line('?', 'sales', 'could not reach the server')
  unreachable.push('sales')
}  else if (!all.ok) {
  line('✓', 'sales', `not readable (HTTP ${all.status})`)
} else if (recent.ok && all.count !== null && recent.count !== null && all.count === recent.count) {
  line('✓', 'sales', `windowed — ${all.count} rows, all within 2 days (032 applied)`)
} else {
  const extra = (all.count ?? 0) - (recent.count ?? 0)
  line('✗', 'sales', `WHOLE LEDGER — ${all.count} rows (${extra} older than the window)`)
  problems.push(`sales: the anon key reads the whole ledger, ${all.count} rows — run migrations 031 then 032`)
}

const tables = [
  // table,            expectation, why
  ['staff',            'closed', '015 moved it behind staff_safe'],
  ['products',         'open',   'the storefront lists them'],
  ['whatsapp_orders',  'open',   'the storefront tracks orders'],
  ['stock_ledger',     'open',   'readable by design; writes revoked in 021'],
  ['receivings',       'open',   'same'],
  ['suppliers',        'open',   'same'],
  ['expenses',         'watch',  'no gated read path exists yet'],
  ['refunds',          'watch',  'no gated read path exists yet'],
]
for (const [t, expect, why] of tables) {
  const r = await readable(t)
  if (r.reached === false) { line('?', t, 'could not reach the server'); unreachable.push(t); continue }
  if (!r.ok) { line('✓', t, `not readable (HTTP ${r.status})`); continue }
  const n = r.count === null ? 'unknown' : `${r.count} rows`
  if (expect === 'closed') {
    line('✗', t, `READABLE — ${n}`)
    problems.push(`${t} is readable with the anon key (${n})`)
  } else if (expect === 'watch') {
    line('!', t, `readable — ${n} (${why})`)
    notes.push(`${t} is readable with the anon key (${n}) — ${why}`)
  } else {
    line('·', t, `readable — ${n} (${why})`)
  }
}

// ---------------------------------------------------------------------------
console.log('\nThe staff PIN column')
const pins = await readable('staff', 'pin')
if (pins.reached === false) { line('?', 'staff.pin', 'could not reach the server'); unreachable.push('staff.pin') }
else if (pins.ok) { line('✗', 'staff.pin', 'READABLE — rotate every PIN now'); problems.push('staff.pin is readable with the anon key') }
else { line('✓', 'staff.pin', `not readable (HTTP ${pins.status})`) }

// ---------------------------------------------------------------------------
console.log(`\n${'-'.repeat(64)}`)
if (unreachable.length) {
  console.log(`INCONCLUSIVE — ${unreachable.length} probe(s) never reached the server.\n`)
  console.log('  Nothing here says the backend is safe; it says the audit could not')
  console.log('  run. Check the URL, the key, and the connection, then run it again.\n')
  console.log(`  no answer for: ${unreachable.join(', ')}\n`)
  process.exit(2)
}
if (notes.length) {
  console.log('Worth knowing:\n')
  for (const n of notes) console.log(`  · ${n}`)
  console.log('')
}
if (!problems.length) {
  console.log('Nothing exposed that a migration would close.\n')
  process.exit(0)
}
console.log(`${problems.length} problem(s):\n`)
for (const p of problems) console.log(`  · ${p}`)
console.log('\nSee SECURITY.md. Migrations live in supabase/migrations and are run')
console.log('in the Supabase SQL editor, in numerical order.\n')
process.exit(1)
