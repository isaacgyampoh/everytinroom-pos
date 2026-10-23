import { useEffect, useState } from 'react'
import { getSettings } from '../lib/hardware'

// ============================================================================
// SHOULD THE BASKET BE ON SCREEN, OR BEHIND A BUTTON?
//
// The basket has always been a slide-over with a dimmed backdrop: add items,
// tap the cart, look, close, carry on. That is right on a phone and wrong on a
// counter — every till a cashier has used (Square, Shopify, Lightspeed) keeps
// the basket beside the grid, because the running total is the thing the
// customer is asking about and the cashier should never have to go and fetch
// it.
//
// Docked only where there is genuinely room. The desktop shell opens at
// 1280x800, so that is the threshold; the 1024x768 touchscreen tills keep the
// slide-over they have today rather than losing two columns of products to a
// layout change nobody asked for. Terminal & printer overrides it either way.
// ============================================================================

export const DOCK_AT = 1280

// Below this the basket is a full-width bottom sheet, not a side panel, so
// "docking" it would park it permanently across the bottom of the screen with
// the products running underneath. Nothing docks below it, whatever the
// setting says.
export const DOCK_FLOOR = 768

// The whole decision, as a pure function so it can be tested without a DOM.
// 'auto' is the default; the two explicit settings exist because a shop with a
// 1366px till may still want the basket on screen, and a shop that has trained
// its staff on the slide-over may not want it moving under them.
export function resolveDock(pref, wideEnough, aboveFloor = true) {
  if (!aboveFloor) return false
  if (pref === 'off') return false
  if (pref === 'on') return true
  return !!wideEnough
}

export function useDockedCart() {
  const [docked, setDocked] = useState(false)

  useEffect(() => {
    const mq = window.matchMedia(`(min-width: ${DOCK_AT}px)`)
    const floor = window.matchMedia(`(min-width: ${DOCK_FLOOR}px)`)

    const apply = () => setDocked(resolveDock(getSettings().dockCart, mq.matches, floor.matches))
    apply()

    mq.addEventListener('change', apply)
    floor.addEventListener('change', apply)
    // Terminal & printer writes settings from another component; re-read on
    // focus so flipping the switch takes effect without a reload.
    window.addEventListener('focus', apply)
    window.addEventListener('pos-settings-changed', apply)
    return () => {
      mq.removeEventListener('change', apply)
      floor.removeEventListener('change', apply)
      window.removeEventListener('focus', apply)
      window.removeEventListener('pos-settings-changed', apply)
    }
  }, [])

  // The main content reserves its right-hand gutter in CSS, which needs to
  // know outside of React's tree.
  useEffect(() => {
    document.body.classList.toggle('cart-docked', docked)
    return () => document.body.classList.remove('cart-docked')
  }, [docked])

  return docked
}
