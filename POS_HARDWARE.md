# Running on a POS terminal

The app was built for a phone or a laptop. This is what changed so it works on
an actual till — a touchscreen with a thermal printer, a barcode scanner and a
cash drawer.

Everything below is configured per machine, from **Terminal & Printer** in the
menu. Two tills in the same shop each keep their own settings.

---

## What was missing before

| | Before | Now |
|---|---|---|
| **Barcode scanner** | Products had no barcode column. Scanning typed digits into the search box and matched nothing. | Products have a barcode; scanning anywhere on the POS screen adds to the cart. |
| **Receipt printing** | `window.open()` + `print()`. Blocked outright in kiosk/fullscreen mode, so receipts silently stopped coming out. | Hidden iframe (never blocked), plus a direct ESC/POS path. |
| **Paper width** | Hardcoded 80mm. | 58mm or 80mm, per terminal. |
| **Cash drawer** | No support at all. | ESC/POS drawer pulse, automatic on cash sales. |
| **No keyboard** | PIN and cash amounts needed a keyboard the till doesn't have. | On-screen keypad on the login and payment screens. |
| **Internet drops** | The sale failed. The customer waited. | Cash sales queue locally and file themselves on reconnect. |
| **Which till?** | Sales recorded only a cashier name. | Each sale is stamped with its terminal; drawers are counted per till. |

---

## Barcode scanner

Any USB or Bluetooth scanner in **keyboard (HID) mode** works — the default for
almost every scanner sold. Nothing to install.

A scanner is not a camera; to the machine it is a keyboard that types the code
very fast and presses Enter. The app watches for that: keystrokes under ~35ms
apart followed by Enter are treated as a scan, anything slower is a person
typing. So scanning works from anywhere on the Point of Sale screen — the
cashier never has to click into the search box first.

**Each product needs its barcode saved before it will scan.** Products →
Edit → tap the Barcode field → scan the item → Save. A barcode can only belong
to one product; the app says which one if you try to reuse it.

Items with no barcode (loose goods, curtains cut to size) are still found by
name as before.

---

## Receipt printer

Two modes, in Terminal & Printer:

**Browser** — the normal print dialog. Works on every platform and every
printer. Set the thermal printer as the system default and margins to **None**
once; the browser remembers it. Cannot open the cash drawer.

**Direct (ESC/POS)** — raw bytes straight to the printer over Web Serial or
WebUSB. No dialog, prints instantly, and it can kick the cash drawer. Chrome or
Edge only. Tap **Pair printer** once per machine and pick the device.

If Direct fails mid-shift (cable pulled, printer off), the app falls back to the
browser dialog rather than losing the receipt.

**Set the paper width correctly.** 58mm is the small roll, 80mm the standard
counter printer. This decides how many characters fit on a line — get it wrong
and every line wraps into mush.

Use **Test print** to check alignment before a shift.

---

## Cash drawer

The drawer is wired to the printer's RJ11 port and opens when the printer
receives an ESC/POS pulse. That means **the drawer needs Direct print mode** —
there is no way to send a pulse through the browser's print dialog.

With "Open on cash sales" on, the drawer opens automatically for cash and
split-cash sales. There is also a manual **Drawer** button on the receipt screen
for a no-sale open.

### Counting the drawer

Open the drawer for a shift with its float, and close it at the end with the
counted cash. The app works out what should be there — opening float plus every
cash and split-cash sale rung on **this till** since it opened — and reports the
difference as over or short.

---

## Working offline

The till sells with no internet at all — including from a cold boot with the
line already down.

Three things make that work, and all three had to be added:

**The catalogue is kept on the machine.** Every successful load writes a
snapshot of products, bundles and promos (about 116 KB) to that till. If the
next start cannot reach the server, the till trades from the snapshot and shows
a red bar saying how old it is. Cost prices are deliberately left out of the
snapshot, so a machine that may not see margins still does not store them. A
snapshot older than a fortnight is discarded rather than trusted — prices move.

**Staff can still sign in.** Checking a PIN normally needs the server, so an
outage used to leave a login screen nobody could pass. Anyone who has signed in
on that till before can now sign in without the line. The PIN itself is never
stored; what is kept is a hash over a random per-machine salt, which is enough
to check a PIN typed at that till and useless anywhere else.

**Sales queue and file themselves.** As below.

What is deliberately NOT available offline: reports, order history, customers
and refunds. None are needed to serve someone at the counter, and all of them
mislead when stale.

### Sales made while the line is down

Cash sales don't need the internet at the moment of the sale, only the record
does. When the connection drops:

- the sale completes and the customer is served
- a provisional receipt prints, numbered `OFFLINE-…`
- the record is held on that machine
- it files itself the moment the connection returns, and gets its real receipt
  number then

An amber badge shows how many sales are waiting; tapping it opens Terminal &
Printer, where **Send now** forces a retry.

Two warnings:

- **Do not clear the browser's data while sales are waiting.** They are stored
  on that machine and nowhere else. The badge tells you when it is safe.
- **MoMo sales are never queued** — the payment itself needs the network, so
  there is nothing to defer.

