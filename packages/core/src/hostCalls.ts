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
import { revalidate } from './revalidate.js'
import { ActionValidationError } from './action.js'
import { redirect } from './redirect.js'
import { ServerAuthenticationError, ServerAuthorizationError } from './js/errors.js'

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
  /**
   * What to do with whatever a reply reported as invalidated.
   *
   * Defaults to marking it on the engine, which is the only thing that makes
   * `Revalidate(ctx, "orders")` on the host side mean anything: an action's
   * answer carries the re-rendered region only if the target reached the
   * revalidation scope before the action returned. Without it a host reports
   * what it dirtied, nothing listens, and the browser is told nothing — the
   * page simply shows stale data with no error anywhere.
   */
  onRevalidate?: (targets: string[]) => void
}

const DEFAULT_FORWARDED = ['cookie', 'authorization']

export interface HostCallReply {
  result?: unknown
  error?: string
  revalidate?: string[]
  /**
   * Field name to messages, when the host refused the input.
   *
   * The same shape everything else here already uses: Laravel's own
   * `$e->errors()`, the socket protocol's `validation_errors`, and what
   * `issuesToErrors` turns a Standard Schema result into. Dot-joined for a
   * nested field, the empty string for a message about the form rather than
   * any one field.
   */
  validationErrors?: Record<string, string[]>
  /** The caller has no session. Becomes the engine's own authentication error. */
  unauthenticated?: boolean
  /** The caller has a session and still may not. */
  unauthorized?: boolean
  /**
   * Where the host says this request should go instead.
   *
   * Answered with a 200 and this field, never as a 3xx: fetch follows a
   * redirect transparently, so a real one would send the host call itself to
   * the destination and hand whatever came back to the render as the
   * function's result.
   */
  redirect?: string
  /** The status to redirect with. Defaults to 307, which preserves the method. */
  redirectStatus?: number
  /**
   * The status a refusal should be answered with.
   *
   * A middleware that aborted meant what it aborted with — throttle answers
   * 429, a signed-url check 403 — and collapsing those to 500 makes a
   * rate-limited visitor indistinguishable from a broken server.
   */
  refusalStatus?: number
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
    //
    // Only that one condition is swallowed. A blanket catch here is the wrong
    // shape: anything else going wrong while reading the request would come
    // out as a call with no session, which is not a failure the caller sees —
    // it is the visitor silently becoming anonymous, and the page rendering as
    // though they were logged out.
    try {
      const from = await incomingHeaders()


      for (const key of forwarded) {
        const value = from.get(key)
        if (value !== null) headers[key] = value
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)

      if (!message.startsWith('No request in scope')) throw error
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

    // Refusing the input is not the call failing — it is the call answering.
    //
    // Thrown rather than returned, so a handler stops where it is instead of
    // carrying on with data the host rejected. createActionClient catches this
    // on the way out and returns { validationErrors }, which is the shape
    // useForm reads: React serialises a REJECTED server action opaquely, so a
    // validation error that stays thrown reaches the browser as "an error
    // occurred" with every field it named gone.
    //
    // Checked before `error`, so a host that sends both is read as a refusal
    // rather than as a failure with no fields.
    if (reply?.validationErrors) {
      throw new ActionValidationError(reply.validationErrors)
    }

    // Raised as the engine's own redirect, so it travels the path every other
    // redirect travels — a real 3xx above a Suspense boundary, the digest
    // below one — rather than becoming an error the page has to interpret.
    if (reply?.redirect) {
      redirect(reply.redirect as never, reply.redirectStatus ?? 307)
    }

    if (reply?.unauthenticated) {
      throw new ServerAuthenticationError(reply.error ?? 'Unauthenticated.')
    }

    if (reply?.unauthorized) {
      throw new ServerAuthorizationError(reply.error ?? 'This action is unauthorized.')
    }

    if (reply?.error !== undefined) {
      const failure = new Error(`Host call ${JSON.stringify(name)} failed: ${reply.error}`)

      // Carried on the error rather than thrown as another class: the host
      // chose a status and the only job here is not to lose it on the way to
      // whoever writes the response.
      if (reply.refusalStatus) {
        ;(failure as Error & { refusalStatus?: number }).refusalStatus = reply.refusalStatus
      }

      throw failure
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

    if (reply.revalidate?.length) {
      if (onRevalidate) onRevalidate(reply.revalidate)
      else for (const target of reply.revalidate) revalidate(target)
    }

    return reply.result ?? null
  }
}
