// The suite every adapter runs against itself, run here against the test
// host. A page test fakes the backend with hostReply; passing the same suite
// as Go and Laravel is what makes that fake say what they would.

import { describe, expect, test } from 'bun:test'
import { CASES, conformance, conformsTo, runConformance, type ArrivedPurge, type PurgeInbox } from '../../src/conformance'
import { homeportPurge } from '../../src/purge'
import { httpHostCalls } from '../../src/hostCalls'
import { hostReply, testHostFetch, testChanges, type TestHost } from '../../src/testHost'

const tags = testChanges()

// Where the reference's purges land: the engine's own homeportPurge, posting
// to the suite's inbox instead of the network.
let deliver: ((purge: ArrivedPurge) => Promise<void>) | undefined
const inbox: PurgeInbox = (handler) => {
  deliver = handler
}
const toInbox: typeof fetch = (async (_url: unknown, init?: RequestInit) => {
  await deliver?.({ method: init?.method ?? 'GET', contentType: new Headers(init?.headers).get('content-type'), body: String(init?.body) })

  return new Response(null, { status: 202 })
}) as typeof fetch
const purger = homeportPurge({ url: 'http://purge.test/', fetch: toInbox })

/** A flash as an adapter leaves one: the carried messages kept, "Saved." after them. */
function flashing(headers: Headers, attributes: string) {
  const carried = /(?:^|;\s*)rsc-flash=([^;]*)/.exec(headers.get('cookie') ?? '')?.[1]
  const messages = carried ? (JSON.parse(decodeURIComponent(carried)) as unknown[]) : []

  return hostReply.settingCookies('ok', `rsc-flash=${encodeURIComponent(JSON.stringify([...messages, { message: 'Saved.', kind: 'success' }]))}; ${attributes}`)
}

