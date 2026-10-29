/**
 * A built server's process has the NODE_ENV the build baked in.
 *
 * The build replaced the expression `process.env.NODE_ENV` and set nothing in
 * the process, so a typed env built from a spread of process.env fell to its
 * `.default('development')` in production, and a Stripe webhook that skipped
 * live events outside production skipped every one for five weeks.
 */

import { describe, expect, test } from 'bun:test'
import { nodeEnvPlugin } from '../../src/vite'
import { commandsEntrySource, compileEntryWithCommands } from '../../src/commandFiles'

function run(source: string, env: Record<string, string> | undefined) {
  new Function('process', source.replace('export default () => {};', ''))(env === undefined ? undefined : { env })

  return env
}

describe('the server', () => {
  test('a process started with nothing set is the mode it was built in', () => {
    expect(run(nodeEnvPlugin('production'), {})?.NODE_ENV).toBe('production')
    expect(run(nodeEnvPlugin('development'), {})?.NODE_ENV).toBe('development')
  })

  test('a value someone set is kept', () => {
    expect(run(nodeEnvPlugin('production'), { NODE_ENV: 'staging' })?.NODE_ENV).toBe('staging')
  })

  test('a Worker with no process starts', () => {
    expect(() => run(nodeEnvPlugin('production'), undefined)).not.toThrow()
  })

  // Nitro replaces the expression in what it bundles, and an assignment to
  // the string it becomes does not parse.
  test('it never writes the expression Nitro replaces', () => {
    expect(nodeEnvPlugin('production')).not.toContain('process.env.NODE_ENV')
  })
})

describe('a command', () => {
  const options = { commands: [{ name: 'migrate', file: '/app/src/commands/migrate.ts' }], polyfills: [], nodeEnv: 'production' as const }

  test('sets it before the app is imported', () => {
    for (const source of [commandsEntrySource(options), compileEntryWithCommands('rsc-static', options)]) {
      const set = source.indexOf('process.env["NODE_ENV"] = "production"')

      expect(set).toBeGreaterThan(-1)
      expect(set).toBeLessThan(source.indexOf('import("./_ssr/rsc.mjs")'))
    }
  })
})
