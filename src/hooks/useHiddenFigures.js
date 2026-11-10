import { useCallback, useEffect, useState } from 'react'
import { getSettings, saveSettings } from '../lib/hardware'

// ============================================================================
// BLANKING THE MONEY
//
// The till sits on a counter facing the shop. Anyone standing at it can read
// the day's takings, the month's margin and the value of the stock in the
// building — none of which is theirs to see. This blanks every figure on the
// dashboard behind •••• until somebody chooses to show them.
//
// It is a privacy screen, not a permission: what a cashier may actually reach
// is decided by canOpenPage() and, for anything that matters, by the database.
// Hiding a number nobody should be able to read is a different job from
// stopping them reading it.
// ============================================================================

export const MASK = '••••'

// The whole rule, as a pure function so it can be tested without a DOM: wrap a
// formatter so it blanks itself while the privacy screen is on.
export const maskWith = (hidden, fmt) => (v) => (hidden ? MASK : fmt(v))

export function useHiddenFigures() {
  const [hidden, setHidden] = useState(() => !!getSettings().hideFigures)

  // Settings are written from Terminal & printer too, so pick up a change made
  // there without needing a reload.
  useEffect(() => {
    const sync = () => setHidden(!!getSettings().hideFigures)
    window.addEventListener('pos-settings-changed', sync)
    window.addEventListener('focus', sync)
    return () => {
      window.removeEventListener('pos-settings-changed', sync)
      window.removeEventListener('focus', sync)
    }
  }, [])

  const toggle = useCallback(() => {
    const next = !getSettings().hideFigures
    saveSettings({ hideFigures: next })
    setHidden(next)
  }, [])

  // Wraps any formatter: hide(money)(12.5) -> 'GHS 12.50' or '••••'.
  const hide = useCallback((fmt) => maskWith(hidden, fmt), [hidden])

  return { hidden, toggle, hide }
}
