// Reading the request from inside a render.
//
//   import { headers, cookies } from '@rsc-kit/core/request'
//
//   export default async function middleware() {
//     const locale = cookies().get('locale') ?? negotiate(headers().get('accept-language'))
//     if (!locale) redirect('/en')
//   }
//
// Server components have no arguments beyond their props, and middleware has
// none at all, so without this an app on a JavaScript host cannot see a header
// — no locale negotiation, no subdomain, no cookie. The Laravel host escaped
// that through rpc(), because PHP has the request; this is the same thing for
// everyone else.
//
// Read-only on purpose. Setting a cookie means writing a response header, and
// by the time a component renders the shell may already have been flushed — an
// API that appears to set one and silently does not is worse than not having
// it. Set them in the host, which owns the response.
//
// Asynchronous on purpose too, and not for ergonomics. A build has no request,
// so a read there suspends and never settles — which is the same thing the
// prerender probe does to a host call. Anything still waiting when the probe's
// budget expires becomes a fallback in the frozen shell, so a read inside a
// Suspense boundary leaves the shell frozen and makes only that boundary
// dynamic. Reading synchronously could only mark the whole route dynamic,
// because there would be nothing to suspend on.
//
// Scoped to the request, on the same store cache() uses. Two requests in
// flight cannot see each other's headers.

import { resolveScope } from './revalidate.js'

/** What a host can supply: a real Request, or the parts of one. */
export type RequestLike = Request | { url: string; headers: Record<string, string> } | null

interface Slot {
  /** False during a build: there is nothing to answer with. */
  request: boolean
  url: string | null
  /**
   * Held as Headers rather than as a Request.
   *
   * `new Request(url, { headers })` drops Cookie: a spec-compliant Headers
   * built with the "request" guard refuses the forbidden header names, and
   * Cookie is one of them. `new Headers()` has no guard and keeps it. Bun
   * happens to allow both, which is why rebuilding a Request looked fine until
   * it ran anywhere stricter — and what it loses is every cookie, silently.
   */
  headers: Headers
  original: Request | null
  /**
   * Whether anything asked. Only for the build's report — the classification
   * comes from the suspension, not from this.
   */
  read: boolean
}

const SCOPE = Symbol.for('@rsc-kit/core.request-scope')

const globals = globalThis as Record<symbol | string, unknown>

let ready: Promise<void> | null = null

interface Scope {
  getStore(): Slot | undefined
  run<T>(store: Slot, fn: () => T): T
}

function scope(): Scope | null {
  return (globals[SCOPE] as Scope | undefined) ?? null
}

function slot(): Slot {
  const store = scope()?.getStore()

  if (!store) {
    throw new Error(
      'No request in scope. headers() and cookies() are for a render — middleware, a layout, ' +
        'a page — and there is nothing to read outside one.',
    )
  }

  store.read = true

  return store
}

/**
 * The request's headers.
 *
 * Empty during a build, where there is no request: the page is marked as
 * needing one instead, and rendered on demand rather than frozen.
 */
export async function headers(): Promise<Headers> {
  const store = slot()

  return store.request ? store.headers : never()
}

/** How a cookie should be written. The names browsers use. */
export interface CookieOptions {
  path?: string
  domain?: string
  maxAge?: number
  expires?: Date
  httpOnly?: boolean
  secure?: boolean
  sameSite?: 'strict' | 'lax' | 'none'
  partitioned?: boolean
}

export interface Cookies {
  get(name: string): string | undefined
  has(name: string): boolean
  getAll(): Record<string, string>
  /**
   * Write one on the response.
   *
   * Only from a server action, which has a response of its own that has not
   * been sent. A render has already flushed its headers by the time a
   * component runs — that is what makes the first paint fast — so this throws
   * there rather than appearing to work.
   */
  set(name: string, value: string, options?: CookieOptions): void
  /** Write one that expires immediately. Same rule about where. */
  delete(name: string, options?: CookieOptions): void
}

