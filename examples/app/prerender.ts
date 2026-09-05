// Build-time rendering. Run after `bun run build`.
//
// Every page is attempted; the ones that reach for request data at render
// time say so by doing it and are left to render on demand.
import { rm } from 'node:fs/promises'
import { prerender } from '@rsc-kit/core/prerender'
import { writeTo } from '@rsc-kit/core/files'
import * as engine from './build/dist/rsc/index.js'

const mark: Record<string, string> = { frozen: '○', shell: '◔', error: '✗' }

// #region prerender
// Cleared first. A route that changes classification — PPR one build, dynamic
// the next — leaves its old shell on disk otherwise, and the host goes on
// serving that shell in preference to rendering the page. Nothing warns: the
// page loads, with content from the previous build.
await rm('./build/static', { recursive: true, force: true })

const results = await prerender({
  engine,
  write: writeTo('./build/static'),
  onResult: (r) => {
    console.log(`  ${mark[r.type]}  ${r.url}${r.reason ? `  (${r.reason})` : ''}`)

    if (r.warning) console.log(`     ⚠  ${r.warning}`)
  },
})
// #endregion

const count = (type: string) => results.filter((r) => r.type === type).length

console.log(`
  ○  the whole page is stored
  ◔  the static parts are stored; the rest renders per request
`)
console.log(`${count('frozen')} stored, ${count('shell')} shells`)
