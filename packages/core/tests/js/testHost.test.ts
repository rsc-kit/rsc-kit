// The test host answers through the real client, so each helper must come
// out as the error, redirect or result a real backend's answer would.

import { describe, expect, test } from 'bun:test'
import { httpHostCalls } from '../../src/hostCalls'
import { hostReply, testHostFetch, type TestHost } from '../../src/testHost'
import { withRequest } from '../../src/request'
import { withRedirect } from '../../src/redirect'
import { isNotFoundSignal } from '../../src/notFound'

const client = (host: TestHost) =>
  httpHostCalls({ endpoint: 'http://test-host/__rsc/host-call', secret: 'test', fetch: testHostFetch(host) })

const failure = async (run: () => Promise<unknown>) => {
  try {
    await run()
  } catch (error) {
    return error as Error & { refusalStatus?: number; errors?: unknown }
  }

  throw new Error('expected a failure')
}

describe('a handler', () => {
  test('returns the result, and is given the arguments', async () => {
    const call = client({ 'Apps.list': ({ args }) => [{ id: args[0] }] })

    expect(await call('Apps.list', 7)).toEqual([{ id: 7 }])
  })

  test('is given the visitor headers the renderer forwards, never the secret', async () => {
    let seen: Headers | null = null
    const call = client({ 'Me.get': ({ headers }) => ((seen = headers), null) })

    await withRequest(new Request('https://app.test/', { headers: { cookie: 'session=abc' } }), () => call('Me.get'))

    expect(seen!.get('cookie')).toBe('session=abc')
    expect(seen!.get('x-rsc-host-secret')).toBeNull()
  })

  test('answers each call of a batch', async () => {
    const call = client({ 'A.one': () => 1, 'A.two': () => 2 })

    expect(await Promise.all([call('A.one'), call('A.two')])).toEqual([1, 2])
  })

  test('that is missing fails the call, naming it', async () => {
    const error = await failure(() => client({})('Apps.lsit'))

    expect(error.message).toContain('"Apps.lsit"')
  })
})

describe('the protocol answers', () => {
  test('unauthenticated and unauthorized are the engine\'s own errors', async () => {
    expect((await failure(() => client({ X: () => hostReply.unauthenticated() })('X'))).name).toBe(
      'ServerAuthenticationError',
    )
    expect((await failure(() => client({ X: () => hostReply.unauthorized() })('X'))).name).toBe(
      'ServerAuthorizationError',
    )
  })

  test('refuse carries its status', async () => {
    expect((await failure(() => client({ X: () => hostReply.refuse(429, 'Slow down.') })('X'))).refusalStatus).toBe(429)
  })

  test('a 404 is the engine\'s notFound(), so the page answers with not-found.tsx', async () => {
    const error = await failure(() => client({ X: () => hostReply.refuse(404, 'No such app.') })('X'))

    expect(isNotFoundSignal(error)).toBe(true)
  })

  test('invalid is a validation refusal, by field', async () => {
    const error = await failure(() => client({ X: () => hostReply.invalid({ name: ['Taken.'] }) })('X'))

    expect(error.errors).toEqual({ name: ['Taken.'] })
  })

  test('redirect is the engine\'s redirect', async () => {
    const taken = await withRedirect(async (seen) => {
      await failure(() => client({ X: () => hostReply.redirect('/login') })('X'))

      return seen()
    })

    expect(taken?.location).toBe('/login')
  })
})
