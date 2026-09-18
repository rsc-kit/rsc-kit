// Typing and checking what a url carries.
//
// The unit half runs the parsers directly; the end-to-end half renders the
// fixture page, because the thing most likely to break is not the parsing but
// the plumbing — a schema that is detected and then never reached looks
// exactly like a schema that passed.

import { beforeAll, describe, expect, test } from 'bun:test'
import {
  isSearchParamsError,
  parseParams,
  parseSearchParams,
  searchParamsToObject,
} from '../../src/routeSchema'
import { isNotFoundSignal } from '../../src/notFound'
import { assertServerRuntime } from './serverRuntime'

assertServerRuntime('urlSchemas.test.ts')

const positive = {
  '~standard': {
    version: 1 as const,
    vendor: 'test',
    validate: (value: any) => {
      const n = Number(value.id ?? value.page)

      return Number.isInteger(n) && n > 0
        ? { value: { n } }
        : { issues: [{ message: 'must be a positive integer', path: ['id'] }] }
    },
  },
}

describe('reading a query string as an object', () => {
  test('a key that appears once is a scalar', () => {
    expect(searchParamsToObject(new URLSearchParams('q=shoes'))).toEqual({ q: 'shoes' })
  })

  test('and one that repeats is an array', () => {
    // So ?tag=a&tag=b reaches an array schema and ?q=shoes reaches a string
    // one, without either schema having to know which shape the url took.
    expect(searchParamsToObject(new URLSearchParams('tag=a&tag=b'))).toEqual({ tag: ['a', 'b'] })
  })
})

describe('params', () => {
  test('hand back the url untouched when the page declared no schema', async () => {
    expect(await parseParams(undefined, { id: '7' })).toEqual({ id: '7' })
  })

  test('arrive parsed, not as the strings the url carried', async () => {
    expect(await parseParams(positive as never, { id: '7' })).toEqual({ n: 7 })
  })

  test('a value the schema refuses is a missing page, not an error', async () => {
    // /posts/banana does not name a page. Answering 500 tells a crawler the
    // page is broken rather than absent, and a cache stores that.
    try {
      await parseParams(positive as never, { id: 'banana' })
      throw new Error('should have thrown')
    } catch (error) {
      expect(isNotFoundSignal(error)).toBe(true)
    }
  })
})

describe('searchParams', () => {
  test('hand back the URLSearchParams when the page declared no schema', async () => {
    const search = new URLSearchParams('page=2')

    expect(await parseSearchParams(undefined, search)).toBe(search)
  })

  test('arrive parsed', async () => {
    expect(await parseSearchParams(positive as never, new URLSearchParams('page=2'))).toEqual({
      n: 2,
    })
  })

  test('a refused query is an error, not a missing page', async () => {
    // The page exists; the query was wrong. A 404 here would be a lie, and it
    // would let a bad link make a real page look deleted.
    try {
      await parseSearchParams(positive as never, new URLSearchParams('page=0'))
      throw new Error('should have thrown')
    } catch (error) {
      expect(isNotFoundSignal(error)).toBe(false)
      expect(isSearchParamsError(error)).toBe(true)
      expect((error as { errors: Record<string, string[]> }).errors).toEqual({
        id: ['must be a positive integer'],
      })
    }
  })
})

describe('the mark survives a second copy of the module', () => {
  test('a not-found raised by another bundle is still a not-found', () => {
    // The seam this exists for: a page is bundled apart from the engine, so
    // each side evaluates its own copy and instanceof is false between them.
    const raised = new Error('nope')

    Object.defineProperty(raised, Symbol.for('@rsc-kit/core.not-found-signal'), { value: true })

    expect(isNotFoundSignal(raised)).toBe(true)
  })

  test('and so is a refused query string', () => {
    const raised = new Error('nope')

    Object.defineProperty(raised, Symbol.for('@rsc-kit/core.route-input-error'), { value: true })

    expect(isSearchParamsError(raised)).toBe(true)
  })
})