/** Kept for the name it had when it could only read. */
export type ReadonlyCookies = Cookies

/**
 * The response being built, while it can still be changed.
 *
 * Open from the moment a request is picked up until the host constructs its
 * Response, and sealed the instant it does. Middleware runs inside that window
 * — before any rendering starts — so a header set there is on the answer. A
 * component runs after it, during streaming, where the status line and headers
 * are already on the wire; setting one there is refused rather than dropped.
 */
interface Draft {
  headers: Headers
  sealed: boolean
}

const DRAFT = Symbol.for('@rsc-kit/core.response-draft')

let draftReady: Promise<void> | null = null

interface DraftScope {
  getStore(): Draft | undefined
  run<T>(store: Draft, fn: () => T): T
}

function draft(): DraftScope | null {
  return (globals[DRAFT] as DraftScope | undefined) ?? null
}

/** The open draft, or an explanation of why there is not one. */
function writable(what: string): Draft {
  const open = draft()?.getStore()

  if (!open) {
    throw new Error(
      `${what} needs a response that has not been sent. Middleware and server actions have one; ` +
        'a script outside a request does not.',
    )
  }

  if (open.sealed) {
    throw new Error(
      `${what} was called after the response had been sent. Headers go out before the render ` +
        'starts — that is what makes the first paint fast — so set them in middleware, which ' +
        'runs before it.',
    )
  }

  return open
}

/**
 * Headers to put on the answer.
 *
 * Mutate it as you would any Headers. `append` is the one to reach for when a
 * header may legitimately appear twice; `set` replaces.
 */
/**
 * The draft's headers, refusing writes once the response has gone.
 *
 * A proxy rather than the Headers itself: returning the live object means code
 * that captured it before the response was built can go on mutating a thing
 * nobody will read. Nothing in this package does that — the host copies the
 * headers onto the response the instant it seals — but "safe because of the
 * order two other functions happen to run in" is not a property, and an app
 * holding the object across an await would find writes silently doing nothing.
 */
function sealable(draft: Draft): Headers {
  const guard = (method: 'set' | 'append' | 'delete') =>
    (...args: [string, string]) => {
      writable('responseHeaders()')

      return (draft.headers[method] as (...a: string[]) => void)(...args)
    }

  const proxy: Headers = new Proxy(draft.headers, {
    get(target, property, receiver) {
      if (property === 'set' || property === 'append' || property === 'delete') {
        return guard(property)
      }

      // A maplike forEach passes the object it was called on as the third
      // callback argument, and binding to the target makes that the raw
      // Headers — a live, unguarded reference handed out by the very method
      // meant to be read-only. Substituted for the proxy so there is no way
      // through.
      if (property === 'forEach') {
        return (fn: (value: string, key: string, parent: Headers) => void, thisArg?: unknown) =>
          target.forEach((value, key) => fn.call(thisArg, value, key, proxy))
      }

      const value = Reflect.get(target, property, receiver)

      return typeof value === 'function' ? value.bind(target) : value
    },
  })

  return proxy
}

export function responseHeaders(): Headers {
  return sealable(writable('responseHeaders()'))
}

/**
 * Run a request with a response that can still be changed, and take what was
 * put on it.
 *
 * `seal()` is called by the host the moment it builds the Response, so
 * anything set afterwards is refused instead of silently going nowhere.
 */
export async function withResponseDraft<T>(
  run: (draft: { taken: () => Headers; seal: () => void }) => Promise<T>,
): Promise<T> {
  if (!globals[DRAFT]) {
    draftReady ??= resolveScope().then((resolved) => {
      globals[DRAFT] ??= resolved as unknown as DraftScope
    })

    await draftReady
  }

  const open: Draft = { headers: new Headers(), sealed: false }

  return await draft()!.run(open, () =>
    run({
      taken: () => open.headers,
      seal: () => {
        open.sealed = true
      },
    }),
  )
}

