/**
 * Asking the same question twice in one request.
 *
 * The duplication this exists for starts before React does: a guard runs
 * before any component, so React's own cache() has no scope open there.
 */

import { describe, expect, test } from 'bun:test'
import { cache, isCaching, withCache } from '../../src/cache'

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
