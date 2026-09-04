// Rendering pages at build time, for a JavaScript host.
//
// The engine does the rendering; this decides what to render and what to do
// with the result. Two decisions, and both are easy to get subtly wrong:
//
// Which urls exist — a route with no params is one url, a route with params is
// however many `generateStaticParams` returns, and a route with params that
// declares none cannot be prerendered at all.
//
// Whether a page can be frozen — asked by rendering it, never declared. The
// shell probe replaces the host global with a promise that never resolves, so
// a page that reaches for request data suspends and says so by doing it. A
// page that simply takes too long says so by not finishing.
//
// The file layout matches the one Laravel writes, so both hosts serve the same
// shapes and anything that reads them works for either.

import type { ManifestRoute, RouteManifest } from './manifest.ts'

/** What a prerenderer needs from the built bundle, beyond serving a request. */
export interface PrerenderEngine {
  manifest?(): RouteManifest
  getStaticParams?(component: string): Promise<Record<string, string>[] | null>
  handleRscPprShell(
    component: string,
    props?: Record<string, unknown>,
    layouts?: { component: string; props: Record<string, unknown> }[],
    loadings?: string[],
    parallelSlots?: Record<string, string>,
  ): Promise<{ shellHtml: string; timedOut: boolean; usedDynamicApis: boolean; error?: string }>
  handleRsc(
    component: string,
    props?: Record<string, unknown>,
    callbackSocket?: string | null,
    layouts?: { component: string; props: Record<string, unknown> }[],
    loadings?: string[],
    parallelSlots?: Record<string, string>,
    from?: number,
    pageKey?: string,
    bootstrap?: boolean,
  ): Promise<{ body: string; rscPayload: string; clientComponents: string[] }>
  handleRscPayload(
    component: string,
    props?: Record<string, unknown>,
    layouts?: { component: string; props: Record<string, unknown> }[],
    loadings?: string[],
    parallelSlots?: Record<string, string>,
    from?: number,
    pageKey?: string,
  ): Promise<{ rscPayload: string }>
}

export interface PrerenderOptions {
  engine: PrerenderEngine
  /**
   * Where the output goes, as a sink rather than a directory.
   *
   * `writeTo` in `@rsc-router/core/files` is the one for a disk, which is what a
   * build normally wants. A function because the read side is one — a host
   * that supplies a reader should be able to supply the matching writer —
   * and because a test can hand it a Map instead of a temp directory.
   */
  write: (name: string, contents: string) => Promise<void> | void
  /** The route table. Defaults to the one the bundle carries. */
  manifest?: RouteManifest
  /**
   * Props for a page at build time.
   *
   * There is no request here, which is the point: anything a page needs that
   * only a request can supply is exactly what makes it un-freezable. Defaults
   * to the url params alone.
   */
  props?: (route: ManifestRoute, params: Record<string, string>) => Record<string, unknown>
  /** Identifies the build in what gets written, so a stale page can be spotted. */
  version?: string
  /** Called as each url is decided, for build output. */
  onResult?: (result: PrerenderResult) => void
}

export interface PrerenderResult {
  url: string
  component: string
  /**
   * static — frozen whole. ppr — a shell was frozen and the client fills the
   * rest. dynamic — rendered on demand. error — refused.
   */
  type: 'static' | 'ppr' | 'dynamic' | 'error'
  reason: string | null
}

/**
 * The file name a route's shell is stored under, with params standing in for
 * themselves: /posts/[slug] → posts/_slug_.
 *
 * A shell contains nothing that varies by param — everything that does is
 * behind a boundary the client fills — so one shell serves every url the
 * route matches, including the ones the app never listed.
 */
export function patternKey(route: ManifestRoute): string {
  const parts = route.segments.map((s) => (s.type === 'static' ? s.value : `_${s.value}_`))

  return parts.join('/') || 'index'
}

