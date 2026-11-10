import { Component } from 'react'

// ============================================================================
// THE TILL MUST NOT GO WHITE
//
// React unmounts the whole tree when a render throws. With no boundary
// anywhere in the app that meant one bad row of data — a null in a field a
// page indexes into, a product with no category — replaced the entire till
// with a blank window. Nothing on screen, nothing to click, and a cashier at
// the counter whose only option is to guess that closing and reopening might
// help.
//
// Two failures end up here and they need different answers:
//
//   1. A MISSING CHUNK. Pages are loaded on demand with hashed filenames. When
//      a deploy lands, a till that has been open for hours still holds the old
//      filenames, so the next page it opens 404s. Nothing is wrong with the
//      data — the app just needs to reload to pick up the new build, which it
//      does here, once, by itself.
//
//   2. A GENUINE CRASH. Reloading would most likely crash again on the same
//      row, so it offers a way back to the till instead and shows the error
//      text, because somebody has to be able to report it over the phone.
//
// Either way the basket is safe: it is written to localStorage on every change
// and restored on sign-in (see useStore), so a reload no longer costs a sale.
// ============================================================================

// Vite's dynamic import failures across browsers. Chrome, Firefox and Safari
// all word this differently and none of them use a stable error code.
//
// Deliberately NOT matching a bare "Failed to fetch": that is the message for
// any dropped request, and a component that threw one during render would be
// mistaken for a stale deploy and reloaded with "Updating the till" — which it
// is not. The module-specific wording is what tells the two apart.
const CHUNK_RE = /dynamically imported module|importing a module script failed|chunkloaderror|loading chunk \d+ failed/i

// Exported so the classification is tested: it decides whether a till
// reloads itself, and getting it wrong either strands a stale build or
// reboots a working till in front of a customer.
export const isChunkError = (err) =>
  CHUNK_RE.test(String(err?.name || '') + ' ' + String(err?.message || ''))

// One automatic reload per browser tab. A deploy that is genuinely broken
// would otherwise reload for ever, which looks identical to a dead till.
const RELOADED_KEY = 'pos-chunk-reloaded'

export default class ErrorBoundary extends Component {
  state = { error: null, stale: false }

  static getDerivedStateFromError(error) {
    return { error, stale: isChunkError(error) }
  }

  componentDidCatch(error, info) {
    console.error('Caught by ErrorBoundary:', error, info?.componentStack)
    if (!isChunkError(error)) return
    let already = true
    try { already = sessionStorage.getItem(RELOADED_KEY) === '1' } catch {}
    if (already) return
    try { sessionStorage.setItem(RELOADED_KEY, '1') } catch {}
    // Let the render finish before pulling the page out from under it.
    setTimeout(() => window.location.reload(), 300)
  }

  reset = () => {
    this.setState({ error: null, stale: false })
    this.props.onReset?.()
  }

  render() {
    const { error, stale } = this.state
    if (!error) return this.props.children

    return (
      <div className="min-h-[70vh] flex items-center justify-center p-6">
        <div className="w-full max-w-md bg-white dark:bg-stone-900 rounded-2xl shadow-lg border border-stone-200 dark:border-stone-700 overflow-hidden">
          <div className="p-6 space-y-2">
            <h2 className="text-lg font-bold text-stone-900 dark:text-stone-100">
              {stale ? 'Updating the till' : 'This screen stopped working'}
            </h2>
            <p className="text-[13px] text-stone-500 dark:text-stone-400 leading-relaxed">
              {stale
                ? 'A new version has been released. Reloading to pick it up — your basket is kept.'
                : 'The rest of the till is still working, and nothing in your basket has been lost. Go back and carry on selling; if this screen keeps failing, read the message below to whoever supports the shop.'}
            </p>
          </div>

          {!stale && (
            <>
              <div className="px-6 pb-5">
                <details className="text-[11px]">
                  <summary className="cursor-pointer font-semibold text-stone-400 select-none">
                    Show the error
                  </summary>
                  <pre className="mt-2 p-3 bg-stone-50 dark:bg-stone-800 rounded-lg text-[10px] leading-relaxed text-stone-600 dark:text-stone-300 whitespace-pre-wrap break-words max-h-40 overflow-auto">
                    {String(error?.message || error)}
                  </pre>
                </details>
              </div>
              <div className="p-5 border-t border-stone-100 dark:border-stone-700 flex gap-3">
                <button onClick={this.reset}
                  className="flex-1 h-12 bg-gray-900 text-white rounded-xl text-sm font-bold active:scale-[.97] transition">
                  Back to the till
                </button>
                <button onClick={() => window.location.reload()}
                  className="h-12 px-4 border-2 border-stone-200 dark:border-stone-600 text-stone-600 dark:text-stone-300 rounded-xl text-sm font-bold active:scale-[.97] transition">
                  Reload
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    )
  }
}