describe('against the real fixture bundle', () => {
  let engine: any

  beforeAll(async () => {
    const { buildFixtureOnce, bundlePath } = await import('./goHost')

    await buildFixtureOnce()
    engine = await import(bundlePath)
  }, 300_000)

  const render = async (url: string) => {
    const { createRscHandler } = await import('../../src/host')
    const handle = createRscHandler({
      engine: { ...engine, manifest: engine.manifest },
      manifest: engine.manifest(),
    } as never)

    return await handle(new Request('https://app.test' + url))
  }

  test('the page is handed parsed values, not the url strings', async () => {
    const res = await render('/typed/7?page=2')

    expect(res?.status).toBe(200)

    // id+1 and page+1 are arithmetic, so the strings the url carried could not
    // have produced this: "7"+1 is "71".
    expect(await res!.text()).toContain('id+1=8 page+1=3')
  })

  test('a default fills in for a query string that omitted it', async () => {
    expect(await (await render('/typed/7'))!.text()).toContain('page+1=2')
  })

  test('a param the schema refuses is not this page', async () => {
    // Null is how this host says "not mine", and the caller answers it with
    // not-found and a 404.
    expect(await render('/typed/banana')).toBeNull()
  })

  test('a query the schema refuses is still this page', async () => {
    // The page exists and the query was wrong — refusing it as a 404 would let
    // a bad link make a real page look deleted.
    const res = await render('/typed/7?page=0')

    expect(res).not.toBeNull()
    expect(res?.status).not.toBe(404)
  })
})

describe('an api route with schemas', () => {
  let call: (url: string, init?: RequestInit) => Promise<Response | null>

  beforeAll(async () => {
    const { buildFixtureOnce, bundlePath } = await import('./goHost')
    const { createRscHandler } = await import('../../src/host')

    await buildFixtureOnce()

    const engine: any = await import(bundlePath)
    const handle = createRscHandler({
      engine: { ...engine, manifest: engine.manifest },
      manifest: engine.manifest(),
    } as never)

    call = (url, init) => handle(new Request('https://app.test' + url, init))
  }, 300_000)

  test('the handler is given parsed values, and a default for what the url omitted', async () => {
    const res = await call('/api/items/7')

    expect(res?.status).toBe(200)
    expect(await res!.json()).toEqual({ id: 8, limit: 21 })
  })

  test('a param the schema refuses is 404, because the url names nothing', async () => {
    expect((await call('/api/items/banana'))?.status).toBe(404)
  })

  test('a query the schema refuses is 400, because the resource exists', async () => {
    const res = await call('/api/items/7?limit=0')

    expect(res?.status).toBe(400)
    expect(await res!.json()).toMatchObject({ errors: { limit: ['must be a positive integer'] } })
  })

  test('a json body is parsed and handed over', async () => {
    const res = await call('/api/items/7', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'hello' }),
    })

    expect(res?.status).toBe(201)
    expect(await res!.json()).toEqual({ id: 7, title: 'HELLO' })
  })

  test('a body the schema refuses is 422, the status an action already uses', async () => {
    const res = await call('/api/items/7', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })

    expect(res?.status).toBe(422)
    expect(await res!.json()).toMatchObject({ errors: { title: ['is required'] } })
  })

  test('and malformed json is refused as a body, not as a crash', async () => {
    const res = await call('/api/items/7', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json at all',
    })

    expect(res?.status).toBe(422)
  })

  test('a form encoding posts to the same schema', async () => {
    // An api route answers a url, and urls are posted to by forms as well as
    // by fetch. Refusing one would be a limitation the schema invented.
    const res = await call('/api/items/7', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'title=hello',
    })

    expect(res?.status).toBe(201)
    expect(await res!.json()).toEqual({ id: 7, title: 'HELLO' })
  })
})
