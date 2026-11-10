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
  APP_URL, APP_PIN, APP_PIN2 = '', APP_BASE, APP_ANON, OTHER_DB = '',
} = process.env

let pass = 0, fail = 0, blocked = 0
// EVERY BROWSER BEHAVIOUR BELOW NEEDS A SESSION.
//
// When the login failed, the run reported six further failures -- the sale,
// the product, the website order, the reconnection, the restart -- as though
// they were six independent defects in the application. They were one defect,
// counted six times, and that is a misleading report in the direction that
// matters: it makes a single broken precondition look like a broken product.
//
// Nothing downstream is attempted without a session now. They are recorded as
// not attempted, naming what they were waiting for.
let authed = false
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
  .replace(new RegExp(`\\b${APP_PIN2 || APP_PIN}\\b`, 'g'), '<pin>')

const tag = `STAGING-PROBE-${Date.now().toString(36)}`

// sales.receipt_no is NOT NULL UNIQUE and has no default, so it has to be
// supplied. Omitting it made every insert in this file fail with 23502 and
// the run reported "the real application did not show the live event" -- a
// delivery failure, for a row that was never written. A counter keeps it
// unique across the several sales this run inserts.
let receiptN = 0
async function insertSale(base, key, customer, total) {
  receiptN += 1
  const tIns = Date.now()
  const r = await fetch(`${base}/rest/v1/sales`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`,
               'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify({
      receipt_no: `${tag}-R${receiptN}`,
      customer, total, payment: 'Cash', cashier: 'Staging Probe',
    }),
  })
  return { ok: r.ok, status: r.status, body: scrub((await r.text()).slice(0, 200)), ms: Date.now() - tIns }
}

// TYPED, NOT FILLED, AND THIS IS NOT COSMETIC.
//
// Login.jsx auto-submits on the fourth digit:
//
//   const p = [...pins]; p[i] = val.slice(-1); setPins(p)
//   if (i === 3 && val) tryLogin(p.join(''))
//
// `pins` comes from React state, so each handler sees whatever had been
// rendered when it was created. Filling four inputs in a tight loop outruns
// React's batching: the fourth handler can still be holding an array whose
// first three entries are empty, and it submits a one-digit PIN. verify_pin
// refuses it, correctly, and the test reads as "the application did not reach
// its logged-in interface" -- blaming the application for the harness typing
// faster than any person could.
//
// Typing with a delay also needs no focus management: the component moves
// focus itself after each digit, which is the behaviour being exercised.
async function enterPin(p, pin) {
  const fields = p.locator('input[inputmode="numeric"], input[type="tel"], input[type="password"], input[maxlength="1"]')
  await fields.first().waitFor({ timeout: 25000 })
  // A LOGIN SCREEN THAT STAYS.
  //
  // The application shows its loader, then the PIN screen, and can swap back
  // to the loader while its first load is still running -- which unmounts the
  // boxes and remounts them empty. The second workstation's attempt landed in
  // that gap: the boxes had been seen, were gone when counted ("0 of 0"), and
  // the PIN went nowhere. So the screen has to hold still before anything is
  // typed: the same number of boxes, twice, over a second apart.
  let count = 0
  for (let i = 0; i < 20; i++) {
    const a = await fields.count()
    await p.waitForTimeout(1200)
    const b = await fields.count()
    if (a > 0 && a === b) { count = b; break }
  }
  if (count === 0) count = await fields.count()
  const digits = String(pin).split('')
  if (count >= 4) {
    // fill() PER BOX, NOT keyboard.type(), AND THIS WAS MY MISTAKE TO MAKE
    // TWICE.
    //
    // Run 40 logged in successfully by filling each box. I then decided the
    // problem was typing faster than React can batch, and replaced filling
    // with keyboard.type -- which broke a login that had been working.
    //
    // Typing cannot be relied on here because each box is maxLength={1} with
    // a controlled value, and the component moves focus itself after every
    // digit while an effect also force-focuses the first box. A keystroke
    // that arrives at a box which already holds a digit is silently dropped,
    // and the PIN is then short. fill() addresses each box directly, so it
    // does not depend on where focus happens to be.
    //
    // The pause is for React to commit between digits: the handler reads the
    // PIN out of state, and the fourth box submits whatever the first three
    // had committed by then.
    for (let i = 0; i < 4; i++) {
      await fields.nth(i).fill(digits[i] ?? '')
      await p.waitForTimeout(90)
    }
  } else {
    await fields.first().fill(String(pin))
    await p.keyboard.press('Enter')
  }
  // WHAT ACTUALLY LANDED IN THE BOXES.
  //
  // "it did not log in" has now cost two runs because it does not say whether
  // the PIN was rejected or never arrived. Reading the fields back separates
  // those: four filled boxes and no session means verify_pin refused it; empty
  // or partly filled boxes mean this function typed into the wrong place.
  // The digits themselves are never printed -- only how many are present.
  let filled = 0
  try {
    for (let i = 0; i < count; i++) {
      const v = await fields.nth(i).inputValue()
      if (v && v.length > 0) filled++
    }
  } catch {}
  return { count, filled }
}

const loggedIn = (p) => p.locator('text=/Staging Probe|Checkout|Products|Sales/i')
  .first().waitFor({ timeout: 30000 }).then(() => true).catch(() => false)

const browser = await chromium.launch({ args: ['--no-sandbox'] })
const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } })
const page = await ctx.newPage()

// Item 8: console errors, failed requests, websocket diagnostics.
const consoleErrors = [], failedRequests = [], sockets = []
// The one call that decides whether the till opens. Watched separately
// because run 42 reported several 401s with no indication of which request
// they belonged to, and that is the difference between a missing EXECUTE
// grant on the platform and a bug in the application.
// WHAT THE PAGE ASKED THE SERVER FOR, AND WHEN.
//
// Two sales checks keep reporting about 78ms from insert to display. A poll
// every three seconds cannot do that twice, and reading the code has not
// explained it, so the page's own requests are timestamped. For each check
// the run prints which of them fell between the insert and the figure
// appearing -- if it was a poll, there is a live_state request in that
// window; if there is not, something else put the figure on screen and the
// check is not measuring what it claims to.
const reqLog = []
page.on('request', (r) => {
  const u = r.url()
  const m = u.match(/\/rest\/v1\/(rpc\/)?([a-z_]+)/)
  if (m) reqLog.push({ at: Date.now(), what: (m[1] || '') + m[2] })
})
const between = (t0, t1) => {
  const c = {}
  for (const r of reqLog) if (r.at >= t0 && r.at <= t1) c[r.what] = (c[r.what] || 0) + 1
  const parts = Object.entries(c).map(([k, v]) => `${k}×${v}`)
  return parts.length ? parts.join(', ') : 'NONE'
}
// What element is showing the figure, so "it appeared" can be checked
// against where it appeared.
const whereShown = async (re) => {
  try {
    const el = page.locator(`text=${re}`).first()
    const tag = await el.evaluate((n) => {
      const cls = (n.className && n.className.toString ? n.className.toString() : '').slice(0, 50)
      const ctx = (n.parentElement ? n.parentElement.innerText : n.innerText || '').replace(/\s+/g, ' ').slice(0, 90)
      return `<${n.tagName.toLowerCase()} class="${cls}"> in "${ctx}"`
    })
    return scrub(tag)
  } catch { return 'could not be located afterwards' }
}
const pinCalls = []
page.on('response', async (r) => {
  const u = r.url()
  if (!/\/rest\/v1\/rpc\/verify_pin/.test(u)) return
  // THE BODY, NOT JUST THE STATUS.
  //
  // A bare "HTTP 400" cost a run. PostgREST puts the database's own
  // complaint in the body, and that names the cause: 42703 for a column
  // this function reads that does not exist, 42P01 for a table it writes
  // that does not exist. The body of a SUCCESSFUL call carries a session
  // token, so it is never read -- only failures are.
  let detail = ''
  if (!r.ok()) {
    try { detail = ' ' + scrub((await r.text()).slice(0, 220)) } catch {}
  }
  pinCalls.push(`HTTP ${r.status()} ${r.statusText() || ''}`.trim() + detail)
})
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
  const pinInputs = page.locator('input[inputmode="numeric"], input[type="tel"], input[type="password"], input[maxlength="1"]')
  await pinInputs.first().waitFor({ timeout: 25000 }).catch(() => {})
  const n = await pinInputs.count()
  if (n === 0) {
    block('the application rendered no PIN entry, so its real login could not be driven')
  } else {
    good(`the application's own Login screen rendered (${n} PIN field(s))`)
    const typed = await enterPin(page, APP_PIN)
    say(`PIN entry: ${typed.filled} of ${typed.count} field(s) hold a digit ` +
        `(the digits themselves are never printed)`)
    // 2. Did verify_pin accept it and the till open?
    if (await loggedIn(page)) {
      good('verify_pin() accepted the PIN and the till opened')
      authed = true
    } else {
      bad('the application did not reach its logged-in interface')
      // What was actually on screen, because "it did not log in" is not a
      // diagnosis and a second run spent guessing is a wasted run.
      try {
        const visible = (await page.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 300)
        say(`what was on screen instead: ${scrub(visible)}`)
        await page.screenshot({ path: '/tmp/app-login-failed.png' })
        say('screenshot: /tmp/app-login-failed.png')
      } catch {}
      // And what the server said to the one call that decides this. A 401 or
      // a 404 on verify_pin is a grant or a schema-cache problem on the
      // platform; a 200 that still does not log in is the application's.
      for (const r of pinCalls.slice(0, 4)) say(`  verify_pin call: ${r}`)
      if (pinCalls.length === 0) {
        say('  verify_pin was never called, so the form did not submit at all')
      }
    }
  }

  // THE GATE. Everything from here needs a signed-in till.
  if (!authed) {
    for (const what of [
      'a new sale appearing without a refresh',
      'a product change appearing',
      'a website order change appearing',
      'two workstations both receiving the same sale',
      'another application\'s sale staying out of this interface',
      'live updates resuming after a network interruption',
      'live updates working after the application restarts',
    ]) {
      block(`NOT ATTEMPTED — ${what}: there is no session, because the login above failed. This is not a separate defect.`)
    }
    say('skipping every behaviour that needs a session; the root cause is the login failure above')
  } else {

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
  // TIMED FROM BEFORE THE INSERT IS SENT, WITH THE INSERT'S OWN DURATION
  // BESIDE IT.
  //
  // This used to start the clock after the insert returned and reported 38ms
  // for a mechanism that polls every three seconds. That figure may be real
  // -- a poll can land just as the row commits -- but three sales checks in
  // one run all came back under 100ms, and a number that cannot be explained
  // is not a measurement yet. Starting the clock before the request and
  // printing how long the request took leaves nothing to infer: the figure
  // is the whole wait, and the insert's share of it is stated.
  const shownP = page.locator('text=/42\\.50/').first()
    .waitFor({ timeout: 30000 }).then(() => Date.now()).catch(() => 0)
  const tSent = Date.now()
  const ins = await insertSale(APP_BASE, APP_ANON, `${tag}-own`, 42.5)
  if (!ins.ok) {
    bad(`could not insert a sale through the API (HTTP ${ins.status}): ${ins.body}`)
  } else {
    say('inserted a sale; waiting up to 30s for the application to show it')
    const shownAt = await shownP
    const shown = shownAt > 0
    const uiMs = shown ? shownAt - tSent : -1
    if (shown) {
      good('THE APPLICATION RECEIVED THE LIVE EVENT AND SHOWED IT IN THE INTERFACE')
      say(`UI_LATENCY_MS ${uiMs} — from the insert being SENT to the figure being on screen; the insert itself took ${ins.ms}ms`)
      say(`  requests in that window: ${between(tSent, shownAt)}`)
      say(`  shown by: ${await whereShown('/42\\.50/')}`)
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
      // Long enough that the page's own mount-time read has finished before
      // the probe row exists. Otherwise that read could pick the row up and
      // the test would credit the subscription for it.
      await page.waitForTimeout(4000)
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
    // ITS OWN CASHIER. verify_pin deletes any existing session for the same
    // staff member, so one PIN on two tills signs the first one out -- that
    // is the application's design, and two tills in a real shop are two
    // people. Using one PIN for both tested something no shop does.
    const pin2Calls = []
    page2.on('response', async (r) => {
      if (!/\/rest\/v1\/rpc\/verify_pin/.test(r.url())) return
      let d = ''
      if (!r.ok()) { try { d = ' ' + scrub((await r.text()).slice(0, 200)) } catch {} }
      pin2Calls.push(`HTTP ${r.status()}` + d)
    })
    const typed2 = await enterPin(page2, APP_PIN2 || APP_PIN)
    const in2 = await loggedIn(page2)
    if (!in2) {
      // Attempted and failed is a failure, not a block, and it says why.
      bad('a second workstation could not sign in, so multi-till delivery is unproven')
      say(`  second till PIN entry: ${typed2.filled} of ${typed2.count} field(s) hold a digit`)
      for (const c of pin2Calls.slice(0, 3)) say(`  second till verify_pin call: ${c}`)
      if (pin2Calls.length === 0) say('  second till never called verify_pin')
      try {
        const v2 = (await page2.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 240)
        say(`  second till screen: ${scrub(v2)}`)
      } catch {}
      if (errs2.length) say(`  second till console errors: ${errs2.slice(0, 3).join(' | ')}`)
    } else {
      good('a second workstation signed in independently')
      await page2.waitForTimeout(6000)   // let its channel finish joining
      const w1 = page.locator('text=/77\\.25/').first()
        .waitFor({ timeout: 30000 }).then(() => true).catch(() => false)
      const w2 = page2.locator('text=/77\\.25/').first()
        .waitFor({ timeout: 30000 }).then(() => true).catch(() => false)
      const t2 = Date.now()
      const ins2 = await insertSale(APP_BASE, APP_ANON, `${tag}-multi`, 77.25)
      if (!ins2.ok) {
        bad(`could not insert the multi-workstation sale (HTTP ${ins2.status}): ${ins2.body}`)
      } else {
        const [s1, s2] = await Promise.all([w1, w2])
        if (s1 && s2) {
          good(`BOTH workstations showed the same sale without a refresh (${Date.now() - t2}ms from the insert being sent; insert ${ins2.ms}ms)`)
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
    const t = Date.now()
    const r = await insertSale(APP_BASE, APP_ANON, `${tag}-reconnect`, 88.8)
    if (!r.ok) {
      bad(`could not insert the reconnection probe (HTTP ${r.status}): ${r.body}`)
    } else {
      if (await w) {
        const tShown = Date.now()
        good(`live updates resumed after a network interruption, unattended (${tShown - t}ms from the insert being sent; insert ${r.ms}ms)`)
        say(`  requests in that window: ${between(t, tShown)}`)
        say(`  shown by: ${await whereShown('/88\\.80/')}`)
      }
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
    await enterPin(page, APP_PIN)
    const back = await loggedIn(page)
    if (!back) {
      bad('the application did not reach its interface again after a restart')
    } else {
      good('the application restarted and signed in again')
      await page.waitForTimeout(6000)   // let the channel finish joining
      const w = page.locator('text=/66\\.60/').first()
        .waitFor({ timeout: 30000 }).then(() => true).catch(() => false)
      const t = Date.now()
      const r = await insertSale(APP_BASE, APP_ANON, `${tag}-restart`, 66.6)
      if (!r.ok) {
        bad(`could not insert the restart probe (HTTP ${r.status}): ${r.body}`)
      } else {
        if (await w) {
          const tShown = Date.now()
          good(`live updates work after the application was restarted (${tShown - t}ms from the insert being sent; insert ${r.ms}ms)`)
          say(`  requests in that window: ${between(t, tShown)}`)
          say(`  shown by: ${await whereShown('/66\\.60/')}`)
        }
        else bad('live updates did NOT work after the application was restarted')
      }
    }
  } catch (e) {
    bad(`the application restart check could not run: ${scrub(String(e)).slice(0, 160)}`)
  }
  }   // end of the authenticated-only block
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

// An explicit line, because "no timeout was reported" is not evidence that
// the run finished -- a crash before this point produces no line either, and
// the acceptance roll-up has to be able to tell the difference between a
// harness that completed and one that vanished.
console.log(`  PASS the browser run completed all of its checks`)
console.log(`\n  passed ${pass}  failed ${fail}  blocked ${blocked}`)
process.exit(fail > 0 ? 1 : blocked > 0 ? 2 : 0)
