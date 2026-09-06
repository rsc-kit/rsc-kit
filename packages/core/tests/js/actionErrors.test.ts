/**
 * What a failed server action gives back.
 *
 * The response is JSON or a redirect header, never a Flight stream. Handing
 * one to the Flight decoder does not surface the server's message — it
 * surfaces the decoder's own confusion, which is what reached applications:
 * "enqueueModel is not a function" for a refusal that had a perfectly good
 * message attached, and "Connection closed." for a validation failure whose
 * field errors had arrived intact.
 */

import { describe, expect, test } from 'bun:test'
import {
  ServerRedirectError,
  ServerValidationError,
  reportClientFailure,
  throwForFailedAction,
  throwForFailedPayload,
} from '../../src/js/errors'
import { createActionClient, isActionValidationError } from '../../src/action'

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })

describe('a failed action response', () => {
  test('a stream is left alone to be decoded', async () => {
    await expect(throwForFailedAction(new Response('flight', { status: 200 }))).resolves.toBeUndefined()
  })

  test('a validation failure keeps its message and field errors', async () => {
    const response = json(422, {
      message: 'Everyone asks for socks.',
      errors: { title: ['Everyone asks for socks.'] },
    })

    const err = await throwForFailedAction(response).catch((e) => e)

    expect(err).toBeInstanceOf(ServerValidationError)
    expect((err as ServerValidationError).message).toBe('Everyone asks for socks.')
    expect((err as ServerValidationError).errors).toEqual({ title: ['Everyone asks for socks.'] })
  })

  test('a redirect is a location, whatever the status', async () => {
    // An expired session answers this way. The destination is the login page,
    // not a message for a form to display.
    const response = new Response('', { status: 401, headers: { 'X-RSC-Redirect': '/login' } })

    const err = await throwForFailedAction(response).catch((e) => e)

    expect(err).toBeInstanceOf(ServerRedirectError)
    expect((err as ServerRedirectError).location).toBe('/login')
  })

  test('a redirect wins over the status it arrived with', async () => {
    const response = json(422, { message: 'ignored' }, { 'X-RSC-Redirect': '/login' })

    expect(await throwForFailedAction(response).catch((e) => e)).toBeInstanceOf(ServerRedirectError)
  })

  test('anything else says what the status was', async () => {
    const err = await throwForFailedAction(new Response('', { status: 500 })).catch((e) => e)

    expect((err as Error).message).toContain('500')
  })

  test('a 422 with no body still produces a validation error', async () => {
    // Never let a malformed body turn a refusal into a parse crash.
    const err = await throwForFailedAction(new Response('not json', { status: 422 })).catch((e) => e)

    expect(err).toBeInstanceOf(ServerValidationError)
    expect((err as ServerValidationError).errors).toEqual({})
  })
})

describe('a failed page payload', () => {
  test('a good response is left to be decoded', () => {
    expect(() => throwForFailedPayload(new Response('flight', { status: 200 }))).not.toThrow()
  })

  test('a failure says what the status was', () => {
    // A PPR route's shell is real HTML with a 200, and everything below its
    // Suspense boundaries arrives in a second request. When that one fails
    // there is nothing on screen to say so: the skeletons just stay.
    expect(() => throwForFailedPayload(new Response('', { status: 500 }))).toThrow('500')
  })
})

describe('reporting a failure nothing else will', () => {
  test('is announced as well as logged', async () => {
    // An app that wants to replace a stuck skeleton with something honest has
    // no other way to find out.
    const { registerDom } = await import('./dom')
    registerDom()

    const seen: unknown[] = []
    const listener = (e: Event) => seen.push((e as CustomEvent).detail)
    window.addEventListener('rsc-client-error', listener)

    const original = console.error
    const logged: unknown[] = []
    console.error = (...args: unknown[]) => logged.push(args)

    try {
      reportClientFailure('the server could not render this page', new Error('boom'))
    } finally {
      console.error = original
      window.removeEventListener('rsc-client-error', listener)
    }

    expect(seen).toHaveLength(1)
    expect((seen[0] as { scope: string }).scope).toBe('the server could not render this page')
    expect(logged).toHaveLength(1)
  })
})

describe('a refusal raised by another copy of the module', () => {
  // An app's actions are bundled separately from the engine, so each has its
  // own copy of this class. instanceof compares identity across that seam and
  // is false — and the refusal is then reported as a server error, so the form
  // shows "Something went wrong" instead of naming the fields. Everything
  // works and nothing logs, which is why this is pinned rather than trusted.
  test('is still recognised, because the mark is what identifies it', async () => {
    const foreign = new Error('Validation failed') as Error & Record<symbol, unknown>

    foreign.name = 'ActionValidationError'
    ;(foreign as { errors?: unknown }).errors = { name: ['Already taken.'] }
    foreign[Symbol.for('@rsc-kit/core.action-validation')] = true

    expect(isActionValidationError(foreign)).toBe(true)

    const run = createActionClient({ onError: () => 'Something went wrong.' }).handler(async () => {
      throw foreign
    })

    expect(await run({})).toEqual({ validationErrors: { name: ['Already taken.'] } })
  })

  test('an ordinary error is still an ordinary error', async () => {
    expect(isActionValidationError(new Error('boom'))).toBe(false)
    expect(isActionValidationError(null)).toBe(false)
    expect(isActionValidationError({ errors: {} })).toBe(false)
  })
})
