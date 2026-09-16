// A function that reads the request, tested with one.
//
// cookies() and headers() read from a scope the host opens per request. In a
// test there is no host, so the test opens the scope itself with withRequest
// and hands in whatever Request it wants the function to see — a signed-in
// cookie, a locale header, nothing at all.

import { describe, expect, test } from 'bun:test'
import { cookies, headers, withRequest } from '@rsc-kit/core/request'

/** Stands in for an action or query that reads who is asking. */
async function whoIsAsking() {
  const jar = await cookies()
  const language = (await headers()).get('Accept-Language')

  return { user: jar.get('user') ?? null, language }
}

describe('a read that depends on the request', () => {
  test('sees the request the test gave it', async () => {
    const seen = await withRequest(
      new Request('https://app.test/orders', {
        headers: { Cookie: 'user=ada', 'Accept-Language': 'en-JM' },
      }),
      whoIsAsking,
    )

    expect(seen).toEqual({ user: 'ada', language: 'en-JM' })
  })

  test('and a different request gives a different answer', async () => {
    const seen = await withRequest(new Request('https://app.test/orders'), whoIsAsking)

    expect(seen).toEqual({ user: null, language: null })
  })

  test('two requests in flight do not see each other', async () => {
    // The scope is per call, not global. Interleaved, each still reads its own.
    const [a, b] = await Promise.all([
      withRequest(new Request('https://x.test', { headers: { Cookie: 'user=a' } }), whoIsAsking),
      withRequest(new Request('https://x.test', { headers: { Cookie: 'user=b' } }), whoIsAsking),
    ])

    expect(a.user).toBe('a')
    expect(b.user).toBe('b')
  })
})