/** Every Conformance function, answered the way the test host lets a test answer it. */
const reference: TestHost = {
  ...tags.host,
  'Conformance.change': () => {
    tags.changed('conformance:changed')
    // After the change, and after the answer: the way the engine's changed() purges.
    setTimeout(() => void purger({ tags: ['conformance:changed'] }), 0)

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
  'Conformance.form': ({ args }) => {
    const values = args[0] as { name: string; email: string }

    return values.email === 'taken@example.com' ? hostReply.invalid({ email: ['That address is taken.'] }) : values.name
  },
  'Conformance.update': ({ args }) => {
    const [values, key] = args as [{ name: string; email: string }, string]

    return values.email === 'taken@example.com' && key !== '7' ? hostReply.invalid({ email: ['That address is taken.'] }) : `${key}:${values.name}`
  },
  'Conformance.redirect': () => hostReply.redirect('/login'),
  'Conformance.ip': ({ headers }) => headers.get('x-rsc-client-ip'),
  'Conformance.revalidate': () => hostReply.revalidating('ok', 'orders'),
  'Conformance.fail': () => hostReply.fail('boom'),
  'Conformance.authorization': ({ headers }) => headers.get('authorization'),
  'Conformance.cookie': ({ headers }) => headers.get('cookie'),
  'Conformance.login': () => hostReply.settingCookies('ok', 'conformance_login=1; Path=/; HttpOnly'),
  'Conformance.flash': ({ headers }) => flashing(headers, 'Path=/; Max-Age=60; SameSite=Lax'),
  'Conformance.double': ({ args }) =>
    args.length === 1 && Number.isInteger(args[0]) ? (args[0] as number) * 2 : hostReply.fail('Conformance.double takes one integer.'),
  'Conformance.invalidNested': () =>
    hostReply.invalid({ 'address.city': ['The city is required.'], '': ['The address could not be checked.'] }),
  // In order, stopping at the first that does not pass.
  '__rsc.middleware': ({ args }) => {
    for (const name of args[0] as string[]) {
      if (name === 'conformance-allow') continue
      if (name === 'conformance-page') {
        const page = args[1] as { url?: string; params?: Record<string, string> } | undefined

        if (page?.params?.order === '7' && new URL(page.url ?? '', 'http://x').pathname === '/conformance/orders/7') continue
      }
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

  return conformance(call, { revalidated, manifest, purges: inbox })
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

describe('run against an endpoint', () => {
  test('hears purges on --purge-port, posted over the network', async () => {
    const port = 18_790 + Math.floor(Math.random() * 1000)
    const overNetwork = homeportPurge({ url: `http://127.0.0.1:${port}/` })
    const results = await runConformance({
      endpoint: 'http://test-host/__rsc/host-call',
      secret: 'test',
      fetch: testHostFetch({
        ...reference,
        'Conformance.change': () => {
          tags.changed('conformance:changed')
          // A change after the suite stopped listening has nowhere to go.
          setTimeout(() => void Promise.resolve(overNetwork({ tags: ['conformance:changed'] })).catch(() => {}), 0)

          return 'ok'
        },
      }),
      purgePort: port,
    })

    expect(results.filter((r) => r.case.includes('purge')).every((r) => r.ok)).toBe(true)
  })
})

describe('a rotation', () => {
  // An adapter that checks the secret: the current one, and those it is told it may still take.
  const checking = (accepted: string[]) => {
    const host = testHostFetch(reference)

    return (async (input: RequestInfo | URL, init?: RequestInit) => {
      const given = new Headers(init?.headers).get('x-rsc-host-secret') ?? ''

      return accepted.includes(given) ? host(input, init) : new Response('forbidden', { status: 403 })
    }) as typeof fetch
  }

  const rotation = (results: Awaited<ReturnType<typeof runConformance>>) => results.find((r) => r.case.includes('previous secret'))!

  test('passes an adapter that answers the previous secret', async () => {
    const results = await runConformance({ endpoint: 'http://test-host/__rsc/host-call', secret: 'test', previousSecret: 'old', fetch: checking(['test', 'old']) })

    expect(rotation(results).ok).toBe(true)
  })

  test('fails one that refuses it', async () => {
    const results = await runConformance({ endpoint: 'http://test-host/__rsc/host-call', secret: 'test', previousSecret: 'old', fetch: checking(['test']) })

    expect(rotation(results)).toMatchObject({ ok: false })
    expect(String(rotation(results).detail)).toContain('the previous secret was refused')
  })

  test('fails a run that was not given one, saying how to start the adapter', async () => {
    const results = await runConformance({ endpoint: 'http://test-host/__rsc/host-call', secret: 'test', fetch: checking(['test']) })

    expect(String(rotation(results).detail)).toContain('RSC_HOST_CALL_SECRET_PREVIOUS=<old>')
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

  test('a change no CDN hears of', async () => {
    const results = await run({
      ...reference,
      'Conformance.change': () => {
        tags.changed('conformance:changed')

        return 'ok'
      },
    })

    expect(results.find((r) => r.case.startsWith('a change is purged'))?.ok).toBe(false)
  }, 10_000)

  test('a purge sent before the change is made, which a CDN refills with the old page', async () => {
    const results = await run({
      ...reference,
      'Conformance.change': async () => {
        await purger({ tags: ['conformance:changed'] })
        tags.changed('conformance:changed')

        return 'ok'
      },
    })

    const purged = results.find((r) => r.case.startsWith('a change is purged'))

    expect(purged?.ok).toBe(false)
    expect(purged?.detail).toContain('before the change was made')
  }, 10_000)

  test('an earlier change\'s purge landing late is not read as this one arriving early', async () => {
    const results = await run({
      ...reference,
      // The answer goes before the purge, so the last change's purge lands
      // while this one is still being made.
      'Conformance.change': async () => {
        await new Promise((resolve) => setTimeout(resolve, 30))
        tags.changed('conformance:changed')
        setTimeout(() => void purger({ tags: ['conformance:changed'] }), 10)

        return 'ok'
      },
    })

    expect(results.find((r) => r.case.startsWith('a change is purged'))?.ok).toBe(true)
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
    // A change that never purges waits out the purge case's five seconds.
  }, 10_000)

  test('a Cookie header that is not forwarded', async () => {
    const results = await run({ ...reference, 'Conformance.cookie': () => null })

    expect(results.find((r) => r.case.includes('Cookie header is forwarded'))?.ok).toBe(false)
  })

  test('a flash the browser cannot read', async () => {
    const results = await run({ ...reference, 'Conformance.flash': ({ headers }) => flashing(headers, 'Path=/; HttpOnly') })

    expect(results.find((r) => r.case.includes('a flash'))?.ok).toBe(false)
  })

  test('a flash written over the one the visitor still carries', async () => {
    const results = await run({
      ...reference,
      'Conformance.flash': () =>
        hostReply.settingCookies('ok', `rsc-flash=${encodeURIComponent(JSON.stringify([{ message: 'Saved.', kind: 'success' }]))}; Path=/`),
    })

    expect(results.find((r) => r.case.includes('a flash'))?.ok).toBe(false)
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

describe('a form function in the manifest', () => {
  const field = { name: { type: 'string', minLength: 2 }, email: { type: 'string', format: 'email' }, topic: { type: 'string', enum: ['sales', 'support'] },
    company: { type: 'string', 'x-visible': { when: 'topic', is: ['support'], required: true } },
  }
  const required = ['email', 'name', 'topic']
  const verdict = async (input: Record<string, unknown>) => {
    const results = await run(reference, { functions: Object.keys(CASES), actions: {}, types: { 'Conformance.form': { params: [input] }, 'Conformance.update': { params: [input, { type: 'string' }] } } })

    return results.find((result) => result.case.startsWith('the manifest describes a form'))
  }

  test('passes described the way a form reads it', async () => {
    expect((await verdict({ type: 'object', properties: field, required }))?.ok).toBe(true)
  })

  test('passes sorted, when x-order says the order', async () => {
    const { company, email, name, topic } = field

    expect((await verdict({ type: 'object', properties: { company, email, name, topic }, 'x-order': ['name', 'email', 'topic', 'company'], required }))?.ok).toBe(true)
  })

  test('fails sorted with no order: the form would draw alphabetically', async () => {
    const { company, email, name, topic } = field
    const result = await verdict({ type: 'object', properties: { company, email, name, topic }, required })

    expect(result?.detail).toContain('company, email, name, topic')
  })

  test('fails when required_if is not read as a field shown while another has a value', async () => {
    const result = await verdict({ type: 'object', properties: { ...field, company: { type: 'string' } }, required })

    expect(result?.detail).toContain('company has no x-visible')
  })

  test('fails with no hint for the browser', async () => {
    const result = await verdict({ type: 'object', properties: { ...field, email: { type: 'string' } }, required })

    expect(result?.detail).toContain('email has no format')
  })
})
