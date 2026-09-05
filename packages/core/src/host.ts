// Everything a JavaScript host has to do to serve the RSC engine.
//
// PHP needs ~2,400 lines for this because it cannot run JavaScript: a socket
// bridge, a worker pool, a frame protocol. A JS host imports the engine and
// calls it, and what remains is the part every host would otherwise rewrite —
// matching a url to a route, negotiating how much of the page to send, and
// speaking the header protocol the client expects.
//
// Deliberately not Hono, or Express, or anything: this takes a Request and
// returns a Response, so it runs under Bun.serve, Deno, Workers, Node's
// fetch adapters and any framework built on them. `./hono` is the three-line
// binding for one of them.
//
//   const rsc = createRscHandler({ engine, manifest, assets })
//   Bun.serve({ fetch: (req) => rsc(req).then((r) => r ?? new Response('', { status: 404 })) })

import { matchIntercept, matchRoute, retentionKey, sharedDepth } from './routing.js'
import { pathKey, patternKey } from './prerender.js'
import { withRevalidation } from './revalidate.js'
export { revalidate } from './revalidate.js'
import { withRedirect } from './redirect.js'
import { withCache } from './cache.js'
import { withRequest, withResponseDraft } from './request.js'
import type { Redirection } from './redirect.js'
export { redirect } from './redirect.js'
// Re-exported, not redefined: routing.ts is the one implementation, shared with
// the prerenderer and the generated bundle, and this stays the adapter's
// public surface so a host imports from one place.
export { matchIntercept, matchRoute, sharedDepth } from './routing.js'
export type { MatchedRoute } from './routing.js'
import { FLIGHT_TYPE, HEADER, HTML_TYPE, PER_CLIENT, REVALIDATE, VARY_ON_RSC } from './headers.js'
import type { MatchedRoute } from './routing.js'
import type { RouteManifest } from './manifest.js'

/** The built server bundle. Only the parts a host calls. */
export interface RscEngine {
  /** The route table this bundle was built from. */
  manifest?(): RouteManifest
  installHostFn(fn: (name: string, ...args: unknown[]) => unknown): void
  handleRscStream(
    component: string,
    props?: Record<string, unknown>,
    layouts?: { component: string; props: Record<string, unknown> }[],
    loadings?: string[],
    parallelSlots?: Record<string, string>,
    slotOverrides?: Record<string, unknown>,
    from?: number,
    pageKey?: string,
  ): Promise<{ stream: ReadableStream; segmentDepth: number }>
  handleRscHtmlStream(
    component: string,
    props?: Record<string, unknown>,
    layouts?: { component: string; props: Record<string, unknown> }[],
    loadings?: string[],
    parallelSlots?: Record<string, string>,
    slotOverrides?: Record<string, unknown>,
    nonce?: string,
    pageKey?: string,
    bootstrap?: boolean,
  ): Promise<{ htmlStream: ReadableStream }>
  handleRscRevalidate?(target: string, page: unknown): Promise<{ rscPayload: string }>
  /**
   * Run a route's middleware without rendering anything.
   *
   * For a frozen page: the host reads it from disk and the engine never sees
   * the request, so the check has to be asked for separately.
   */
  runRouteMiddleware?(component: string, props: Record<string, unknown>): Promise<void>
  handleAction(
    actionId: string,
    body: Uint8Array | string | FormData,
    contentType?: string,
    page?: unknown,
    takeRevalidated?: () => string[],
  ): Promise<{ stream: ReadableStream }>
}