Replays are safe. Every queued sale carries a reference generated once, and the
server refuses to insert the same reference twice, so a half-finished replay or
two tabs flushing at once cannot ring the same basket up again.

The app itself also opens with no connection — the shell is cached. Live data
(stock, prices) is never served from cache; a till showing yesterday's stock
levels with no way to tell would be worse than showing nothing.

---

## Naming the tills

Give each machine a name in Terminal & Printer (e.g. "Front Counter"). It is
stamped on every sale, which is what makes per-till drawer counts and reports
meaningful — staff move between tills, so the cashier name doesn't answer
"which drawer does this cash belong to".

---

## Setting up a new terminal

1. Open the app in Chrome or Edge and install it (address bar → Install).
2. Sign in. The app goes fullscreen automatically.
3. Terminal & Printer → set the till name and paper width.
4. Choose Browser or Direct; if Direct, tap **Pair printer**.
5. **Test print**, and **Test drawer pulse** if a drawer is fitted.
6. Scan any product to confirm the scanner is in keyboard mode.

### Screen

Designed down to 1024×768, the common 15" till resolution. Keys and tap targets
are sized for a fingertip on a resistive screen, not a mouse.

### Auto-logout

The till locks after **1 hour** of inactivity, and the cashier's cart is kept
and restored when they sign back in — a different cashier signing in gets their
own cart. Change it in **Terminal & Printer → Locking** (1 min / 15 min / 1 hour
/ 4 hours); it is per machine, so a counter and a back-office PC can differ.

---

## Installing it as a desktop app

The app installs as a real desktop application on the till — its own window, its
own icon in the Start menu or Dock, no address bar, and it keeps working when
the internet drops. No separate download, no installer to maintain.

### Windows / Linux (Chrome or Edge)

1. Open **https://www.everytinroom.store**
2. Click the **install icon** in the address bar (a screen with a down arrow),
   or menu → *Cast, save and share* → **Install page as app**
3. It appears in the Start menu as **EVERYTINROOM**

### macOS

Chrome or Edge → menu → *Cast, save and share* → **Install page as app**. Safari
users: *File → Add to Dock*.

### What installing gets you

- **Its own window** with no browser chrome, so nothing to click away from
- **Right-click the taskbar icon** for New sale, Orders, and Terminal & printer
- **One window only.** Clicking the icon again focuses the till that is already
  open rather than starting a second one — two windows would mean two carts.
- **Opens offline.** The app shell is cached, so a till that reboots with no
  internet still starts and can sell; the queue files those sales later.

### Making the till start itself

A shop till should come up ready without anyone opening anything.

**Windows** — press `Win+R`, type `shell:startup`, and drop a shortcut in that
folder pointing at:

```
"C:\Program Files\Google\Chrome\Application\chrome.exe" --app=https://www.everytinroom.store --start-fullscreen
```

`--app` removes all browser furniture; `--start-fullscreen` fills the screen. Set
the machine to log in automatically and the till is ready from a cold boot.

**A note on the printer:** Direct (ESC/POS) mode asks permission for the
serial/USB device once per machine. Pair it from Terminal & printer after
installing, and the browser remembers it.

### Do you need a packaged .exe instead?

Probably not. A wrapped build (Tauri or Electron) would add automatic updates,
printer access with no permission prompt, and independence from an installed
browser. It also brings per-platform builds, code signing — without it Windows
shows a scary publisher warning — and a release process to maintain.

The installed web app already gives you the window, the icon, the offline start
and the printer. Worth revisiting only if the permission prompt or the lack of
auto-update becomes a daily annoyance.

---

## The Windows installer

The installed web app puts the till in its own window but the application still
lives in a browser profile — clear the browser's data and the till has nothing
to open until it can reach the internet again. The Windows build puts the
application on the machine.

### Getting it

Every tagged release builds an installer on a Windows machine and attaches it
to the GitHub release. Download the `.exe`, run it, and the till appears in the
Start menu and on the desktop.

To produce one without tagging: Actions → **Windows desktop build** → *Run
workflow*. The installer is attached to the run as an artifact.

Windows will warn that the publisher is unknown, because the installer is not
code-signed. *More info → Run anyway*. Signing needs a certificate (roughly
$200–400 a year) and is worth it only if staff are installing it themselves.

### What it adds over the browser install

- **The application is on the machine.** It opens and sells with no internet,
  from a cold boot, even on a PC that has never been online.
- **No permission prompt for the printer.** Serial and USB are granted to the
  shop's own till, so Direct (ESC/POS) mode and the cash drawer work without a
  click each session.
- **No browser needed**, and nothing for staff to close by accident — there is
  no address bar and no tabs.
- **One window, enforced.** A second launch focuses the running till.

### Building it yourself

```
npm ci && npm run build          # the web app
cd desktop && npm install
npm run build:win                # installer lands in desktop/release
```

The desktop shell serves the same `dist/` the browser gets, over a local
address, so there is one build and one code path — the till runs exactly what
the website runs.

If it exits immediately complaining about `ELECTRON_RUN_AS_NODE`, that variable
is set in your shell and makes Electron behave as plain Node. Unset it.
