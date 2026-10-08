/**
 * Declining on purpose, with data the page can act on.
 *
 * A delete refused because something is still attached: the message is meant
 * to be seen, and the attached things are what the dialog links to. Neither a
 * validation error - the input was fine - nor a failure, whose message
 * onError replaces.
 */

import { describe, expect, test } from 'bun:test'
import { z } from 'zod'
import { createActionClient, refuse } from '../../src/action'
import { httpHostCalls } from '../../src/hostCalls'
import { queryRefusal } from '../../src/query'

const action = createActionClient({ onError: () => 'Something went wrong.' })
const blockers = z.object({ blockers: z.array(z.object({ id: z.number(), href: z.string() })) })

describe('refuse()', () => {
  test('arrives as the message beside the checked data', async () => {
    const remove = action
      .input(z.object({ id: z.number() }))
      .refusal(blockers)
      .handler(async ({ input, refuse }) => {
        return refuse('Still in use', { blockers: [{ id: input.id + 1, href: '/orders/2' }] })
      })

    expect(await remove({ id: 1 })).toEqual({
      serverError: 'Still in use',
      refusal: { blockers: [{ id: 2, href: '/orders/2' }] },
    })
  })

  test("its message is never replaced by onError's", async () => {
    const remove = action.handler(async () => refuse('That slot was just taken'))

    expect(await remove()).toEqual({ serverError: 'That slot was just taken' })
  })

  test('from a middleware, or anything the handler calls', async () => {
    const quota = action
      .refusal(z.object({ plan: z.string() }))
      .use(async () => refuse('Over your plan', { plan: 'free' }))
      .handler(async () => 'never')

    expect(await quota()).toEqual({ serverError: 'Over your plan', refusal: { plan: 'free' } })
  })

  test('data with no declared schema never reaches the page', async () => {
    const error = console.error
    const said: string[] = []

    console.error = (...args: unknown[]) => void said.push(args.map(String).join(' '))

    try {
      const remove = action.handler(async () => refuse('Still in use', { secret: 'internal' }))

      expect(await remove()).toEqual({ serverError: 'Still in use' })
      expect(said.join('\n')).toContain('declares no .refusal(schema)')
    } finally {
      console.error = error
    }
  })

  test('data the schema does not accept is a bug in the server, answered as one', async () => {
    const remove = action.refusal(blockers).handler(async () => refuse('Still in use', { blockers: 'nope' } as never))

    expect(await remove()).toEqual({ serverError: 'Something went wrong.' })
  })

  test('a read keeps the message, and carries the checked data on the error', async () => {
    const read = action.refusal(z.object({ plan: z.string() })).query(async () => refuse('Upgrade to see this', { plan: 'pro' }))
    const error = (await read().catch((e) => e)) as Error & { refusal?: unknown }

    expect(error.message).toBe('Upgrade to see this')
    expect(error.refusal).toEqual({ plan: 'pro' })
  })
})

describe('a backend refusal with data', () => {
  const reply = (body: unknown, status: number) =>
    (async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })) as never

  test('reaches the action as its own refusal, checked against the same schema', async () => {
    const call = httpHostCalls({
      endpoint: 'http://backend.test/_rsc/call',
      secret: 's',
      fetch: reply({ error: 'Still in use', refusalStatus: 409, refusalData: { blockers: [{ id: 3, href: '/orders/3' }] } }, 409),
    })
    const remove = action.refusal(blockers).handler(async () => call('Projects.delete', 1))

    expect(await remove()).toEqual({
      serverError: 'Still in use',
      refusal: { blockers: [{ id: 3, href: '/orders/3' }] },
    })
  })

  test('without data, its message still reaches the form', async () => {
    const call = httpHostCalls({
      endpoint: 'http://backend.test/_rsc/call',
      secret: 's',
      fetch: reply({ error: 'Busy, try again in a minute', refusalStatus: 503 }, 503),
    })
    const remove = action.handler(async () => call('Projects.delete', 1))

    expect(await remove()).toEqual({ serverError: 'Busy, try again in a minute' })
  })

  test('without a status, it is a failure, and onError says what the person sees', async () => {
    const call = httpHostCalls({
      endpoint: 'http://backend.test/_rsc/call',
      secret: 's',
      fetch: reply({ error: 'SQLSTATE[HY000]: connection refused' }, 500),
    })
    const remove = action.handler(async () => call('Projects.delete', 1))

    expect(await remove()).toEqual({ serverError: 'Something went wrong.' })
  })
})

describe('turned away by the backend', () => {
  const reply = (body: unknown, status: number) =>
    (async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })) as never
  const backend = (body: unknown, status: number) =>
    httpHostCalls({ endpoint: 'http://backend.test/_rsc/call', secret: 's', fetch: reply(body, status) })

  const cases = [
    ['signed out', { unauthenticated: true, error: 'Unauthenticated.' }, 401, 'Unauthenticated.'],
    ['not allowed', { unauthorized: true, error: 'You do not own this team.' }, 403, 'You do not own this team.'],
    ['nothing there', { error: 'Team not found', refusalStatus: 404 }, 404, 'Team not found'],
  ] as const

  for (const [what, body, status, message] of cases) {
    test(`${what}: an action answers with the backend's message`, async () => {
      const call = backend(body, status)
      const remove = action.handler(async () => call('Teams.delete', 1))

      expect(await remove()).toEqual({ serverError: message })
    })

    test(`${what}: a read rejects with it as it was, for the page to answer ${status}`, async () => {
      const call = backend(body, status)
      const read = action.query(async () => call('Teams.show', 1))
      const answered = queryRefusal(await read().catch((e) => e))

      expect(answered).toEqual({ status, message })
    })
  }

  test('a read refused with a status answers that status, its message and its checked data', async () => {
    const call = backend({ error: 'Over your plan', refusalStatus: 402, refusalData: { plan: 'free', secret: 'x' } }, 402)
    const read = action.refusal(z.object({ plan: z.string() })).query(async () => call('Reports.show', 1))

    expect(queryRefusal(await read().catch((e) => e))).toEqual({
      status: 402,
      message: 'Over your plan',
      refusal: { plan: 'free' },
    })
  })

  test('a read that failed is still a failure', async () => {
    const call = backend({ error: 'SQLSTATE[HY000]: connection refused' }, 500)
    const read = action.query(async () => call('Reports.show', 1))
    const error = (await read().catch((e) => e)) as Error

    expect(error.message).toBe('Something went wrong.')
    expect(queryRefusal(error)).toBeNull()
  })
})