export interface RscHostOptions {
  /** The built server bundle — `import * as engine from './build/rsc/index.js'`. */
  engine: RscEngine
  /**
   * The route table. Defaults to the one the bundle was built with, which is
   * almost always what you want — a manifest passed separately can go stale
   * against the bundle it is describing.
   */
  manifest?: RouteManifest
  /**
   * Functions the app's server components call as `await rpc('name', ...args)`.
   *
   * In the Laravel host this crosses a socket into PHP. Here they are just
   * functions, which is the whole reason a JS host is smaller.
   */
  rpc?: Record<string, (...args: unknown[]) => unknown>
  /**
   * Props for a page, given whatever its url bound.
   *
   * Defaults to the url params alone. A host that loads a user, reads a
   * session or resolves a tenant does it here — this is the one place the
   * engine cannot supply anything for.
   */
  props?: (match: MatchedRoute, request: Request) => Record<string, unknown> | Promise<Record<string, unknown>>
  /**
   * Reads what the prerenderer wrote, if this build has any.
   *
   * A function rather than a directory, because not every host has a
   * filesystem: on an edge runtime these live in a KV store or a static-asset
   * binding. `prerenderedFrom` in `@rsc-router/core/files` is the one for a disk.
   *
   * Checked before rendering, and anything it cannot find falls through to
   * being rendered now — so a partial prerender is a valid state, not a
   * broken one.
   */
  prerendered?: (name: string) => Promise<string | null> | string | null
  /** Serve a built browser asset. Return null for anything not found. */
  assets?: (pathname: string, request: Request) => Promise<Response | null> | Response | null
  /**
   * Identifies this build to the client, which compares it on every
   * navigation and falls back to a full load when it changes. Without one a
   * client keeps talking to a deployment that no longer exists — worst behind
   * a CDN, where the shell it holds may already be from an older build.
   */
  version?: string
}

/**
 * The answer to a redirect that was decided before anything was written.
 *
 * A document gets a real status code. A payload request must NOT: `fetch`
 * follows a 3xx transparently, so the client would receive the destination's
 * HTML and hand it to the Flight decoder, which reports its own confusion
 * rather than the redirect. It gets 204 and a header instead, and navigates
 * itself — which is also what makes the redirect an SPA one.
 */
/**
 * A string safe to write inside a <script> element.
 *
 * `JSON.stringify` escapes for JavaScript, and this is not a JavaScript
 * context — it is HTML that happens to contain JavaScript. The parser ends the
 * element at the first `</script`, wherever it appears, so a destination
 * carrying one closes the tag and whatever follows is markup the browser runs.
 *
 * That destination is routinely computed rather than written — redirect()
 * documents "remembering where someone was going and sending them back to it"
 * as the usual case, which is a query string or a cookie arriving verbatim
 * here. U+2028 and U+2029 are escaped too: legal in JSON, line terminators in
 * JavaScript.
 */
function inScript(value: string): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}

function redirectResponse(to: Redirection, isPayloadRequest: boolean): Response {
  if (isPayloadRequest) {
    return new Response(null, {
      status: 204,
      headers: { [HEADER.redirect]: to.location, Vary: VARY_ON_RSC },
    })
  }

  return new Response(null, {
    status: to.status,
    headers: { Location: to.location, Vary: VARY_ON_RSC },
  })
}

/**
 * Append the redirect a render asked for after its shell had already gone out.
 *
 * The status line is spent by then, so the instruction travels in the body. A
 * script rather than waiting for hydration to notice the error digest: it runs
 * as the browser parses it, which is sooner, and it is the only path that
 * works at all for a route shipping no client runtime.
 *
 * Read on flush, because that is when the render has finished and a redirect
 * from inside a Suspense boundary is finally known.
 */
function appendLateRedirect(
  stream: ReadableStream,
  taken: () => Redirection | null,
): ReadableStream {
  // An engine that answered with a finished body rather than a stream has no
  // late window at all: the render was over before this was called, so the
  // caller's own check already saw everything there was to see.
  if (typeof stream?.getReader !== 'function') return stream

  const encoder = new TextEncoder()
  const reader = stream.getReader()

  // Read-and-re-emit rather than pipeThrough(new TransformStream(...)): a
  // TransformStream from a different realm than the stream it is piped into
  // is rejected outright, and a host embedded in a runtime that supplies its
  // own web streams is exactly that case.
  return new ReadableStream({
    async pull(controller) {
      const { done, value } = await reader.read()

      if (!done) {
        controller.enqueue(value)

        return
      }

      const to = taken()

      // replace, so Back does not return to a url that redirected.
      if (to) {
        controller.enqueue(encoder.encode(`<script>location.replace(${inScript(to.location)})</script>`))
      }

      controller.close()
    },
    cancel(reason) {
      return reader.cancel(reason)
    },
  })
}

