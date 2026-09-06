// Host calls over HTTP — the transport that lets a host in another language
// answer `rpc()` without implementing the socket framing.
//
// These assert on the request the transport sends and what it makes of the
// reply, against a fetch stand-in. The end of the wire is a Go server in
// adapters/go; what is pinned here is the contract that server implements.

import { describe, expect, test } from 'bun:test'
import { httpHostCalls } from '../../src/hostCalls'
import { withRequest } from '../../src/request'

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

  test('a result of null stays null rather than becoming undefined', async () => {
    const { fetchImpl } = stub({ result: null })
    expect(await httpHostCalls({ ...base, fetch: fetchImpl })('X.y')).toBeNull()
  })
})
