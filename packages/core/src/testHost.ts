// A backend for tests: answers rpc() calls and host middleware the way a Go
// or Laravel host answers them over HTTP, without one running.
//
// The app under test talks to it through the real client, httpHostCalls,
// handed a fetch that answers in-process. So a test exercises what ships -
// batching, a redirect raised as the engine's own, an unauthenticated reply
// becoming a 401 - and only the backend is stood in for.

import type { HostCallReply } from './hostCalls.js'

const REPLY = Symbol.for('rsc-kit.test-host-reply')

/** The name the engine asks a host's route guards under. */
export const HOST_MIDDLEWARE = '__rsc.middleware'

/** What a test handler is given: the call's arguments, and the headers the renderer forwarded. */
export interface HostCallInput {
  args: unknown[]
  /** The visitor's request headers the renderer passed on - the cookie, the Accept-Language. */
  headers: Headers
}

/** Answers one function. Return a value for its result, or one of `hostReply`'s answers. */
export type HostHandler = (call: HostCallInput) => unknown

/**
 * The backend's functions, by the name rpc() calls them with.
 *
 * Route guards declared for the host are asked as `__rsc.middleware`
 * (`HOST_MIDDLEWARE`), with the guard names as the first argument; answer
 * `true` to let the page render. Anything else refuses, as a real host's
 * answer would.
 */
export type TestHost = Record<string, HostHandler>

type Reply = Omit<HostCallReply, 'result'> & { [REPLY]: true }

const reply = (fields: Omit<Reply, typeof REPLY>): Reply => ({ ...fields, [REPLY]: true })

/**
 * The protocol's own answers, for a handler to return.
 *
 *     host: {
 *       'Apps.list': ({ headers }) =>
 *         headers.get('cookie')?.includes('session=') ? [{ id: 1 }] : hostReply.unauthenticated(),
 *       'Apps.create': ({ args }) => hostReply.invalid({ name: ['Taken.'] }),
 *     }
 */
export const hostReply = {
  /** No session: the page answers 401, an action its auth error. */
  unauthenticated: (message?: string): Reply => reply({ unauthenticated: true, error: message }),
  /** A session that still may not: 403. */
  unauthorized: (message?: string): Reply => reply({ unauthorized: true, error: message }),
  /** Send the visitor somewhere else, as the host's redirect does. */
  redirect: (to: string, status = 307): Reply => reply({ redirect: to, redirectStatus: status }),
  /** Refuse with a status - a 404 for a record this caller cannot see, a 429. */
  refuse: (status: number, message = 'Refused.'): Reply => reply({ error: message, refusalStatus: status }),
  /** The input was refused, by field: an action returns these as validationErrors. */
  invalid: (errors: Record<string, string[]>): Reply => reply({ validationErrors: errors }),
  /** A result, and the regions of the page the call says it changed. */
  revalidating: (result: unknown, ...targets: string[]): Reply =>
    reply({ result, revalidate: targets } as Omit<Reply, typeof REPLY>),
} as const

function isReply(value: unknown): value is Reply {
  return typeof value === 'object' && value !== null && (value as Record<symbol, unknown>)[REPLY] === true
}

async function answer(host: TestHost, name: string, args: unknown[], headers: Headers): Promise<HostCallReply> {
  const handler = host[name]

  // Fails the call rather than answering null: a function the test forgot
  // is a test that would otherwise pass against nothing.
  if (!handler) {
    return {
      error:
        name === HOST_MIDDLEWARE
          ? `the page asked its host guards (${JSON.stringify(args[0])}) and the test host has no "${HOST_MIDDLEWARE}" handler`
          : `the test host has no handler for ${JSON.stringify(name)}`,
    }
  }

  const value = await handler({ args, headers })

  if (isReply(value)) {
    const { [REPLY]: _, ...fields } = value

    return fields
  }

  return { result: value === undefined ? null : value }
}

/**
 * A fetch that answers the host-call endpoint from `host`: one call as
 * itself, a batch as `{ replies }`, in order.
 */
export function testHostFetch(host: TestHost): typeof fetch {
  return (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers)
    const body = JSON.parse(String(init?.body ?? '{}')) as
      | { function: string; args?: unknown[] }
      | { calls: { function: string; args?: unknown[] }[] }

    // The renderer's own headers are not the visitor's.
    headers.delete('x-rsc-host-secret')
    headers.delete('content-type')

    const json = (value: unknown) =>
      new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } })

    if ('calls' in body) {
      return json({
        replies: await Promise.all(body.calls.map((c) => answer(host, c.function, c.args ?? [], headers))),
      })
    }

    return json(await answer(host, body.function, body.args ?? [], headers))
  }) as typeof fetch
}