/**
 * A cookie name, as RFC 6265 defines one: a token, so no separators at all.
 *
 * Checked rather than escaped because there is no escaping — a name is not a
 * quoted string. An app that derives one from user input (`pref_${key}`) would
 * otherwise let that input close the pair and open another: a name of
 * `session=attacker; Path=/; HttpOnly; x` serializes to a header whose *first*
 * pair is a session cookie the caller chose, and the browser reads the first.
 */
const COOKIE_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/

/** No separator may appear in an attribute either, for the same reason. */
const COOKIE_ATTRIBUTE = /[;,\r\n]/

/** `name=value; Path=/; HttpOnly` — the header a browser expects. */
export function serializeCookie(cookie: { name: string; value: string; options: CookieOptions }): string {
  if (!COOKIE_NAME.test(cookie.name)) {
    throw new Error(
      `Not a usable cookie name: ${JSON.stringify(cookie.name)}. ` +
        'A name is a token — letters, digits and !#$%&\'*+-.^_`|~ — with no spaces, ' +
        'semicolons or equals signs. Nothing escapes them, so one cannot be encoded around.',
    )
  }

  if (cookie.options.sameSite !== undefined) {
    const value = String(cookie.options.sameSite).toLowerCase()

    if (value !== 'strict' && value !== 'lax' && value !== 'none') {
      throw new Error(
        `Not a SameSite value: ${JSON.stringify(cookie.options.sameSite)}. ` +
          'It is written into the header as given, so anything else becomes further attributes.',
      )
    }
  }

  for (const [attribute, value] of [
    ['path', cookie.options.path],
    ['domain', cookie.options.domain],
    // Trusted because it is typed as a Date — but a cast reaches this, and the
    // result lands in the header verbatim like the others.
    ['expires', cookie.options.expires?.toUTCString()],
  ] as const) {
    if (typeof value === 'string' && COOKIE_ATTRIBUTE.test(value)) {
      throw new Error(
        `The cookie ${attribute} ${JSON.stringify(value)} contains a separator. ` +
          'It would be read as further attributes rather than as part of this one.',
      )
    }
  }

  const parts = [`${cookie.name}=${encodeURIComponent(cookie.value)}`]
  const o = cookie.options

  if (o.maxAge !== undefined) parts.push(`Max-Age=${Math.floor(o.maxAge)}`)
  if (o.expires) parts.push(`Expires=${o.expires.toUTCString()}`)
  // Defaulted, because a cookie without one is scoped to the path that set it
  // — a session written by POST /_rsc/action would not be sent for any page.
  parts.push(`Path=${o.path ?? '/'}`)
  if (o.domain) parts.push(`Domain=${o.domain}`)
  if (o.sameSite) parts.push(`SameSite=${o.sameSite[0].toUpperCase()}${o.sameSite.slice(1)}`)
  if (o.secure) parts.push('Secure')
  if (o.httpOnly) parts.push('HttpOnly')
  if (o.partitioned) parts.push('Partitioned')

  return parts.join('; ')
}

export async function cookies(): Promise<Cookies> {
  const parsed = parseCookies((await headers()).get('cookie') ?? '')

  const write = (name: string, value: string, options: CookieOptions = {}): void => {
    // Appended, never set: several cookies on one response are several
    // Set-Cookie headers, and replacing would leave only the last.
    writable('cookies().set()').headers.append(
      'Set-Cookie',
      serializeCookie({ name, value, options }),
    )
  }

  return {
    get: (name) => parsed[name],
    has: (name) => name in parsed,
    getAll: () => ({ ...parsed }),
    set: write,
    // Expired rather than removed: a browser drops a cookie when it is told
    // one has already passed, and there is no other way to say it.
    delete: (name, options = {}) => write(name, '', { ...options, maxAge: 0 }),
  }
}

/**
 * The whole request, for a host-specific need the accessors do not cover.
 *
 * Null on a host that forwards only the parts — the worker behind Laravel has
 * a socket, not a request. Use headers() and cookies(), which work everywhere.
 */
