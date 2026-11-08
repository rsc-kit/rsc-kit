import { afterEach, describe, expect, test } from 'bun:test'
import { changed } from '../../src/changed'
import { takeAfterWork, withRequest } from '../../src/request'
import { homeportPurge, installPurge, installedPurge, purge, type Purge } from '../../src/purge'

const tick = () => new Promise((resolve) => setTimeout(resolve, 10))

afterEach(() => {
  installPurge(undefined as never)
  delete process.env.HOMEPORT_PURGE_URL
  delete process.env.RSC_PURGE_URL
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

  test('posts to RSC_PURGE_URL, before the HOMEPORT_PURGE_URL Homeport sets', async () => {
    const posted: string[] = []
    const fetch = globalThis.fetch

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      posted.push(String(input))

      return new Response(null, { status: 202 })
    }) as typeof fetch

    try {
      process.env.HOMEPORT_PURGE_URL = 'http://homeport.internal/'
      process.env.RSC_PURGE_URL = 'http://edge.internal/'
      await installedPurge()!({ tags: ['a'] })

      delete process.env.RSC_PURGE_URL
      await installedPurge()!({ tags: ['b'] })
    } finally {
      globalThis.fetch = fetch
    }

    expect(posted).toEqual(['http://edge.internal/', 'http://homeport.internal/'])
  })

  test('is Homeport\'s when HOMEPORT_PURGE_URL is set and the app installed none', () => {
    expect(installedPurge()).toBeNull()

    process.env.HOMEPORT_PURGE_URL = 'http://purge.internal/'
    expect(installedPurge()).not.toBeNull()

    installPurge(null)
    expect(installedPurge()).toBeNull()
  })

  test('never fails the change: every purge that throws is logged', async () => {
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

    expect(warnings.length).toBe(2)
  })
})

describe('homeportPurge()', () => {
  const recording = (statuses: number[] = []) => {
    const bodies: unknown[] = []
    const send = (async (_url: unknown, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)))
      expect(new Headers(init?.headers).get('content-type')).toBe('application/json')
      expect(init?.signal).toBeInstanceOf(AbortSignal)

      return new Response(null, { status: statuses.shift() ?? 202, headers: { 'Retry-After': '0' } })
    }) as typeof fetch

    return { bodies, fetch: send }
  }

  test('posts { tags, paths } in calls of at most 100 together', async () => {
    const { bodies, fetch } = recording()
    const tags = Array.from({ length: 250 }, (_, i) => `t${i}`)

    await homeportPurge({ url: 'http://purge.test/', fetch })({ tags, paths: ['/a'] })

    expect(bodies.length).toBe(3)
    expect((bodies[0] as Purge).tags!.length).toBe(100)
    expect((bodies[0] as Purge).paths).toBeUndefined()
    expect((bodies[2] as Purge).tags!.length).toBe(50)
    expect((bodies[2] as Purge).paths).toEqual(['/a'])
  })

  test('fills a call with paths once the tags run out, and never past 100', async () => {
    const { bodies, fetch } = recording()
    const paths = Array.from({ length: 100 }, (_, i) => `/p${i}`)

    await homeportPurge({ url: 'http://purge.test/', fetch })({ tags: ['a', 'b'], paths })

    expect(bodies.map((body) => ((body as Purge).tags?.length ?? 0) + ((body as Purge).paths?.length ?? 0))).toEqual([100, 2])
  })

  test('leaves out a tag or path too long to take, so it cannot cost the rest of the call', async () => {
    const { bodies, fetch } = recording()

    await homeportPurge({ url: 'http://purge.test/', fetch })({
      tags: ['posts', 'x'.repeat(1025), 'é'.repeat(513), 'y'.repeat(1024)],
      paths: ['/a', '/'.repeat(2049)],
    })

    expect(bodies).toEqual([{ tags: ['posts', 'y'.repeat(1024)], paths: ['/a'] }])
  })

  test('tries a second 429 no further, and still sends the calls after it', async () => {
    const { bodies, fetch } = recording([429, 429])
    const tags = Array.from({ length: 150 }, (_, i) => `t${i}`)

    await expect(homeportPurge({ url: 'http://purge.test/', fetch })({ tags })).rejects.toThrow(/answered 429/)

    // The first call and its one retry, then the second call.
    expect(bodies.map((body) => (body as Purge).tags!.length)).toEqual([100, 100, 50])
  })

  test('holds no later purge back while one is waiting', async () => {
    const sent: string[] = []
    let release = () => {}
    const waiting = new Promise<void>((resolve) => (release = resolve))
    const send = (async (_url: unknown, init?: RequestInit) => {
      const { tags } = JSON.parse(String(init?.body)) as { tags: string[] }

      sent.push(tags[0])

      if (tags[0] === 'slow') await waiting

      return new Response(null, { status: 202 })
    }) as typeof fetch
    const purger = homeportPurge({ url: 'http://purge.test/', fetch: send })
    const slow = purger({ tags: ['slow'] })

    await purger({ tags: ['next'] })

    expect(sent).toEqual(['slow', 'next'])

    release()
    await slow
  })

  test('counts only a 202 as accepted', async () => {
    const { fetch } = recording([200])

    await expect(homeportPurge({ url: 'http://purge.test/', fetch })({ tags: ['posts'] })).rejects.toThrow(/answered 200/)
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
