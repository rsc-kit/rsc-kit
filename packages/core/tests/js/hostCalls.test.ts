// Host calls over HTTP — the transport that lets a host in another language
// answer `rpc()` without implementing the socket framing.
//
// These assert on the request the transport sends and what it makes of the
// reply, against a fetch stand-in. The end of the wire is a Go server in
// adapters/go; what is pinned here is the contract that server implements.

import { describe, expect, test } from 'bun:test'
import { httpHostCalls } from '../../src/hostCalls'
import { withRequest } from '../../src/request'
import { withRevalidation } from '../../src/revalidate'
import { isActionValidationError } from '../../src/action'
import { withRedirect } from '../../src/redirect'
import { assertServerRuntime } from './serverRuntime'

assertServerRuntime('hostCalls.test.ts')

type Captured = { url: string; init: RequestInit; headers: Record<string, string>; body: any }

function stub(reply: unknown, status = 200) {
  const seen: Captured[] = []

  const fetchImpl = (async (url: any, init: any) => {
    const headers: Record<string, string> = {}
    for (const [k, v] of Object.entries(init.headers ?? {})) headers[k.toLowerCase()] = String(v)
    seen.push({ url: String(url), init, headers, body: JSON.parse(String(init.body)) })

    return new Response(typeof reply === 'string' ? reply : JSON.stringify(reply), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  }) as unknown as typeof fetch

  return { seen, fetchImpl }
}

const base = { endpoint: 'http://127.0.0.1:9999/__rsc/host-call', secret: 's3cret' }

describe('httpHostCalls', () => {
  test('posts the function name and args, and unwraps the result', async () => {
    const { seen, fetchImpl } = stub({ result: [{ id: 1 }] })
    const call = httpHostCalls({ ...base, fetch: fetchImpl })

    expect(await call('Orders.recent', 5, { open: true })).toEqual([{ id: 1 }])
    expect(seen[0].body).toEqual({ function: 'Orders.recent', args: [5, { open: true }] })
    expect(seen[0].init.method).toBe('POST')
    expect(seen[0].url).toBe(base.endpoint)
  })

  test('sends the shared secret, and refuses to be built without one', () => {
    const { fetchImpl } = stub({ result: null })
    expect(() => httpHostCalls({ ...base, secret: '', fetch: fetchImpl })).toThrow(/requires a secret/)
  })

  test('carries the secret on every call', async () => {
    const { seen, fetchImpl } = stub({ result: null })
    await httpHostCalls({ ...base, fetch: fetchImpl })('X.y')
    expect(seen[0].headers['x-rsc-host-secret']).toBe('s3cret')
  })

  // The point of forwarding: the backend's own session middleware reads its
  // cookie and finds the same user the page is being rendered for.
  test('forwards the render request cookie, so the call runs as that visitor', async () => {
    const { seen, fetchImpl } = stub({ result: 'ok' })
    const call = httpHostCalls({ ...base, fetch: fetchImpl })

    await withRequest(
      { url: 'http://app.test/orders', headers: { cookie: 'session=abc', authorization: 'Bearer t' } },
      () => call('Orders.recent'),
    )

    expect(seen[0].headers.cookie).toBe('session=abc')
    expect(seen[0].headers.authorization).toBe('Bearer t')
  })

  test('forwards nothing else — this POST describes itself', async () => {
    const { seen, fetchImpl } = stub({ result: 'ok' })
    const call = httpHostCalls({ ...base, fetch: fetchImpl })

    await withRequest(
      { url: 'http://app.test/x', headers: { cookie: 'a=1', 'x-forwarded-for': '9.9.9.9', 'content-length': '12' } },
      () => call('X.y'),
    )

    expect(seen[0].headers['x-forwarded-for']).toBeUndefined()
    expect(seen[0].headers['content-length']).toBeUndefined()
    expect(seen[0].headers['content-type']).toBe('application/json')
  })

  // A build-time render has no visitor, and that is not a failure.
  test('outside a request it still calls, carrying no session', async () => {
    const { seen, fetchImpl } = stub({ result: 'built' })
    expect(await httpHostCalls({ ...base, fetch: fetchImpl })('X.y')).toBe('built')
    expect(seen[0].headers.cookie).toBeUndefined()
  })

  test('a reported error becomes the thrown message, not the status code', async () => {
    const { fetchImpl } = stub({ error: 'Orders table is missing' }, 500)
    await expect(httpHostCalls({ ...base, fetch: fetchImpl })('Orders.recent')).rejects.toThrow(
      /Orders table is missing/,
    )
  })

  test('a non-JSON body says so rather than surfacing as a null result', async () => {
    const { fetchImpl } = stub('<html>502 Bad Gateway</html>')
    await expect(httpHostCalls({ ...base, fetch: fetchImpl })('X.y')).rejects.toThrow(/not JSON/)
  })

  test('an unreachable host names the endpoint', async () => {
    const fetchImpl = (async () => {
      throw new Error('connect ECONNREFUSED')
    }) as unknown as typeof fetch

    await expect(httpHostCalls({ ...base, fetch: fetchImpl })('X.y')).rejects.toThrow(
      /could not reach the host at http:\/\/127\.0\.0\.1:9999/,
    )
  })

  test('a host that never answers times out rather than hanging the render', async () => {
    const fetchImpl = ((_url: any, init: any) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(new Error('aborted')))
      })) as unknown as typeof fetch

    await expect(
      httpHostCalls({ ...base, fetch: fetchImpl, timeoutMs: 30 })('Slow.thing'),
    ).rejects.toThrow(/timed out after 30ms/)
  })

  // Parity with the socket channel, where a reply may report what it dirtied.
  test('a reply may report what it invalidated', async () => {
    const { fetchImpl } = stub({ result: 'ok', revalidate: ['orders', 'page'] })
    const seen: string[][] = []

    await httpHostCalls({ ...base, fetch: fetchImpl, onRevalidate: (t) => seen.push(t) })('Orders.create')
    expect(seen).toEqual([['orders', 'page']])
  })

  // Without this the host reports what it dirtied, nothing listens, and the
  // browser is told nothing — the page shows stale data with no error anywhere.
  test('with no handler given, a reported target is marked on the engine', async () => {
    const { fetchImpl } = stub({ result: 'ok', revalidate: ['orders'] })

    const { taken } = await withRevalidation(async (take) => {
      await httpHostCalls({ ...base, fetch: fetchImpl })('Orders.create')

      return { taken: take() }
    })

    expect(taken).toEqual(['orders'])
  })

  // A refusal is an answer, not a failure — the same distinction the socket
  // protocol draws with its validation_errors frame.
  test('a refusal is raised as a validation error, not as a failed call', async () => {
    const { fetchImpl } = stub({ validationErrors: { name: ['Already taken.'] } }, 422)

    try {
      await httpHostCalls({ ...base, fetch: fetchImpl })('Orders.create')
      throw new Error('should have thrown')
    } catch (error) {
      expect(isActionValidationError(error)).toBe(true)
      expect((error as { errors: Record<string, string[]> }).errors).toEqual({
        name: ['Already taken.'],
      })
    }
  })

  test('a refusal wins over an error field, so fields are never lost', async () => {
    const { fetchImpl } = stub(
      { validationErrors: { name: ['Required.'] }, error: 'Validation failed' },
      422,
    )

    try {
      await httpHostCalls({ ...base, fetch: fetchImpl })('Orders.create')
      throw new Error('should have thrown')
    } catch (error) {
      expect(isActionValidationError(error)).toBe(true)
    }
  })

  // Everything the socket protocol can answer, the same way it answers it.
  test('a redirect is raised as a redirect, not returned as data', async () => {
    const { fetchImpl } = stub({ redirect: '/login' })

    const taken = await withRedirect(async (get) => {
      await httpHostCalls({ ...base, fetch: fetchImpl })('Session.check').catch(() => {})

      return get()
    })

    expect(taken?.location).toBe('/login')
    expect(taken?.status).toBe(307)
  })

  test('a redirect may choose its status', async () => {
    const { fetchImpl } = stub({ redirect: '/moved', redirectStatus: 308 })

    const taken = await withRedirect(async (get) => {
      await httpHostCalls({ ...base, fetch: fetchImpl })('X.y').catch(() => {})

      return get()
    })

    expect(taken?.status).toBe(308)
  })

  test('no session becomes an authentication error', async () => {
    const { fetchImpl } = stub({ unauthenticated: true, error: 'Unauthenticated.' }, 401)

    await expect(httpHostCalls({ ...base, fetch: fetchImpl })('Me.orders')).rejects.toThrow(
      /Unauthenticated/,
    )
  })

  test('a refused permission becomes an authorization error', async () => {
    const { fetchImpl } = stub({ unauthorized: true, error: 'This action is unauthorized.' }, 403)

    await expect(httpHostCalls({ ...base, fetch: fetchImpl })('Orders.destroy')).rejects.toThrow(
      /unauthorized/,
    )
  })

  test('a result of null stays null rather than becoming undefined', async () => {
    const { fetchImpl } = stub({ result: null })
    expect(await httpHostCalls({ ...base, fetch: fetchImpl })('X.y')).toBeNull()
  })
})

