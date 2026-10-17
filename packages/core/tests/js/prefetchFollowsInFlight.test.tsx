/**
 * A click that takes a prefetch still arriving shows the page as soon as an
 * ordinary click would, not when the last byte is in.
 *
 * A prefetch kept its answer as one string, so a navigation that took the entry
 * awaited all of it. A touch prefetches with no delay and the click lands
 * 100-300 ms later, and an entry older than its TTL is asked for again at the
 * touch - so a tap on a slow tab took a request a few milliseconds old, and
 * the old page stayed up, with the url unchanged, until the slowest thing on
 * the new one had finished. The shell was in the browser 40 ms after the tap.
 * Without the prefetch the same tap showed the tab's skeleton at once.
 */

import { registerDom } from './dom'

registerDom()

import { beforeEach, describe, expect, test } from 'bun:test'
import {
  cancelPrefetch,
  navigate,
  prefetch,
  setApiRoutes,
  setCallServer,
  setDeserializer,
  setHeldLayouts,
  setInterceptManifest,
  setNavigateHandler,
  setRestoreHandler,
} from '../../src/js/navigate'

const encoder = new TextEncoder()

interface Page {
  write(text: string): void
  end(): void
  fail(error: unknown): void
}

let sent: string[] = []
let pages: Record<string, Page> = {}
let shown: { tree: unknown; depth: number }[] = []
let signals: Record<string, AbortSignal | undefined> = {}

/** Every url answers a payload that stays open until the test ends it. */
function installServer() {
  ;(globalThis as { fetch: unknown }).fetch = (input: unknown, init?: { signal?: AbortSignal }) => {
    const url = new URL(String(input), 'https://example.test').pathname
    sent.push(url)
    signals[url] = init?.signal

    let controller!: ReadableStreamDefaultController<Uint8Array>
    const body = new ReadableStream<Uint8Array>({ start: (c) => void (controller = c) })

    pages[url] = {
      write: (text) => controller.enqueue(encoder.encode(text)),
      end: () => controller.close(),
      fail: (error) => controller.error(error),
    }

    return Promise.resolve(
      new Response(body, {
        headers: { 'Content-Type': 'text/x-component', 'X-RSC-Segment-Depth': '1', 'X-RSC-Layouts': '' },
      }),
    )
  }
}

/**
 * Flight's root: the decode settles once the first row is in and leaves the
 * rest to arrive. Anything after it is read in the background, as React does.
 */
function installDecoder() {
  setDeserializer(async (stream: ReadableStream) => {
    const reader = stream.getReader()
    const first = await reader.read()

    if (first.done) return ''

    const decoder = new TextDecoder()
    let rest = decoder.decode(first.value, { stream: true })
    const root = { get text() { return rest }, done: false }

    void (async () => {
      for (;;) {
        const next = await reader.read().catch(() => ({ done: true as const, value: undefined }))

        if (next.done) break

        rest += decoder.decode(next.value, { stream: true })
      }

      root.done = true
    })()

    return root
  })
}

const tick = (ms = 10) => new Promise((r) => setTimeout(r, ms))

beforeEach(() => {
  sent = []
  pages = {}
  shown = []
  signals = {}
  history.replaceState({}, '', '/start')
  installDecoder()
  setCallServer(async () => null)
  setNavigateHandler((tree, _key, depth) => void shown.push({ tree, depth }))
  setRestoreHandler(() => false)
  setInterceptManifest([])
  setHeldLayouts([])
  setApiRoutes([])
  installServer()
})

describe('a click that takes a prefetch still arriving', () => {
  test('shows the page from its first row, not from its last byte', async () => {
    prefetch('/tab')
    await tick()
    pages['/tab'].write('shell')

    const going = navigate('/tab' as never)
    await tick()

    // The data behind the shell is still being fetched by the server.
    expect(shown).toHaveLength(1)
    expect((shown[0].tree as { text: string }).text).toBe('shell')
    expect(location.pathname).toBe('/tab')

    pages['/tab'].write(' and the data')
    pages['/tab'].end()
    await going
    await tick()

    expect((shown[0].tree as { text: string; done: boolean })).toMatchObject({ text: 'shell and the data', done: true })
  })

  test('asks the server once: the click is the prefetch, followed', async () => {
    prefetch('/tab')
    await tick()
    pages['/tab'].write('shell')

    void navigate('/tab' as never)
    await tick()

    expect(sent).toEqual(['/tab'])
  })

  test('hands over every byte, in order, whichever side of the click it arrived', async () => {
    prefetch('/tab')
    await tick()
    pages['/tab'].write('one ')
    pages['/tab'].write('two ')

    void navigate('/tab' as never)
    await tick()
    pages['/tab'].write('three ')
    await tick()
    pages['/tab'].write('four')
    pages['/tab'].end()
    await tick()

    expect((shown[0].tree as { text: string; done: boolean })).toMatchObject({ text: 'one two three four', done: true })
  })

  test('a pointer leaving the link after the click does not cut the page short', async () => {
    prefetch('/tab')
    await tick()
    pages['/tab'].write('shell')

    void navigate('/tab' as never)
    await tick()

    // The click was the pointer's last act on the link, and leaving it is the next.
    cancelPrefetch('/tab')
    pages['/tab'].write(' and the data')
    pages['/tab'].end()
    await tick()

    expect(sent).toEqual(['/tab'])
    expect((shown[0].tree as { text: string; done: boolean })).toMatchObject({ text: 'shell and the data', done: true })
  })

  test('is stopped, like a request of its own, when another navigation overtakes it before it showed', async () => {
    prefetch('/tab')
    await tick()

    // The server has answered and said nothing yet: the click is waiting for a first row.
    void navigate('/tab' as never)
    await tick()

    expect(shown).toHaveLength(0)
    expect(signals['/tab']?.aborted).toBe(false)

    void navigate('/elsewhere' as never)
    await tick()

    expect(signals['/tab']?.aborted).toBe(true)
  })

  test('is asked for again when the prefetch fails before it said anything', async () => {
    prefetch('/tab')
    await tick()
    pages['/tab'].fail(new Error('connection reset'))

    const going = navigate('/tab' as never)
    await tick()
    pages['/tab'].write('shell')
    pages['/tab'].end()
    await going

    expect(sent).toEqual(['/tab', '/tab'])
    expect(shown).toHaveLength(1)
    expect((shown[0].tree as { text: string }).text).toBe('shell')
  })
})

describe('a click that takes a prefetch that has arrived', () => {
  test('uses it whole, and asks for nothing', async () => {
    prefetch('/tab')
    await tick()
    pages['/tab'].write('shell and the data')
    pages['/tab'].end()
    await tick()

    await navigate('/tab' as never)

    expect(sent).toEqual(['/tab'])
    expect(shown).toHaveLength(1)
    expect((shown[0].tree as { text: string }).text).toBe('shell and the data')
  })
})
