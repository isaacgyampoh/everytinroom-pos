// ============================================================================
// EVERYTINROOM POS — Windows desktop shell
//
// The installed web app already gave the till its own window. What it could not
// give was a copy of the application that lives on the machine: a browser
// cache can be cleared, and a till that has been wiped cannot reach the shop's
// own software without internet. This ships the built app inside the installer,
// so the till opens and trades whether or not there is a line.
//
// WHY A CUSTOM SCHEME AND NOT file:// OR A LOCAL PORT
//     Everything the offline design depends on — the catalogue snapshot, the
//     queued sales, the terminal settings, the remembered sign-ins — lives in
//     localStorage, which is keyed by ORIGIN.
//
//     file:// has no stable origin and no service worker. A local HTTP server
//     looked right and was worse in a way that would only have shown up in the
//     shop: listen(0) takes a free port, so the origin was
//     http://127.0.0.1:53744 one launch and :53745 the next. Every restart
//     would have started with empty storage and silently abandoned any sale
//     queued while the line was down.
//
//     A registered privileged scheme has one origin, everytinroom://pos, for
//     the life of the installation. No port, nothing to collide with, no
//     firewall prompt, and localStorage and service workers behave exactly as
//     they do in the browser build.
// ============================================================================

// If ELECTRON_RUN_AS_NODE is set, the Electron binary behaves as plain Node and
// require('electron') hands back a path string instead of the API — every call
// below then fails with an unhelpful "cannot read properties of undefined".
// Some toolchains set it globally, so say what is wrong rather than crash.
if (process.env.ELECTRON_RUN_AS_NODE) {
  console.error(
    'ELECTRON_RUN_AS_NODE is set, so this is running as Node rather than as\n' +
    'the Electron main process. Unset it and start again:\n\n' +
    '  env -u ELECTRON_RUN_AS_NODE npm start      (macOS / Linux)\n' +
    '  set ELECTRON_RUN_AS_NODE= && npm start     (Windows)\n')
  process.exit(1)
}

const { app, BrowserWindow, shell, Menu, dialog, protocol, net } = require('electron')
const path = require('path')
const fs = require('fs')
const { pathToFileURL } = require('url')

const DIST = path.join(__dirname, 'app')
const SCHEME = 'everytinroom'
const ORIGIN = `${SCHEME}://pos`

// Declared before app-ready, as Electron requires. `standard` gives it a real
// origin, `secure` is what unlocks localStorage and service workers.
protocol.registerSchemesAsPrivileged([{
  scheme: SCHEME,
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
}])

// Serve the bundle. Anything that is not a real file falls through to
// index.html so the app's own routing keeps working.
function serveBundle() {
  protocol.handle(SCHEME, (request) => {
    let rel
    try { rel = decodeURIComponent(new URL(request.url).pathname) } catch { rel = '/' }
    if (!rel || rel === '/') rel = '/index.html'

    // Never serve outside the bundle, whatever the request says.
    // path.sep matters: without it a sibling folder named `app-old` would pass
    // a plain startsWith(DIST) check and be served.
    const full = path.normalize(path.join(DIST, rel))
    if (full !== DIST && !full.startsWith(DIST + path.sep)) return new Response('Forbidden', { status: 403 })

    const file = fs.existsSync(full) && fs.statSync(full).isFile() ? full : path.join(DIST, 'index.html')
    return net.fetch(pathToFileURL(file).toString())
  })
}

// ---------------------------------------------------------------------------
// Behaviour a till needs that a browser tab got for free.
// ---------------------------------------------------------------------------

// shell.openExternal rejects when Windows has no handler for the URL or the
// default browser is broken. Unhandled, that is an unhandled rejection in the
// log and a link that does nothing at all for whoever clicked it.
function openOutside(url) {
  shell.openExternal(url).catch(() => {
    dialog.showMessageBox(win, {
      type: 'info',
      title: 'EVERYTINROOM POS',
      message: 'This machine could not open that link.',
      detail: `${url}\n\nCopy it into a browser, or set a default browser in Windows settings.`,
      buttons: ['OK'],
    })
  })
}

// window.open passes its placement as a features string. The customer display
// works out which physical screen the customer is facing and asks for that
// screen's exact rectangle, so those numbers have to survive.
function childOptions(features) {
  const f = {}
  String(features || '').split(',').forEach((pair) => {
    const [k, v] = pair.split('=').map((s) => (s || '').trim())
    if (k) f[k.toLowerCase()] = v
  })
  const n = (k) => (Number.isFinite(Number(f[k])) && f[k] !== '' ? Number(f[k]) : undefined)
  return {
    x: n('left'), y: n('top'),
    width: n('width') || 1280, height: n('height') || 800,
    fullscreen: f.fullscreen === 'yes',
    autoHideMenuBar: true,
    backgroundColor: '#16181d',   // the customer display is a dark screen
    webPreferences: { nodeIntegration: false, contextIsolation: true, spellcheck: false },
  }
}

