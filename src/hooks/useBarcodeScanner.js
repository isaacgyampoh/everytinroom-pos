import { useEffect, useRef } from 'react'

// ============================================================================
// BARCODE SCANNER (keyboard wedge)
//
// A USB/Bluetooth barcode scanner is not a camera — to the operating system it
// is a keyboard that types the code very fast and then presses Enter. That is
// why scanning used to do nothing useful here: the digits landed in whatever
// input happened to have focus, and nothing was watching for them.
//
// Humans type at roughly 100-300ms between keys. A scanner is under ~30ms.
// That gap is the whole detection method: buffer keystrokes, and if a run of
// them arrives fast enough and ends with Enter, it was scanned, not typed.
//
// Listening on the window in the capture phase means a scan works no matter
// where focus is — the cashier never has to click the search box first, which
// is the difference between a till that feels like a POS and one that doesn't.
// ============================================================================

const MAX_GAP_MS = 35      // slower than this between keys and it's a human
const MIN_LENGTH = 4       // shorter than this and it's not a barcode

export function useBarcodeScanner(onScan, enabled = true) {
  const buf = useRef('')
  const lastKey = useRef(0)
  const handler = useRef(onScan)
  handler.current = onScan

  useEffect(() => {
    if (!enabled) return

    const onKeyDown = (e) => {
      // Let people type in fields that expect a burst of characters anyway
      // (a note, a password), and honour an explicit opt-out.
      const el = document.activeElement
      if (el?.dataset?.noScan !== undefined) return
      if (el?.tagName === 'TEXTAREA') return

      const now = Date.now()
      const gap = now - lastKey.current
      lastKey.current = now

      if (e.key === 'Enter') {
        const code = buf.current
        buf.current = ''
        if (code.length >= MIN_LENGTH) {
          // Swallow the Enter so it doesn't also submit whatever form the
          // cashier happens to be standing in.
          e.preventDefault()
          e.stopPropagation()
          handler.current?.(code)
        }
        return
      }

      // Only single printable characters are part of a barcode.
      if (e.key.length !== 1) return

      // A slow keystroke means a human started typing — drop whatever was
      // buffered and begin again from this character.
      if (gap > MAX_GAP_MS) buf.current = e.key
      else buf.current += e.key

      // Scanners send the code in one burst; anything longer than a real
      // barcode is stray input.
      if (buf.current.length > 64) buf.current = ''
    }

    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [enabled])
}