/** Close a document the render was aborted in the middle of. */
export function closeDocument(html: string): string {
  let out = html

  if (!/<\/body>/i.test(out) && /<body/i.test(out)) out += '</body>'
  if (!/<\/html>/i.test(out) && /<html/i.test(out)) out += '</html>'

  return out
}

/** The file name a url is stored under: / → index, /a/b → a/b. */
export function pathKey(url: string): string {
  return url.replace(/^\/+|\/+$/g, '') || 'index'
}

/** Substitute params into a route's segments to get a concrete url. */
export function urlFor(route: ManifestRoute, params: Record<string, string>): string {
  const parts = route.segments.map((segment) =>
    segment.type === 'static' ? segment.value : (params[segment.value] ?? ''),
  )

  return '/' + parts.filter((p) => p !== '').join('/')
}

/**
 * Every url this build should attempt, and the params each was built from.
 *
 * A parameterised route that declares no `generateStaticParams` yields
 * nothing — not an error: rendering on demand is a legitimate answer, and the
 * alternative is guessing at slugs the app never listed.
 */
/** Stand-in values for a route whose real urls were never listed. */
function placeholders(route: ManifestRoute): Record<string, string> {
  const params: Record<string, string> = {}

  for (const segment of route.segments) {
    if (segment.type !== 'static') params[segment.value] = '_'
  }

  return params
}

export async function urlsToBuild(
  manifest: RouteManifest,
  engine: PrerenderEngine,
): Promise<{ route: ManifestRoute; params: Record<string, string>; url: string }[]> {
  const entries: { route: ManifestRoute; params: Record<string, string>; url: string }[] = []

  for (const route of manifest.routes) {
    const parameterised = route.segments.some((s) => s.type !== 'static')

    if (!parameterised) {
      entries.push({ route, params: {}, url: urlFor(route, {}) })
      continue
    }

    // A route that lists no urls still gets one attempt, with placeholder
    // params, so it can ship a shell. Nothing in a shell varies by param.
    if (!route.staticParams) {
      entries.push({ route, params: placeholders(route), url: urlFor(route, placeholders(route)) })
      continue
    }

    const sets = (await engine.getStaticParams?.(route.component)) ?? null

    // Null means the route declares none, so it is rendered on demand. An
    // empty array means the app looked and there is nothing to build — both
    // produce no files, and only one of them is a mistake to warn about.
    if (!sets) continue

    for (const params of sets) {
      entries.push({ route, params, url: urlFor(route, params) })
    }
  }

  return entries
}

