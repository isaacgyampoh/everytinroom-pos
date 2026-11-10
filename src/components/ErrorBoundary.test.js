import { describe, it, expect } from 'vitest'
import { isChunkError } from './ErrorBoundary'

// Two failures reach the boundary and they get opposite treatment. A missing
// chunk means a deploy landed under a till that has been open for hours, and
// reloading fixes it. Anything else is a real crash, where reloading would
// most likely crash again on the same row — and telling the cashier the till
// is "updating" would be a lie.
describe('isChunkError', () => {
  it('recognises a chunk that went missing after a deploy', () => {
    const real = [
      // Chrome / Edge
      'Failed to fetch dynamically imported module: https://x/assets/Dashboard-abc123.js',
      // Firefox
      'error loading dynamically imported module: https://x/assets/POS-def456.js',
      // Safari
      'Importing a module script failed.',
    ]
    for (const message of real) expect(isChunkError({ message }), message).toBe(true)
  })

  it('recognises a bundler chunk error by name', () => {
    expect(isChunkError({ name: 'ChunkLoadError', message: 'Loading chunk 7 failed.' })).toBe(true)
  })

  it('does not mistake an ordinary crash for a stale deploy', () => {
    const crashes = [
      "Cannot read properties of null (reading 'category')",
      'x.map is not a function',
      'Maximum update depth exceeded',
    ]
    for (const message of crashes) expect(isChunkError({ message }), message).toBe(false)
  })

  // The trap worth keeping a test on: "Failed to fetch" is the message for ANY
  // dropped request, and a shop connection drops constantly. Matching it would
  // reboot a working till and claim it was updating.
  it('does not treat a plain dropped request as a stale deploy', () => {
    for (const message of ['Failed to fetch',
                           'NetworkError when attempting to fetch resource.',
                           'Load failed']) {
      expect(isChunkError({ message }), message).toBe(false)
    }
  })

  it('is false for an error with nothing on it', () => {
    expect(isChunkError({})).toBe(false)
    expect(isChunkError(null)).toBe(false)
    expect(isChunkError(undefined)).toBe(false)
  })
})
