/**
 * The worker must put React's entire shell on the socket before it releases
 * deferred host calls.
 *
 * PHP runs a host callback synchronously on the same thread that pumps the
 * HTML socket, so while one is in flight nothing the worker writes reaches the
 * browser. Releasing the queue after only the first chunk left the rest of the
 * shell — every Suspense fallback in it — stranded for the length of the call:
 * a page with a 2.5s host call painted nothing for 2.5s instead of showing its
 * skeletons immediately.
 */

import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDeferredHost, drainQueuedChunks, streamWithDeferredRelease } from '../../src/streaming'

/** A reader whose chunks are already queued, then goes quiet forever. */
function queuedReader(chunks: string[], thenQuiet = true) {
  let i = 0

  return {
    read(): Promise<{ done: boolean; value?: string }> {
      if (i < chunks.length) return Promise.resolve({ done: false, value: chunks[i++] })
      if (thenQuiet) return new Promise(() => {})

      return Promise.resolve({ done: true })
    },
  }
}

describe('drainQueuedChunks', () => {
  test('writes every queued chunk before returning', async () => {
    const written: string[] = []
    const shell = ['<html>', '<head>', '<body>', '<!--$?-->skeleton']

    const { done } = await drainQueuedChunks(queuedReader(shell), (c) => written.push(c))

    expect(written).toEqual(shell)
    expect(done).toBe(false)
  })

  test('stops at the first read that does not settle, and hands it back', async () => {
    const written: string[] = []
    let resolveLate: ((r: { done: boolean; value?: string }) => void) | null = null
    let reads = 0

    const reader = {
      read(): Promise<{ done: boolean; value?: string }> {
        reads++
        if (reads === 1) return Promise.resolve({ done: false, value: 'shell' })

        return new Promise((resolve) => {
          resolveLate = resolve
        })
      },
    }

    const { pending, done } = await drainQueuedChunks(reader, (c) => written.push(c))

    expect(written).toEqual(['shell'])
    expect(done).toBe(false)
    expect(pending).not.toBeNull()

    // The unsettled read is carried back, not dropped: its chunk still arrives.
    resolveLate!({ done: false, value: 'boundary' })
    expect(await pending!).toEqual({ done: false, value: 'boundary' })
  })

  test('returns immediately when the producer has nothing yet', async () => {
    // A shell that itself awaits a host call cannot produce HTML until that
    // call runs, so the drain must give up at once and let the queue flush.
    const written: string[] = []

    const { pending, done } = await drainQueuedChunks(
      { read: () => new Promise<{ done: boolean; value?: string }>(() => {}) },
      (c) => written.push(c),
    )

    expect(written).toEqual([])
    expect(done).toBe(false)
    expect(pending).not.toBeNull()
  })

  test('reports a stream that ends during the drain', async () => {
    const written: string[] = []

    const { pending, done } = await drainQueuedChunks(queuedReader(['a', 'b'], false), (c) => written.push(c))

    expect(written).toEqual(['a', 'b'])
    expect(done).toBe(true)
    expect(pending).toBeNull()
  })

  test('does not stop early on a chunk that resolves in a later microtask', async () => {
    // Queued chunks settle in microtasks; the race is against a macrotask, so
    // a chunk that is merely a few microtasks deep must still be drained.
    const written: string[] = []
    let i = 0
    const chunks = ['a', 'b', 'c']

    const reader = {
      async read(): Promise<{ done: boolean; value?: string }> {
        await Promise.resolve()
        await Promise.resolve()
        if (i < chunks.length) return { done: false, value: chunks[i++] }

        return new Promise(() => {})
      },
    }

    await drainQueuedChunks(reader, (c) => written.push(c))

    expect(written).toEqual(chunks)
  })
})

describe('createDeferredHost', () => {
  /** Records calls and lets the test settle them by hand. */
  function recordingHost() {
    const calls: string[] = []

    return {
      calls,
      fn: (name: string, ...args: unknown[]): Promise<unknown> => {
        calls.push(name)

        return Promise.resolve(`${name}:${args.join(',')}`)
      },
    }
  }

  test('does not defer before begin(), so metadata is never queued', async () => {
    // generateMetadata runs before any payload exists, so a host call there has
    // nothing to strand. Queueing it only stalled metadata until the backstop.
    const host = recordingHost()
    const deferred = createDeferredHost(host.fn)

    await expect(deferred.hostFn('Meta.title')).resolves.toBe('Meta.title:')
    expect(host.calls).toEqual(['Meta.title'])
  })

  test('queues calls made during the render until flush()', async () => {
    const host = recordingHost()
    const deferred = createDeferredHost(host.fn)
    deferred.begin()

    const pending = deferred.hostFn('Stats.fetch', 7)

    // The whole point: nothing has reached PHP yet, so it cannot be blocking
    // while React still has payload to write.
    expect(host.calls).toEqual([])

    deferred.flush()

    await expect(pending).resolves.toBe('Stats.fetch:7')
    expect(host.calls).toEqual(['Stats.fetch'])
  })

  test('passes calls straight through once flushed', async () => {
    const host = recordingHost()
    const deferred = createDeferredHost(host.fn)
    deferred.begin()
    deferred.flush()

    await expect(deferred.hostFn('Todos.list')).resolves.toBe('Todos.list:')
    expect(host.calls).toEqual(['Todos.list'])
  })

  test('flush() is idempotent and never double-sends a queued call', async () => {
    const host = recordingHost()
    const deferred = createDeferredHost(host.fn)
    deferred.begin()

    const pending = deferred.hostFn('Stats.fetch')
    deferred.flush()
    deferred.flush()

    await pending
    expect(host.calls).toEqual(['Stats.fetch'])
  })

  test('preserves call order across the queue', async () => {
    const host = recordingHost()
    const deferred = createDeferredHost(host.fn)
    deferred.begin()

    const all = Promise.all([deferred.hostFn('a'), deferred.hostFn('b'), deferred.hostFn('c')])
    deferred.flush()

    await all
    expect(host.calls).toEqual(['a', 'b', 'c'])
  })

  test('rejects the caller when the real host call fails', async () => {
    const deferred = createDeferredHost(() => Promise.reject(new Error('socket closed')))
    deferred.begin()

    const pending = deferred.hostFn('Stats.fetch')
    deferred.flush()

    await expect(pending).rejects.toThrow('socket closed')
  })
})

