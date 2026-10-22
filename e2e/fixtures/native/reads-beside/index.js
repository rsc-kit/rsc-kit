// Reads a file beside its own code, the way a package with data or a .wasm
// does: it has to be on disk where __dirname says, not inside the binary.
const { readFileSync } = require('node:fs')
const { join } = require('node:path')

module.exports = () => JSON.parse(readFileSync(join(__dirname, 'data', 'words.json'), 'utf8'))
