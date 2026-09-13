// ============================================================================
// EVERYTINROOM POS — Windows desktop shell
//
// The installed web app already gave the till its own window. What it could not
// give was a copy of the application that lives on the machine: a browser
// cache can be cleared, and a till that has been wiped cannot reach the shop's
// own software without internet. This ships the built app inside the installer,
// so the till opens and trades whether or not there is a line.
//
// WHY A LOCAL SERVER AND NOT loadFile()
//     file:// has no stable origin, so localStorage is unreliable and service
//     workers do not run at all. Everything the offline design depends on —
//     the catalogue snapshot, the queued sales, the terminal settings, the
//     remembered sign-ins — lives in localStorage. Serving the same bundle over
//     127.0.0.1 gives a real, stable http origin, so the desktop build behaves
//     exactly like the browser one and there is no second code path to keep
//     honest.
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

const { app, BrowserWindow, shell, Menu, dialog } = require('electron')
const path = require('path')
const http = require('http')
const fs = require('fs')
const { pathToFileURL } = require('url')

const DIST = path.join(__dirname, 'app')
const HOST = '127.0.0.1'

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2',
}

// Serve the bundle. Any path that is not a real file falls through to
// index.html so the app's own routing keeps working.
function startServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      try {
        const url = new URL(req.url, `http://${HOST}`)
        let rel = decodeURIComponent(url.pathname)
        if (rel === '/') rel = '/index.html'

        // Never serve outside the bundle, whatever the request says.
        const full = path.normalize(path.join(DIST, rel))
        if (!full.startsWith(DIST)) { res.writeHead(403).end('Forbidden'); return }

        const file = fs.existsSync(full) && fs.statSync(full).isFile()
          ? full
          : path.join(DIST, 'index.html')

        const ext = path.extname(file).toLowerCase()
        res.writeHead(200, {
          'Content-Type': MIME[ext] || 'application/octet-stream',
          // Hashed assets never change meaning; index.html must not be pinned
          // or an update would never be seen.
          'Cache-Control': file.includes(`${path.sep}assets${path.sep}`)
            ? 'public, max-age=31536000, immutable'
            : 'no-cache',
        })
        fs.createReadStream(file).pipe(res)
      } catch (e) {
        res.writeHead(500).end('Server error')
      }
    })
    server.on('error', reject)
    server.listen(0, HOST, () => resolve(server.address().port))
  })
}

let win = null

async function createWindow() {
  let port
  try {
    port = await startServer()
  } catch (e) {
    dialog.showErrorBox('EVERYTINROOM POS',
      'The till could not start its local server.\n\n' + e.message)
    app.quit()
    return
  }

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

  // A till should fill the screen. Esc still gets you out for maintenance.
  win.once('ready-to-show', () => { win.show(); win.setFullScreen(true) })

  // Anything not the app itself — a customer's tracking link, a WhatsApp
  // message — opens in the real browser rather than hijacking the till.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(`http://${HOST}:${port}`)) { e.preventDefault(); shell.openExternal(url) }
  })

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

  win.loadURL(`http://${HOST}:${port}/`)
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
    createWindow()
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
  })

  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
}
