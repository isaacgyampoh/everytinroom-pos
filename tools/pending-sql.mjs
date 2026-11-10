#!/usr/bin/env node
// ============================================================================
// WHAT STILL NEEDS RUNNING, AS ONE THING TO PASTE
//
// Three migrations have sat unapplied for weeks while the problems they fix
// stayed live. The SQL was never the hard part — working out which files, in
// what order, and whether it is safe to run them together is.
//
//   npm run migrate:pending
//
// Asks the live database which of them are actually missing, then writes a
// single file containing exactly those, in order, ready to paste into the
// Supabase SQL editor.
//
// The additive ones go in that file together. Anything that CLOSES something —
// where running it at the wrong moment makes a working till quietly wrong
// rather than loudly broken — is written to a second file on its own, with
// what has to be true first.
//
// Read-only against the database. It writes files to disk and nothing else.
// ============================================================================

import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const migDir = join(root, 'supabase', 'migrations')

const src = readFileSync(join(root, 'src', 'lib', 'supabase.js'), 'utf8')
const fb = (n) => (src.match(new RegExp(`${n} = '([^']+)'`)) || [])[1]
const URL_ = (process.env.VITE_SUPABASE_URL || fb('FALLBACK_URL') || '').replace(/\/+$/, '')
const KEY = process.env.VITE_SUPABASE_ANON_KEY || fb('FALLBACK_ANON_KEY') || ''
if (!URL_ || !KEY) { console.error('No backend configured.'); process.exit(2) }

const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }
let unreachable = false

// Does an RPC resolve? PGRST202 is "no function matches these arguments".
async function fnExists(name, args) {
  try {
    const r = await fetch(`${URL_}/rest/v1/rpc/${name}`, { method: 'POST', headers: H, body: JSON.stringify(args) })
    if (r.status === 404) return !((await r.json().catch(() => ({})))?.code === 'PGRST202')
    return true
  } catch { unreachable = true; return null }
}

async function columnExists(table, column) {
  try {
    const r = await fetch(`${URL_}/rest/v1/${table}?select=${column}&limit=1`, { headers: H })
    return r.ok
  } catch { unreachable = true; return null }
}

async function salesWindowed() {
  try {
    const count = async (filter = '') => {
      const r = await fetch(`${URL_}/rest/v1/sales?select=id&limit=1${filter}`, {
        method: 'HEAD', headers: { ...H, Prefer: 'count=exact' } })
      if (!r.ok) return null
      return Number((r.headers.get('content-range') || '').split('/')[1])
    }
    const all = await count()
    const recent = await count(`&date=gte.${new Date(Date.now() - 2 * 864e5).toISOString()}`)
    if (all === null) return true          // not readable at all is even better
    return recent !== null && all === recent
  } catch { unreachable = true; return null }
}

const file = (prefix) => {
  const name = readdirSync(migDir).find(f => f.startsWith(prefix))
  if (!name) throw new Error(`no migration starting ${prefix}`)
  return { name, sql: readFileSync(join(migDir, name), 'utf8') }
}

console.log(`\nChecking ${URL_}\n`)

// --- what is missing --------------------------------------------------------
const checks = [
  { prefix: '031', what: 'the session-gated read path for sales',
    missing: async () => (await fnExists('list_sales', { p_token: 'x', p_limit: 1 })) === false, closes: false },
  { prefix: '033', what: 'promotion channels and server-side order pricing',
    missing: async () => (await columnExists('promos', 'channel')) === false, closes: false },
  { prefix: '032', what: 'closing the sales ledger to the public key',
    missing: async () => (await salesWindowed()) === false, closes: true },
]

const pending = []
for (const c of checks) {
  const m = await c.missing()
  if (unreachable) {
    console.error('Could not reach the database. Nothing written — a guess about')
    console.error('what is applied is worse than no answer at all.\n')
    process.exit(2)
  }
  console.log(`  ${m ? '·' : '✓'} ${c.prefix}  ${c.what}${m ? '  — NOT APPLIED' : '  — already applied'}`)
  if (m) pending.push(c)
}

if (!pending.length) {
  console.log('\nNothing to run. `npm run audit:backend` confirms what that bought you.\n')
  process.exit(0)
}

const banner = (title, body) =>
  `-- ${'='.repeat(74)}\n-- ${title}\n-- ${'='.repeat(74)}\n--\n` +
  body.split('\n').map(l => `-- ${l}`.trimEnd()).join('\n') + `\n\n`

const additive = pending.filter(p => !p.closes)
const closing = pending.filter(p => p.closes)
const written = []

if (additive.length) {
  let out = banner('RUN THIS FIRST — EVERYTHING HERE IS ADDITIVE',
    [`Generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} against`,
     URL_,
     '',
     'These add columns with safe defaults and new functions. They revoke',
     'nothing and change no existing row, so a deployed app that has not been',
     'updated keeps working exactly as it does now.',
     '',
     'Paste the whole file into the Supabase SQL editor and run it.',
     '',
     'Contains, in order:',
     ...additive.map(p => `  ${file(p.prefix).name}`)].join('\n'))
  for (const p of additive) {
    const f = file(p.prefix)
    out += `\n-- ${'-'.repeat(72)}\n-- ${f.name}\n-- ${'-'.repeat(72)}\n${f.sql}\n`
  }
  const path = join(root, 'supabase', 'PENDING-1-additive.sql')
  writeFileSync(path, out)
  written.push(path)
}

if (closing.length) {
  let out = banner('RUN THIS SECOND, AND ONLY WHEN THE CHECKS BELOW PASS',
    ['This CLOSES access. Run it at the wrong moment and nothing breaks loudly —',
     'the till falls back to reading the table directly, succeeds, and returns a',
     'two-day window. Every report then looks wrong rather than broken, which is',
     'worse.',
     '',
     'Before running it:',
     '  1. The file above has been run.',
     '  2. `npm run audit:backend` shows list_sales present.',
     '  3. Open Reports and Receipts on a till and confirm sales still appear,',
     '     with no "pre-031 schema" warning in the browser console.',
     '',
     'To undo it:',
     '  DROP POLICY IF EXISTS "sales_select_recent" ON sales;',
     '  CREATE POLICY "sales_select" ON sales FOR SELECT TO anon, authenticated USING (true);'].join('\n'))
  for (const p of closing) {
    const f = file(p.prefix)
    out += `\n-- ${'-'.repeat(72)}\n-- ${f.name}\n-- ${'-'.repeat(72)}\n${f.sql}\n`
  }
  const path = join(root, 'supabase', 'PENDING-2-closing.sql')
  writeFileSync(path, out)
  written.push(path)
}

console.log('\nWritten:')
for (const w of written) console.log(`  ${w.replace(root + '/', '')}`)
console.log('\nPaste the first into the Supabase SQL editor and run it. Then')
console.log('`npm run audit:backend` to see what changed.\n')