// F11 toggles fullscreen. Escape is deliberately left alone — the app uses it
// to close the cart drawer and its modals, and stealing it here would break
// them in the desktop build only.
function allowFullScreenToggle(w) {
  w.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') {
      e.preventDefault()
      w.setFullScreen(!w.isFullScreen())
    }
  })
}

// A POS layout is fixed. On a touchscreen a stray two-finger pinch zooms the
// page and there is no menu to undo it with, which looks exactly like the app
// breaking.
function lockZoom(wc) {
  wc.setVisualZoomLevelLimits(1, 1).catch(() => {})
  wc.on('did-finish-load', () => wc.setZoomFactor(1))
}

// A blank white window is the worst thing a till can show: nothing to read,
// nothing to do. Say what happened and offer the one useful action.
function watchForTrouble(w) {
  w.webContents.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
    if (!isMainFrame || code === -3) return   // -3 is an aborted navigation
    dialog.showMessageBox(w, {
      type: 'error',
      title: 'EVERYTINROOM POS',
      message: 'The till software could not start.',
      detail: `${desc} (${code})\n${url}\n\nIf this keeps happening, reinstall from the admin page.`,
      buttons: ['Try again', 'Close'],
      defaultId: 0,
    }).then(({ response }) => (response === 0 ? w.reload() : w.close()))
  })

  // The renderer died, so whatever was on screen is already gone. Reloading
  // gets the cashier back to the PIN screen instead of a dead window.
  w.webContents.on('render-process-gone', (_e, details) => {
    if (details.reason === 'clean-exit') return
    w.reload()
  })

  // Merely slow is not the same as dead, and reloading mid-sale would throw
  // away a cart. Let whoever is standing at the till decide.
  w.on('unresponsive', () => {
    dialog.showMessageBox(w, {
      type: 'warning',
      title: 'EVERYTINROOM POS',
      message: 'The till has stopped responding.',
      detail: 'Waiting is usually enough. Restarting loses anything in the current cart.',
      buttons: ['Keep waiting', 'Restart the till'],
      defaultId: 0,
    }).then(({ response }) => { if (response === 1) w.reload() })
  })
}

let win = null

function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 800,
    minWidth: 1024, minHeight: 700,
    show: false,
    backgroundColor: '#f6f6f5',
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'build', 'icon.ico'),
    webPreferences: {
      // The page is the shop's own bundle, but there is no reason to hand it
      // node — it does not use it, and not granting it keeps the attack
      // surface the same as the browser build.
      nodeIntegration: false,
      contextIsolation: true,
      spellcheck: false,
    },
  })

  // A till should fill the screen. F11 gets you out again for maintenance —
  // without it the window has no menu, no title bar and no way back to the
  // Windows desktop short of Alt+F4.
  win.once('ready-to-show', () => { win.show(); win.setFullScreen(true) })
  allowFullScreenToggle(win)
  lockZoom(win.webContents)

  // Anything not the app itself — a customer's tracking link, a WhatsApp
  // message — opens in the real browser rather than hijacking the till.
  //
  // The shop's OWN pages are a different matter. The customer display is a
  // second window on the second screen, opened by the app with a
  // everytinroom://pos URL. Denying every window.open (which is what this did)
  // left the customer screen blank on the desktop till with nothing logged.
  win.webContents.setWindowOpenHandler(({ url, features }) => {
    if (!url.startsWith(ORIGIN)) { openOutside(url); return { action: 'deny' } }
    return { action: 'allow', overrideBrowserWindowOptions: childOptions(features) }
  })
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(ORIGIN)) { e.preventDefault(); openOutside(url) }
  })

  // The customer display is a window in its own right and needs the same
  // rules — it must not become a way to browse out of the till.
  win.webContents.on('did-create-window', (child) => {
    child.setMenuBarVisibility(false)
    allowFullScreenToggle(child)
    lockZoom(child.webContents)
    child.webContents.setWindowOpenHandler(({ url }) => {
      if (!url.startsWith(ORIGIN)) openOutside(url)
      return { action: 'deny' }
    })
    child.webContents.on('will-navigate', (e, url) => {
      if (!url.startsWith(ORIGIN)) { e.preventDefault(); openOutside(url) }
    })
  })

  watchForTrouble(win)

  // Serial and USB are how the receipt printer and cash drawer are reached.
  // In a browser each needs a permission click; here the till is the shop's own
  // machine, so grant them and let Terminal & printer do the pairing.
  win.webContents.session.setPermissionCheckHandler((_wc, permission) =>
    ['serial', 'usb', 'hid', 'clipboard-read', 'clipboard-sanitized-write'].includes(permission))
  win.webContents.session.setDevicePermissionHandler(() => true)
  win.webContents.session.on('select-serial-port', (event, ports, callback) => {
    event.preventDefault()
    callback(ports.length ? ports[0].portId : '')
  })

  win.loadURL(`${ORIGIN}/`)
  win.on('closed', () => { win = null })
}

// One till, one window. A second instance focuses the first rather than opening
// a duplicate — two windows would mean two carts.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (win) { if (win.isMinimized()) win.restore(); win.focus() }
  })

  app.whenReady().then(() => {
    Menu.setApplicationMenu(null)
    serveBundle()
    createWindow()
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
  })

  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
}
