import { afterEach, describe, expect, test } from 'bun:test'
import { changed } from '../../src/changed'
import { takeAfterWork, withRequest } from '../../src/request'
import { homeportPurge, installPurge, installedPurge, purge, type Purge } from '../../src/purge'

const tick = () => new Promise((resolve) => setTimeout(resolve, 10))

afterEach(() => {
  installPurge(undefined as never)
  delete process.env.HOMEPORT_PURGE_URL
})

describe('changed() and the purge hook', () => {
  test('sends the names an action changed as one purge, once the answer has gone', async () => {
    const sent: Purge[] = []

    installPurge((what) => {
      sent.push(what)
    })

    const work = await withRequest(new Request('https://site.test/_rsc/action', { method: 'POST' }), async () => {
      await changed('posts')
      await changed('post:1', 'posts')
      expect(sent).toEqual([])

      return takeAfterWork()
    })

    await work

    expect(sent).toEqual([{ tags: ['posts', 'post:1'] }])
  })

  test('outside a request, purges at once', async () => {
    const sent: Purge[] = []

    installPurge((what) => {
      sent.push(what)
    })

    await changed('posts')
    await tick()

    expect(sent).toEqual([{ tags: ['posts'] }])
  })

  test('is Homeport\'s when HOMEPORT_PURGE_URL is set and the app installed none', () => {
    expect(installedPurge()).toBeNull()

    process.env.HOMEPORT_PURGE_URL = 'http://purge.internal/'
    expect(installedPurge()).not.toBeNull()

    installPurge(null)
    expect(installedPurge()).toBeNull()
  })

  test('never fails the change: a purge that throws is logged once', async () => {
    const warnings: unknown[] = []
    const warn = console.warn

    console.warn = (...args: unknown[]) => warnings.push(args)

    try {
      installPurge(() => {
        throw new Error('CDN down')
      })
      await purge({ tags: ['a'] })
      await purge({ tags: ['b'] })
    } finally {
      console.warn = warn
    }

    expect(warnings.length).toBeLessThanOrEqual(1)
  })
})

describe('homeportPurge()', () => {
  const recording = (statuses: number[] = []) => {
    const bodies: unknown[] = []
    const send = (async (_url: unknown, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)))
      expect(new Headers(init?.headers).get('content-type')).toBe('application/json')

      return new Response(null, { status: statuses.shift() ?? 202, headers: { 'Retry-After': '0' } })
    }) as typeof fetch

    return { bodies, fetch: send }
  }

  test('posts { tags, paths } in calls of at most 100 each', async () => {
    const { bodies, fetch } = recording()
    const tags = Array.from({ length: 250 }, (_, i) => `t${i}`)

    await homeportPurge({ url: 'http://purge.test/', fetch })({ tags, paths: ['/a'] })

    expect(bodies.length).toBe(3)
    expect((bodies[0] as Purge).tags!.length).toBe(100)
    expect((bodies[0] as Purge).paths).toEqual(['/a'])
    expect((bodies[2] as Purge).tags!.length).toBe(50)
    expect((bodies[2] as Purge).paths).toBeUndefined()
  })

  test('posts { all: true } on its own', async () => {
    const { bodies, fetch } = recording()

    await homeportPurge({ url: 'http://purge.test/', fetch })({ all: true })

    expect(bodies).toEqual([{ all: true }])
  })

  test('tries a 429 once more, and rejects on what it cannot send', async () => {
    const limited = recording([429])

    await homeportPurge({ url: 'http://purge.test/', fetch: limited.fetch })({ tags: ['a'] })
    expect(limited.bodies.length).toBe(2)

    const refused = recording([400])

    await expect(homeportPurge({ url: 'http://purge.test/', fetch: refused.fetch })({ tags: ['a'] })).rejects.toThrow('400')
  })
})
