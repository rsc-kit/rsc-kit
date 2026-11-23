// What the build says to do about a route that threw while it rendered. It
// used to say one thing for all of them - make what the page needs reachable -
// and an app missing a "use client" was sent to check its backend.

import { describe, expect, test } from 'bun:test'
import { NotPrerenderable, renderFailureAdvice } from '../../src/prerender'

const SENT =
  'Functions cannot be passed directly to Client Components unless you explicitly expose it by marking it with "use server". ' +
  'Or maybe you meant to call this function rather than return it.\n  {action: ..., children: function children}'

describe('renderFailureAdvice', () => {
  test('a function handed to a client component: "use client", and nothing about the network', () => {
    const advice = renderFailureAdvice([{ url: '/forgot-password', reason: SENT }])

    expect(advice).toContain('/forgot-password: a server component passed a client component')
    expect(advice).toContain('put "use client" at the top of the file')
    expect(advice).not.toMatch(/reach|connection\(\)|Prerendering/)
  })

  test("React's other ways of saying it", () => {
    for (const reason of [
      'Event handlers cannot be passed to Client Component props.',
      'Only plain objects, and a few built-ins, can be passed to Client Components from Server Components. Classes or null prototypes are not supported.',
      'Only plain objects can be passed to Client Components from Server Components.',
    ])
      expect(renderFailureAdvice([{ url: '/a', reason }])).toContain('"use client"')
  })

  test('a connection that failed: what has to be running, and connection()', () => {
    for (const reason of ['connect ECONNREFUSED 127.0.0.1:5432', 'fetch failed', 'Unable to connect. Is the computer able to access the url?', 'getaddrinfo ENOTFOUND db']) {
      const advice = renderFailureAdvice([{ url: '/orders', reason }])

      expect(advice).toContain("couldn't reach something")
      expect(advice).toContain('await connection()')
      expect(advice).not.toContain('use client')
    }
  })

  test('anything else: the error is the page\'s own', () => {
    for (const reason of ["undefined is not an object (evaluating 'a.b')", null]) {
      const advice = renderFailureAdvice([{ url: '/x', reason }])

      expect(advice).toContain('/x: the page threw the error above')
      expect(advice).not.toContain("couldn't reach")
    }
  })

  test('each kind once, naming its own routes', () => {
    const advice = renderFailureAdvice([
      { url: '/a', reason: SENT },
      { url: '/b', reason: 'fetch failed' },
      { url: '/c', reason: SENT },
      { url: '/d', reason: 'boom' },
    ])

    expect(advice.split('\n\n').map((part) => part.slice(0, part.indexOf(':')))).toEqual(['/a, /c', '/b', '/d'])
  })

  test('the refusal of a page whose hole threw gives the same advice', () => {
    const refused = (reason: string) =>
      new NotPrerenderable([{ url: '/a', component: 'app/a/page', type: 'blocked', reason: `could not be rendered at build time: ${reason}` } as never]).message

    expect(refused(SENT)).toContain('"use client"')
    expect(refused(SENT)).not.toContain('rpc(')
    expect(refused('connect ECONNREFUSED')).toContain('await rpc(...)')
  })
})