export async function request(): Promise<Request | null> {
  const store = slot()

  return store.request ? store.original : never()
}

/**
 * Mark everything below as belonging to the request, not to the build.
 *
 *     export default async function Orders() {
 *       await connection()
 *
 *       const rows = await db.query('select * from orders')
 *
 *       return <ul>{rows.map(...)}</ul>
 *     }
 *
 * At build time this never resolves, so nothing after it runs: the query is not
 * made, the boundary above becomes a hole, and the rest of the page still
 * freezes. At request time it resolves immediately and the component runs
 * normally.
 *
 * **Once is enough.** It is a barrier, not a wrapper — everything after it in
 * this component belongs to the request, however many calls that is. Repeating
 * it before each query does nothing.
 *
 * It needs a boundary above it. With a <Suspense> or a loading.tsx there is a
 * fallback to store and the page becomes a shell; with neither, nothing can
 * paint and the build refuses the route rather than storing a blank.
 *
 * Reach for it when the build should not run something — a database the build
 * machine cannot see, or a value that must differ per visitor. A query the
 * build CAN run, whose answer is the same for everyone, wants none of this: it
 * should be frozen.
 *
 * The same name and behaviour as Next's `connection()`.
 */
export async function connection(): Promise<void> {
  const store = slot()

  // No request means a build. Suspend rather than continue, the same way
  // headers() and cookies() do.
  if (!store.request) return never()
}

/** The url this request was made to, whichever way the host supplied it. */
export async function url(): Promise<string | null> {
  const store = slot()

  return store.request ? store.url : never()
}

function parseCookies(header: string): Record<string, string> {
  const out: Record<string, string> = {}

  for (const part of header.split(';')) {
    const eq = part.indexOf('=')

    if (eq === -1) continue

    const name = part.slice(0, eq).trim()

    if (!name) continue

    // Decoded because that is how they were written. A malformed escape is
    // left as it arrived rather than throwing the render away.
    const raw = part.slice(eq + 1).trim()

    try {
      out[name] = decodeURIComponent(raw)
    } catch {
      out[name] = raw
    }
  }

  return out
}

/**
 * Run one request with its headers readable.
 *
 * `null` is the build: a scope with nothing in it, so a page that reads is
 * caught rather than silently frozen holding whatever the machine that built
 * it happened to send.
 */
export async function withRequest<T>(from: RequestLike, run: () => Promise<T>): Promise<T> {
  if (!globals[SCOPE]) {
    ready ??= resolveScope().then((resolved) => {
      globals[SCOPE] ??= resolved as unknown as Scope
    })

    await ready
  }

  const isRequest = from instanceof Request
  const store: Slot = {
    request: from !== null,
    url: from ? (isRequest ? from.url : from.url) : null,
    headers: from ? (isRequest ? from.headers : new Headers(from.headers)) : new Headers(),
    original: isRequest ? from : null,
    read: false,
  }

  return await scope()!.run(store, run)
}

/**
 * A promise that never settles, so the caller suspends.
 *
 * What a read does during a build. React treats it exactly as it treats a host
 * call that never answers: the component suspends, its Suspense fallback goes
 * into the shell, and the probe's budget decides the rest.
 */
function never(): Promise<never> {
  slot().read = true

  return new Promise(() => {})
}

/**
 * Whether anything read the request during the scope that is open.
 *
 * For the prerenderer, which opens one with no request and asks afterwards.
 */
export function requestWasRead(): boolean {
  return scope()?.getStore()?.read ?? false
}

/**
 * The query string, as a page receives it.
 *
 * Derived from the request rather than passed down the render, so no host has
 * to forward it separately — and so it suspends during a build for the same
 * reason every other read does. A frozen page cannot know the query it will be
 * asked for.
 */
export async function searchParams(): Promise<URLSearchParams> {
  const from = await url()

  return from ? new URL(from).searchParams : new URLSearchParams()
}
