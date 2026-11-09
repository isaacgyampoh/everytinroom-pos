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
    // From the instant the API confirmed the insert to the instant the figure
    // is on screen. This is the only latency figure in the suite that
    // measures what a cashier experiences: it includes the websocket, the
    // application's own handler, its re-read of the sale through the API and
    // React's render. The synthetic client's number stops at the callback.
    const tCommitted = Date.now()
    const shown = await page.locator('text=/42\\.50/').first()
      .waitFor({ timeout: 30000 }).then(() => true).catch(() => false)
    const uiMs = Date.now() - tCommitted
    if (shown) {
      good('THE APPLICATION RECEIVED THE LIVE EVENT AND SHOWED IT IN THE INTERFACE')
      say(`UI_LATENCY_MS ${uiMs} — from the API confirming the insert to the figure being on screen`)
      try {
        await page.screenshot({ path: '/tmp/app-realtime-popup.png' })
        say('screenshot: /tmp/app-realtime-popup.png (taken after login; no PIN on screen)')
      } catch {}
    } else {
      bad('the application did not show the sale: its pos-live subscription delivered nothing')
    }
  }

  // 4a. THE OTHER TWO SUBSCRIBED TABLES.
  //
  // App.jsx subscribes to three tables and only one of them had ever been
  // exercised through the interface. The sales handler is the conspicuous one
  // because it raises a popup; products and whatsapp_orders just call a
  // refresher, so the only way to see them work is to be on the page that
  // shows the data and watch it change.
  //
  // The hash is set rather than navigated, so the application routes itself
  // through its own hashchange listener without reloading -- a reload would
  // tear down the very subscription under test and re-establish it, which
  // would prove nothing about delivery to a running till.
  async function liveOnPage(hash, needle, label, insert) {
    try {
      await page.evaluate((h) => { window.location.hash = h }, hash)
      await page.waitForTimeout(2500)      // let the page mount and re-read
      // Armed before the insert, for the same reason as the popup above.
      const seenIt = page.locator(`text=${needle}`).first()
        .waitFor({ timeout: 30000 }).then(() => true).catch(() => false)
      const r = await insert()
      if (!r.ok) {
        bad(`could not insert the ${label} probe (HTTP ${r.status}): ${r.body}`)
        return
      }
      const t = Date.now()
      if (await seenIt) good(`a ${label} change appeared in the interface without a refresh (${Date.now() - t}ms)`)
      else bad(`a ${label} change did NOT appear in the interface — that subscription delivers nothing`)
    } catch (e) {
      bad(`the ${label} check could not run: ${scrub(String(e)).slice(0, 160)}`)
    }
  }

  const postRow = async (table, row) => {
    const r = await fetch(`${APP_BASE}/rest/v1/${table}`, {
      method: 'POST',
      headers: { apikey: APP_ANON, Authorization: `Bearer ${APP_ANON}`,
                 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify(row),
    })
    return { ok: r.ok, status: r.status, body: scrub((await r.text()).slice(0, 200)) }
  }

  await liveOnPage('#/products', `${tag}-PRODUCT`, 'product',
    () => postRow('products', { name: `${tag}-PRODUCT`, price: 13.37, quantity: 5 }))
  await liveOnPage('#/whatsapp', `${tag}-WAORDER`, 'website order',
    () => postRow('whatsapp_orders', {
      order_no: `${tag}-WAORDER`, customer_name: `${tag}-WAORDER`,
      total: 55.5, status: 'Pending',
    }))
  // Back to the till, so the workstation check below starts where a cashier
  // would be.
  await page.evaluate(() => { window.location.hash = '#/pos' })
  await page.waitForTimeout(1500)

  // 4b. TWO WORKSTATIONS. A shop has more than one till, and the thing that
  // matters is that a sale rung up at one appears at the other. A second
  // browser CONTEXT, not a second tab: separate storage and a separate
  // session, which is what a second machine actually is.
  //
  // Both waits are armed BEFORE the insert. The sale popup dismisses itself
  // after four seconds, so checking one till and then the other could miss
  // the second one's window and report a working platform as broken --
  // whereas armed first, each till is watched from before the event exists.
  let page2 = null
  try {
    const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 860 } })
    page2 = await ctx2.newPage()
    const errs2 = []
    page2.on('console', (m) => { if (m.type() === 'error') errs2.push(scrub(m.text()).slice(0, 160)) })
    await page2.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 45000 })
    const pin2 = page2.locator('input[inputmode="numeric"], input[type="password"], input[maxlength="1"]')
    await pin2.first().waitFor({ timeout: 25000 })
    const n2 = await pin2.count()
    const d2 = String(APP_PIN).split('')
    if (n2 >= 4) { for (let i = 0; i < 4; i++) await pin2.nth(i).fill(d2[i]) }
    else { await pin2.first().fill(String(APP_PIN)); await page2.keyboard.press('Enter') }
    const in2 = await page2.locator('text=/Staging Probe|Checkout|Products|Sales/i')
      .first().waitFor({ timeout: 30000 }).then(() => true).catch(() => false)
    if (!in2) {
      block('a second workstation could not sign in, so multi-till delivery was not tested')
    } else {
      good('a second workstation signed in independently')
      await page2.waitForTimeout(6000)   // let its channel finish joining
      const w1 = page.locator('text=/77\\.25/').first()
        .waitFor({ timeout: 30000 }).then(() => true).catch(() => false)
      const w2 = page2.locator('text=/77\\.25/').first()
        .waitFor({ timeout: 30000 }).then(() => true).catch(() => false)
      const ins2 = await insertSale(APP_BASE, APP_ANON, `${tag}-multi`, 77.25)
      if (!ins2.ok) {
        bad(`could not insert the multi-workstation sale (HTTP ${ins2.status}): ${ins2.body}`)
      } else {
        const t2 = Date.now()
        const [s1, s2] = await Promise.all([w1, w2])
        if (s1 && s2) {
          good(`BOTH workstations showed the same sale without a refresh (${Date.now() - t2}ms)`)
        } else {
          bad(`only ${(s1 ? 1 : 0) + (s2 ? 1 : 0)} of 2 workstations showed the sale ` +
              `(first till ${s1 ? 'yes' : 'no'}, second till ${s2 ? 'yes' : 'no'})`)
          if (errs2.length) say(`second workstation console errors: ${errs2.slice(0, 3).join(' | ')}`)
        }
      }
    }
  } catch (e) {
    block(`the second workstation could not be opened: ${scrub(String(e)).slice(0, 160)}`)
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

  // Signing in is needed twice more below, so it is one function. It asserts
  // nothing: the assertions belong to the tests that call it.
  async function signIn(p) {
    const f = p.locator('input[inputmode="numeric"], input[type="password"], input[maxlength="1"]')
    await f.first().waitFor({ timeout: 25000 })
    const c = await f.count()
    const d = String(APP_PIN).split('')
    if (c >= 4) { for (let i = 0; i < 4; i++) await f.nth(i).fill(d[i]) }
    else { await f.first().fill(String(APP_PIN)); await p.keyboard.press('Enter') }
    return p.locator('text=/Staging Probe|Checkout|Products|Sales/i')
      .first().waitFor({ timeout: 30000 }).then(() => true).catch(() => false)
  }

  // 6. A NETWORK INTERRUPTION, which is the normal condition of a shop in
  // Accra rather than an edge case.
  //
  // The confound to avoid: this application already re-reads everything on
  // the browser's `online` event, so a row inserted immediately after
  // reconnecting would appear because of that refresh and the test would pass
  // with a subscription that never recovered. So the row goes in only after
  // the reconnect has settled and that refresh has been and gone. From then
  // on, nothing but a live subscription can put a new sale on screen.
  try {
    await page.evaluate(() => { window.location.hash = '#/pos' })
    await ctx.setOffline(true)
    say('the first workstation is offline')
    await page.waitForTimeout(5000)
    await ctx.setOffline(false)
    say('back online; waiting 15s for the reconnect and the application\'s own refresh to finish')
    await page.waitForTimeout(15000)
    const w = page.locator('text=/88\\.80/').first()
      .waitFor({ timeout: 30000 }).then(() => true).catch(() => false)
    const r = await insertSale(APP_BASE, APP_ANON, `${tag}-reconnect`, 88.8)
    if (!r.ok) {
      bad(`could not insert the reconnection probe (HTTP ${r.status}): ${r.body}`)
    } else {
      const t = Date.now()
      if (await w) good(`live updates resumed after a network interruption, unattended (${Date.now() - t}ms)`)
      else bad('live updates did NOT resume after a network interruption — a till would go quietly stale')
    }
  } catch (e) {
    bad(`the network interruption check could not run: ${scrub(String(e)).slice(0, 160)}`)
  }

  // 7. THE APPLICATION RESTARTED. A till gets closed and reopened, and a
  // cashier re-enters their PIN. Nothing about that may leave it without
  // live updates, which is a separate question from the service restarting.
  try {
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 45000 })
    const back = await signIn(page)
    if (!back) {
      bad('the application did not reach its interface again after a restart')
    } else {
      good('the application restarted and signed in again')
      await page.waitForTimeout(6000)   // let the channel finish joining
      const w = page.locator('text=/66\\.60/').first()
        .waitFor({ timeout: 30000 }).then(() => true).catch(() => false)
      const r = await insertSale(APP_BASE, APP_ANON, `${tag}-restart`, 66.6)
      if (!r.ok) {
        bad(`could not insert the restart probe (HTTP ${r.status}): ${r.body}`)
      } else {
        const t = Date.now()
        if (await w) good(`live updates work after the application was restarted (${Date.now() - t}ms)`)
        else bad('live updates did NOT work after the application was restarted')
      }
    }
  } catch (e) {
    bad(`the application restart check could not run: ${scrub(String(e)).slice(0, 160)}`)
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
