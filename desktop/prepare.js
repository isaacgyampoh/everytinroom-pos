// Copy the built web app into the Electron bundle. Keeping one source of truth
// means the desktop till runs exactly the code the browser till runs — there is
// no second build to drift.
const fs = require('fs')
const path = require('path')

const SRC = path.join(__dirname, '..', 'dist')
const DEST = path.join(__dirname, 'app')

if (!fs.existsSync(SRC)) {
  console.error('No ../dist — run `npm run build` in the project root first.')
  process.exit(1)
}

// `npm run prepare-app` builds the web app first, so this only catches someone
// running prepare.js on its own. Shipping an installer built from a stale dist
// is silent and only shows up as "the fix isn't in the Windows app".
const newest = (dir) => fs.readdirSync(dir, { withFileTypes: true }).reduce((t, e) => {
  const p = path.join(dir, e.name)
  return Math.max(t, e.isDirectory() ? newest(p) : fs.statSync(p).mtimeMs)
}, 0)
const SRC_DIR = path.join(__dirname, '..', 'src')
if (fs.existsSync(SRC_DIR) && newest(SRC_DIR) > newest(SRC)) {
  console.error('../dist is older than ../src — it would ship stale code.')
  console.error('Run `npm run build` in the project root, or use `npm run prepare-app`.')
  process.exit(1)
}
fs.rmSync(DEST, { recursive: true, force: true })
fs.cpSync(SRC, DEST, { recursive: true })

const count = (dir) => fs.readdirSync(dir, { withFileTypes: true })
  .reduce((n, e) => n + (e.isDirectory() ? count(path.join(dir, e.name)) : 1), 0)
console.log(`bundled ${count(DEST)} files into desktop/app`)
