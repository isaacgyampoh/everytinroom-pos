// ============================================================================
// IS THE PUBLISHED RELEASE NEWER THAN THE ONE THIS TILL IS RUNNING?
//
// The desktop till serves its bundle from disk, inside the installer. That is
// what lets it open and trade with no line at all — and it also means a web
// deploy never reaches it. The only way a packaged till gets a fix is somebody
// running a newer installer, and nothing told them one existed.
//
// Comparing version strings looks trivial and is the usual place this breaks:
// '2.10.0' sorts BEFORE '2.9.0' as text, so a shop on 2.9.0 would be told it
// was up to date for the whole 2.10 series. Compare the numbers, segment by
// segment.
// ============================================================================

// '2.10.0' -> [2, 10, 0]. Anything unparseable in a segment becomes 0 rather
// than NaN, so a hand-typed version like '2.1' or 'v2.1.0-beta' still orders
// sensibly instead of poisoning every comparison.
export function parseVersion(v) {
  return String(v ?? '')
    .trim()
    .replace(/^v/i, '')
    .split('-')[0]              // drop a pre-release suffix
    .split('.')
    .slice(0, 3)
    .map((n) => {
      const d = parseInt(n, 10)
      return Number.isFinite(d) && d >= 0 ? d : 0
    })
}

export function compareVersions(a, b) {
  const x = parseVersion(a)
  const y = parseVersion(b)
  for (let i = 0; i < 3; i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0)
    if (d !== 0) return d < 0 ? -1 : 1
  }
  return 0
}

// Deliberately strict: only a genuinely HIGHER version counts. A till must not
// be nagged to reinstall the build it is already running, and it must not be
// pushed backwards onto an older one if somebody republishes by mistake.
//
// A missing or unreadable version on either side means "do not prompt". Being
// quiet is the safe failure here — the cost of a missed prompt is a late
// update, the cost of a false one is a shop reinstalling its till for nothing.
export function isNewerVersion(published, running) {
  if (!published || !running) return false
  if (!/\d/.test(String(published)) || !/\d/.test(String(running))) return false
  return compareVersions(published, running) > 0
}
