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

import type { ManifestRoute, RouteManifest } from './manifest.js'
import { withRedirect } from './redirect.js'
import { withCache } from './cache.js'
import { requestReadBy, requestWasRead, withRequest } from './request.js'
import { watchNondeterminism, whileRendering } from './nondeterminism.js'

/** What a prerenderer needs from the built bundle, beyond serving a request. */
/**
 * How long the root-fallback diagnostic waits before answering.
 *
 * Short on purpose: the question is whether anything painted, not what. See
 * the call site.
 */
const ROOT_FALLBACK_BUDGET_MS = 200

/**
 * How many routes render at once.
 *
 * Each is a full React render, so this trades memory and CPU for wall time.
 * The gain flattens almost immediately — measured on a twelve-route example:
 * 10.2 s sequential, 4.1 s at four, 4.0 s at six, 4.0 s at twelve, beyond
 * which one route's own serial chain is the floor.
 *
 * Four rather than six because the difference between them is inside the
 * noise, and the smaller number leaves room for whatever else is running.
 * A build is rarely the only thing on a machine — it shares CI with other
 * jobs, and it shares a laptop with the test suite that renders its own
 * fixtures, where six was enough to turn a two-second budget into a timeout.
 */
const DEFAULT_PRERENDER_CONCURRENCY = 4

/**
 * The client components the engine itself puts around every page when the
 * bootstrap is on - the segment and slot boundaries, the title, the pathname
 * provider, the error boundary. They are in every payload, they are not the
 * app's, and a render without the bootstrap does not insert them. Anything
 * else in the list is the app's, and needs the runtime.
 */
const RUNTIME_OWN = new Set([
  'DocumentTitle',
  'PathnameProvider',
  'RouteErrorBoundary',
  'SegmentBoundary',
  'SlotBoundary',
])

/**
 * The one line the bootstrap would have run for the worker, for a document
 * stored without a bootstrap. Same timing as the runtime's: after load, so
 * it competes with nothing the first visit needs. A page whose document has
 * no closing body tag is left alone.
 */
const WORKER_REGISTRATION =
  "<script>'serviceWorker'in navigator&&addEventListener('load',function(){navigator.serviceWorker.register('/sw.js').catch(function(){})})</script>"

export function withWorkerRegistration(html: string): string {
  const at = html.lastIndexOf('</body>')

  return at === -1 ? html : html.slice(0, at) + WORKER_REGISTRATION + html.slice(at)
}

export interface PrerenderEngine {
  manifest?(): RouteManifest
  /**
   * A route.ts, answered. Optional: a bundle built before api routes existed
   * has none, and the build then simply stores no route.
   */
  handleApiRoute?(
    name: string,
    request: Request,
    params: Record<string, string>,
    allow: string,
  ): Promise<Response>
  getStaticParams?(component: string): Promise<Record<string, string>[] | null>
  handleRscPprShell(
    component: string,
    props?: Record<string, unknown>,
    layouts?: { component: string; props: Record<string, unknown> }[],
    loadings?: string[],
    parallelSlots?: Record<string, string>,
    pageKey?: string,
    /** How long to render before taking what has flushed. Defaults to the full budget. */
    budgetMs?: number,
  ): Promise<{
    shellHtml: string
    timedOut: boolean
    usedDynamicApis: boolean
    /**
     * The host calls this render made, by name.
     *
     * So the build can say which one kept the page from being frozen rather
     * than only that something did. Optional: an engine built before this
     * existed reports nothing, and the line is printed without a reason.
     */
    dynamicBecause?: string[]
    error?: string
    /**
     * Where the render stopped, when it stopped — React's own resumable state.
     *
     * Null when the page finished, which is the same thing as `timedOut` being
     * false. An engine built before this existed returns undefined, and the
     * shell is then served the way it always was: holes filled by the client
     * after hydration rather than resumed at the origin.
     */
    postponed?: unknown
    /**
     * Anything that failed while producing the shell, including a rejection a
     * Suspense boundary caught.
     *
     * Such a rejection never reaches the caller: React keeps the fallback and
     * the render finishes, so without this a page whose data source was
     * unreachable looked complete and its loading state was frozen as a
     * finished page.
     */
    renderFailure?: string
  }>
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
    /**
     * Whether a host is installed to answer rpc().
     *
     * False during a build, where there is none: every host call then suspends
     * and the page reports that it reached for one, instead of resolving to
     * undefined and being frozen holding it.
     */
    canReachHost?: boolean,
  ): Promise<{
    body: string
    rscPayload: string
    clientComponents: string[]
    /** A server action is in the tree - a form or a client prop - so a runtime is needed to submit it. */
    serverReferences?: boolean
    usedDynamicApis?: boolean
  }>
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
   * The app has a service worker. A page stored without the bootstrap has
   * nothing to register it, so one line is put in its place - the worker is
   * for the second visit, and a visitor who lands on such a page first should
   * still get one.
   */
  serviceWorker?: boolean
  /**
   * Where the output goes, as a sink rather than a directory.
   *
   * `writeTo` in `@rsc-kit/core/files` is the one for a disk, which is what a
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
  /**
   * How many routes to render at once. Defaults to 6; 1 renders sequentially.
   *
   * Worth lowering when the pages talk to something that will not enjoy six
   * concurrent callers — a local database, a rate-limited API.
   */
  concurrency?: number
  /** Identifies the build in what gets written, so a stale page can be spotted. */
  version?: string
  /** Called as each url is decided, for build output. */
  onResult?: (result: PrerenderResult) => void
}