// Calls issued in the same tick of a render - sibling components each
// awaiting rpc() - travel as one POST, so a page's parallel reads cost the
// host one request rather than one each. Everything below the wire stays
// per call: a refusal reaches the caller that was refused, a revalidation
// lands in the render that asked, and a host that has never seen the envelope
// gets single calls from then on.
describe('batching', () => {
  /**
   * A host that understands the envelope: each call is answered by `answer`,
   * with its own status inside the reply.
   */
  function batchingHost(answer: (name: string, args: unknown[]) => { status?: number } & Record<string, unknown>) {
    const seen: Captured[] = []
    const fetchImpl = (async (url: any, init: any) => {
      const headers: Record<string, string> = {}
      for (const [k, v] of Object.entries(init.headers ?? {})) headers[k.toLowerCase()] = String(v)
      const body = JSON.parse(String(init.body))
      seen.push({ url: String(url), init, headers, body })

      if (Array.isArray(body.calls)) {
        const replies = body.calls.map((c: any) => answer(c.function, c.args))

        return Response.json({ replies })
      }

      const { status = 200, ...reply } = answer(body.function, body.args)

      return Response.json(reply, { status })
    }) as unknown as typeof fetch

    return { seen, fetchImpl }
  }

  test('calls issued in the same tick travel as one POST, and each gets its own answer', async () => {
    const { seen, fetchImpl } = batchingHost((name, args) => ({ result: `${name}(${args.join(',')})` }))
    const call = httpHostCalls({ ...base, fetch: fetchImpl })

    const [a, b, c] = await Promise.all([call('Orders.recent', 5), call('Me.profile'), call('Cart.count', 'x')])

    expect(seen).toHaveLength(1)
    expect(seen[0].body).toEqual({
      calls: [
        { function: 'Orders.recent', args: [5] },
        { function: 'Me.profile', args: [] },
        { function: 'Cart.count', args: ['x'] },
      ],
    })
    expect([a, b, c]).toEqual(['Orders.recent(5)', 'Me.profile()', 'Cart.count(x)'])
  })

  test('a call on its own goes as itself - nothing new on the wire', async () => {
    const { seen, fetchImpl } = batchingHost(() => ({ result: 1 }))

    await httpHostCalls({ ...base, fetch: fetchImpl })('X.y', 1)

    expect(seen[0].body).toEqual({ function: 'X.y', args: [1] })
  })

  test('two visitors in flight at once never share a request', async () => {
    const { seen, fetchImpl } = batchingHost((name) => ({ result: name }))
    const call = httpHostCalls({ ...base, fetch: fetchImpl })

    const asVisitor = (cookie: string, name: string) =>
      withRequest(new Request('http://app.test/', { headers: { cookie } }), async () => call(name))

    await Promise.all([asVisitor('session=ada', 'A.one'), asVisitor('session=bob', 'B.one'), asVisitor('session=ada', 'A.two')])

    // Ada's two calls batched, Bob's alone - keyed on what is forwarded.
    expect(seen).toHaveLength(2)
    const ada = seen.find((s) => s.headers.cookie === 'session=ada')!
    const bob = seen.find((s) => s.headers.cookie === 'session=bob')!
    expect(ada.body.calls.map((c: any) => c.function)).toEqual(['A.one', 'A.two'])
    expect(bob.body).toEqual({ function: 'B.one', args: [] })
  })

  test('a refusal inside a batch reaches the caller that was refused, and no one else', async () => {
    const { fetchImpl } = batchingHost((name) =>
      name === 'Orders.create'
        ? { status: 422, validationErrors: { name: ['Already taken.'] } }
        : { result: 'fine' },
    )
    const call = httpHostCalls({ ...base, fetch: fetchImpl })

    const [ok, refused] = await Promise.allSettled([call('Me.profile'), call('Orders.create')])

    expect(ok).toEqual({ status: 'fulfilled', value: 'fine' })
    expect(refused.status).toBe('rejected')
    expect(isActionValidationError((refused as PromiseRejectedResult).reason)).toBe(true)
  })

  test('a redirect and a revalidation land in the render that asked, not in the timer that answered', async () => {
    const { fetchImpl } = batchingHost((name) =>
      name === 'Guard.check' ? { redirect: '/login' } : { result: 'ok', revalidate: ['orders'] },
    )
    const call = httpHostCalls({ ...base, fetch: fetchImpl })

    const [guard, action] = await Promise.all([
      withRedirect(async (taken) => {
        await call('Guard.check').catch(() => {})

        return taken()
      }),
      withRevalidation(async (take) => {
        await call('Orders.create')

        return take()
      }),
    ])

    expect(guard?.location).toBe('/login')
    expect(action).toEqual(['orders'])
  })

  test('a host that does not know the envelope gets single calls, from the first batch on', async () => {
    // A host written to the single shape: `calls` is a call with no function.
    const { seen, fetchImpl } = stub({ error: 'A host call needs a "function" name.' }, 400)
    let replies = 0
    const fetchSingles = (async (url: any, init: any) => {
      const body = JSON.parse(String(init.body))

      if (Array.isArray(body.calls)) return fetchImpl(url, init)

      replies++
      seen.push({ url: String(url), init, headers: {}, body })

      return Response.json({ result: body.function })
    }) as unknown as typeof fetch
    const call = httpHostCalls({ ...base, fetch: fetchSingles })

    expect(await Promise.all([call('A.one'), call('B.one')])).toEqual(['A.one', 'B.one'])
    // The refused batch, then each call on its own.
    expect(seen.map((s) => s.body)).toEqual([
      { calls: [{ function: 'A.one', args: [] }, { function: 'B.one', args: [] }] },
      { function: 'A.one', args: [] },
      { function: 'B.one', args: [] },
    ])

    // Remembered: the next tick's calls never try the envelope again.
    await Promise.all([call('C.one'), call('D.one')])
    expect(seen.slice(3).map((s) => s.body)).toEqual([
      { function: 'C.one', args: [] },
      { function: 'D.one', args: [] },
    ])
    expect(replies).toBe(4)
  })

  test('a batch that cannot reach the host fails every call, and is not re-sent one by one', async () => {
    let attempts = 0
    const fetchImpl = (async () => {
      attempts++
      throw new Error('ECONNREFUSED')
    }) as unknown as typeof fetch
    const call = httpHostCalls({ ...base, fetch: fetchImpl })

    const results = await Promise.allSettled([call('A.one'), call('B.one')])

    expect(results.map((r) => r.status)).toEqual(['rejected', 'rejected'])
    expect(String((results[0] as PromiseRejectedResult).reason)).toContain('could not reach the host')
    // An action may have run on a host that then went away; sending it again
    // is worse than reporting it failed.
    expect(attempts).toBe(1)
  })

  test('batch: false never uses the envelope', async () => {
    const { seen, fetchImpl } = batchingHost((name) => ({ result: name }))
    const call = httpHostCalls({ ...base, fetch: fetchImpl, batch: false })

    await Promise.all([call('A.one'), call('B.one')])

    expect(seen.map((s) => s.body)).toEqual([
      { function: 'A.one', args: [] },
      { function: 'B.one', args: [] },
    ])
  })
})
