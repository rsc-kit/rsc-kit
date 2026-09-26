/**
 * A built server stopped by a rollout. srvx drains in-flight requests on
 * SIGTERM but never exits, and an app holding a pool open waited for its
 * SIGKILL. The shutdown plugin waits out the drain, calls the app's
 * shutdown(), and exits.
 */

import { describe, expect, test } from 'bun:test'
import { SHUTDOWN_PLUGIN } from '../../src/vite'

function plugin(env: Record<string, string> = {}) {
  const listeners: Record<string, () => void> = {}
  const events: string[] = []
  let exited: number | null = null
  const fakeProcess = {
    env,
    once: (signal: string, fn: () => void) => void (listeners[signal] = fn),
    exit: (code: number) => {
      exited = code
      events.push('exit ' + code)
    },
  }
  const run = new Function('process', 'globalThis', 'console', SHUTDOWN_PLUGIN.replace('export default function', 'return function'))(
    fakeProcess,
    globalThis,
    { error: (...args: unknown[]) => events.push('error ' + String(args[1])) },
  ) as () => void

  run()

  return { listeners, events, exited: () => exited }
}

describe('stopping a built server', () => {
  test('waits out the drain, calls shutdown(), and exits 0', async () => {
    const { listeners, events } = plugin({ SERVER_SHUTDOWN_TIMEOUT: '0.05' })
    ;(globalThis as { __rscKitShutdown?: () => unknown }).__rscKitShutdown = async () => void events.push('shutdown')

    expect(Object.keys(listeners).sort()).toEqual(['SIGINT', 'SIGTERM'])

    listeners.SIGTERM!()
    listeners.SIGINT!() // a second signal does not start a second stop
    expect(events).toEqual([]) // nothing before the drain window

    await new Promise((r) => setTimeout(r, 450))
    expect(events).toEqual(['shutdown', 'exit 0'])
  })

  test('a shutdown() that hangs cannot hold the process', async () => {
    const { listeners, events } = plugin({ SERVER_SHUTDOWN_TIMEOUT: '0.05', RSC_SHUTDOWN_TIMEOUT: '0.1' })
    ;(globalThis as { __rscKitShutdown?: () => unknown }).__rscKitShutdown = () => new Promise(() => {})

    listeners.SIGTERM!()
    await new Promise((r) => setTimeout(r, 550))
    expect(events).toEqual(['exit 0'])
  })

  test('a shutdown() that throws is reported, and the process still exits', async () => {
    const { listeners, events } = plugin({ SERVER_SHUTDOWN_TIMEOUT: '0.05' })
    ;(globalThis as { __rscKitShutdown?: () => unknown }).__rscKitShutdown = () => {
      throw new Error('pool already closed')
    }

    listeners.SIGTERM!()
    await new Promise((r) => setTimeout(r, 450))
    expect(events).toEqual(['error Error: pool already closed', 'exit 0'])
  })
})
