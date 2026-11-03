/**
 * Asking the same question twice in one request.
 *
 * The duplication this exists for starts before React does: a guard runs
 * before any component, so React's own cache() has no scope open there.
 */

import { beforeEach, describe, expect, test } from 'bun:test'
import { cache, forgetCached, installCacheStore, isCaching, memoryCacheStore, setCacheBuild, withCache } from '../../src/cache'
import { changed, installVersionSource, memoryVersions } from '../../src/changed'
import { cookies, withRequest } from '../../src/request'

describe('within one request', () => {
  test('the second call does not run the function', async () => {
    let calls = 0
    const currentUser = cache(async () => {
      calls++

      return { id: 1 }
    })

    await withCache(async () => {
      await currentUser()
      await currentUser()
      await currentUser()
    })

    expect(calls).toBe(1)
  })

  test('callers that arrive mid-flight wait on the first, not a second', async () => {
    // The promise is cached, not the value. Caching the value would let three
    // concurrent callers each start their own query before any finished.
    let calls = 0
    const slow = cache(async () => {
      calls++
      await new Promise((r) => setTimeout(r, 20))

      return calls
    })

    const answers = await withCache(() => Promise.all([slow(), slow(), slow()]))

    expect(calls).toBe(1)
    expect(answers).toEqual([1, 1, 1])
  })

  test('a rejection is the answer too', async () => {
    let calls = 0
    const failing = cache(async () => {
      calls++
      throw new Error('no session')
    })

    await withCache(async () => {
      await expect(failing()).rejects.toThrow('no session')
      await expect(failing()).rejects.toThrow('no session')
    })

    expect(calls).toBe(1)
  })
})

describe('arguments', () => {
  test('different primitives are different questions', async () => {
    const seen: unknown[] = []
    const find = cache(async (id: number) => {
      seen.push(id)

      return id
    })

    await withCache(async () => {
      await find(1)
      await find(2)
      await find(1)
    })

    expect(seen).toEqual([1, 2])
  })

  test('objects compare by identity, not by shape', async () => {
    // Serialising the arguments instead would make these one call — which they
    // are not, because the object can be mutated between them.
    let calls = 0
    const of = cache(async (_o: object) => ++calls)

    const a = { id: 1 }

    await withCache(async () => {
      await of(a)
      await of(a)
      await of({ id: 1 })
    })

    expect(calls).toBe(2)
  })

  test('two cached functions do not share a table', async () => {
    const a = cache(async () => 'a')
    const b = cache(async () => 'b')

    await withCache(async () => {
      expect(await a()).toBe('a')
      expect(await b()).toBe('b')
    })
  })
})

describe('between requests', () => {
  test('nothing is shared', async () => {
    let calls = 0
    const currentUser = cache(async () => ++calls)

    expect(await withCache(() => currentUser())).toBe(1)
    expect(await withCache(() => currentUser())).toBe(2)
  })

  test('two in flight at once cannot see each other', async () => {
    // The failure this rules out is the worst one available: a memo table
    // shared across requests hands one user another user's answer.
    const answers: string[] = []
    const who = cache(async (name: string) => name)

    const request = (name: string) =>
      withCache(async () => {
        await new Promise((r) => setTimeout(r, name === 'ada' ? 20 : 1))
        answers.push(await who(name))
      })

    await Promise.all([request('ada'), request('grace')])

    expect(answers.sort()).toEqual(['ada', 'grace'])
  })
})

describe('outside a request', () => {
  test('it calls straight through rather than throwing', async () => {
    // Shared code should not have to know which side of the boundary it is on.
    let calls = 0
    const currentUser = cache(async () => ++calls)

    expect(await currentUser()).toBe(1)
    expect(await currentUser()).toBe(2)
    expect(isCaching()).toBe(false)
  })
})

describe('nesting', () => {
  test('an inner scope reuses the table already open', async () => {
    // A host that wraps and an engine that also wraps must not end up with two
    // tables, or the inner work misses what the outer already answered.
    let calls = 0
    const currentUser = cache(async () => ++calls)

    await withCache(async () => {
      await currentUser()
      await withCache(async () => {
        await currentUser()
      })
    })

    expect(calls).toBe(1)
  })
})

describe('after a write', () => {
  test('forgetting the memos makes the next call ask again', async () => {
    // An action's request memoised the row it read before writing it; a
    // page rendered in the same request read the memo back and showed the
    // old name. The render after a mutation starts from nothing.
    let name = 'before'
    let calls = 0
    const currentName = cache(async () => {
      calls++

      return name
    })

    await withCache(async () => {
      expect(await currentName()).toBe('before')
      name = 'after'
      expect(await currentName()).toBe('before')

      forgetCached()

      expect(await currentName()).toBe('after')
      expect(await currentName()).toBe('after')
    })

    expect(calls).toBe(2)
  })

  test('outside a request there is nothing to forget', () => {
    expect(() => forgetCached()).not.toThrow()
  })
})