/**
 * The build's refusal to store a route it cannot answer ahead of time.
 *
 * Thrown rather than reported, because the alternative is a category: a bucket
 * of routes that quietly render per request, which is where the slow ones go
 * to be forgotten. Every route is either stored or has said it will not be.
 */
export class NotPrerenderable extends Error {
  public readonly routes: PrerenderResult[]

  constructor(routes: PrerenderResult[]) {
    // Two different problems arrive here, and the advice for one is useless for
    // the other. A page that reads the request above every boundary needs a
    // boundary; a page whose render threw needs whatever it was reaching for.
    const threw = routes.filter((r) => r.reason?.startsWith('could not be rendered'))
    const unpaintable = routes.filter((r) => !r.reason?.startsWith('could not be rendered'))

    const advice: string[] = []

    if (unpaintable.length > 0) {
      advice.push(
        'These read request data — params, headers, cookies, or the host — above\n' +
          'every Suspense boundary, so nothing can paint without it:\n\n' +
          unpaintable.map((r) => `  ${r.url} — ${r.reason ?? 'nothing to paint'}`).join('\n') +
          '\n\nPut the part that waits inside <Suspense>, or add a loading.tsx beside\n' +
          'the page, so there is something to store while the rest arrives.',
      )
    }

    if (threw.length > 0) {
      advice.push(
        'These failed while rendering:\n\n' +
          threw.map((r) => `  ${r.url} — ${r.reason}`).join('\n') +
          '\n\nPrerendering runs your application code, so it needs whatever that code\n' +
          'needs. If the page is fine and this machine simply cannot reach a\n' +
          'database or an API, either give the build access or turn prerendering\n' +
          'off with `rscKit({ prerender: false })`.\n\n' +
          'Reaching for data through the host — `await rpc(...)` — avoids this\n' +
          'entirely: the build stubs that call, so the page freezes a shell\n' +
          'without the data being available.',
      )
    }

    super('Some routes could not be prerendered.\n\n' + advice.join('\n\n') + '\n')
    this.name = 'NotPrerenderable'
    this.routes = routes

    // Not enumerable: Vite prints an error's own properties under its stack,
    // and this list is the message again, as an object dump.
    Object.defineProperty(this, 'routes', { value: routes, enumerable: false })
  }
}

