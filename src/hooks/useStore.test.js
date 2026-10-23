import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useStore } from './useStore'

// A basket is somebody standing at the counter with their shopping on it. It
// used to be written to disk only by logout(), so it survived a shift change
// and nothing else — a crash, a closed tab or a power cut took it with it.
const KEY = 'carts-by-cashier'
const stash = () => JSON.parse(localStorage.getItem(KEY) || '{}')
const cashier = (id) => ({ id, permissions: [] })

// The write is coalesced on a 400ms timer; this is how long a test waits.
const settle = () => vi.advanceTimersByTime(500)

beforeEach(() => {
  vi.useFakeTimers()
  useStore.setState({ user: null, isAdmin: false, token: null, cart: [] })
  vi.advanceTimersByTime(500)      // drain any write the reset itself queued
  localStorage.clear()
})

describe('the open basket is kept on disk', () => {
  it('survives a crash, with nothing having called logout', () => {
    useStore.setState({ user: cashier('a') })
    useStore.getState().addToCart({ productId: 1, name: 'rice', price: 20 })
    useStore.getState().addToCart({ productId: 2, name: 'oil', price: 15 })

    settle()

    expect(stash().a).toHaveLength(2)
    expect(stash().a.map(i => i.name)).toEqual(['rice', 'oil'])
  })

  it('coalesces a burst of changes into a single write', () => {
    useStore.setState({ user: cashier('a') })
    const spy = vi.spyOn(localStorage, 'setItem')

    for (let i = 0; i < 20; i++) {
      useStore.getState().addToCart({ productId: i, name: 'item' + i, price: 1 })
    }
    settle()

    expect(spy.mock.calls.filter(c => c[0] === KEY)).toHaveLength(1)
  })

  it('writes nothing when nobody is signed in', () => {
    useStore.setState({ user: null, cart: [{ productId: 1, name: 'rice', qty: 1 }] })
    settle()
    expect(localStorage.getItem(KEY)).toBeNull()
  })

  // logout() stashes the basket and then clears it. A write still in flight
  // would otherwise land afterwards and overwrite the stash with an empty cart,
  // losing the very basket logout was trying to save.
  it('does not let a pending write clobber what logout just stashed', () => {
    useStore.setState({ user: cashier('a') })
    useStore.getState().addToCart({ productId: 1, name: 'rice', price: 20 })
    // No settle() — the write is deliberately still pending here.
    useStore.getState().logout()
    settle()

    expect(stash().a).toHaveLength(1)
    expect(stash().a[0].name).toBe('rice')
  })

  it('gives a cashier their own basket back and nobody else theirs', () => {
    useStore.setState({ user: cashier('a') })
    useStore.getState().addToCart({ productId: 1, name: 'rice', price: 20 })
    settle()
    useStore.getState().logout()
    settle()

    // A different cashier takes the till: a fresh basket, not the last one's.
    useStore.getState().login(cashier('b'), false, null)
    expect(useStore.getState().cart).toEqual([])
    settle()
    expect(stash().a).toHaveLength(1)          // a's basket is untouched
    useStore.getState().logout()
    settle()

    // The first cashier returns.
    useStore.getState().login(cashier('a'), false, null)
    expect(useStore.getState().cart).toHaveLength(1)
    expect(useStore.getState().cart[0].name).toBe('rice')
  })

  it('clears the basket on disk when the cart is emptied', () => {
    useStore.setState({ user: cashier('a') })
    useStore.getState().addToCart({ productId: 1, name: 'rice', price: 20 })
    settle()
    expect(stash().a).toHaveLength(1)

    useStore.getState().clearCart()
    settle()

    expect(stash().a ?? []).toHaveLength(0)
  })
})
