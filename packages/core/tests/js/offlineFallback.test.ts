// What the build says when /offline cannot be the fallback. The reason comes
// from the prerender table, where it was written to follow a route's mark;
// here it follows "because", and the two grammars are not the same.

import { describe, expect, test, spyOn, afterEach } from 'bun:test'
import { offlineFallback } from '../../src/vite'

const said: string[] = []
const spy = spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
  said.push(args.slice(1).join(' '))
})

afterEach(() => {
  said.length = 0
})

const result = (type: string, reason: string | null) =>
  ({ url: '/offline', type, reason }) as never

describe('why /offline cannot be the fallback', () => {
  test('a dynamic page: "because it called cookies()"', () => {
    expect(offlineFallback([], [result('dynamic', 'dynamic — called cookies()')])).toBeNull()
    expect(said[0]).toBe(
      'offline: /offline cannot be the fallback, because it called cookies(). A fallback has to be servable with no network at all.',
    )
  })

  test('a shell: the reason is a sentence already, and takes no "it"', () => {
    offlineFallback([], [
      result('shell', 'connection() awaited by AuthLinks, AuthDialogSlot streams per request; the rest is stored'),
    ])

    expect(said[0]).toBe(
      'offline: /offline cannot be the fallback, because connection() awaited by AuthLinks, AuthDialogSlot streams per request. A fallback has to be servable with no network at all.',
    )
    expect(said[0]).not.toContain('because it connection()')
  })

  test('a frozen /offline is the fallback, silently', () => {
    expect(offlineFallback(['/offline'], [result('frozen', null)])).toBe('/offline')
    expect(said).toHaveLength(0)
  })

  test('no /offline route means no fallback and nothing said', () => {
    expect(offlineFallback([], [])).toBeNull()
    expect(said).toHaveLength(0)
  })
})

