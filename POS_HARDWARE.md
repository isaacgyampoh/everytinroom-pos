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

The till locks after 1 minute of inactivity, and the cashier's cart is kept and
restored when they sign back in — a different cashier signing in gets their own
cart. Change the timeout in `src/App.jsx` (`INACTIVITY_TIMEOUT`) if that is too
aggressive for your counter.
