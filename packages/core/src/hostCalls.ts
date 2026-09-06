// Host calls over HTTP, so a host in any language can answer them.
//
// A server component writing `await rpc('Orders.recent')` needs the host
// mid-render. The Laravel path answers on a second unix socket with its own
// framing (PROTOCOL.md, "The callback channel"), which every non-JS host has
// to reimplement before it can render a single page that fetches anything.
// This is the same conversation over an ordinary POST.
//
// The transport is the only thing that changes. The engine still sees one
// function, the deferred-release ordering in streaming.ts still applies, and a
// reply may still carry `revalidate` — a Go host that answers this endpoint
// gets the same semantics the socket has, without the framing.

import { headers as incomingHeaders } from './request.js'

export interface HttpHostCallsOptions {
  /**
   * Where calls are POSTed. A loopback address or a unix socket url — see the
   * note on `secret` for why this must not be a public one.
   */
  endpoint: string
  /**
   * Sent as `X-RSC-Host-Secret`, and required rather than optional.
   *
   * This endpoint runs functions by name on behalf of a render. PROTOCOL.md
   * Part 3b draws the line at client-supplied input deciding what RUNS, and an
   * unauthenticated callback endpoint is on the wrong side of it: anyone who
   * can reach it can invoke any registered host function directly, with
   * whatever arguments they like and none of the app's routing in front. A
   * default of "off" would be the kind that ships.
   */
  secret: string
  /**
   * Request headers copied from the render's own request onto the call.
   *
   * This is what makes a host call run as the person browsing: the backend's
   * session middleware reads its cookie and finds the same user. Nothing else
   * is forwarded, because everything else is either meaningless to the backend
   * or actively wrong — `content-length` and `content-type` describe this POST,
   * not the page request.
   */
  forwardHeaders?: string[]
  /** Defaults to 30s. A render blocked on a host that never answers is a hung request. */
  timeoutMs?: number
  /** Injectable for tests and for a runtime whose fetch is not global. */
  fetch?: typeof fetch
  /** Called with whatever a reply reported as invalidated. */
  onRevalidate?: (targets: string[]) => void
}

const DEFAULT_FORWARDED = ['cookie', 'authorization']

export interface HostCallReply {
  result?: unknown
  error?: string
  revalidate?: string[]
}

/**
 * The function to hand to `installHostFn`, or to `hostCalls` on the JS host.
 */
export function httpHostCalls(
  options: HttpHostCallsOptions,
): (name: string, ...args: unknown[]) => Promise<unknown> {
  const {
    endpoint,
    secret,
    forwardHeaders = DEFAULT_FORWARDED,
    timeoutMs = 30_000,
    fetch: fetchImpl,
    onRevalidate,
  } = options

  if (!secret) {
    throw new Error('httpHostCalls requires a secret — see the note on the option.')
  }

  const forwarded = forwardHeaders.map((name) => name.toLowerCase())

  return async function hostCall(name: string, ...args: unknown[]): Promise<unknown> {
    const doFetch = fetchImpl ?? globalThis.fetch

    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'x-rsc-host-secret': secret,
    }

    // Outside a render — a prerender pass, or a host calling one directly —
    // there is no request to forward from, and that is not an error. The call
    // simply carries no session, which is exactly what a build-time render
    // should be doing.
    try {
      const from = await incomingHeaders()

      for (const key of forwarded) {
        const value = from.get(key)
        if (value !== null) headers[key] = value
      }
    } catch {
      // No request in scope.
    }

    // AbortSignal.timeout is not on every runtime this engine targets, so the
    // controller is written out rather than assumed.
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    let response: Response

    try {
      response = await doFetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({ function: name, args }),
        signal: controller.signal,
      })
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error(`Host call ${JSON.stringify(name)} timed out after ${timeoutMs}ms`)
      }

      throw new Error(
        `Host call ${JSON.stringify(name)} could not reach the host at ${endpoint}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    } finally {
      clearTimeout(timer)
    }

    // Read the body before branching on status: a host that reports the error
    // in JSON with a 500 is saying something more useful than "500", and
    // throwing on the status alone discards it.
    const text = await response.text()
    let reply: HostCallReply | null = null

    try {
      reply = text ? (JSON.parse(text) as HostCallReply) : null
    } catch {
      reply = null
    }

    if (reply?.error !== undefined) {
      throw new Error(`Host call ${JSON.stringify(name)} failed: ${reply.error}`)
    }

    if (!response.ok) {
      throw new Error(
        `Host call ${JSON.stringify(name)} failed: ${response.status} ${response.statusText}`.trim() +
          (text ? ` — ${text.slice(0, 200)}` : ''),
      )
    }

    if (reply === null) {
      throw new Error(
        `Host call ${JSON.stringify(name)} returned a body that is not JSON: ${text.slice(0, 200)}`,
      )
    }

    if (reply.revalidate?.length && onRevalidate) onRevalidate(reply.revalidate)

    return reply.result ?? null
  }
}