describe('streamWithDeferredRelease', () => {
  /**
   * Let the drain finish. It races each read against a macrotask, so settling
   * takes more than one turn — wait for the release rather than guessing.
   */
  async function settle(events: string[], marker = 'RELEASE'): Promise<void> {
    for (let i = 0; i < 20 && !events.includes(marker); i++) {
      await new Promise((r) => setTimeout(r, 0))
    }
  }

  /**
   * The ordering both worker paths depend on. PHP runs a host callback on the
   * same thread that pumps the socket, so a call released too early blocks the
   * pump with payload still unwritten — which is exactly how a 2.5s rpc() left
   * the browser blank instead of painting its Suspense fallbacks.
   */
  function scriptedReader(queued: string[]) {
    let i = 0
    let releaseLate: ((r: { done: boolean; value?: string }) => void) | null = null

    return {
      reader: {
        read(): Promise<{ done: boolean; value?: string }> {
          if (i < queued.length) return Promise.resolve({ done: false, value: queued[i++] })

          return new Promise((resolve) => {
            releaseLate = resolve
          })
        },
      },
      /** Deliver a chunk that only becomes available after the host call. */
      arriveLate(value: string | null) {
        releaseLate?.(value === null ? { done: true } : { done: false, value })
      },
    }
  }

  test('releases only after every queued chunk is written', async () => {
    const events: string[] = []
    const shell = ['<html>', '<head>', 'skeleton-1', 'skeleton-2']
    const { reader, arriveLate } = scriptedReader(shell)

    const streaming = streamWithDeferredRelease(
      reader,
      (c) => events.push(`chunk:${c}`),
      () => events.push('RELEASE'),
    )

    await settle(events)

    // Every fallback is on the socket before PHP can block on a host call.
    expect(events).toEqual([...shell.map((c) => `chunk:${c}`), 'RELEASE'])

    arriveLate(null)
    await streaming
  })

  test('writes chunks that arrive after the release', async () => {
    const events: string[] = []
    const { reader, arriveLate } = scriptedReader(['shell'])

    const streaming = streamWithDeferredRelease(
      reader,
      (c) => events.push(`chunk:${c}`),
      () => events.push('RELEASE'),
      () => Promise.resolve(),
    )

    await settle(events)
    expect(events).toEqual(['chunk:shell', 'RELEASE'])

    // A boundary resolving after the host call still reaches the browser.
    arriveLate('boundary')
    await settle(events, 'chunk:boundary')
    arriveLate(null)
    await streaming

    expect(events).toEqual(['chunk:shell', 'RELEASE', 'chunk:boundary'])
  })

  test('releases immediately when the payload itself is blocked on a host call', async () => {
    // A shell that awaits rpc() produces nothing until the call runs, so
    // holding the queue would deadlock both sides.
    const events: string[] = []
    const { reader, arriveLate } = scriptedReader([])

    const streaming = streamWithDeferredRelease(
      reader,
      (c) => events.push(`chunk:${c}`),
      () => events.push('RELEASE'),
    )

    await settle(events)
    expect(events).toEqual(['RELEASE'])

    arriveLate(null)
    await streaming
  })

  test('still releases when the stream ends inside the drain', async () => {
    const events: string[] = []
    let i = 0
    const chunks = ['only']

    await streamWithDeferredRelease(
      { read: () => Promise.resolve(i < chunks.length ? { done: false, value: chunks[i++] } : { done: true }) },
      (c) => events.push(`chunk:${c}`),
      () => events.push('RELEASE'),
    )

    expect(events).toEqual(['chunk:only', 'RELEASE'])
  })
})

/**
 * The generated entries import @vitejs/plugin-rsc subpaths, so the project must
 * have it installed even though rscRoutes() composes it and the app never names
 * it in a config. When it is absent the bundler fails on a generated file the
 * user never wrote — `Rolldown failed to resolve import
 * "@vitejs/plugin-rsc/rsc"` — so the build checks first and says what to run.
 */
describe('required package preflight', () => {
  test('reports every missing package, in install order', async () => {
    const { missingPeers, REQUIRED_PEERS } = await import('../../src/build-rsc-vite')
    const empty = mkdtempSync(join(tmpdir(), 'larabun-peers-'))

    // A bare directory: nothing installed anywhere above it.
    expect(missingPeers(empty)).toEqual([...REQUIRED_PEERS])

    rmSync(empty, { recursive: true, force: true })
  })

  test('a project with the packages installed reports nothing', async () => {
    const { missingPeers } = await import('../../src/build-rsc-vite')

    // This package has all four in its own node_modules.
    expect(missingPeers(join(import.meta.dir, '../..'))).toEqual([])
  })

  test('finds packages hoisted to a parent directory', async () => {
    const { isInstalled } = await import('../../src/build-rsc-vite')
    const nested = join(import.meta.dir, '../../tests/fixtures')

    // Resolution walks up, the way a bundler does.
    expect(isInstalled(nested, 'vite')).toBe(true)
    expect(isInstalled(nested, 'definitely-not-a-real-package')).toBe(false)
  })
})