export interface PrerenderResult {
  url: string
  component: string
  /**
   * frozen — the whole page is on disk.
   * shell — the chrome is on disk and the rest is rendered per request.
   * blocked — nothing could be stored. Fails the build.
   * error — the render itself failed, or the build refused what it produced.
   *
   * dynamic — answered per request, and correctly so. Api routes only.
   *
   * There is no such outcome for a PAGE. A page that cannot be stored has its
   * boundary in the wrong place, and the fix is to move it — not to declare
   * the problem away, which is how the slow ones get forgotten. An api route
   * has no boundary to move: it either depends on the request or it does not,
   * and depending on it is the ordinary case rather than a mistake.
   */
  type: 'frozen' | 'shell' | 'blocked' | 'error' | 'dynamic'
  reason: string | null
  /**
   * Something worth knowing that is not a failure.
   *
   * The one that matters: a page whose only boundary is the root loading.tsx.
   * It is stored, so the build has nothing to refuse — but the fallback that
   * caught it belongs to the whole app rather than to this page, and every
   * page in the app shows the same thing while this one's data arrives.
   */
  warning?: string
  /** A fact about how it was stored that is neither a reason nor a warning. */
  note?: string
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

/**
 * The file name a url is stored under: / → index, /a/b → a/b.
 *
 * Refuses a key that could leave the directory it is written into. The input is
 * whatever generateStaticParams() returned — typically slugs from a database or
 * a CMS — so a record named `../../../../etc/cron.d/x` is an arbitrary file
 * write on the build machine with content the same record influences.
 *
 * Checked here rather than in the writer, because the writer is supplied by the
 * host: `writeTo` on disk does the obvious thing, but a KV or edge binding has
 * no notion of a parent directory and no reason to look for one.
 */
/**
 * The key, showing only the marks that actually appear above it.
 *
 * Wording follows Next's build output deliberately. Most people arriving here
 * have read that legend already, and inventing a second vocabulary for the same
 * three states costs them a translation for nothing.
 */
export function legend(results: { type: string }[]): string {
  const has = (type: string) => results.some((r) => r.type === type)
  const lines: string[] = []

  if (has('frozen')) {
    lines.push('  \u25CB  (Static)             prerendered as static content')
  }

  if (has('shell')) {
    lines.push(
      '  \u25D0  (Partial Prerender)  prerendered as static HTML with dynamic server-streamed content',
    )
  }

  if (has('dynamic')) {
    lines.push('  \u0192  (Dynamic)            server-rendered on demand')
  }

  if (has('error') || has('blocked')) {
    lines.push('  \u2717  (Failed)             did not render, or painted nothing — the build stops here')
  }

  return lines.join('\n')
}

/**
 * How much JavaScript a route makes the browser download.
 *
 * Gzipped, because that is what crosses the wire — uncompressed bytes are a
 * number nobody is served.
 *
 * A real per-route figure only because client components are chunked per
 * module. Grouped the way plugin-rsc groups them by default, every route in an
 * app loads every client component and this column is one number repeated down
 * the page.
 */
export function clientJsSize(bytes: number): string {
  if (bytes === 0) return 'no js'

  const kb = bytes / 1000

  return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} kB`
}

/**
 * The paragraph a mark cannot hold.
 *
 * "dynamic — called rpc(\"getUser\")" says what happened and not why the build
 * could not simply make the call, which is the first thing someone asks when a
 * page they expected to be static is not. The backend is running; the build is
 * not talking to it.
 *
 * Printed once under the summary rather than beside each route: an app where
 * every page reads from the backend would otherwise repeat the same paragraph
 * forty times.
 */
export function notes(results: { type?: string; reason?: string | null }[]): string {
  const said = (text: string) => results.some((r) => r.reason?.includes(text))
  const parts: string[] = []

  // Every route not frozen, all for one reason, is the shape a read in the
  // root layout leaves: one cookies() in a header component and nothing on
  // the site can be stored. The build cannot see which component read it -
  // only that every page did - so it says what that usually means.
  const pages = results.filter((r) => r.type && r.type !== 'error' && r.type !== 'blocked')
  const reasons = new Set(pages.map((r) => r.reason ?? ''))

  if (pages.length > 1 && !pages.some((r) => r.type === 'frozen') && reasons.size === 1) {
    const [reason] = reasons

    parts.push(
      `  Every route ${reason}. When one read makes every page dynamic it is usually\n` +
        '  in the root layout - a header reading the session, a locale from a cookie.\n' +
        '  Move that read into the component that needs it, under a <Suspense>, and\n' +
        '  the rest of the site can freeze around it.',
    )
  }

  if (said('rpc(')) parts.push(rpcNote())

  return parts.join('\n\n')
}

function rpcNote(): string {
  return (
    '  A build has no backend to call. rpc() suspends instead of answering, so a page\n' +
    '  that reads through one ships a shell and finishes for whoever asks — which is\n' +
    '  almost always what you want, since that data is rarely the same for everyone.\n' +
    '\n' +
    '  If a page really should be frozen, move the read out of rpc(). If it really\n' +
    '  should be per visitor, say so with await connection() and the intent is on the\n' +
    '  page rather than inferred from a call that happened to suspend.'
  )
}

/**
 * The one-line tally under the legend, in the legend's own words.
 */
export function summary(results: { type: string }[]): string {
  const count = (type: string) => results.filter((r) => r.type === type).length
  const parts: string[] = []

  if (count('frozen')) parts.push(`${count('frozen')} static`)
  if (count('shell')) parts.push(`${count('shell')} partial prerender`)
  if (count('dynamic')) parts.push(`${count('dynamic')} dynamic`)
  if (count('error') + count('blocked')) parts.push(`${count('error') + count('blocked')} failed`)

  return parts.join(', ') || 'nothing to store'
}

export function pathKey(url: string): string {
  const key = url.replace(/^\/+|\/+$/g, '') || 'index'

  if (key.split('/').some((segment) => segment === '..' || segment === '.')) {
    throw new Error(
      'Refusing to store ' + JSON.stringify(url) + ': the path leaves the output directory. ' +
        'A url segment came from generateStaticParams() or a route param and contains "..".',
    )
  }

  return key
}

/**
 * Substitute params into a route's segments to get a concrete url.
 *
 * A param is one segment, so a value carrying a slash is not a deeper url — it
 * is a value that was never a single segment. A catch-all is the exception and
 * is spelled as one in the route.
 */
export function urlFor(route: ManifestRoute, params: Record<string, string>): string {
  const parts = route.segments.map((segment) => {
    if (segment.type === 'static') return segment.value

    const value = params[segment.value] ?? ''

    if (segment.type !== 'catchAll' && /[/\\]/.test(value)) {
      throw new Error(
        'The ' + segment.value + ' param is ' + JSON.stringify(value) + ', which is not one url ' +
          'segment. A value with a slash in it has to be a catch-all route, or be encoded.',
      )
    }

    return value
  })

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

  const entries = await urlsToBuild(manifest, engine)
  const results: PrerenderResult[] = new Array(entries.length)

  // Rendered a few at a time rather than one after another.
  //
  // Most of a build is this loop, and most of this loop is waiting: a page
  // whose shell is decided by a two-second budget spends two seconds doing
  // nothing while the next page waits its turn. Nothing here is shared between
  // routes — the probe's stand-in host is held in async context, so concurrent
  // renders cannot see each other's — which is what makes overlapping them
  // safe, and was not true until it was scoped.
  //
  // Bounded, because each one is a full React render: unbounded would turn a
  // large site into as many concurrent renders as it has pages.
  //
  // Results are placed by index, so what a build reports does not depend on
  // which page happened to finish first.
  const concurrency = Math.max(1, options.concurrency ?? DEFAULT_PRERENDER_CONCURRENCY)
  let next = 0

  const worker = async () => {
    while (true) {
      const index = next++

      if (index >= entries.length) return

      const { route, params, url } = entries[index]

      results[index] = await prerenderOne(route, params, url)
      options.onResult?.(results[index])
    }
  }

  const unwatch = watchNondeterminism()

  try {
    await Promise.all(Array.from({ length: Math.min(concurrency, entries.length) }, worker))
  } finally {
    unwatch()
  }

  const refused = results.filter((r) => r.type === 'blocked')

  if (refused.length > 0) {
    throw new NotPrerenderable(refused)
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
    /**
     * Why this route ships a shell rather than a whole page.
     *
     * In the order that answers the question soonest. A named call is the most
     * actionable — you can go and look at it — so it wins over the two
     * structural reasons, either of which may also be true.
     */
    const shellReason = (calls: string[]): string | null => {
      if (calls.length) return 'dynamic — called ' + calls.join(', ')

      // One shell serving every url the route matches. generateStaticParams is
      // what turns it into a page per url.
      if (unlistedNow) return 'one shell for every url — add generateStaticParams to store each'

      // Nothing reached for the request; the data simply took too long. The
      // page is fine, it just finishes per visitor.
      if (shell?.timedOut) return 'data took longer than the build budget'

      return null
    }

    const said = (type: PrerenderResult['type'], reason: string | null): PrerenderResult => ({
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
    //
    // Wrapped so a redirect has somewhere to be recorded. Reading the scope
    // rather than inspecting the thrown error is the only thing that works
    // from out here: React catches what a component throws and re-raises its
    // own, whose message is stripped in production — so a redirect above the
    // boundaries arrives as a generic render failure, and one from inside a
    // boundary never arrives at all.
    // A build renders each url once, and each gets its own table: two routes
    // must not share an answer just because they were built in the same run.
    // No request, deliberately: a page that reads one is caught below rather
    // than frozen holding whatever the build machine happened to send.
    const [{ shell, redirected, readRequest, readBy }, nondeterministic] = await whileRendering(() =>
      withRequest(null, () =>
      withCache(() => withRedirect(async (taken) => {
      try {
        return {
          shell: await engine.handleRscPprShell(
            route.component,
            props,
            layouts,
            route.loadings,
            route.slots,
            // Only when this shell serves one url. A parameterised route's
            // shell is shared, so baking a url into it would put the wrong one
            // on every page but the one that happened to be built.
            unlistedNow ? '' : url,
          ),
          redirected: taken(),
          readRequest: requestWasRead(),
          // What reached for it, so the build can name the call rather than
          // only report that the page is dynamic.
          readBy: requestReadBy(),
        }
      } catch (error) {
        // A guard refusing throws out of the probe rather than being caught
        // inside it: middleware run before the render, so there is no render yet
        // to capture the failure. A refusal is a classification, not a build
        // error — the route is one that cannot be frozen.
        const refused = taken()

        if (!refused) throw error

        return { shell: null, redirected: refused, readRequest: requestWasRead(), readBy: requestReadBy() }
      }
    })),
    ),
    )

    // A page that leaves rather than renders is not a build failure, and it is
    // not something to freeze either: what would be stored is the redirect's
    // own emptiness, served for ever to everyone. Rendered on demand instead,
    // where the redirect can actually happen.
    /**
     * Did this page's own boundary catch the wait, or the app's?
     *
     * A root loading.tsx wraps every page, so a page that blocks — or throws,
     * which is how a client hook says it has no server answer — is caught
     * whatever it does. The route is stored either way and the build has
     * nothing to refuse, which makes a page whose boundary is in the wrong
     * place look exactly like one whose boundary is right.
     *
     * Asked by rendering again without the root fallback, and only for a route
     * that has no closer one.
     *
     * Only for a route that came out as a shell. A frozen one rendered to
     * completion with the root boundary present, and removing a boundary
     * cannot stop a render that already finished — so the second probe
     * finishes too, its markup is the whole document, and the emptiness test
     * cannot fire. It was being paid for anyway: a second full render of every
     * frozen page, which on a site whose pages are mostly frozen is most of
     * the prerender.
     */
    async function withRootFallbackChecked(result: PrerenderResult): Promise<PrerenderResult> {
      if (result.type !== 'shell') return result
      if (route.loadings.length !== 1 || !engine.handleRscPprShell) return result

      // A tenth of the shell budget, because this is a different question.
      //
      // Deciding what a page's shell IS means waiting out everything that can
      // resolve. Asking whether anything paints at all without the root
      // fallback is a boolean about the first flush — and a page that paints,
      // paints immediately. Given the full budget it cost two seconds a route
      // to learn what the first millisecond already said, which on this
      // example was 40% of the entire prerender.
      const withoutRoot = await withRequest(null, () =>
        withCache(() =>
          withRedirect(async () =>
            engine.handleRscPprShell(
              route.component,
              props,
              layouts,
              [],
              route.slots,
              url,
              ROOT_FALLBACK_BUDGET_MS,
            ),
          ),
        ),
      ).catch(() => null)

      if (withoutRoot && closeDocument(withoutRoot.shellHtml.trim()) === '') {
        result.warning =
          'nothing painted without the root loading.tsx — the fallback the whole app shares ' +
          'is standing in for this page. Put a boundary where the waiting is.'
      }

      return result
    }

    // A route that only redirects still has an answer to freeze — the answer
    // is the redirect, not a page. Rendering it per request re-derives a
    // constant, and on a static host there would be nothing to derive it with.
    if (redirected) {
      await write(
        `${pathKey(url)}.redirect.json`,
        JSON.stringify({ status: redirected.status, location: redirected.location }),
      )

      return said('frozen', `redirects to ${redirected.location}`)
    }

    if (!shell) return said('error', 'refused before it rendered')

    if (shell.error) return said('error', shell.error)

    // Something failed while rendering. Not necessarily the page's fault — a
    // build machine that cannot reach the database produces this, and so does a
    // genuinely broken component — so it is not fatal. It is simply not
    // something to freeze: whatever this render produced is a failure state,
    // and freezing it serves that state to everyone until the next build.
    //
    // Rendering per request is the honest answer. It works as soon as whatever
    // was missing is reachable, which at runtime it usually is.
    if (shell.renderFailure) {
      return said('blocked', `could not be rendered at build time: ${shell.renderFailure}`)
    }

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
          'blocked',
          (readRequest
            ? 'reads the request'
            : shell.usedDynamicApis
              ? 'reaches for the host'
              : 'blocks') +
            ' before anything can paint. Add a loading.tsx beside it, or put a ' +
            '<Suspense> above the waiting, and it has a skeleton to store.',
        )
      }

      await writeShell(route, url, body, shell.postponed)

      // Why it is a shell rather than a whole page. "◐ /orders" on its own
      // leaves someone reading the build output to guess what did it, which is
      // the question this line exists to answer.
      const calls = [...(shell.dynamicBecause ?? []), ...(readBy ?? [])]

      return await withRootFallbackChecked(said('shell', shellReason(calls)))
    }

    // Warned, not refused.
    //
    // A frozen `new Date()` may be exactly what the author meant — a build
    // stamp, a copyright year — and the build cannot tell that from a
    // "3 minutes ago" that will still say three minutes next month. Refusing
    // would make the honest case unbuildable in order to protect the careless
    // one, and there is no flag to add here without inventing the declaration
    // this design exists to avoid.
    //
    // So it says what happened, names what was called, and gives the repair.
    // The escape hatch is that a warning does not stop the build — which is the
    // right weight for something that is occasionally correct.
    //
    // Only for a page frozen WHOLE. On a shell the call may sit inside a hole,
    // which renders per request, where it is correct.
    const noteNondeterminism = (result: PrerenderResult): PrerenderResult => {
      if (nondeterministic.length === 0) return result

      result.warning =
        `froze ${nondeterministic.join(' and ')} — a stored page keeps whatever that ` +
        'returned at build time. If it should differ per visitor, await connection() so ' +
        'the page renders per request; if only the browser needs it, use(browser()) keeps ' +
        'it out of the build entirely.'

      return result
    }

    // Rendered whole, with params that were invented because the route listed
    // none. Freezing that stores a page whose id is literally `_`, and a shell
    // is no better: the value is in the markup rather than behind a boundary
    // the client fills. A route reaches this only by rendering its params
    // before it can paint, which is exactly the shape that cannot be shared
    // across urls.
    if (unlisted) {
      return said('blocked', 'renders its params before it can paint, and lists no urls to build')
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
      // A build has no host to answer rpc(), so every host call must suspend
      // rather than resolve. Without this they found no host at all and the
      // page was frozen holding whatever undefined rendered to — a document
      // that looks right, hydrates against an undefined prop, and blanks.
      false,
    )

    // The render reached for the host, so its data is not the same for
    // everyone and there is no build-time answer for it. Not frozen: a shell
    // is shipped instead and the page finishes for whoever asks.
    if (rendered.usedDynamicApis) {
      return said('shell', 'reaches the host for data')
    }

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

    // Nothing for a runtime to do. No client component means nothing to
    // hydrate, and no server reference means no form that would post through
    // React - so the bootstrap is 70 kB of javascript that runs and changes
    // nothing. Rendered once more without it and stored that way. Only when
    // the page declared nothing: `clientJs = true` keeps the runtime, for a
    // page that wants the service worker or the update prompt regardless.
    let note: string | undefined
    let body = rendered.body

    if (
      route.clientJs === 'auto' &&
      rendered.clientComponents.every((name) => RUNTIME_OWN.has(name)) &&
      !rendered.serverReferences
    ) {
      // Only the document. The flight payload stays the bootstrap render's:
      // a Link elsewhere navigating here fetches it and expects the segment
      // and title wrappers that render puts in, which this one leaves out.
      const bare = await engine.handleRsc(
        route.component,
        props,
        null,
        layouts,
        route.loadings,
        route.slots,
        0,
        url,
        false,
        false,
      )

      body = options.serviceWorker ? withWorkerRegistration(bare.body) : bare.body
      note = 'no client components, so ships no javascript'
    }

    const key = pathKey(url)

    await write(`${key}.html`, body)
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

    const frozen = noteNondeterminism(await withRootFallbackChecked(said('frozen', null)))

    return note ? { ...frozen, note } : frozen
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
  async function writeShell(
    route: ManifestRoute,
    url: string,
    body: string,
    postponed?: unknown,
  ): Promise<void> {
    const parameterised = route.segments.some((s) => s.type !== 'static')
    const key = parameterised && !route.staticParams ? patternKey(route) : pathKey(url)

    await write(`${key}.ppr.html`, body)

    // Written only when there is something to resume from. Its absence is
    // meaningful rather than incidental: a host that finds no postponed state
    // serves the shell and lets the client fill it, which is what every build
    // before this one did.
    if (postponed != null) {
      await write(`${key}.postponed.json`, JSON.stringify(postponed))
    }
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