describe('across requests', () => {
  beforeEach(() => {
    installCacheStore(memoryCacheStore())
    installVersionSource(memoryVersions())
    setCacheBuild('build-1')
  })

  const counted = (options: Parameters<typeof cache>[1]) => {
    const asked: string[] = []
    const find = cache(async (slug: string) => {
      asked.push(slug)

      return { slug, at: new Date(0) }
    }, options)

    return { asked, find }
  }

  test('a second request is answered from the store', async () => {
    const { asked, find } = counted({ key: 'pages.find', revalidate: 60 })

    await withCache(() => find('about'))
    await withCache(() => find('about'))
    await find('about')

    expect(asked).toEqual(['about'])
  })

  test('each argument list is its own answer', async () => {
    const { asked, find } = counted({ key: 'pages.find', revalidate: 60 })

    await find('about')
    await find('pricing')
    await find('about')

    expect(asked).toEqual(['about', 'pricing'])
  })

  test('a miss hands back what a hit would: JSON', async () => {
    const { find } = counted({ key: 'pages.find', revalidate: 60 })

    expect(await find('about')).toEqual({ slug: 'about', at: '1970-01-01T00:00:00.000Z' } as never)
    expect(await find('about')).toEqual({ slug: 'about', at: '1970-01-01T00:00:00.000Z' } as never)
  })

  test('changed() on a tag makes the next ask miss, without a purge', async () => {
    const { asked, find } = counted({ key: 'pages.find', revalidate: 3600, tags: ['pages'] })

    await find('about')
    await find('about')
    await changed('pages')
    await find('about')
    await find('about')

    expect(asked).toEqual(['about', 'about'])
  })

  test('tags from the arguments: a change to one record leaves the others kept', async () => {
    const { asked, find } = counted({ key: 'pages.find', revalidate: 3600, tags: (slug) => [`page:${slug}`] })

    await find('about')
    await find('pricing')
    await changed('page:about')
    await find('about')
    await find('pricing')

    expect(asked).toEqual(['about', 'pricing', 'about'])
  })

  test('an answer older than revalidate is asked again', async () => {
    const { asked, find } = counted({ key: 'pages.find', revalidate: 0.02 })

    await find('about')
    await new Promise((resolve) => setTimeout(resolve, 30))
    await find('about')

    expect(asked).toEqual(['about', 'about'])
  })

  test('a new build does not read what the last one kept', async () => {
    const { asked, find } = counted({ key: 'pages.find', revalidate: 60 })

    await find('about')
    setCacheBuild('build-2')
    await find('about')

    expect(asked).toEqual(['about', 'about'])
  })

  test('concurrent asks for one key start one lookup', async () => {
    let calls = 0
    const slow = cache(async () => {
      calls++
      await new Promise((resolve) => setTimeout(resolve, 20))

      return calls
    }, { key: 'slow', revalidate: 60 })

    expect(await Promise.all([slow(), slow(), slow()])).toEqual([1, 1, 1])
    expect(calls).toBe(1)
  })

  test('runs as nobody: reading cookies throws instead of keeping one visitor\'s answer for all', async () => {
    const whoami = cache(async () => (await cookies()).get('session') ?? null, { key: 'whoami', revalidate: 60 })
    const visitor = new Request('https://app.test/', { headers: { cookie: 'session=alice' } })

    await expect(withRequest(visitor, () => whoami())).rejects.toThrow('No request in scope')
  })

  test('a failing store is asked around, not a failing page', async () => {
    const warn = console.warn
    console.warn = () => {}

    try {
      installCacheStore({
        get: () => {
          throw new Error('redis is down')
        },
        set: () => {
          throw new Error('redis is down')
        },
      })

      const { asked, find } = counted({ key: 'pages.find', revalidate: 60 })

      expect(await find('about')).toMatchObject({ slug: 'about' })
      expect(await find('about')).toMatchObject({ slug: 'about' })
      expect(asked).toEqual(['about', 'about'])
    } finally {
      console.warn = warn
    }
  })

  test('the memory store keeps the most recently used', async () => {
    const store = memoryCacheStore({ max: 2 })

    store.set('a', '1', 60)
    store.set('b', '2', 60)
    store.get('a')
    store.set('c', '3', 60)

    expect([store.get('a'), store.get('b'), store.get('c')]).toEqual(['1', undefined, '3'])
  })

  test('needs a key and a lifetime', () => {
    expect(() => cache(async () => 1, { key: '', revalidate: 60 })).toThrow('needs a key')
    expect(() => cache(async () => 1, { key: 'x', revalidate: 0 })).toThrow('above 0')
  })
})