export function createRscHandler(options: RscHostOptions): (request: Request) => Promise<Response | null> {
  const { engine, assets, version } = options
  // Annotated rather than inferred: the narrowing below is lost inside the
  // closures that use it, and every one of them runs after the throw.
  const manifest: RouteManifest | undefined = options.manifest ?? engine.manifest?.()

  if (!manifest) {
    throw new Error(
      'No route table. Pass `manifest`, or build with a plugin version that embeds one in the bundle.',
    )
  }

  const routes: RouteManifest = manifest

  // Only when this host has functions of its own. Installing unconditionally
  // overwrites whatever was already registered — a prerenderer sharing the
  // same engine instance, or a host that set its own up first — and the
  // symptom is every call failing as unregistered.
  if (options.rpc) installHostFunctions(options.rpc)

  function installHostFunctions(fns: NonNullable<RscHostOptions['rpc']>): void {
    engine.installHostFn(async (name: string, ...args: unknown[]) => {
      const fn = fns[name]

      if (!fn) {
        // Louder than returning null: a typo in a server component otherwise
        // renders as missing data with nothing anywhere saying why.
        throw new Error(
          `No host function named ${JSON.stringify(name)}. Registered: ${Object.keys(fns).join(', ') || '(none)'}`,
        )
      }

      return await fn(...args)
    })
  }

  async function propsFor(match: MatchedRoute, request: Request): Promise<Record<string, unknown>> {
    return options.props ? await options.props(match, request) : match.params
  }

  /** The page a server action was invoked from, so it can re-render regions of it. */
  function pageContext(match: MatchedRoute, props: Record<string, unknown>) {
    return {
      component: match.route.component,
      props,
      layouts: match.route.layouts.map((component) => ({ component, props: {} })),
      loadings: match.route.loadings,
      parallelSlots: match.route.slots,
      // What may be named in X-RSC-Revalidate — see renderRevalidated.
      sections: match.route.sections,
    }
  }

  function withVersion(headers: Record<string, string>): Record<string, string> {
    return version ? { ...headers, [HEADER.version]: version } : headers
  }

  // A build made for export ships a client that asks for payloads by url,
  // because a static host cannot read a header. Serving that build from a
  // server is a reasonable thing to do — previewing an export, or one build
  // used both ways — and without this every navigation 404s in the console
  // while the page itself looks fine.
  const payloadName = manifest.build?.payloadName || ''

  /**
   * The page a payload url belongs to, if this is one.
   *
   * Both the whole-document name and the depth variants beside it: a client
   * built for export asks for index.seg1.rsc when it already holds a layout,
   * and matching only the plain name leaves that as a 404 no page reports.
   */
  const payloadNames = new RegExp(
    '/' + payloadName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/^index\\\./, 'index(\\.seg\\d+)?\\.') + '$',
  )

  function pageForPayload(pathname: string): string | null {
    if (payloadName === '') return null

    const match = payloadNames.exec(pathname)

    if (!match) return null

    return pathname.slice(0, match.index) || '/'
  }

  // One memo table per request, opened at the outermost point so that
  // everything below shares it: middleware, layouts, the page, and an action. A
  // guard that reads the session and a layout that reads it again are one
  // query, not two.
  return async function handle(request: Request): Promise<Response | null> {
    return await withRequest(request, () =>
      withCache(() =>
        // Open for the whole request and sealed the moment an answer exists,
        // so middleware — which runs before any rendering — can put headers on
        // it, and a component, which runs after, is told why it cannot.
        withResponseDraft(async ({ taken, seal }) => {
          const response = await route(request)

          seal()

          if (!response) return null

          const collected = taken()

          collected.forEach((value, name) => {
            // Set-Cookie is applied below, once per cookie: iterating a Headers
            // gives it joined in some runtimes and per-cookie in others, and a
            // joined one is a single malformed cookie the browser discards.
            if (name.toLowerCase() === 'set-cookie') return

            // set, not append: a middleware asking for a header means that
            // value, not that value added to whatever the host already chose.
            response.headers.set(name, value)
          })

          // Appended, because several cookies are several headers.
          for (const cookie of collected.getSetCookie()) {
            response.headers.append('Set-Cookie', cookie)
          }

          return response
        }),
      ),
    )
  }

  async function route(request: Request): Promise<Response | null> {
    let url = new URL(request.url)
    const asPayload = pageForPayload(url.pathname)

    if (asPayload !== null) {
      // Rewritten to the page it is asking about, with the header the rest of
      // this handler reads — one path through, however the client asked.
      url = new URL(asPayload + url.search, url.origin)
      const headers = new Headers(request.headers)

      headers.set(HEADER.rsc, '1')
      request = new Request(url, { method: request.method, headers })
    }

    if (assets) {
      const asset = await assets(url.pathname, request)

      if (asset) return asset
    }

    if (request.method === 'POST' && url.pathname === HEADER.actionPath) {
      return await handleAction(request, url)
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') return null

    // One named region of this page, asked for without mutating anything to
    // earn it. What an action invalidated does not come through here — that
    // travels back inside the action's own answer, which is the whole point of
    // marking rather than telling the client to go and ask.
    const revalidating = request.headers.get(HEADER.revalidate)

    if (revalidating !== null && request.headers.get(HEADER.rsc) !== null) {
      return await handleRevalidate(request, url, revalidating)
    }

    // An intercepted navigation renders the page you are already on, with the
    // interceptor dropped into one of its slots — so the modal opens over it
    // and the url changes. Only ever on a client navigation: a hard load has
    // no referer to open over and gets the real page.
    const interceptSlot = request.headers.get(HEADER.intercept)

    if (interceptSlot !== null && request.headers.get(HEADER.rsc) !== null) {
      return await handleIntercept(request, url, interceptSlot)
    }

    // Only now. A frozen page is a whole page, and both requests above ask for
    // something smaller than one: answering a named region with the whole
    // document puts the entire page inside that region, and answering an
    // interception with it replaces the page the modal was opening over.
    const match = matchRoute(routes, url.pathname)

    if (options.prerendered) {
      // A guarded route can still be frozen: whether the content is the same
      // for everyone, and whether this caller may see it, are different
      // questions. The build answers the first; this answers the second, and
      // only then is the frozen page handed over.
      const refusal = await refuseUnlessAllowed(request, match)

      if (refusal) return refusal

      const frozen = await servePrerendered(request, url, options.prerendered)

      if (frozen) return frozen
    }

    if (!match) return null

    const props = await propsFor(match, request)
    const layouts = match.route.layouts.map((component) => ({ component, props: {} }))
    const chain = match.route.layouts

    // A payload request says so with a header on the page's own url, so one
    // route serves both the document and the navigation that follows it.
    if (request.headers.get(HEADER.rsc) === null) {
      // Scoped to this render, so two requests redirecting at once cannot read
      // each other's destination.
      return await withRedirect(async (taken) => {
        // Awaited, and that await is the whole design: React resolves this
        // when the SHELL is ready, so a redirect thrown above every Suspense
        // boundary rejects here — before a byte is written, with a status line
        // still available. Nothing is buffered to make that true.
        let htmlStream: ReadableStream

        try {
          ;({ htmlStream } = await engine.handleRscHtmlStream(
            match.route.component,
            props,
            layouts,
            match.route.loadings,
            match.route.slots,
            {},
            undefined,
            url.pathname,
            // A route that ships no runtime gets no bootstrap and no segment
            // boundary — the boundary is itself a client component, so leaving
            // it in means no page could ever be JS-free.
            match.route.clientJs !== false,
          ))
        } catch (error) {
          // A rejected shell is how a redirect above every boundary arrives:
          // React could not finish the shell, because the component that would
          // have produced it left instead.
          //
          // The scope decides, not the error. React catches what a component
          // threw and re-raises its own — whose message is stripped in
          // production — so testing the caught value for a redirect signal
          // fails exactly where it matters, and the answer is a 500 with the
          // destination sitting in a scope nobody read.
          const refused = taken()

          if (refused) return redirectResponse(refused, false)

          throw error
        }

        const early = taken()

        if (early) return redirectResponse(early, false)

        return new Response(appendLateRedirect(htmlStream, taken), {
          headers: withVersion({
            'Content-Type': HTML_TYPE,
            [HEADER.layouts]: chain.join(','),
            Vary: VARY_ON_RSC,
            'Cache-Control': match.route.middleware?.length ? PER_CLIENT : REVALIDATE,
          }),
        })
      })
    }

    const from = sharedDepth(request.headers.get(HEADER.segments), chain)

    // Proposed by the host, decided by the engine: an interceptor can force a
    // wider render than the client asked for, so what goes back is the depth
    // that came out, never the one that went in.
    return await withRedirect(async (taken) => {
      let stream: ReadableStream
      let segmentDepth: number

      try {
        ;({ stream, segmentDepth } = await engine.handleRscStream(
          match.route.component,
          props,
          layouts,
          match.route.loadings,
          match.route.slots,
          {},
          from,
          url.pathname,
        ))
      } catch (error) {
        // Same reasoning as the document path: what the render recorded is
        // reliable, what React re-raised is not.
        const refused = taken()

        if (refused) return redirectResponse(refused, true)

        throw error
      }

      const early = taken()

      // 204 and a header. A payload request that redirected later than this
      // carries the destination in the error digest instead, and the client's
      // RedirectBoundary performs it.
      if (early) return redirectResponse(early, true)

      return new Response(stream, {
        headers: withVersion({
          'Content-Type': FLIGHT_TYPE,
          [HEADER.segmentDepth]: String(segmentDepth),
          [HEADER.layouts]: chain.join(','),
          Vary: VARY_ON_RSC,
          'Cache-Control': PER_CLIENT,
        }),
      })
    })
  }

  /**
   * A page rendered at build time, if there is one for this url.
   *
   * The payload has to match the depth the client shares, not simply exist.
   * Serving the whole document to a client that already holds the layouts
   * replaces the root — and replacing the root unmounts everything retained
   * behind it, so going back stops restoring what you had.
   */
  async function servePrerendered(
    request: Request,
    url: URL,
    source: NonNullable<RscHostOptions['prerendered']>,
  ): Promise<Response | null> {
    const key = pathKey(url.pathname)
    const read = async (name: string) => await source(name)

    // Before anything else: a route that only redirects was frozen as the
    // redirect itself, so there is no page under this url and never will be.
    const frozenRedirect = await read(`${key}.redirect.json`)

    if (frozenRedirect !== null) {
      const to = JSON.parse(frozenRedirect) as { status: number; location: string }

      return redirectResponse(to, request.headers.get(HEADER.rsc) !== null)
    }

    if (request.headers.get(HEADER.rsc) === null) {
      // A frozen page first; then a shell, under this url or under the route's
      // pattern. Nothing in a shell varies by param, so one shell serves every
      // url its route matches — which is the only way a route whose urls were
      // never listed gets anything frozen at all.
      const route = matchRoute(routes, url.pathname)
      const html =
        (await read(`${key}.html`)) ??
        (await read(`${key}.ppr.html`)) ??
        (route ? await read(`${patternKey(route.route)}.ppr.html`) : null)

      return html === null
        ? null
        : new Response(html, {
            headers: withVersion({
                  'Content-Type': HTML_TYPE,
                  Vary: VARY_ON_RSC,
                  'Cache-Control': route?.route.middleware?.length ? PER_CLIENT : REVALIDATE,
                }),
          })
    }

    // Only the document is ever served frozen for a shell. The payload is what
    // fills it in, and it has to be rendered now — answering with a frozen one
    // would hand back the same fallbacks the shell already shows, and the page
    // would never finish loading.

    const meta = await read(`${key}.meta.json`)

    // Both or neither: without the chain there is no way to know which depth a
    // payload is for, and guessing means handing the client a segment for a
    // boundary it does not have.
    if (meta === null) return null

    const chain = (JSON.parse(meta).layouts ?? []) as string[]
    const shared = sharedDepth(request.headers.get(HEADER.segments), chain)

    // The variant for exactly this depth, or the whole document. Anything else
    // would be a payload for a boundary the client is not holding.
    const variant = shared > 0 ? await read(`${key}.seg${shared}.flight`) : null
    const payload = variant ?? (await read(`${key}.flight`))

    if (payload === null) return null

    return new Response(payload, {
      headers: withVersion({
        'Content-Type': FLIGHT_TYPE,
        [HEADER.segmentDepth]: String(variant ? shared : 0),
        [HEADER.layouts]: chain.join(','),
        Vary: VARY_ON_RSC,
        'Cache-Control': PER_CLIENT,
      }),
    })
  }

  /**
   * The middleware of a route, or null to go ahead.
   *
   * Used wherever a render can be reached without the engine running the chain
   * itself: a page served from disk, and an interception, which renders a
   * component the route table did not choose.
   *
   * Asked before anything is read or rendered — the answer to a refusal must
   * not be a page that has already been fetched.
   */
  async function refuseUnlessAllowed(
    request: Request,
    match: MatchedRoute | null,
  ): Promise<Response | null> {
    if (!match?.route.middleware?.length) return null

    // A route that declares middleware and an engine that cannot run it is not
    // "no middleware" — it is a check that silently does not happen. Refusing
    // is the only safe reading, and it names the cause rather than serving the
    // guarded page. Reachable when a host runs a bundle built by an older
    // plugin, where the export did not exist.
    if (!engine.runRouteMiddleware) {
      return new Response(
        'This route declares middleware, and the engine cannot run it. ' +
          'Rebuild the app against the current @rsc-router/core.',
        { status: 500 },
      )
    }

    const asPayload = request.headers.get(HEADER.rsc) !== null

    return await withRedirect(async (taken) => {
      try {
        await engine.runRouteMiddleware!(match.route.component, await propsFor(match, request))
      } catch (error) {
        const refused = taken()

        if (refused) return redirectResponse(refused, asPayload)

        throw error
      }

      const refused = taken()

      return refused ? redirectResponse(refused, asPayload) : null
    })
  }

  async function handleRevalidate(request: Request, url: URL, target: string): Promise<Response> {
    if (!engine.handleRscRevalidate) {
      return new Response('This build cannot revalidate', { status: 501 })
    }

    const match = matchRoute(routes, url.pathname)

    if (!match) return new Response('No such page', { status: 404 })

    // Scoped like the render paths: a guard above the target may refuse, and
    // that refusal is an answer rather than a failure.
    return await withRedirect(async (taken) => {
      let rscPayload: string

      try {
        ;({ rscPayload } = await engine.handleRscRevalidate!(
          target,
          pageContext(match, await propsFor(match, request)),
        ))
      } catch (error) {
        const refused = taken()

        if (refused) return redirectResponse(refused, true)

        throw error
      }

      const refused = taken()

      if (refused) return redirectResponse(refused, true)

      return new Response(rscPayload, {
        headers: withVersion({
          'Content-Type': FLIGHT_TYPE,
          // Echoed so the client can tell which region it is holding.
          [HEADER.revalidate]: target,
          Vary: VARY_ON_RSC,
          'Cache-Control': 'private, no-store',
        }),
      })
    })
  }

  async function handleIntercept(request: Request, url: URL, slot: string): Promise<Response> {
    const intercept = matchIntercept(routes, url.pathname, slot)

    if (!intercept) return new Response('No interceptor for this url', { status: 404 })

    // The guards of the route being intercepted, before anything is rendered.
    //
    // An interceptor exists to show the same resource as the route it stands in
    // for — a modal over /orders/[id] shows that order. So it has to be behind
    // the same checks, and nothing else in this path runs them: the engine is
    // handed the interceptor component, which the route table did not choose
    // and whose middleware chain is keyed off manifest().routes, where an
    // interceptor does not appear.
    //
    // Derived from the url, never from X-RSC-Referer. The referer is a header
    // the caller writes, and guarding by it means the caller picks the guard.
    const intercepted = matchRoute(routes, url.pathname)

    // Nothing to guard means nothing to serve. A url that matches an
    // interceptor but no route has no middleware chain to consult, so there is
    // no way to know whether this caller may see it — and an interceptor
    // stands in for a route, so a url with no route behind it is not a page
    // anyone was entitled to open a modal over.
    if (!intercepted) return new Response('No such page', { status: 404 })

    const refusal = await refuseUnlessAllowed(request, intercepted)

    if (refusal) return refusal

    const referer = request.headers.get(HEADER.referer)
    const under = referer ? matchRoute(routes, new URL(referer, url.origin).pathname) : null

    // Without a page to open over there is nothing to intercept: render the
    // interceptor on its own rather than answering with the wrong page.
    const component = under ? under.route.component : intercept.component
    const props = under ? await propsFor(under, request) : intercept.params
    const chain = under ? under.route.layouts : []
    const slots = under ? under.route.slots : {}
    const loadings = under ? under.route.loadings : []

    // The interceptor alone, when there is a page to open it over and this
    // build can render a region on its own.
    //
    // Re-rendering the page underneath would put the modal on screen at the
    // cost of rebuilding everything below the layout that declares the slot —
    // so opening a modal from a half-filled form throws the form away. The
    // page beneath is already mounted and correct; only the slot is new.
    if (under && engine.handleRscRevalidate) {
      const { rscPayload } = await engine.handleRscRevalidate(slot, {
        component: under.route.component,
        // The target's params, not the page's: a modal for /posts/hello opened
        // from /feed is about hello.
        props: intercept.params,
        layouts: [],
        loadings: [],
        // Named as the slot so the renderer finds it there, but pointing at
        // the interceptor rather than the default this route would otherwise
        // fill it with.
        parallelSlots: { [slot]: intercept.component },
      })

      return new Response(rscPayload, {
        headers: withVersion({
          'Content-Type': FLIGHT_TYPE,
          // Says what this payload is, so the client puts it in the slot
          // instead of treating it as a segment of the page.
          [HEADER.revalidate]: slot,
          Vary: VARY_ON_RSC,
          // Per-client by construction: which region this is was chosen by a
          // request header, so a shared cache has nothing useful to key on.
          'Cache-Control': 'private, no-store',
        }),
      })
    }

    const { stream, segmentDepth } = await engine.handleRscStream(
      component,
      props,
      chain.map((layout) => ({ component: layout, props: {} })),
      loadings,
      slots,
      {},
      sharedDepth(request.headers.get(HEADER.segments), chain),
      retentionKey(url.pathname, slot),
    )

    return new Response(stream, {
      headers: withVersion({
        'Content-Type': FLIGHT_TYPE,
        [HEADER.segmentDepth]: String(segmentDepth),
        [HEADER.layouts]: chain.join(','),
        Vary: VARY_ON_RSC,
        'Cache-Control': PER_CLIENT,
      }),
    })
  }

  async function handleAction(request: Request, url: URL): Promise<Response> {
    const actionId = request.headers.get(HEADER.action)

    if (!actionId) return new Response('Missing X-RSC-Action', { status: 400 })

    // The body travels as application/octet-stream so a host that parses
    // multipart cannot consume it first; its real type rides in a header.
    const body = new Uint8Array(await request.arrayBuffer())
    const contentType = request.headers.get(HEADER.contentType) ?? 'text/plain;charset=UTF-8'

    // Where it was invoked from, so anything the action invalidates can be
    // re-rendered against the page that is actually on screen.
    const referer = request.headers.get(HEADER.referer)
    const match = referer ? matchRoute(routes, new URL(referer, url.origin).pathname) : null
    const page = match ? pageContext(match, await propsFor(match, request)) : undefined

    // Scoped to this action: revalidate() called anywhere inside it, at any
    // depth, marks here and nowhere else — two requests can be in flight and
    // marking is per-request state.
    const { stream } = await withRevalidation((taken) =>
      engine.handleAction(actionId, body, contentType, page, taken),
    )

    return new Response(stream, {
      headers: withVersion({ 'Content-Type': 'text/x-component; charset=utf-8' }),
    })
  }
}
