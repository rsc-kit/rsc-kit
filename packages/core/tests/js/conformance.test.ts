// The suite every adapter runs against itself, run here against the test
// host. A page test fakes the backend with hostReply; passing the same suite
// as Go and Laravel is what makes that fake say what they would.

import { describe, expect, test } from 'bun:test'
import { CASES, conformance, conformsTo } from '../../src/conformance'
import { httpHostCalls } from '../../src/hostCalls'
import { hostReply, testHostFetch, testChanges, type TestHost } from '../../src/testHost'

const tags = testChanges()

/** Every Conformance function, answered the way the test host lets a test answer it. */
const reference: TestHost = {
  ...tags.host,
  'Conformance.change': () => {
    tags.changed('conformance:changed')

    return 'ok'
  },
  'Conformance.echo': ({ args }) => args[0],
  'Conformance.emptyList': () => [],
  'Conformance.time': () => '2026-01-02T03:04:05Z',
  'Conformance.noTime': () => null,
  'Conformance.unauthenticated': () => hostReply.unauthenticated(),
  'Conformance.unauthorized': () => hostReply.unauthorized(),
  'Conformance.notFound': () => hostReply.refuse(404, 'Not found.'),
  'Conformance.refuse': () => hostReply.refuse(429, 'Slow down.'),
  'Conformance.refuseWithData': () => hostReply.refuse(409, 'Still in use', { blockers: [{ id: 7, href: '/orders/7' }] }),
  'Conformance.invalid': () => hostReply.invalid({ name: ['The name field is required.'] }),
  'Conformance.redirect': () => hostReply.redirect('/login'),
  'Conformance.revalidate': () => hostReply.revalidating('ok', 'orders'),
  'Conformance.fail': () => hostReply.fail('boom'),
  'Conformance.authorization': ({ headers }) => headers.get('authorization'),
  'Conformance.cookie': ({ headers }) => headers.get('cookie'),
  'Conformance.login': () => hostReply.settingCookies('ok', 'conformance_login=1; Path=/; HttpOnly'),
  'Conformance.double': ({ args }) =>
    args.length === 1 && Number.isInteger(args[0]) ? (args[0] as number) * 2 : hostReply.fail('Conformance.double takes one integer.'),
  'Conformance.invalidNested': () =>
    hostReply.invalid({ 'address.city': ['The city is required.'], '': ['The address could not be checked.'] }),
  // In order, stopping at the first that does not pass.
  '__rsc.middleware': ({ args }) => {
    for (const name of args[0] as string[]) {
      if (name === 'conformance-allow') continue
      if (name === 'conformance-redirect') return hostReply.redirect('/conformance-login')

      return hostReply.unauthorized()
    }

    return true
  },
}

const run = (host: TestHost, manifest?: Parameters<typeof conformance>[1]['manifest']) => {
  const revalidated: string[][] = []
  const call = httpHostCalls({
    endpoint: 'http://test-host/__rsc/host-call',
    secret: 'test',
    fetch: testHostFetch(host),
    onRevalidate: (targets) => revalidated.push(targets),
  })

  return conformance(call, { revalidated, manifest })
}

describe('the test host', () => {
  test('answers every case the way an adapter must', async () => {
    const failed = (await run(reference)).filter((r) => !r.ok)

    expect(failed).toEqual([])
  })

  test('covers every function the contract names', () => {
    expect(Object.keys(reference).sort()).toEqual(Object.keys(CASES).sort())
  })
})

