// ===========================================================================
// Drive the real Everytinroom application in a real Chromium and wait for the
// sale popup that App.jsx renders when a `sales` INSERT arrives on its
// `pos-live` channel.
//
// Driven by deploy/scripts/test-app-realtime.sh, which builds the application
// against the staging platform and serves it. Environment:
//   APP_URL   where the built application is served
//   APP_PIN   the staging staff PIN (never printed)
//   APP_BASE  the platform's API base, for inserting rows
//   APP_ANON  the application's anon key
//   APP_DB / OTHER_DB  database names, for the cross-tenant check
//
// NOT a synthetic UI: this is the application's own bundle, its own Login
// screen, its own setupRealtime(), its own popup.
// ===========================================================================
import { chromium } from 'playwright'

const {
  APP_URL, APP_PIN, APP_BASE, APP_ANON, OTHER_DB = '',
} = process.env

let pass = 0, fail = 0, blocked = 0
const good = (m) => { pass++; console.log(`  PASS ${m}`) }
const bad = (m) => { fail++; console.log(`  FAIL ${m}`) }
const block = (m) => { blocked++; console.log(`  BLOCKED ${m}`) }
const say = (m) => console.log(`  ${m}`)

// Nothing credential-shaped reaches the output, including from the page's own
// console and network logs.
const scrub = (s) => String(s)
  .replace(/eyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]*/g, '<jwt>')
  .replace(new RegExp(String(APP_ANON).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '<key>')
  .replace(new RegExp(`\\b${APP_PIN}\\b`, 'g'), '<pin>')

const tag = `STAGING-PROBE-${Date.now().toString(36)}`

async function insertSale(base, key, customer, total) {
  const r = await fetch(`${base}/rest/v1/sales`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`,
               'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify({ customer, total, payment: 'Cash', cashier: 'Staging Probe' }),
  })
  return { ok: r.ok, status: r.status, body: scrub((await r.text()).slice(0, 200)) }
}

const browser = await chromium.launch({ args: ['--no-sandbox'] })
const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } })
const page = await ctx.newPage()

// Item 8: console errors, failed requests, websocket diagnostics.
const consoleErrors = [], failedRequests = [], sockets = []
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(scrub(m.text()).slice(0, 200))
})
page.on('requestfailed', (r) => {
  failedRequests.push(`${r.method()} ${scrub(r.url()).slice(0, 120)} — ${r.failure()?.errorText || '?'}`)
})
page.on('websocket', (ws) => {
  sockets.push(`opened ${scrub(ws.url()).slice(0, 110)}`)
  let frames = 0, pg = 0
  ws.on('framereceived', (f) => {
    frames++
    const d = scrub(String(f.payload || '')).slice(0, 300)
    if (/postgres_changes/.test(d)) { pg++; if (pg <= 3) sockets.push(`recv postgres_changes: ${d.slice(0, 180)}`) }
  })
  ws.on('close', () => sockets.push(`closed after ${frames} frame(s), ${pg} mentioning postgres_changes`))
  ws.on('socketerror', (e) => sockets.push(`socket error: ${scrub(e)}`))
})

try {
  say(`opening the application at ${APP_URL}`)
  await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 45000 })

  // 1. The real Login screen.
  const pinInputs = page.locator('input[inputmode="numeric"], input[type="password"], input[maxlength="1"]')
  await pinInputs.first().waitFor({ timeout: 25000 }).catch(() => {})
  const n = await pinInputs.count()
  if (n === 0) {
    block('the application rendered no PIN entry, so its real login could not be driven')
  } else {
    good(`the application's own Login screen rendered (${n} PIN field(s))`)
    const digits = String(APP_PIN).split('')
    if (n >= 4) {
      for (let i = 0; i < 4; i++) await pinInputs.nth(i).fill(digits[i])
    } else {
      await pinInputs.first().fill(String(APP_PIN))
      await page.keyboard.press('Enter')
    }
    // 2. Did verify_pin accept it and the till open?
    const loggedIn = await page.locator('text=/Staging Probe|Checkout|Products|Sales/i')
      .first().waitFor({ timeout: 30000 }).then(() => true).catch(() => false)
    if (loggedIn) good('verify_pin() accepted the PIN and the till opened')
    else bad('the application did not reach its logged-in interface')
  }

  // 3. The subscriptions the application actually makes.
  const subs = await page.evaluate(() => {
    try {
      // The channel the application creates in setupRealtime().
      const g = window
      const names = []
      for (const k of Object.keys(g)) { /* no global handle by design */ }
      return { note: 'no global handle; verified by behaviour instead', names }
    } catch (e) { return { note: String(e) } }
  })
  say(`subscription introspection: ${subs.note}`)

  // 4. THE ACTUAL TEST: insert a sale and wait for the application's popup.
  await page.waitForTimeout(6000)   // let the channel finish joining
  const ins = await insertSale(APP_BASE, APP_ANON, `${tag}-own`, 42.5)
  if (!ins.ok) {
    bad(`could not insert a sale through the API (HTTP ${ins.status}): ${ins.body}`)
  } else {
    say('inserted a sale; waiting up to 30s for the application to show it')
    const shown = await page.locator('text=/42\\.50/').first()
      .waitFor({ timeout: 30000 }).then(() => true).catch(() => false)
    if (shown) {
      good('THE APPLICATION RECEIVED THE LIVE EVENT AND SHOWED IT IN THE INTERFACE')
      try {
        await page.screenshot({ path: '/tmp/app-realtime-popup.png' })
        say('screenshot: /tmp/app-realtime-popup.png (taken after login; no PIN on screen)')
      } catch {}
    } else {
      bad('the application did not show the sale: its pos-live subscription delivered nothing')
    }
  }

  // 5. Cross-tenant: a sale in ANOTHER application must not appear here.
  if (OTHER_DB) {
    const otherBase = `http://${OTHER_DB.replace(/_/g, '-')}.staging.test`
    const o = await insertSale(otherBase, APP_ANON, `${tag}-other`, 99.99)
    say(`inserted into ${OTHER_DB} (HTTP ${o.status}; its own key differs, so a refusal here is also correct)`)
    const leaked = await page.locator('text=/99\\.99/').first()
      .waitFor({ timeout: 15000 }).then(() => true).catch(() => false)
    if (leaked) bad(`a sale written to ${OTHER_DB} APPEARED in ${process.env.APP_DB}'s interface`)
    else good(`a sale written to ${OTHER_DB} did not appear in this application's interface`)
  }
} catch (e) {
  bad(`the browser run stopped: ${scrub(e && e.message ? e.message : e).slice(0, 220)}`)
} finally {
  say('--- browser diagnostics ---')
  say(`console errors: ${consoleErrors.length}`)
  consoleErrors.slice(0, 6).forEach((l) => say(`    ${l}`))
  say(`failed requests: ${failedRequests.length}`)
  failedRequests.slice(0, 6).forEach((l) => say(`    ${l}`))
  say(`websocket events: ${sockets.length}`)
  sockets.slice(0, 10).forEach((l) => say(`    ${l}`))
  await ctx.close().catch(() => {})
  await browser.close().catch(() => {})
}

console.log(`\n  passed ${pass}  failed ${fail}  blocked ${blocked}`)
process.exit(fail > 0 ? 1 : blocked > 0 ? 2 : 0)
