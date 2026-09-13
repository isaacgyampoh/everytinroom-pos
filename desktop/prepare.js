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
fs.rmSync(DEST, { recursive: true, force: true })
fs.cpSync(SRC, DEST, { recursive: true })

const count = (dir) => fs.readdirSync(dir, { withFileTypes: true })
  .reduce((n, e) => n + (e.isDirectory() ? count(path.join(dir, e.name)) : 1), 0)
console.log(`bundled ${count(DEST)} files into desktop/app`)
