import { describe, it, expect } from 'vitest'
import { maskWith, MASK } from './useHiddenFigures'
import { money, moneyShort } from '../lib/utils'

// A till faces into the shop. The privacy screen blanks the money so whoever
// is standing at the counter cannot read the day's takings over the cashier's
// shoulder — it hides figures, it does not restrict access.
describe('maskWith', () => {
  it('shows the real figure when the screen is off', () => {
    expect(maskWith(false, money)(12.5)).toBe('GHS 12.50')
    expect(maskWith(false, moneyShort)(15500)).toBe('15.5k')
  })

  it('blanks every figure when the screen is on', () => {
    expect(maskWith(true, money)(12.5)).toBe(MASK)
    expect(maskWith(true, moneyShort)(15500)).toBe(MASK)
  })

  // Zero is the giveaway: "GHS 0.00" on a dashboard tells a bystander the shop
  // has taken nothing today, which is exactly the sort of thing the screen is
  // for. It must blank like any other number.
  it('blanks zero rather than treating it as nothing to hide', () => {
    expect(maskWith(true, money)(0)).toBe(MASK)
    expect(maskWith(false, money)(0)).toBe('GHS 0.00')
  })

  it('blanks a negative figure too', () => {
    expect(maskWith(true, money)(-40)).toBe(MASK)
  })

  it('never calls the formatter while hidden', () => {
    let called = false
    maskWith(true, () => { called = true; return 'x' })(1)
    expect(called).toBe(false)
  })

  it('is the same width whatever the figure, so the layout does not jump', () => {
    const a = maskWith(true, money)(7)
    const b = maskWith(true, money)(1234567)
    expect(a).toBe(b)
  })
})
