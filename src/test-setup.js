// Browser globals the modules under test reach for, without pulling in jsdom.
import { beforeEach, vi } from 'vitest'

function makeStorage() {
  let data = {}
  return {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v) },
    removeItem: (k) => { delete data[k] },
    clear: () => { data = {} },
    get length() { return Object.keys(data).length },
    key: (i) => Object.keys(data)[i] ?? null,
  }
}

globalThis.localStorage = makeStorage()
globalThis.sessionStorage = makeStorage()

// The queue checks navigator.onLine before trying to send. Node has a
// `navigator`, but no onLine, and it is read-only — so define our own.
Object.defineProperty(globalThis, 'navigator', {
  value: { onLine: true },
  writable: true,
  configurable: true,
})

// Every test starts with an empty till: no queued sales, nothing cached, online.
beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  navigator.onLine = true
  vi.useRealTimers()
})
