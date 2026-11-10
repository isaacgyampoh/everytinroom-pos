import { describe, it, expect } from 'vitest'
import { resolveDock, DOCK_AT, DOCK_FLOOR } from './useDockedCart'

// Whether the basket sits beside the grid or behind a button. Getting this
// wrong on a narrow till costs the cashier two columns of products; getting it
// wrong on a wide one costs them a tap on every sale.
describe('resolveDock', () => {
  it('docks on a wide screen by default', () => {
    expect(resolveDock('auto', true)).toBe(true)
    expect(resolveDock(undefined, true)).toBe(true)
  })

  it('leaves the slide-over alone on a narrow till by default', () => {
    expect(resolveDock('auto', false)).toBe(false)
    expect(resolveDock(undefined, false)).toBe(false)
  })

  it('lets a shop force it on, even on a narrow till', () => {
    expect(resolveDock('on', false)).toBe(true)
  })

  it('lets a shop keep the slide-over, even on a wide one', () => {
    expect(resolveDock('off', true)).toBe(false)
  })

  // Below the floor the basket is a full-width bottom sheet. Docking it there
  // would park it across the bottom of the screen for good, with the products
  // scrolling underneath — so the floor beats every setting, including "on".
  it('never docks below the floor, whatever the setting says', () => {
    expect(resolveDock('on', true, false)).toBe(false)
    expect(resolveDock('auto', true, false)).toBe(false)
    expect(resolveDock('off', true, false)).toBe(false)
  })

  it('docks above the floor when asked', () => {
    expect(resolveDock('on', false, true)).toBe(true)
  })

  it('the floor is below the dock threshold', () => {
    expect(DOCK_FLOOR).toBeLessThan(DOCK_AT)
  })

  // The desktop shell opens at 1280x800, so the threshold has to be at or
  // below that or the Windows till never gets the docked basket it was
  // measured for.
  it('threshold is no wider than the desktop shell window', () => {
    expect(DOCK_AT).toBeLessThanOrEqual(1280)
  })
})