describe('the suite catches', () => {
  // Each a bug an app found, one at a time, before there was a suite.
  test('a nil slice sent as null', async () => {
    const results = await run({ ...reference, 'Conformance.emptyList': () => null })

    expect(results.find((r) => r.case.startsWith('"no rows"'))?.ok).toBe(false)
  })

  test('a refusal sent as a bare error, which a page cannot tell from a crash', async () => {
    const results = await run({ ...reference, 'Conformance.unauthenticated': () => hostReply.fail('401') })

    expect(results.find((r) => r.case.startsWith('not signed in'))?.ok).toBe(false)
  })

  test('a 404 that is not the engine\'s not-found', async () => {
    const results = await run({ ...reference, 'Conformance.notFound': () => hostReply.fail('not found') })

    expect(results.find((r) => r.case.startsWith('not found'))?.ok).toBe(false)
  })

  test('a guard that answers yes to a name it never registered', async () => {
    const results = await run({ ...reference, '__rsc.middleware': () => true })

    expect(results.find((r) => r.case.includes('fail closed'))?.ok).toBe(false)
  })

  test('versions kept as a counter, which repeat once an old name is pruned', async () => {
    let counter = 0
    const results = await run({
      ...reference,
      'Conformance.change': () => {
        counter++

        return 'ok'
      },
      '__rsc.changed': ({ args }) => {
        const since = (args[0] as { since: Record<string, number> }).since
        const now: Record<string, number> = { 'conformance:changed': counter, 'conformance:never': 0 }

        return { versions: Object.fromEntries(Object.keys(since).filter((n) => (now[n] ?? 0) !== since[n]).map((n) => [n, now[n] ?? 0])) }
      },
    })

    expect(results.find((r) => r.case.startsWith('a version is the time'))?.ok).toBe(false)
  })

  test('a Cookie header that is not forwarded', async () => {
    const results = await run({ ...reference, 'Conformance.cookie': () => null })

    expect(results.find((r) => r.case.includes('Cookie header is forwarded'))?.ok).toBe(false)
  })

  test("a login whose cookie never reaches the page", async () => {
    const results = await run({ ...reference, 'Conformance.login': () => 'ok' })

    expect(results.find((r) => r.case.includes('reaches the page'))?.ok).toBe(false)
  })

  test('guards that all run, the last one deciding', async () => {
    const results = await run({
      ...reference,
      '__rsc.middleware': ({ args }) => {
        const names = args[0] as string[]
        const last = names[names.length - 1]

        if (last === 'conformance-redirect') return hostReply.redirect('/conformance-login')

        return last === 'conformance-allow' ? true : hostReply.unauthorized()
      },
    })

    expect(results.find((r) => r.case.startsWith('guards run in order'))?.ok).toBe(false)
  })

  test('arguments that do not fit answered as a refusal', async () => {
    const results = await run({
      ...reference,
      'Conformance.double': ({ args }) => (Number.isInteger(args[0]) ? (args[0] as number) * 2 : hostReply.invalid({ 0: ['Not an integer.'] })),
    })

    expect(results.find((r) => r.case.startsWith('arguments that do not fit'))?.ok).toBe(false)
  })

  test('every name answered, not only the ones that differ', async () => {
    const results = await run({
      ...reference,
      '__rsc.changed': async (call) => {
        const answer = (await reference['__rsc.changed']!(call as never)) as { versions: Record<string, number> }
        const since = (call.args[0] as { since: Record<string, number> }).since

        return { versions: { ...Object.fromEntries(Object.keys(since).map((n) => [n, since[n]])), ...answer.versions } }
      },
    })

    expect(results.find((r) => r.case.startsWith('only the names that differ'))?.ok).toBe(false)
  })

  test('a value that does not fit the type the manifest declares', async () => {
    const manifest = {
      functions: Object.keys(CASES).filter((n) => !n.startsWith('__')),
      types: { 'Conformance.time': { result: { type: 'integer' } } },
    }
    const results = await run(reference, manifest)

    expect(results.find((r) => r.case.startsWith('a time'))?.detail).toContain('expected an integer')
  })
})

describe('a value against a schema', () => {
  const defs = { Order: { type: 'object', properties: { id: { type: 'integer' }, tags: { type: 'array', items: { type: 'string' } } }, required: ['id', 'tags'] } }

  test('fits, or says where it does not', () => {
    expect(conformsTo({ id: 1, tags: [] }, { $ref: '#/defs/Order' }, defs, 'result')).toBeNull()
    expect(conformsTo({ id: 1, tags: null }, { $ref: '#/defs/Order' }, defs, 'result')).toBe('result.tags: expected an array, got null')
    expect(conformsTo(null, { anyOf: [{ type: 'string', format: 'date-time' }, { type: 'null' }] }, defs, 'r')).toBeNull()
    expect(conformsTo('nope', { type: 'string', format: 'date-time' }, defs, 'r')).toContain('not a date-time')
  })
})
