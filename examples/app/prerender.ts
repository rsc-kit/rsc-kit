// Build-time rendering. Run after `bun run build`.
//
// Every page is attempted; the ones that reach for request data at render
// time say so by doing it and are left to render on demand.
import { prerender } from '@rsc-router/core/prerender'
import { writeTo } from '@rsc-router/core/files'
import * as engine from './build/dist/rsc/index.js'
import { rpcFunctions } from './rpc'

// The same functions the server registers. A page that calls one of these is
// exactly the page that cannot be frozen — the probe replaces them.
engine.installHostFn(async (name: string, ...args: unknown[]) =>
  (rpcFunctions as Record<string, (...a: unknown[]) => unknown>)[name]?.(...args),
)

const mark = { static: '○', ppr: '◔', dynamic: 'λ', error: '✗' }

const results = await prerender({
  engine,
  write: writeTo('./build/static'),
  onResult: (r) => console.log(`  ${mark[r.type]}  ${r.url}${r.reason ? `  (${r.reason})` : ''}`),
})

const count = (type: string) => results.filter((r) => r.type === type).length

console.log(`
  ○  static   frozen whole
  ◔  ppr      shell frozen, the rest filled by the client
  λ  dynamic  rendered on demand
`)
console.log(`${count('static')} static, ${count('ppr')} ppr, ${count('dynamic')} dynamic`)