export async function prerender(options: PrerenderOptions): Promise<PrerenderResult[]> {
  const { engine, write, version } = options
  const manifest = options.manifest ?? engine.manifest?.()

  if (!manifest) {
    throw new Error('No route table. Pass `manifest`, or build with a plugin version that embeds one.')
  }

  const results: PrerenderResult[] = []

  for (const { route, params, url } of await urlsToBuild(manifest, engine)) {
    const result = await prerenderOne(route, params, url)

    results.push(result)
    options.onResult?.(result)
  }

  return results

  async function prerenderOne(
    route: ManifestRoute,
    params: Record<string, string>,
    url: string,
  ): Promise<PrerenderResult> {
    const props = options.props ? options.props(route, params) : params
    const layouts = route.layouts.map((component) => ({ component, props: {} }))
    const unlistedNow = route.segments.some((seg) => seg.type !== 'static') && !route.staticParams
    const said = (type: PrerenderResult['type'], reason: string | null) => ({
      // A route standing in for many urls reports the pattern. Reporting the
      // placeholder url instead prints `/posts/_`, which looks like a page.
      url: unlistedNow ? '/' + patternKey(route) : url,
      component: route.component,
      type,
      reason,
    })

    const unlisted = route.segments.some((seg) => seg.type !== 'static') && !route.staticParams

    // Classify by rendering, never by asking. The probe is cheap and cannot
    // hang: anything still suspended when its budget expires is the answer.
    const shell = await engine.handleRscPprShell(
      route.component,
      props,
      layouts,
      route.loadings,
      route.slots,
    )

    if (shell.error) return said('error', shell.error)

    // A timeout is the ordinary path for a page that streams, not a failure:
    // the probe hands the page a host global that never resolves, React
    // flushes everything that does not depend on it, and the abort happens
    // once there is nothing left to flush. So the captured markup IS the
    // shell — layouts, static content, and the fallbacks standing in for what
    // has not arrived.
    if (shell.timedOut) {
      const body = closeDocument(shell.shellHtml.trim())

      // Nothing was flushed before the page blocked, so there is no shell to
      // ship — a page that blocks above every boundary can only be rendered on
      // demand. `reaches for the host` is the specific reason when both are
      // true; a page that merely ran long says the other thing.
      if (body === '') {
        return said(
          'dynamic',
          shell.usedDynamicApis
            ? 'blocks on the host before anything can paint'
            : 'did not paint anything in time',
        )
      }

      await writeShell(route, url, body)

      return said('ppr', null)
    }

    // Rendered whole, with params that were invented because the route listed
    // none. Freezing that stores a page whose id is literally `_`, and a shell
    // is no better: the value is in the markup rather than behind a boundary
    // the client fills. A route reaches this only by rendering its params
    // before it can paint, which is exactly the shape that cannot be shared
    // across urls.
    if (unlisted) {
      return said('dynamic', 'renders its params before it can paint, and lists no urls to build')
    }

    const shipsJs = route.clientJs !== false

    const rendered = await engine.handleRsc(
      route.component,
      props,
      null,
      layouts,
      // Not empty: a page whose layout declares a parallel slot renders without
      // it otherwise, and nothing says so — the page comes out whole apart from
      // the missing region.
      route.loadings,
      route.slots,
      0,
      url,
      shipsJs,
    )

    // A client component without a runtime is inert markup — a button that
    // does nothing. Refused rather than shipped, and named, because they are
    // usually inherited from a shared layout rather than written on the page.
    if (!shipsJs && rendered.clientComponents.length > 0) {
      return said(
        'error',
        `ships no client runtime, but the tree renders ${rendered.clientComponents.join(', ')}. ` +
          'These usually come from a shared layout rather than the page itself.',
      )
    }

    const key = pathKey(url)

    await write(`${key}.html`, rendered.body)
    await write(`${key}.flight`, rendered.rscPayload)

    // One variant per depth the client might already hold. Without them every
    // navigation to a prerendered route is a whole document, which replaces the
    // root and unmounts the pages retained behind it — so going back does not
    // restore the form you were filling in. Most routes in a real app are
    // prerendered, which makes this the common path rather than an edge case.
    for (let depth = 1; depth <= route.layouts.length; depth++) {
      const { rscPayload } = await engine.handleRscPayload(
        route.component,
        props,
        layouts,
        route.loadings,
        route.slots,
        depth,
        url,
      )

      await write(`${key}.seg${depth}.flight`, rscPayload)
    }

    await write(
      `${key}.meta.json`,
      JSON.stringify({ layouts: route.layouts, component: route.component, version: version ?? null }, null, 2),
    )

    return said('static', null)
  }

  /**
   * Freeze a shell, under the url when it is one and under the route's pattern
   * when it stands for many.
   *
   * A route whose urls were never listed still gets a shell: nothing in it
   * varies by param, so the same markup is correct for every url the route
   * matches. That is most of the value — the routes you can enumerate are the
   * ones you could already freeze whole.
   */
  async function writeShell(route: ManifestRoute, url: string, body: string): Promise<void> {
    const parameterised = route.segments.some((s) => s.type !== 'static')
    const key = parameterised && !route.staticParams ? patternKey(route) : pathKey(url)

    await write(`${key}.ppr.html`, body)
    await write(
      `${key}.ppr-meta.json`,
      JSON.stringify(
        { layouts: route.layouts, component: route.component, parameterised, version: version ?? null },
        null,
        2,
      ),
    )
  }

}
