// File-based routing for React Server Components, as a Vite plugin.
//
// Host-agnostic by design: it discovers an app/ route tree, generates the three
// entries, and exposes a render contract over a global the host installs. What
// that global is called, and how a route declares dynamic props, are options —
// nothing here knows or cares which backend is driving it.
//
//   import { rscRoutes } from '<package>/vite'
//   export default defineConfig({ plugins: [rscRoutes(), react({ compiler: true })] })
//
// The plugin discovers the app/ route tree, generates the three entries that
// carry the route composition and the worker's render contract, and supplies
// the structural config (entries, output dirs, base). @vitejs/plugin-rsc is
// included here so it always runs before any react() layer the app adds.

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import rsc from '@vitejs/plugin-rsc'
import { loadEnv } from 'vite'
import type { Plugin, PluginOption, ResolvedConfig } from 'vite'
import { httpHostCalls } from './hostCalls.js'
import type { ManifestIntercept, ManifestRoute, RouteManifest, RouteSegment } from './manifest.js'

export interface RscRoutesOptions {
  /** Project root. Defaults to RSC_PROJECT_ROOT, then cwd. */
  projectRoot?: string
  /** Directory holding the app/ route tree. Defaults to `src`. */
  sourceDir?: string
  /** Where the server bundles and generated entries go. Defaults to `.rsc`. */
  outDir?: string
  /** Where the browser bundle is written. Defaults to `dist/client`. */
  assetsDir?: string
  /** Public URL the browser bundle is served from. Defaults to `/`. */
  assetsUrl?: string
  /**
   * A file the dev server writes its own url into, and removes on shutdown.
   *
   * Laravel's convention, and the reason it is worth adopting: a dev server
   * picks its port at runtime — 5173 is the most contended port on a developer's
   * machine, and Vite silently moves to the next free one — so anything holding
   * a fixed url is wrong the moment a second project is running. A backend that
   * reads this file follows the server instead of guessing at it.
   */
  hotFile?: string
  /**
   * Where `rpc()` goes while `vite dev` is serving.
   *
   * A built deployment installs this itself — the server that runs
   * createRscHandler passes `hostCalls`. The dev server has no such server in
   * front of it, so without this every rpc() during development is refused and
   * any page whose data comes from the backend renders blank.
   *
   * Both halves default to the app's own .env, which for a Laravel app already
   * has them: APP_URL for the backend and RSC_HOST_CALL_SECRET for the secret.
   * That is the difference between "configure the dev server" and "it works".
   */
  hostCall?: { endpoint?: string; secret?: string; path?: string }
  /**
   * This package's directory, holding the client runtime the browser entry
   * imports. Vite stages configs through node_modules/.vite-temp, so
   * import.meta.dir is not this file's real location by the time the plugin
   * runs — a host invoking the build out of process passes the real path
   * through RSC_PACKAGE_DIR.
   */
  packageDir?: string
  /**
   * Name of the global the host installs for calling its own functions from a
   * server component — `await rpc('getUser', id)`. The mechanism is
   * host-agnostic; only the name is a convention, so a host that prefers
   * something else can say so.
   */
  hostGlobal?: string
  /**
   * JSON file of `{urlPattern, slot}` entries naming the routes the client
   * router should intercept rather than navigate to. Written by the host,
   * which owns route discovery.
   */
  interceptManifestFile?: string
  /**
   * Bare-specifier prefix for importing the client runtime, as in
   * `import Link from '<prefix>/Link'`, aliased to this package's js/
   * directory.
   *
   * Only needed when this package is not resolvable from the project's
   * node_modules — a host that vendors it through its own package manager,
   * say. Installed from npm, the package name resolves on its own and no
   * alias is required.
   */
  packageAlias?: string
  /**
   * Origin the Vite dev server is reachable at, e.g. `http://localhost:5173`.
   *
   * Set only when running under the dev server. @vitejs/plugin-rsc emits its
   * bootstrap and CSS links root-relative in dev and no Vite setting moves
   * them, so with the host serving the page the browser would ask the host for
   * modules only Vite can answer. Given this, the SSR entry rewrites them onto
   * the dev origin — see devUrls.ts. Empty in a build, where the URLs are real
   * built assets.
   */
  devOrigin?: string
  /**
   * What the build produces.
   *
   *   'server'  the default: pages are served by a host, and a payload is
   *             asked for with a header on the page's own url.
   *   'export'  files any static host can serve. Payloads get addresses of
   *             their own, because a host serving files cannot act on a
   *             header, and the client is built to ask for those instead.
   */
  output?: 'server' | 'export'
  /** Where an exported site is written, relative to the project root. */
  exportPath?: string
  /**
   * Filename payloads are served under on a static host, e.g. `index.rsc`.
   *
   * Only for an exported build. Normally the payload shares the page's url and
   * is asked for with a header; a host that serves files cannot answer that,
   * so the payload needs an address of its own.
   */
  staticPayloads?: string
  /**
   * How to tell that a route's props are resolved dynamically by the host, so
   * the page cannot be prerendered whole.
   *
   * Entirely host-defined: a host that writes a config file beside the page
   * names that file and the pattern that marks it dynamic. Omitted, no page is
   * classified dynamic on this basis.
   */
  routeConfig?: { file: string; dynamicPattern: RegExp }
  /**
   * Functions the host exposes to the app, as `{ exportedName: target }`.
   *
   * The build writes a "use server" module of stubs for these, each one
   * calling the host global with its target — so app code imports an ordinary
   * async function and never names the transport. Discovery belongs to the
   * host, whose functions these are; only the rendering is here, because the
   * module has to land beside the app's source and that path is the build's.
   *
   * A host whose functions are already JavaScript passes nothing.
   */
  hostActions?: Record<string, string>
  /**
   * Freeze what can be frozen at the end of `vite build`. Defaults to true.
   *
   * Off, the build produces bundles and nothing else, and every route renders
   * per request. See the note on the hook for when you would want that.
   */
  prerender?: boolean
}

// Resolved once per rscRoutes() call. One build runs in one process, so these are
// module state rather than threaded through every helper.
let projectRoot: string
let sourceDir: string
let outDir: string
let appDir: string
let genDir: string
let publicAssetsDir: string
let assetsBaseUrl: string
let hotFile: string
let hostCallOptions: RscRoutesOptions['hostCall']
let packageDir: string
let hostGlobal: string
let interceptManifestFile: string
let packageAlias: string | null
/** Dev-server origin; empty in a build. See devUrls.ts. */
let devOrigin: string
/** 'server' or 'export' — see RscRoutesOptions.output. */
let output: string
/** Where an exported site is written. */
let exportPath: string
/**
 * Filename payloads are exported under, empty unless building for a static
 * host. Set, the client asks `<page>/<name>` for a payload instead of asking
 * for the page's own url with a header a static host cannot act on.
 */
let staticPayloads: string
let routeConfig: { file: string; dynamicPattern: RegExp } | null
/** Whether `vite build` freezes pages when it finishes — see RscRoutesOptions. */
let prerenderAfterBuild: boolean
/** True during `vite build --watch`, where re-rendering every route is noise. */
let isWatch = false
/** Host functions to generate stubs for — see RscRoutesOptions.hostActions. */
let hostActions: Record<string, string>

/**
 * This file's directory.
 *
 * Not `import.meta.dir`, which is Bun-only: Vite bundles the config and runs it
 * under Node, where that is undefined and the path resolution below throws
 * before the build starts. Reached whenever RSC_PACKAGE_DIR is unset — which is
 * the ordinary case for an app that installs the engine from npm and runs
 * `vite build` itself.
 */
/** This package's name, for excluding it from dep optimization. */
const PACKAGE_NAME: string = (() => {
  try {
    const manifest = JSON.parse(
      readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf-8'),
    ) as { name?: string }

    return manifest.name ?? '@rsc-kit/core'
  } catch {
    return '@rsc-kit/core'
  }
})()

function thisDir(): string {
  return dirname(fileURLToPath(import.meta.url))
}

/** routeConfig supplied through the environment, for out-of-process hosts. */
function envRouteConfig(): { file: string; dynamicPattern: RegExp } | null {
  const file = process.env.RSC_ROUTE_CONFIG_FILE
  const pattern = process.env.RSC_ROUTE_CONFIG_PATTERN

  if (!file || !pattern) return null

  return { file, dynamicPattern: new RegExp(pattern) }
}

/** The file a backend writes its action names into. */
const HOST_ACTIONS_FILE = 'rsc-host-actions.json'

/**
 * Host actions, read from a file the backend wrote.
 *
 * A file rather than an environment variable, because the backend no longer
 * drives the build — `vite build` does. Discovery has to stay where the classes
 * are (reflection through Composer's autoloader finds what a class inherits;
 * a regex would silently miss every inherited action), but the handoff is just
 * a map of names, and a JSON file is something any language can write:
 *
 *     php artisan rsc:action-manifest > rsc-host-actions.json
 *     go run ./cmd/rsc-actions       > rsc-host-actions.json
 *
 * Absent is not an error. An app with no host actions has no file, and one
 * that has them regenerates it as part of its build.
 */
function fileHostActions(root: string): Record<string, string> {
  const path = join(root, HOST_ACTIONS_FILE)

  if (!existsSync(path)) return {}

  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as unknown

    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('expected an object of { jsName: "Class.method" }')
    }

    return parsed as Record<string, string>
  } catch (error) {
    // Loud, because the alternative is generating no stubs: every import of a
    // server action then fails at build time, naming the import rather than
    // this file.
    throw new Error(
      `Could not read ${HOST_ACTIONS_FILE}: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

/**
 * The alias that lets a vendored copy of this package be imported by name.
 *
 * Only when the package is not installed, because an alias is a path rewrite
 * and rewrites nothing through the package's own exports. With both in play
 * the specifier meant two different things: `<pkg>/Form` resolved to whatever
 * file happened to sit at js/Form, rather than to what ./Form is declared to
 * mean. Installed from npm, ordinary resolution reads the exports map and the
 * two cannot drift.
 */
function aliasEntries(): Array<{ find: RegExp; replacement: string }> {
  if (!packageAlias) return []

  if (existsSync(join(projectRoot, 'node_modules', packageAlias))) return []

  return [
    {
      find: new RegExp('^' + packageAlias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '/(.*)$'),
      replacement: join(packageDir, 'js') + '/$1',
    },
  ]
}

function resolvePaths(options: RscRoutesOptions): void {
  projectRoot = resolve(options.projectRoot || process.env.RSC_PROJECT_ROOT || process.cwd())
  sourceDir = resolve(options.sourceDir || process.env.RSC_SOURCE_DIR || join(projectRoot, 'src'))
  outDir = resolve(options.outDir || process.env.RSC_OUT_DIR || join(projectRoot, '.rsc'))
  appDir = join(sourceDir, 'app')

  // Generated entries live under the (in-project) out dir so module resolution
  // can walk up to the project's node_modules (@vitejs/plugin-rsc, react, ...).
  genDir = join(outDir, '.gen')

  // The CLIENT bundle is browser-facing and has to be web-served; the rsc/ssr
  // bundles are SERVER code and stay under outDir, which must never be public.
  publicAssetsDir = resolve(options.assetsDir || process.env.RSC_ASSETS_DIR || join(projectRoot, 'dist/client'))
  assetsBaseUrl = options.assetsUrl || process.env.RSC_ASSETS_URL || '/'
  hotFile = options.hotFile || process.env.RSC_HOT_FILE || ''
  hostCallOptions = options.hostCall
  packageDir = resolve(options.packageDir || process.env.RSC_PACKAGE_DIR || thisDir())
  hostGlobal = options.hostGlobal || process.env.RSC_HOST_GLOBAL || 'rpc'
  interceptManifestFile = resolve(
    options.interceptManifestFile || process.env.RSC_INTERCEPT_MANIFEST || join(outDir, 'intercept-manifest.json'),
  )
  packageAlias = options.packageAlias || process.env.RSC_PACKAGE_ALIAS || null
  devOrigin = options.devOrigin || process.env.RSC_DEV_ORIGIN || ''
  output = options.output || process.env.RSC_OUTPUT || 'server'
  exportPath = options.exportPath || process.env.RSC_EXPORT_PATH || 'dist'
  // An export decides this for itself: the client has to ask for payloads by
  // url because there is no server to read a header, and the name it asks for
  // is the one the export writes.
  staticPayloads =
    options.staticPayloads || process.env.RSC_STATIC_PAYLOADS || (output === 'export' ? 'index.rsc' : '')

  // No default: which file marks a route dynamic is the host's convention, and
  // guessing one here would bake a particular backend into a generic plugin.
  // The env pair exists so a host driving the build out of process can pass it
  // without writing a config file.
  routeConfig = options.routeConfig ?? envRouteConfig()
  // A host driving the build out of process cannot pass an option, and may
  // prerender itself afterwards with paths only it knows.
  prerenderAfterBuild = options.prerender ?? process.env.RSC_PRERENDER !== '0'
  hostActions = options.hostActions ?? fileHostActions(projectRoot)
}

interface Component {
  name: string // route-relative key, e.g. "app/page", "app/layout"
  absPath: string
  alias: string // safe JS identifier for the generated import
}

function log(...args: unknown[]): void {
  console.error('[rsc-routes]', ...args)
}


// ── The route manifest ───────────────────────────────────────────────────────

/**
 * What the plugin knows about the route tree, written out for a host to read.
 *
 * The plugin already walks app/ to generate the entries, and every host has to
 * know the same things — which url a component answers, what layouts wrap it,
 * which slots and sections belong to it. Laravel scans the tree a second time
 * to work that out; a JS host would have to write a third. This is the one
 * answer, emitted where both can read it.
 *
 * Urls are expressed as segments rather than as a pattern string, because the
 * pattern is the host's dialect: Laravel writes {slug}, Hono writes :slug, and
 * neither is the plugin's business.
 */

/** `[...path]` → catchAll, `[id]` → param, `(group)` → nothing at all. */
function urlSegments(componentName: string): RouteSegment[] {
  const parts = componentName.split('/').slice(1, -1)
  const segments: RouteSegment[] = []

  for (const part of parts) {
    // A route group organises files without appearing in the url.
    if (part.startsWith('(') && part.endsWith(')')) continue
    // A slot directory is not part of its page's url either.
    if (part.startsWith('@')) continue

    if (part.startsWith('[...') && part.endsWith(']')) {
      segments.push({ type: 'catchAll', value: part.slice(4, -1) })
      continue
    }

    if (part.startsWith('[') && part.endsWith(']')) {
      segments.push({ type: 'param', value: part.slice(1, -1) })
      continue
    }

    // An interception marker says which url this replaces, not what it is
    // called: (.)photo intercepts the sibling /photo. Left in place the
    // manifest would claim a route at /(.)photo, which nothing can navigate to.
    segments.push({ type: 'static', value: part.replace(/^\(\.{1,3}\)/, '') })
  }

  return segments
}

/** Whether a component sits under an interception marker: (.) (..) (...) */
function isIntercept(componentName: string): boolean {
  return componentName.split('/').some((part) => /^\(\.{1,3}\)/.test(part))
}

/** The slot directory a component lives under, if any. */
function slotOf(componentName: string): string | null {
  const part = componentName.split('/').find((p) => p.startsWith('@'))

  return part ? part.slice(1) : null
}

/**
 * Everything the plugin discovered, as a host needs it.
 *
 * Ancestry is by path prefix: a layout at app/docs applies to everything under
 * app/docs, which is the same rule the composition uses.
 */
function routeManifest(): RouteManifest {
  const names = [...components.keys()]
  const dirOf = (name: string) => name.split('/').slice(0, -1).join('/')

  // By path, not by string: 'app/slow3' begins with 'app/slow' as text and is
  // not inside it, which would hand /slow3 the loading state of /slow.
  const isUnder = (dir: string, ancestor: string) =>
    dir === ancestor || dir.startsWith(ancestor + '/')

  const ancestors = (name: string, base: string) =>
    names
      .filter((n) => n.endsWith('/' + base) && !isIntercept(n) && isUnder(dirOf(name), dirOf(n)))
      .sort((a, b) => a.length - b.length)

  /** Project-root-relative, posix — the same string on every machine. */
  const fromRoot = (abs: string) => relative(projectRoot, abs).replace(/\\/g, '/')

  /** The host's config file in a directory, if the host named one and it exists. */
  const configIn = (absDir: string): string | null => {
    if (!routeConfig) return null

    const path = join(absDir, routeConfig.file)

    return existsSync(path) ? fromRoot(path) : null
  }

  /** Ancestor configs, outermost first, excluding the page's own directory. */
  const ancestorConfigs = (dir: string): string[] => {
    const found: string[] = []
    const parts = dir.split('/').slice(0, -1)

    while (parts.length > 0) {
      const path = configIn(join(sourceDir, parts.join('/')))

      if (path) found.unshift(path)

      parts.pop()
    }

    return found
  }

  /**
   * Host middleware named by a route.ts beside or above a page.
   *
   *     // app/admin/route.ts
   *     export const middleware = ['auth', 'can:update,post']
   *
   * Read statically rather than imported, for the same reason
   * generateStaticParams is detected by reading the source: this runs while the
   * manifest is being built, before there is a bundle to execute.
   *
   * The names mean nothing here. They are the host's vocabulary — Laravel
   * middleware aliases, a Go router's names — and the engine only carries them
   * to whoever knows what they mean.
   */
  const middlewareIn = (absDir: string): string[] => {
    for (const file of ['route.ts', 'route.tsx']) {
      const path = join(absDir, file)

      if (!existsSync(path)) continue

      const match = readFileSync(path, 'utf-8').match(
        /export\s+const\s+middleware\s*(?::[^=]+)?=\s*\[([^\]]*)\]/,
      )

      if (!match) continue

      // Each quoted literal, rather than splitting the list on commas: a
      // middleware name carries its arguments after a colon and those are
      // comma-separated too, so splitting turns 'throttle:60,1' into a
      // throttle of 60 and a middleware called 1.
      return [...match[1].matchAll(/['"`]([^'"`]*)['"`]/g)]
        .map((quoted) => quoted[1].trim())
        .filter(Boolean)
    }

    return []
  }

  /**
   * Every host middleware above and on a page, outermost first.
   *
   * Order is the whole of it: an outer guard has to run before an inner one, or
   * a check deciding whether the inner check is even reachable runs second.
   * Duplicates are dropped, so a name repeated down the tree runs once, at the
   * outermost point it was asked for.
   */
  const hostMiddleware = (dir: string): string[] => {
    const parts = dir.split('/').filter(Boolean)
    const found: string[] = []

    for (let depth = 0; depth <= parts.length; depth++) {
      for (const name of middlewareIn(join(sourceDir, ...parts.slice(0, depth)))) {
        if (!found.includes(name)) found.push(name)
      }
    }

    return found
  }

  const routes: ManifestRoute[] = []
  const intercepts: ManifestIntercept[] = []

  for (const name of names) {
    if (name.endsWith('/page') && isIntercept(name)) {
      const slot = slotOf(name)

      if (slot) {
        const marker = name.split('/').find((p) => /^\(\.{1,3}\)/.test(p))?.match(/^\(\.{1,3}\)/)?.[0] ?? '(.)'

        intercepts.push({ component: name, slot, segments: urlSegments(name), marker })
      }

      continue
    }

    if (!name.endsWith('/page') || slotOf(name)) continue

    const slots: Record<string, string> = {}

    for (const candidate of names) {
      const slot = slotOf(candidate)
      // A slot belongs to the layout in the directory that declares it, so it
      // applies to a page only if that directory is on the page's path.
      if (!slot || isIntercept(candidate) || !candidate.endsWith('/default')) continue
      if (isUnder(dirOf(name), candidate.split('/@')[0])) slots[slot] = candidate
    }

    routes.push({
      component: name,
      segments: urlSegments(name),
      layouts: ancestors(name, 'layout').map((n) => n),
      loadings: ancestors(name, 'loading').map((n) => n),
      middleware: ancestors(name, 'middleware').map((n) => n),
      slots,
      sections: names.filter((n) => SECTION_FILE.test(n + '.tsx') && dirOf(n) === dirOf(name)),
      config: configIn(join(sourceDir, dirOf(name))),
      hostMiddleware: hostMiddleware(dirOf(name)),
      ancestorConfigs: ancestorConfigs(dirOf(name)),
      staticParams: hasStaticParams(components.get(name)!.absPath),
      clientJs: shipsClientJs(components.get(name)!.absPath),
    })
  }

  // What the build decided, for a host that has to act on it afterwards —
  // writing the site out, and knowing which filename the client will ask for.
  return {
    version: 1,
    build: { output, exportPath, payloadName: staticPayloads },
    routes,
    intercepts,
  }
}

// ── What the app imports ─────────────────────────────────────────────────────

/**
 * Write the modules the app's source imports but nobody writes by hand.
 *
 * All three land in the source directory because that is where the app's own
 * imports and its typechecker can reach them: the stubs are imported by
 * relative path, and an ambient declaration is only ambient if it is inside
 * the project. The build owns that path, which is why it owns this.
 *
 * Rewritten on every run. The failure they prevent is invisible at build
 * time — a stale stub calls a global that has since been renamed, and only
 * the browser ever finds out.
 */
function writeHostBindings(manifest: RouteManifest): void {
  mkdirSync(sourceDir, { recursive: true })

  // The global is installed at runtime, so nothing in app source declares it
  // and a typecheck cannot see it. Written whether or not there are actions:
  // server components call it directly too.
  writeFileSync(join(sourceDir, 'rsc-env.d.ts'), renderHostGlobalTypes())

  // The engine's own ambient types, copied where the app's typechecker will
  // see them. Deliberately a separate file from the one above: this one is
  // the engine's and identical everywhere, that one is generated from how
  // this host is configured.
  // The urls this build found, so a link to a page that does not exist fails
  // the typecheck instead of the browser.
  writeFileSync(join(sourceDir, 'rsc-routes.d.ts'), renderRouteTypes(manifest))

  // The bundle the host imports is generated, so nothing declares it. Written
  // here rather than left to the app: every app needs the identical file, and
  // an app-authored one goes stale — the first version named only RscEngine,
  // which typechecks a server and fails a prerender script.
  writeFileSync(join(sourceDir, 'rsc-engine.d.ts'), ENGINE_TYPES)

  const engineTypes = join(packageDir, 'types.d.ts')

  if (existsSync(engineTypes)) {
    writeFileSync(join(sourceDir, 'rsc-types.d.ts'), readFileSync(engineTypes, 'utf-8'))
  }

  const target = join(sourceDir, 'server-actions.generated.ts')

  // A host with no functions of its own leaves no file behind: kept, its
  // stubs would go on naming targets the host has stopped answering for.
  if (Object.keys(hostActions).length === 0) {
    if (existsSync(target)) rmSync(target)

    return
  }

  writeFileSync(target, renderHostActions())
}

/**
 * The generated engine bundle, as the type its callers expect.
 *
 * Both contracts: createRscHandler serves requests, prerender() renders at
 * build time and needs three methods the first does not have. manifest() is
 * optional on both because a host may be handed an engine without one — this
 * is the generated bundle, which always exports it, and saying so is what lets
 * exportSite() be called without a guard that could never fire.
 */
const ENGINE_TYPES = `// @generated — do not edit. Written by the RSC build.
declare module '*/dist/rsc/index.js' {
  import type { RscEngine } from '@rsc-kit/core/host'
  import type { PrerenderEngine } from '@rsc-kit/core/prerender'

  const engine: RscEngine & PrerenderEngine & Required<Pick<PrerenderEngine, 'manifest'>>

  export = engine
}
`

/**
 * Render every route once and write what can be stored.
 *
 * Imported at call time, not at the top of this file: `prerender` pulls in the
 * render pipeline, and a dev server that never prerenders should not pay for
 * loading it.
 */
/**
 * What the build classified when it classified nothing.
 *
 * With prerendering off there is no probe and no answer to report, so every
 * route is dynamic by construction rather than by measurement — printed the
 * same way so the output means the same thing either way.
 */
function reportAllDynamic(): void {
  const routes = routeManifest().routes

  for (const route of routes) {
    // The pattern rather than a url: nothing was rendered, so there are no
    // params and inventing one would name a page that may not exist.
    const path = route.segments
      .map((segment) => (segment.type === 'static' ? segment.value : `[${segment.value}]`))
      .join('/')

    console.log(`  \u0192  /${path}`)
  }

  console.log(`
  \u0192  (Dynamic)            server-rendered on demand

  ${routes.length} dynamic — prerendering is off`)
}

async function prerenderAfterBundles(): Promise<void> {
  const bundle = join(outDir, 'dist/rsc/index.js')

  if (!existsSync(bundle)) return

  const [{ prerender, summary, legend }, { writeTo }] = await Promise.all([
    import('./prerender.js'),
    import('./files.js'),
  ])

  const staticDir = join(outDir, 'static')

  // Cleared first: a route that changes classification between builds
  // otherwise leaves its old shell on disk and the host goes on serving it.
  // Nothing warns — the page loads, with content from the previous build.
  rmSync(staticDir, { recursive: true, force: true })

  const engine = (await import(pathToFileURL(bundle).href)) as never
  const mark: Record<string, string> = { frozen: '○', shell: '◐', blocked: 'ƒ', error: '✗' }
  let failed = 0

  const results = await prerender({
    engine,
    write: writeTo(staticDir),
    onResult: (r) => {
      if (r.type === 'error') failed++
      console.log(`  ${mark[r.type] ?? ' '}  ${r.url}${r.reason ? `  (${r.reason})` : ''}`)
      if (r.warning) console.log(`     ⚠  ${r.warning}`)
    },
  })

  const count = (type: string) => results.filter((r) => r.type === type).length

  console.log(`
${legend(results)}

  ${summary(results)}`)

  if (failed > 0) {
    throw new Error(
      `[rsc-routes] ${failed} route${failed === 1 ? '' : 's'} failed to render.\n` +
        'Prerendering runs your app: whatever those pages need at render time has to be\n' +
        'reachable from the build. Fix them, or build with prerender: false and render on demand.',
    )
  }
}

/** `/posts/[slug]` — the pattern, in the shape the app writes its links in. */
function patternOf(segments: RouteSegment[]): string {
  if (segments.length === 0) return '/'

  return (
    '/' +
    segments
      .map((segment) =>
        segment.type === 'static'
          ? segment.value
          : segment.type === 'catchAll'
            ? `[...${segment.value}]`
            : `[${segment.value}]`,
      )
      .join('/')
  )
}

/**
 * The app's routes as a union, for `@rsc-kit/core/routes` to derive from.
 *
 * Rewritten every build like the other generated files: a route deleted from
 * the tree has to stop being a valid href, and the only thing that knows is
 * the walk that just happened.
 *
 * Interception patterns are deliberately absent. An interceptor answers a url
 * that some real route already owns — listing it would put the same href in
 * the union twice and imply you could link to a modal.
 */
function renderRouteTypes(manifest: RouteManifest): string {
  const patterns = [...new Set(manifest.routes.map((route) => patternOf(route.segments)))].sort()

  return [
    '// @generated — do not edit. Written by the RSC build from the route tree.',
    '//',
    '// Turns Link, navigate() and route() into typed apis: an href that no route',
    '// answers stops compiling. Delete this file and they fall back to `string`,',
    '// which is what a project that has not built yet gets.',
    '',
    '// `export {}` is load-bearing: in a file with no import or export,',
    '// `declare module` *replaces* the real module rather than augmenting it,',
    '// and Href and route() vanish from it with no error to explain why.',
    'export {}',
    '',
    "declare module '@rsc-kit/core/routes' {",
    '  interface Register {',
    patterns.length > 0
      ? '    routes:\n' + patterns.map((p) => '      | ' + JSON.stringify(p)).join('\n')
      : '    // No routes found under the source directory.\n    routes: never',
    '  }',
    '}',
    '',
  ].join('\n')
}

/** The "use server" module exposing each host function as a plain async call. */
function renderHostActions(): string {
  const lines = [
    '"use server";',
    '// @generated — do not edit. Written by the RSC build from the host action map.',
    '',
  ]

  for (const [name, target] of Object.entries(hostActions)) {
    lines.push('export async function ' + name + '(...args: unknown[]) {')
    lines.push('  return await (globalThis as any).' + hostGlobal + '(' + JSON.stringify(target) + ', ...args);')
    lines.push('}')
    lines.push('')
  }

  return lines.join('\n')
}

/** Ambient declaration for the host global, written beside the app's source. */
function renderHostGlobalTypes(): string {
  return [
    '// @generated — do not edit.',
    '//',
    '// ' + hostGlobal + '() is installed on globalThis by the RSC worker, so it has no',
    '// import to resolve. This declares it for the typechecker; run',
    '// `tsc --noEmit` to catch calls to a host global that no longer exists.',
    '//',
    '// Deliberately not a module — no import/export — so the declaration is',
    '// global to the project without every file having to reference it.',
    '',
    'declare function ' + hostGlobal + '<T = unknown>(name: string, ...args: unknown[]): Promise<T>;',
    '',
  ].join('\n')
}

// ── Discovery ────────────────────────────────────────────────────────────────

const ROUTE_FILES = ['page', 'layout', 'loading', 'default', 'middleware']
/** `orders.section.tsx` — a region of a page that can be refreshed by name. */
const SECTION_FILE = /\.section\.(tsx|jsx|ts|js)$/
const EXTS = ['tsx', 'jsx', 'ts', 'js']

function findRouteFile(dir: string, base: string): string | null {
  for (const ext of EXTS) {
    const p = join(dir, `${base}.${ext}`)
    if (existsSync(p)) return p
  }
  return null
}

function componentName(absPath: string): string {
  const rel = relative(sourceDir, absPath).replace(/\\/g, '/')
  return rel.replace(/\.(tsx|jsx|ts|js)$/, '')
}

function toAlias(name: string): string {
  return '_c_' + name.replace(/[^a-zA-Z0-9]/g, '_')
}

const components = new Map<string, Component>()

function register(absPath: string): Component {
  const name = componentName(absPath)
  const existing = components.get(name)
  if (existing) return existing
  const c: Component = { name, absPath, alias: toAlias(name) }
  components.set(name, c)
  return c
}

/** Walk app/ collecting page/layout/loading/default/middleware components. */
function discover(dir: string): void {
  for (const base of ROUTE_FILES) {
    const p = findRouteFile(dir, base)
    if (p) register(p)
  }

  // Named regions. Registered like any other component so the generated entry
  // imports them — which is what runs section() and puts the name in the
  // registry the server looks up to re-render one on its own.
  for (const entry of readdirSync(dir)) {
    if (SECTION_FILE.test(entry)) register(join(dir, entry))
  }

  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry)
    if (statSync(abs).isDirectory()) discover(abs)
  }
}

/**
 * Which of the two metadata exports a module actually has.
 *
 * Both are read separately because the generated entry names each one it
 * mentions, and naming an export that is not there is a bundler warning on
 * every build — `Import 'generateMetadata' will always be undefined`. Most
 * pages export only the static object, so referencing both meant that warning
 * for almost every route in an app.
 */
function metadataExports(absPath: string): { static: boolean; generate: boolean } {
  const src = readFileSync(absPath, 'utf-8')

  return {
    static: /export\s+const\s+metadata\b/.test(src),
    generate: /export\s+(async\s+)?function\s+generateMetadata\b/.test(src),
  }
}

/**
 * Whether a route ships the client runtime at all.
 *
 * Opting out buys back everything React costs on a page that has nothing to
 * hydrate — react-dom alone is most of it. Declared rather than inferred: a
 * page with no client components today may gain one tomorrow, and the build
 * refusing that is the point.
 */
function shipsClientJs(absPath: string): boolean {
  const src = readFileSync(absPath, 'utf-8')

  return !/export\s+const\s+clientJs\s*(:[^=]+)?=\s*false/.test(src)
}

/**
 * Which urls exist for a parameterised route.
 *
 * The one thing about a route the build cannot work out for itself: only the
 * app knows its slugs. Everything else about whether a page can be frozen is
 * observed by rendering it — a page that suspends past the shell budget, or
 * reaches for the host, says so by doing it. This is asked rather than
 * inferred because there is nothing to infer it from.
 */
function hasStaticParams(absPath: string): boolean {
  const src = readFileSync(absPath, 'utf-8')

  return /export\s+((async\s+)?function\s+generateStaticParams|const\s+generateStaticParams)/.test(src)
}

// ── Codegen ──────────────────────────────────────────────────────────────────

function generateEntryRsc(): string {
  const imports: string[] = []
  const mapEntries: string[] = []
  const metaEntries: string[] = []
  const paramEntries: string[] = []

  for (const c of components.values()) {
    imports.push(`import ${c.alias} from ${JSON.stringify(c.absPath)}`)
    mapEntries.push(`  ${JSON.stringify(c.name)}: ${c.alias},`)

    const meta = metadataExports(c.absPath)

    if (meta.static || meta.generate) {
      imports.push(`import * as ${c.alias}_meta from ${JSON.stringify(c.absPath)}`)

      const fields = [
        meta.static ? `static: ${c.alias}_meta.metadata` : null,
        meta.generate ? `generate: ${c.alias}_meta.generateMetadata` : null,
      ].filter(Boolean)

      metaEntries.push(`  ${JSON.stringify(c.name)}: { ${fields.join(', ')} },`)
    }

    if (hasStaticParams(c.absPath)) {
      // The namespace import may already be in place for metadata; a second
      // one of the same module is the same binding, so this is safe to repeat.
      imports.push(`import * as ${c.alias}_params from ${JSON.stringify(c.absPath)}`)
      paramEntries.push(`  ${JSON.stringify(c.name)}: ${c.alias}_params.generateStaticParams,`)
    }
  }

  // The engine's own modules are named without an extension: this plugin runs
  // from src/ in its own repo and from dist/ once published, and Vite resolves
  // either. Naming .tsx here builds fine from source and fails after publish.
  return `// GENERATED by rscRoutes() — do not edit.
import { SegmentBoundary } from ${JSON.stringify(join(packageDir, "js/SegmentBoundary"))}
import { DocumentTitle } from ${JSON.stringify(join(packageDir, "js/DocumentTitle"))}
import { SlotBoundary } from ${JSON.stringify(join(packageDir, "js/SlotBoundary"))}
import { sectionComponent } from ${JSON.stringify(join(packageDir, "js/section"))}
import { PathnameProvider } from ${JSON.stringify(join(packageDir, "js/PathnameProvider"))}
import { searchParams as requestSearchParams } from ${JSON.stringify(join(packageDir, "request"))}
import { redirectDigest } from ${JSON.stringify(join(packageDir, "redirectDigest"))}
import { createRscHandler } from ${JSON.stringify(join(packageDir, "host"))}
import { renderToReadableStream, decodeReply, loadServerAction } from '@vitejs/plugin-rsc/rsc'
import { Suspense, createElement, Fragment } from 'react'
import { AsyncLocalStorage } from 'node:async_hooks'
${imports.join('\n')}

type HostFn = (name: string, ...args: unknown[]) => Promise<unknown>
type LayoutEntry = { component: string; props?: Record<string, unknown> }
type SlotOverride = { component: string; props?: Record<string, unknown> }

const components: Record<string, any> = {
${mapEntries.join('\n')}
}

const metadataMap: Record<string, { static?: any; generate?: (p: any) => any }> = {
${metaEntries.join('\n')}
}

const staticParamsMap: Record<string, () => any> = {
${paramEntries.join('\n')}
}

/**
 * The route table this bundle was built from.
 *
 * Embedded rather than read back from routes.json, so a host cannot pair a
 * fresh bundle with a stale manifest — the two came out of the same build and
 * now cannot be separated. The file is still written, because a host that
 * cannot import a JavaScript module has no other way to read it.
 */
export function manifest(): any {
  return ${JSON.stringify(routeManifest())}
}

/**
 * The param sets a route declares, or null when it declares none.
 *
 * Null and [] are different answers: no generateStaticParams means the route
 * is rendered on demand, an empty array means the app looked and there is
 * nothing to build. Collapsing them silently prerenders nothing for a route
 * that asked for everything, or the reverse.
 */
export async function getStaticParams(component: string): Promise<Record<string, string>[] | null> {
  const generate = staticParamsMap[component]

  if (!generate) return null

  return (await generate()) as Record<string, string>[]
}

// The host installs its callable via installHostFn. The global must be set
// synchronously INSIDE each render fn (applyHost) right before
// renderToReadableStream — setting it once ahead of a separate render call does
// not reach the Flight render.
const HOST_GLOBAL = ${JSON.stringify(hostGlobal)}

/**
 * The reserved name a host answers route middleware on.
 *
 * Prefixed so it cannot collide with a function an application registered.
 * A host that has never heard of it answers "no such function", which
 * throws — the correct answer for a guarded route on a host that cannot
 * check the guard.
 */
const HOST_MIDDLEWARE_FN = '__rsc.middleware'

let currentHost: HostFn | null = null

export function installHostFn(fn: HostFn) {
  currentHost = fn
  return () => {
    if (currentHost === fn) currentHost = null
  }
}

/**
 * The probe's stand-in host, for whichever render is asking.
 *
 * Held in async context rather than on the global, because two prerenders
 * running at once each need their own. The previous shape saved the real host,
 * overwrote the global and restored it afterwards — correct for one render at
 * a time and silently wrong for two: the second overwrites the first's saved
 * value, and both pages then call whichever closure assigned last, so
 * usedDynamicApis is recorded against the wrong page and routes are
 * misclassified. Benign for a pure-JS host, which installs none; wrong for
 * Laravel, which does.
 */
const probeHost = new AsyncLocalStorage<(...args: unknown[]) => Promise<unknown>>()

function applyHost() {
  // A dispatcher, installed once. App code calls a global; which implementation
  // that reaches is a question about the render it is inside.
  //
  ;(globalThis as Record<string, unknown>)[HOST_GLOBAL] = (...args: unknown[]) => {
    const fn = probeHost.getStore() ?? currentHost

    // An optional call was here, and it answered every rpc() with undefined
    // when no host was installed. undefined is a value: the component renders
    // with it, the render succeeds, and a prerender freezes the result. The
    // page then hydrates against an undefined prop, the client component reads
    // a property of it, React unmounts the document, and the browser shows a
    // blank page with nothing in the console.
    //
    // No backticks in this region — everything from the generated entry
    // onward is a template literal, and one ends it here.
    // Rejected rather than thrown: rpc() is documented to return a promise, so
    // a caller that stores it before awaiting must get a rejection, not an
    // exception from the call itself.
    if (!fn) {
      return Promise.reject(
        new Error(
          'No host callable is installed, so ' + String(args[0]) + ' cannot be answered. ' +
            'A render that needs the host must either run with one installed or be probed.',
        ),
      )
    }

    return fn(...args)
  }
}

/**
 * Which layout renders a given slot.
 *
 * The slot component's own path names the directory that declares it:
 * app/docs/@modal/default is declared in app/docs, and the layout there is the
 * one whose props it belongs in. Falls back to the innermost layout when
 * nothing matches, which is the shape a single-layout app has anyway.
 */
function ownerLayoutIndex(slotComponent: string, layouts: LayoutEntry[]): number {
  const at = slotComponent.indexOf('/@')
  if (at === -1) return layouts.length - 1

  const ownerDir = slotComponent.slice(0, at)
  const suffix = '/layout'
  const found = layouts.findIndex(
    (l) => (l.component.endsWith(suffix) ? l.component.slice(0, -suffix.length) : l.component) === ownerDir,
  )

  return found === -1 ? layouts.length - 1 : found
}

/**
 * The query string, prepared for a page that may never ask for it.
 *
 * Created for every render but awaited by almost none, so its rejection has to
 * be claimed here: an unhandled one fails the render of a page that did
 * nothing wrong. Awaiting it still surfaces the real error.
 */
function pageSearchParams(): Promise<URLSearchParams> {
  const pending = requestSearchParams()

  pending.catch(() => {})

  return pending
}

// Composition: layout(outer..inner) > Suspense(loading, innermost-first) > page.
function buildElement(
  component: string,
  props: Record<string, unknown>,
  layouts: LayoutEntry[],
  loadings: string[],
  parallelSlots: Record<string, string>,
  slotOverrides: Record<string, SlotOverride>,
  head: unknown[] = [],
  from = 0,
  pageKey = '',
  bootstrap = true,
  // What await params gives the page. A never-settling one is how the
  // prerender probe says "not for any particular url": the page suspends where
  // it reads, everything above it still paints, and that is a shell one file
  // can serve for every url the route matches.
  params: Promise<Record<string, unknown>> = Promise.resolve(props),
) {
  const Component = components[component]
  if (!Component) throw new Error('Unknown RSC component: ' + component)

  // Awaitable rather than spread. Spread, a page reads its slug synchronously
  // and renders to completion during the probe — producing a page about an
  // invented value, right for nothing — which is why such a route could only
  // ever be rendered per request.
  let element = createElement(Component, { params, searchParams: pageSearchParams() })

  for (let i = loadings.length - 1; i >= 0; i--) {
    const Loading = components[loadings[i]]
    element = createElement(Suspense, { fallback: Loading ? createElement(Loading) : null }, element)
  }

  // <title>/<meta> go OUTSIDE the Suspense boundaries so they reach the shell
  // immediately — inside, they would be withheld until the page's data
  // resolves, delaying the whole document on a slow page.
  if (head.length) element = createElement(Fragment, null, ...head, element)

  // A slot belongs to the layout in the directory that declares it, which is
  // not necessarily the innermost one: slots are collected by walking up from
  // the page to the app root. Handing every slot to the innermost layout drops
  // any the innermost does not declare, silently — the page renders, the modal
  // just never appears.
  const slotsByLayout = new Map<number, Record<string, unknown>>()

  for (const [slot, value] of Object.entries(parallelSlots)) {
    const override = slotOverrides[slot]
    let rendered: unknown = null

    // Slot components are pages too — an interceptor is a page in a slot — so
    // they get the same awaitables the page does rather than spread values.
    if (override) {
      const OverrideComp = components[override.component]
      rendered = OverrideComp
        ? createElement(OverrideComp, {
            params: Promise.resolve(override.props ?? {}),
            searchParams: pageSearchParams(),
          })
        : null
    } else {
      const SlotComp = components[value]
      rendered = SlotComp
        ? createElement(SlotComp, { params, searchParams: pageSearchParams() })
        : null
    }

    const owner = ownerLayoutIndex(value, layouts)
    if (owner < from) continue

    const bucket = slotsByLayout.get(owner) ?? {}
    // Wrapped so an action can put a re-rendered slot here without the page
    // around it being asked for again. With nothing stored the boundary
    // renders exactly what is passed, so this changes nothing on its own.
    bucket[slot] = bootstrap ? createElement(SlotBoundary, { name: slot }, rendered) : rendered
    slotsByLayout.set(owner, bucket)
  }

  // Indices stay absolute: from skips the layouts the client already has
  // mounted, so slot ownership and boundary depth mean the same thing whether
  // this is a whole document or one segment of it.
  for (let i = layouts.length - 1; i >= from; i--) {
    const Layout = components[layouts[i].component]
    if (!Layout) continue

    // The seam a navigation can replace on its own. Depth counts from the
    // outermost layout, so depth 1 is everything below the root layout and the
    // deepest boundary wraps the page alone. With nothing in the client store
    // these render their children unchanged.
    //
    // It is a client component, so a route shipping no runtime must not get
    // one — otherwise every page would drag React in for a seam nothing can
    // use, and no page could ever be JS-free.
    if (bootstrap) {
      element = createElement(SegmentBoundary, { depth: i + 1, pageKey }, element)
    }

    element = createElement(Layout, {
      ...(layouts[i].props ?? {}),
      ...(slotsByLayout.get(i) ?? {}),
      children: element,
    })
  }

  // The url the client hooks answer with during a server render. Outside the
  // boundaries, so a page keeps it across a partial navigation; omitted with
  // the runtime, since a route shipping none has nothing to read it.
  if (bootstrap && pageKey) {
    element = createElement(PathnameProvider, { value: pageKey }, element)
  }

  return element
}

// Resolve route metadata into React elements. React 19 hoists <title>/<meta>
// rendered anywhere in the tree into <head> — so the "vite way" for metadata is
// to render it as elements, no PHP-side <head> string injection.
async function renderTree(
  component: string,
  props: Record<string, unknown>,
  layouts: LayoutEntry[],
  loadings: string[],
  parallelSlots: Record<string, string>,
  slotOverrides: Record<string, SlotOverride>,
  from = 0,
  pageKey = '',
  bootstrap = true,
  params?: Promise<Record<string, unknown>>,
) {
  // The FULL chain, always: a title template lives on an outer layout, and a
  // partial render still has to produce the same <title> the whole document
  // would have.
  const md = await resolveMetadata(component, props, layouts)
  const head: unknown[] = []

  if (md) {
    if (md.title != null) {
      // The element is what a server render puts in <head>, and what a route
      // with no runtime relies on entirely.
      head.push(createElement('title', { key: '__t' }, String(md.title)))

      // And the effect is what keeps it right once pages are retained — see
      // DocumentTitle. Only where there is a runtime to run it: a client
      // component on a route that ships none is refused by the build.
      if (bootstrap) head.push(createElement(DocumentTitle, { key: '__ts', title: String(md.title) }))
    }
    if (md.description != null) head.push(createElement('meta', { key: '__d', name: 'description', content: String(md.description) }))
    for (const [k, v] of Object.entries(md)) {
      if (k === 'title' || k === 'description' || v == null) continue
      head.push(createElement('meta', { key: '__m_' + k, name: k, content: String(v) }))
    }
  }

  // Metadata elements are rendered INSIDE the document tree so React 19 hoists
  // <title>/<meta> into <head> (hoisting only works from within the tree).
  return buildElement(component, props, layouts, loadings, parallelSlots, slotOverrides, head, from, pageKey, bootstrap, params)
}

/**
 * The shallowest layout this render must actually produce.
 *
 * An interceptor replaces a slot on the layout that declares it. If that layout
 * is one the client already has, a partial render would never reach it and the
 * modal would silently not appear — so the render is widened to include it.
 */
function segmentStart(
  from: number,
  layouts: LayoutEntry[],
  parallelSlots: Record<string, string>,
  slotOverrides: Record<string, SlotOverride>,
): number {
  let start = from

  for (const slot of Object.keys(slotOverrides)) {
    const declared = parallelSlots[slot]
    if (!declared) continue

    const owner = ownerLayoutIndex(declared, layouts)
    if (owner < start) start = owner
  }

  return start
}

/**
 * Run a route's middleware before anything at or below them is rendered.
 *
 * A guard is middleware.ts in a directory: a function that returns nothing and
 * refuses by redirecting or throwing. It exists because a check is not UI, and
 * making it one was the problem — a layout that checks who you are is also a
 * layout that fetches a nav bar, and the two have opposite needs.
 *
 * Layouts are skipped on a partial navigation, which is the whole point of
 * partial navigation, and the client decides how many to skip by naming what
 * it claims to hold. Nothing verifies that claim; nothing can. So a check that
 * lives in a layout is a check the caller can decline. Forcing the layout to
 * run instead makes every navigation pay for its data fetching to re-run a
 * check that costs one query.
 *
 * Guards are not part of that arithmetic. Every render path runs the whole
 * chain, in order, outermost first — a full load, a partial navigation, a
 * revalidation, an interception. There is no marker to forget: the file is the
 * declaration.
 */
let middlewareChains: Record<string, string[]> | null = null

let hostChains: Record<string, string[]> | null = null

/**
 * Guards the host runs, named by a route.ts and meaningless here.
 *
 * Asked before the engine's own middleware.ts guards, because a host's are the
 * coarser check — a session, a rate limit — and running application code to
 * decide whether application code may run is the wrong way round.
 *
 * It fails CLOSED, and that is the whole of its design. This call reaches
 * another process over a network, so it can time out, be refused, or answer
 * something unparseable — and every one of those is a guarded page rendered to
 * whoever asked, if the absence of a refusal is read as permission. Only a
 * literal true allows.
 */
async function runHostMiddleware(component) {
  if (!hostChains) {
    hostChains = {}

    for (const route of manifest().routes) {
      if (route.hostMiddleware?.length) hostChains[route.component] = route.hostMiddleware
    }
  }

  const names = hostChains[component] ?? []

  if (names.length === 0) return

  if (!currentHost) {
    throw new Error(
      'Route ' + component + ' declares host middleware (' + names.join(', ') +
        ') but no host callable is installed, so it cannot be checked.',
    )
  }

  const answer = await currentHost(HOST_MIDDLEWARE_FN, names)

  // Anything other than a literal true. A host answering null, undefined, a
  // string, or an object it happened to build on the way to an error is not
  // saying yes.
  if (answer !== true) {
    throw new Error('Host middleware refused ' + component + ' (' + names.join(', ') + ').')
  }
}


async function runMiddleware(component: string, props: Record<string, unknown> = {}): Promise<void> {
  await runHostMiddleware(component)

  // Read from the route table rather than passed in, so every render path is
  // covered by construction and no host has to remember to forward them.
  if (!middlewareChains) {
    middlewareChains = {}

    for (const route of manifest().routes as { component: string; middleware?: string[] }[]) {
      if (route.middleware?.length) middlewareChains[route.component] = route.middleware
    }
  }

  for (const name of middlewareChains[component] ?? []) {
    const guard = components[name]

    // A declared guard that is not in the bundle is not "no guard" — it is a
    // check that silently does not happen, which is the same reasoning the
    // host applies when the engine cannot run middleware at all. Currently
    // unreachable, because the chain and the component map come from one
    // discovery pass; it is one refactor away from being reachable, and this
    // is the place that has to fail closed.
    if (!guard) {
      throw new Error(
        'Route middleware ' + name + ' is declared for ' + component + ' but is not in the bundle.',
      )
    }

    // Sequential and awaited, outermost first: an outer guard refusing means
    // the inner one should never have been asked.
    await guard(props)
  }
}

// SPA-navigation Flight stream (worker: rsc-stream).
/**
 * Run a route's middleware without rendering anything.
 *
 * For a host serving a page it did not render: a frozen page is read from disk
 * and never touches the engine, so the check has to be asked for. Refusing
 * throws, exactly as it does mid-render.
 */
export async function runRouteMiddleware(component: string, props: Record<string, unknown> = {}): Promise<void> {
  applyHost()

  return runMiddleware(component, props)
}

export async function handleRscStream(
  component: string,
  props: Record<string, unknown> = {},
  layouts: LayoutEntry[] = [],
  loadings: string[] = [],
  parallelSlots: Record<string, string> = {},
  slotOverrides: Record<string, SlotOverride> = {},
  from = 0,
  pageKey = '',
): Promise<{ stream: ReadableStream; clientChunks: unknown; segmentDepth: number }> {
  applyHost()

  // The host proposes how much the client already has; the engine decides what
  // is actually safe to skip and reports back what it rendered.
  const start = segmentStart(from, layouts, parallelSlots, slotOverrides)

  // Before anything below them is rendered, never after.
  await runMiddleware(component, props)

  return {
    stream: renderToReadableStream(
      await renderTree(component, props, layouts, loadings, parallelSlots, slotOverrides, start, pageKey),
      { onError: flightOnError },
    ),
    clientChunks: {},
    segmentDepth: start,
  }
}

/**
 * The digest React sends to the client in place of a server error's message.
 *
 * A redirect thrown after the shell has flushed has no header left to travel
 * in — the status line is already sent. React transmits a digest for every
 * server error, in production as well as development, so the destination
 * rides there and the client's boundary performs it.
 *
 * redirectDigest is imported by the generated entry, at the top of this
 * template. An import added to this file instead compiles and bundles without
 * complaint, and then throws at render time against a name that is not there.
 *
 * Returning undefined leaves React's own behaviour alone for everything else.
 */
function flightOnError(error: unknown): string | undefined {
  const digest = redirectDigest(error)

  if (digest) return digest

  console.error('[rsc-routes]', error)

  return undefined
}

// Initial-load HTML stream + hydration payload (worker: rsc-html-stream).
export async function handleRscHtmlStream(
  component: string,
  props: Record<string, unknown> = {},
  layouts: LayoutEntry[] = [],
  loadings: string[] = [],
  parallelSlots: Record<string, string> = {},
  slotOverrides: Record<string, SlotOverride> = {},
  nonce?: string,
  pageKey = '',
  bootstrap = true,
): Promise<{ htmlStream: ReadableStream; rscPayloadPromise: Promise<string>; clientChunks: unknown }> {
  applyHost()
  await runMiddleware(component, props)
  const flight = renderToReadableStream(
    await renderTree(component, props, layouts, loadings, parallelSlots, slotOverrides, 0, pageKey, bootstrap),
    { onError: flightOnError },
  )
  const [forHtml, forPayload] = flight.tee()
  const rscPayloadPromise = new Response(forPayload).text()
  const ssr = await (import.meta as any).viteRsc.loadModule('ssr', 'index')
  const htmlStream = await ssr.handleSsr(forHtml, nonce, undefined, bootstrap)
  return { htmlStream, rscPayloadPromise, clientChunks: {} }
}

/**
 * Finish a shell that was frozen at build time.
 *
 * The render is an ordinary one — real host, real data, middleware included —
 * and the postponed state decides what of it actually reaches the wire. React
 * skips everything the shell already emitted and writes only the boundaries it
 * could not finish then.
 *
 * bootstrap is deliberately false. The shell shipped the bootstrap script; a
 * second one would boot the client runtime twice.
 */
export async function handleRscResume(
  component: string,
  props: Record<string, unknown> = {},
  layouts: LayoutEntry[] = [],
  loadings: string[] = [],
  parallelSlots: Record<string, string> = {},
  slotOverrides: Record<string, SlotOverride> = {},
  postponed: unknown = null,
  nonce?: string,
  pageKey = '',
): Promise<{ htmlStream: ReadableStream }> {
  applyHost()
  await runMiddleware(component, props)

  // The tree must be shaped exactly as it was when the shell was frozen, or
  // React cannot line the resumed segments up with the slots left for them:
  //
  //   Couldn't find all resumable slots by key/index during replaying.
  //   The tree doesn't match so React will fallback to client rendering.
  //
  // Hence \`true\` here rather than false. It reads like it would emit a second
  // bootstrap script, and it does not — resume() takes no bootstrap content at
  // all, so the shell's remains the only one. What this flag actually decides
  // is whether the tree carries its SegmentBoundary, and the shell's did.
  const flight = renderToReadableStream(
    await renderTree(component, props, layouts, loadings, parallelSlots, slotOverrides, 0, pageKey, true),
    { onError: flightOnError },
  )

  const ssr = await (import.meta as any).viteRsc.loadModule('ssr', 'index')
  const htmlStream = await ssr.handleSsrResume(flight, postponed, nonce)

  return { htmlStream }
}

// Server action (worker: rsc-action).
/** The page an action was invoked from, so what it invalidated can be rendered. */
interface PageContext {
  component: string
  props: Record<string, unknown>
  layouts: LayoutEntry[]
  loadings: string[]
  parallelSlots: Record<string, string>
  /**
   * The sections this route declares, which is what bounds a revalidate.
   *
   * Optional only because a host built against an older manifest may not send
   * it; absent, no named section can be revalidated at all. Refusing is the
   * safe reading — the alternative is the registry, which holds every section
   * in the app.
   */
  sections?: string[]
}

/**
 * Render one thing an action said it invalidated.
 *
 *   'all'   the whole document, layouts included
 *   'page'  everything below the layouts, which stay as they are
 *   <slot>  a single parallel slot, by the name its directory gave it
 *
 * A slot is the only unit smaller than a page the server can name, which is
 * why two tables have to be slots to be refreshed apart from each other.
 */
async function renderRevalidated(target: string, page: PageContext): Promise<unknown> {
  // Every target below 'all' renders without the layout chain above it, which
  // is the same skip a navigation performs and needs the same guard run.
  await runMiddleware(page.component, page.props)

  if (target === 'all' || target === 'page') {
    return renderTree(
      page.component,
      page.props,
      page.layouts,
      page.loadings,
      page.parallelSlots,
      {},
      target === 'all' ? 0 : page.layouts.length,
      '',
    )
  }

  // A named region first: it is the lighter of the two, and the one a page
  // reaches for when it only wants part of itself refreshed.
  //
  // Scoped to the sections this route declares. The registry is a module-level
  // map keyed by name, and the generated entry imports every component in the
  // app eagerly, so a name-keyed registry holds every section in the app by the
  // time a request arrives — and two pages may legitimately both call theirs
  // 'stats', where the last one loaded wins.
  //
  // So the target is resolved through the module this route declares, not
  // through a shared map: the manifest says which section files belong to this
  // page, the components map turns one into its module, and section() left the
  // unwrapped component on the export. Identity, rather than string matching.
  //
  // Read from the manifest rather than from the message. The host is not the
  // adversary here, but the route table is build-time truth and already in this
  // bundle, so there is no reason to depend on a field a host has to remember
  // to send — one that forgot would be silently unprotected.
  const owner = manifest().routes.find((route: any) => route.component === page.component)
  const declared: string[] = owner?.sections ?? page.sections ?? []

  // A target of orders names the file app/ledger/orders.section. Matched on
  // that stem, so a target cannot reach a sibling by suffix.
  const path = declared.find((name: string) => name.split('/').pop() === target + '.section')
  const Section = path ? sectionComponent(components[path]) : undefined

  // No throw here: the target may be a slot, which the branch below resolves.
  // A name that is a section of some *other* page simply does not match, falls
  // through, and is refused there — where the error can name both kinds.

  if (Section) {
    // The component, not the wrapper section() returned. The client replaces
    // what is inside the boundary, so sending the wrapper would nest a new
    // boundary inside the old one on every refresh.
    return createElement(Section, page.props)
  }

  // hasOwn, so a target of __proto__ or constructor names nothing.
  const slotComponent = Object.hasOwn(page.parallelSlots, target)
    ? page.parallelSlots[target]
    : undefined

  if (!slotComponent) {
    throw new Error(
      'Cannot revalidate ' + target + ': no section or slot of this page by that name. ' +
        'Sections: ' +
        (declared.map((n: string) => n.split('/').pop()!.replace('.section', '')).join(', ') ||
          'none') +
        '. Slots: ' +
        (Object.keys(page.parallelSlots).join(', ') || 'none'),
    )
  }

  const SlotComp = components[slotComponent]

  if (!SlotComp) throw new Error('Unknown RSC component: ' + slotComponent)

  return createElement(SlotComp, {
    params: Promise.resolve(page.props),
    searchParams: pageSearchParams(),
  })
}

export async function handleAction(
  actionId: string,
  body: string | FormData | Uint8Array,
  contentType = 'text/plain',
  page?: PageContext,
  takeRevalidated?: () => string[],
): Promise<{ stream: ReadableStream }> {
  applyHost()

  // Every body arrives as bytes on its own socket frame — an upload because it
  // has to, the rest because the transport does not special-case them. What
  // differs is what they decode to: multipart is FormData, everything else is
  // the text encodeReply produced.
  //
  // Treating only multipart as bytes and leaving the rest empty is a silent
  // failure: the action runs with no arguments at all.
  let decodable: string | FormData

  if (typeof body === 'string') {
    decodable = body
  } else if (contentType.includes('multipart/form-data')) {
    decodable = await new Response(body, { headers: { 'Content-Type': contentType } }).formData()
  } else {
    decodable = new TextDecoder().decode(body)
  }

  // Checked before decoding, because React's decoder does not fail cleanly on
  // a malformed payload: the parse error is raised inside a chunk nobody
  // awaits, so the promise decodeReply returned never settles. The caller
  // cannot catch that — no try/catch anywhere sees it — and the request hangs
  // while the rejection escapes. On Node, whose default is to exit on an
  // unhandled rejection, that is the whole process, reachable by anyone who
  // can post to the action endpoint.
  //
  // A reply that is not multipart is the JSON model encodeReply produced, so
  // parsing it is both the check and the whole of it.
  if (typeof decodable === 'string') {
    try {
      JSON.parse(decodable)
    } catch {
      throw new Error('Malformed server action body: expected the payload encodeReply produces.')
    }
  }

  const args = (await decodeReply(decodable)) as unknown[]
  const action = await loadServerAction(actionId)
  const result = await (action as (...a: unknown[]) => unknown)(...args)

  // Read after the action has run: what it invalidated is only known once its
  // host calls have been made. Rendering here rather than telling the browser
  // to ask is the whole point — the answer carries what went stale with it.
  const targets = takeRevalidated?.() ?? []

  if (targets.length === 0 || !page) {
    return { stream: renderToReadableStream(result) }
  }

  const revalidated: Record<string, unknown> = {}

  for (const target of targets) {
    revalidated[target] = await renderRevalidated(target, page)
  }

  // Marked, so an action whose own result happens to be an object with a
  // 'result' key is not mistaken for this envelope.
  return { stream: renderToReadableStream({ __rscRevalidated: revalidated, result }) }
}

export async function resolveMetadata(
  component: string,
  props: Record<string, unknown> = {},
  layouts: LayoutEntry[] = [],
): Promise<Record<string, unknown> | null> {
  const pageEntry = metadataMap[component]
  const page: Record<string, unknown> = pageEntry
    ? (pageEntry.generate
        // The same awaitables the page receives. Resolved rather than
        // suspending, even during the probe: a title has to be produced for
        // the shell, and there is no fallback for a <title>.
        ? ((await pageEntry.generate({
            params: Promise.resolve(props),
            searchParams: pageSearchParams(),
          })) ?? {})
        : { ...(pageEntry.static ?? {}) })
    : {}

  // Non-title metadata: layout defaults (outer→inner), page overrides.
  const merged: Record<string, unknown> = {}
  for (const l of layouts) {
    const s = metadataMap[l.component]?.static
    if (s) for (const [k, v] of Object.entries(s)) if (k !== 'title') merged[k] = v
  }
  for (const [k, v] of Object.entries(page)) if (k !== 'title') merged[k] = v

  // Title: the page title with the NEAREST layout title.template applied; if the
  // page has no title, the nearest layout default/string title.
  let title: string | undefined = typeof page.title === 'string' ? page.title : undefined
  for (let i = layouts.length - 1; i >= 0; i--) {
    const lt = metadataMap[layouts[i].component]?.static?.title as
      | string | { template?: string; default?: string } | undefined
    if (lt && typeof lt === 'object') {
      if (title != null && lt.template) { title = lt.template.replace('%s', title); break }
      if (title == null && lt.default) { title = lt.default; break }
    } else if (title == null && typeof lt === 'string') { title = lt; break }
  }
  if (title != null) merged.title = title

  return Object.keys(merged).length ? merged : null
}

// Buffered render (worker: rsc / rscWithoutCallbacks — used at prerender time).
export async function handleRsc(
  component: string,
  props: Record<string, unknown> = {},
  _callbackSocket: string | null = null,
  layouts: LayoutEntry[] = [],
  loadings: string[] = [],
  parallelSlots: Record<string, string> = {},
  from = 0,
  pageKey = '',
  bootstrap = true,
  canReachHost = true,
): Promise<{ body: string; rscPayload: string; clientChunks: unknown; usedDynamicApis: boolean; clientComponents: string[] }> {
  applyHost()

  // A build renders this with no host installed, so every rpc() has to suspend
  // rather than answer — which is what marks the page as needing a request.
  // Without the probe those calls found no host at all, and the page was
  // frozen holding whatever undefined rendered to.
  //
  // Defaults to true because the other caller is an interception, which runs
  // at request time with a real host and must not be probed.
  let usedDynamicApis = false

  const probe = (..._args: unknown[]) => {
    usedDynamicApis = true

    return new Promise<never>(() => {})
  }

  // Not a generic arrow function: this file is generated as .tsx, where <T>
  // parses as JSX and the build fails on a tag it cannot close.
  const runWith = canReachHost
    ? (fn: () => Promise<unknown>) => fn()
    : (fn: () => Promise<unknown>) => probeHost.run(probe, fn)

  // renderTree (not bare buildElement) so the prerendered Flight payload carries
  // the same <title>/<meta> elements the live SPA payload does.
  const tree = await runWith(() =>
    renderTree(component, props, layouts, loadings, parallelSlots, {}, from, pageKey, bootstrap),
  )

  const flight = renderToReadableStream(tree, { onError: flightOnError })
  const [forHtml, forPayload] = flight.tee()
  const rscPayload = await new Response(forPayload).text()
  const ssr = await (import.meta as any).viteRsc.loadModule('ssr', 'index')
  const htmlStream = await ssr.handleSsr(forHtml, undefined, undefined, bootstrap)
  const body = await new Response(htmlStream).text()

  return {
    body,
    rscPayload,
    clientChunks: {},
    usedDynamicApis,
    // Client reference rows name the components the browser has to run. Shipping
    // no runtime would leave them as inert markup, so the host refuses — and
    // says which components forced the decision, since they are usually in a
    // shared layout rather than the page itself.
    clientComponents: clientReferenceNames(rscPayload),
  }
}

/**
 * Names of the client components a payload references.
 *
 * A row reads 1:I["<module>",[],"Name",1]; the fourth quoted field is the
 * export. Parsed by splitting rather than matching, because this function is
 * emitted into a template literal where a regex would need double escaping.
 */
function clientReferenceNames(payload: string): string[] {
  const names = new Set<string>()

  for (const row of payload.split(':I[').slice(1)) {
    const name = row.split('"')[3]
    if (name) names.add(name)
  }

  return [...names]
}

// Flight payload only (worker: rsc-payload — build-time).
//
// The segment variant of a prerendered route needs the payload and nothing
// else. handleRsc also renders the HTML, which for that variant is built and
// thrown away — a whole SSR pass per route for output nobody reads.
/**
 * Render one thing on its own, for a client asking to refresh it.
 *
 * The same targets an action can mark. This is the path for a refresh nobody
 * mutated anything to earn — a button, a poll, a websocket saying the orders
 * table moved.
 */
export async function handleRscRevalidate(
  target: string,
  page: PageContext,
): Promise<{ rscPayload: string }> {
  applyHost()

  const flight = renderToReadableStream(await renderRevalidated(target, page))

  return { rscPayload: await new Response(flight).text() }
}

export async function handleRscPayload(
  component: string,
  props: Record<string, unknown> = {},
  layouts: LayoutEntry[] = [],
  loadings: string[] = [],
  parallelSlots: Record<string, string> = {},
  from = 0,
  pageKey = '',
): Promise<{ rscPayload: string }> {
  applyHost()

  const flight = renderToReadableStream(
    await renderTree(component, props, layouts, loadings, parallelSlots, {}, from, pageKey),
    { onError: flightOnError },
  )

  return { rscPayload: await new Response(flight).text() }
}

// PPR shell + classification (worker: rsc-ppr-shell — build-time).
//
// php() is replaced by a probe that records the call and never resolves, so
// every subtree depending on per-request data stays suspended while everything
// static renders normally. Whatever React has flushed when the deadline passes
// IS the shell: layouts, static markup, and Suspense fallbacks.
//
// The two flags this returns are what the prerender pipeline classifies on:
//   usedDynamicApis — the page touched php(), so it cannot be frozen whole
//   timedOut        — the render never finished, i.e. it is still waiting on
//                     data, so only the shell is safe to cache
// A page that sets neither is genuinely static and can be prerendered fully.
const PPR_SHELL_TIMEOUT_MS = Number(process.env.RSC_PPR_TIMEOUT_MS || 2000)

export async function handleRscPprShell(
  component: string,
  props: Record<string, unknown> = {},
  layouts: LayoutEntry[] = [],
  loadings: string[] = [],
  parallelSlots: Record<string, string> = {},
  // The url this shell will be served for, when it is served for exactly one.
  // Empty for a parameterised route, whose shell is shared across every url it
  // matches and therefore cannot carry one.
  pageKey = '',
  // How long to let the render run before taking whatever has flushed.
  //
  // A parameter because not every caller is asking the same question. Deciding
  // what a page's shell IS needs the full budget — the point is to wait out
  // everything that can resolve. Asking whether anything paints at all without
  // a root fallback is a boolean about the first flush, and a page that paints,
  // paints immediately: giving that the same budget spends two seconds per
  // route to learn nothing the first millisecond did not say.
  budgetMs = PPR_SHELL_TIMEOUT_MS,
  // Whether this build can answer host calls.
  //
  // False is the old and still the usual answer: the stub suspends, and a page
  // reaching for its host becomes a shell rather than freezing data fetched
  // once at build time.
  //
  // A host that opened a callback socket for the build says true, and then the
  // call is made and its answer stored. That is the only way a Laravel page can
  // be static at all, since a host call is the only route its data has — and
  // connection() is how such a page opts back out.
  //
  // Asked of the caller rather than read from whatever host happens to be
  // installed, because those are different statements: a test that installed
  // one is not a build that can reach PHP.
  canReachHost = false,
): Promise<{ shellHtml: string; clientChunks: unknown; timedOut: boolean; usedDynamicApis: boolean; error?: string }> {
  // Deliberately no middleware here. The probe is asking whether the content is
  // the same for everyone, which is a question about the page. Whether a
  // particular caller may see it is a question about the request, and there is
  // no request at build time — running a guard here would refuse every time
  // and make every guarded route dynamic for the wrong reason.
  let usedDynamicApis = false

  applyHost()

  const probe = (..._args: unknown[]) => {
    usedDynamicApis = true

    // Never resolves: the awaiting component suspends and React renders its
    // Suspense fallback into the shell instead of the real content.
    return new Promise<unknown>(() => {})
  }

  let shellHtml = ''
  let completed = false
  let error: string | undefined
  let postponed: unknown = null

  // The budget, declared before the error handler that consults it.
  const controller = new AbortController()
  const budget = setTimeout(() => controller.abort(), budgetMs)

  // Anything that failed while producing this shell.
  //
  // A rejection inside a Suspense boundary does NOT reach the caller: React
  // catches it, keeps the fallback, and the render goes on to finish. So the
  // probe looked like a page that had nothing left to do — no postponed state,
  // no thrown error — and the fallback was frozen as a finished static page.
  // A database the build machine cannot reach produced a permanently loading
  // page, stored, with the build reporting success.
  let renderFailure: string | undefined

  const noteFailure = (e: unknown): string | undefined => {
    const digest = redirectDigest(e)

    // A redirect is a classification here, not a failure.
    if (digest) return digest

    // Every probe ends by aborting, so React reports that abort. Asked of the
    // signal rather than matched against the message: a string test would be a
    // guess about wording, and would quietly stop working when React changed it.
    if (controller.signal.aborted) return undefined

    renderFailure ??= e instanceof Error ? e.message : String(e)
    console.error('[rsc-routes]', e)

    return undefined
  }

  // The budget is an abort signal rather than a race. \`prerender\` resolves when
  // it is aborted, handing back both what flushed and where it stopped, so there
  // is nothing left to cancel by hand and no window in which the render is still
  // going after the caller has moved on.

  // Everything the render does happens inside the scope, so the stand-in host
  // travels with it rather than with the process.
  const runWith = canReachHost
    ? (fn: () => Promise<void>) => fn()
    : (fn: () => Promise<void>) => probeHost.run(probe, fn)

  const produce = runWith(async () => {
    try {
      // Params settle only when this probe is for one concrete url. A route
      // that listed its urls is being rendered for one of them, so the page
      // can be frozen whole; a route that listed none is being rendered for
      // the pattern, where any value would be an invention.
      const tree = await renderTree(
        component,
        props,
        layouts,
        loadings,
        parallelSlots,
        {},
        0,
        pageKey,
        true,
        pageKey ? Promise.resolve(props) : new Promise(() => {}),
      )
      // Quiet about a redirect: during the probe it is a classification, not
      // a failure, and React would otherwise print a stack for every one.
      const flight = renderToReadableStream(tree, { onError: noteFailure })
      const ssr = await (import.meta as any).viteRsc.loadModule('ssr', 'index')
      // The flight stream stays open across this. A Flight stream that has
      // closed tells the decoder the connection ended, so the boundary waiting
      // on it errors rather than staying pending — and an errored boundary is
      // finished, not postponed: it comes back null and there is nothing left
      // to resume from.
      const prerendered = await ssr.handleSsrPrerender(flight, {
        signal: controller.signal,
        onError: noteFailure,
      })

      postponed = prerendered.postponed

      const reader = prerendered.prelude.getReader()
      const decoder = new TextDecoder()

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        shellHtml += decoder.decode(value, { stream: true })
      }

      completed = true
    } catch (e: any) {
      error = e?.message ?? String(e)
    }
  })

  await produce
  clearTimeout(budget)

  // timedOut used to mean the stopwatch ran out. It now means React has
  // boundaries it could not finish — the thing the caller was always asking
  // about, and exact rather than inferred: a page that finishes inside the
  // budget says so by postponing nothing.
  return {
    shellHtml,
    clientChunks: {},
    timedOut: postponed !== null,
    usedDynamicApis,
    error,
    postponed,
    renderFailure,
  }
}

/**
 * What \`vite dev\` serves.
 *
 * @vitejs/plugin-rsc's dev server calls this module's default export for every
 * request, so implementing it is the whole of dev mode: the same handler the
 * production server builds, over the same route table, against modules Vite
 * re-evaluates on edit. Nothing is prebuilt, so there is no build to keep in
 * step and no NODE_ENV to match — this is React's development build because
 * Vite is running in development.
 *
 * Assets and prerendered pages are deliberately absent. Vite serves its own
 * assets in dev, and a frozen page is a build artifact: serving one here would
 * hand back the last build's HTML for a file just edited.
 */
let devHandler: ((request: Request) => Promise<Response | null>) | null = null

export default async function handler(request: Request): Promise<Response> {
  devHandler ??= createRscHandler({
    engine: {
      manifest,
      getStaticParams,
      installHostFn,
      handleRsc,
      handleRscStream,
      handleRscHtmlStream,
      handleRscRevalidate,
      handleRscPayload,
      handleRscPprShell,
      handleRscResume,
      handleAction,
      resolveMetadata,
      runRouteMiddleware,
    } as never,
  })

  return (await devHandler(request)) ?? new Response('Not found', { status: 404 })
}
`
}

function generateEntrySsr(): string {
  const devUrls = join(packageDir, 'devUrls')

  return `// GENERATED by rscRoutes() — do not edit.
import { createFromReadableStream } from '@vitejs/plugin-rsc/ssr'
import { renderToReadableStream, resume } from 'react-dom/server.edge'
import { prerender } from 'react-dom/static.edge'
import { rewriteViteDevUrlStream } from ${JSON.stringify(devUrls)}

// Set only by the dev server. @vitejs/plugin-rsc emits its bootstrap and CSS
// links root-relative in dev, which would send the browser to the host for
// modules only Vite can answer — see devUrls.ts.
const DEV_ORIGIN = ${JSON.stringify(devOrigin)}

export async function handleSsr(
  rscStream: ReadableStream,
  nonce?: string,
  onError?: (error: unknown) => void,
  bootstrap = true,
): Promise<ReadableStream> {
  const root = await createFromReadableStream(rscStream)

  // Without the bootstrap the page ships no client runtime at all: no React,
  // no Flight client, no router. HTML only. A page with nothing interactive on
  // it has no use for 70kB of hydration.
  const bootstrapScriptContent = bootstrap
    ? await (import.meta as any).viteRsc.loadBootstrapScriptContent('index')
    : undefined

  // Without an onError handler React rejects each abortable task on its own,
  // and those rejections surface as unhandled — noisy for the PPR shell render,
  // which aborts on purpose once it has the shell.
  const html = await renderToReadableStream(root as any, {
    bootstrapScriptContent,
    nonce,
    onError: onError ?? ((error: unknown) => { console.error('[rsc-routes:ssr]', error) }),
  })

  return DEV_ORIGIN ? rewriteViteDevUrlStream(html, DEV_ORIGIN) : html
}

/**
 * The same render, stopped at the first thing it cannot finish.
 *
 * \`renderToReadableStream\` and then cancelling gives you the bytes that
 * flushed and nothing else — the render is *aborted*, so React has no record of
 * where it got to. \`prerender\` aborts the same way but hands back
 * \`postponed\`: enough state to pick the render back up later, against data
 * that did not exist at build time.
 *
 * The rscStream must still be OPEN when this returns. A Flight stream that has
 * closed tells the decoder the connection ended, so the boundary waiting on it
 * *errors* rather than staying pending — and an errored boundary is not
 * postponed, it is finished. \`postponed\` comes back null and there is nothing
 * to resume.
 */
export async function handleSsrPrerender(
  rscStream: ReadableStream,
  options: { nonce?: string; bootstrap?: boolean; signal?: AbortSignal } = {},
): Promise<{ prelude: ReadableStream; postponed: unknown }> {
  const root = await createFromReadableStream(rscStream)

  const bootstrapScriptContent =
    options.bootstrap === false
      ? undefined
      : await (import.meta as any).viteRsc.loadBootstrapScriptContent('index')

  const { prelude, postponed } = await prerender(root as any, {
    bootstrapScriptContent,
    nonce: options.nonce,
    signal: options.signal,
    // Aborting is how this ends, so React's report of it is not news.
    onError: () => {},
  })

  return {
    prelude: DEV_ORIGIN ? rewriteViteDevUrlStream(prelude, DEV_ORIGIN) : prelude,
    postponed: postponed ?? null,
  }
}

/**
 * Pick a build-time render back up, against data that exists now.
 *
 * Emits ONLY what the shell left unfinished — the hidden segments plus React's
 * own script to move them into place. It is meant to be concatenated after the
 * shell, and it carries no bootstrap of its own: the shell already shipped one.
 *
 * The swap is done by that inline script, not by hydration, so the holes land
 * even on a page whose JavaScript never loads.
 */
export async function handleSsrResume(
  rscStream: ReadableStream,
  postponed: unknown,
  nonce?: string,
): Promise<ReadableStream> {
  const root = await createFromReadableStream(rscStream)

  const html = await resume(root as any, postponed as any, {
    nonce,
    onError: (error: unknown) => { console.error('[rsc-routes:resume]', error) },
  })

  return DEV_ORIGIN ? rewriteViteDevUrlStream(html, DEV_ORIGIN) : html
}
`
}

function generateEntryBrowser(): string {
  const clientBootstrap = join(packageDir, 'js/createViteRscApp')

  // Only for an exported build, and only what the client needs to work out how
  // much of a page to ask for: a file server sends no headers, so without this
  // every navigation takes the whole document and replaces the root. Inlined
  // rather than fetched, so it costs no request. Omitted entirely otherwise —
  // a server answers this, and shipping a route table to every browser for
  // nothing is a page-weight cost with no benefit.
  const routesForClient = staticPayloads
    ? routeManifest().routes.map((route) => ({ segments: route.segments, layouts: route.layouts }))
    : null

  const refreshModule = join(packageDir, 'js/navigate')

  return `// GENERATED by rscRoutes() — do not edit.
import { createViteRscApp } from ${JSON.stringify(clientBootstrap)}
import { refresh } from ${JSON.stringify(refreshModule)}

createViteRscApp(document, ${JSON.stringify(interceptManifest())}, ${JSON.stringify({
    staticPayloads: staticPayloads || null,
    routes: routesForClient,
  })})

// A server component is not a module the browser has, so Vite cannot replace
// it the way it replaces a client one. @vitejs/plugin-rsc says so instead:
// when a module in the rsc graph changes it sends this, and re-fetching the
// payload is the update. Without a listener an edit to a page reaches the
// server and stops there, and the browser goes on showing the old render
// until someone reloads by hand.
//
// 'all', not 'page': a layout is a server component too, and refreshing only
// below it would leave an edited layout on screen unchanged. It costs nothing
// extra — a client component below is remounted either way, because the new
// payload carries a fresh reference to its module. Editing that component
// directly is the case where state survives, and that is Fast Refresh doing
// it rather than this.
if (import.meta.hot) {
  import.meta.hot.on('rsc:update', () => {
    void refresh('all')
  })
}
`
}

/**
 * Intercepted URL patterns, published by the host before the build.
 *
 * The client has to recognise an intercepted link before it asks the server,
 * so the patterns are baked into the browser entry. The host owns the file
 * because it owns route discovery; an absent or unreadable one just means no
 * interception, never a failed build.
 */
/**
 * The intercepted urls the client router has to recognise, in its dialect.
 *
 * Generated here rather than read from a file the host wrote. The host used to
 * discover these because it owned the walk of app/; now the plugin does, and a
 * host writing them meant producing this file before the build that needed it —
 * an ordering that only worked because the two steps happened to be in the
 * right sequence.
 */
function interceptManifest(): Array<{ urlPattern: string; slot: string }> {
  return routeManifest().intercepts.map((entry) => ({
    // The client writes [id] where a Laravel route writes {id}.
    urlPattern:
      '/' +
      entry.segments
        .map((seg) => (seg.type === 'static' ? seg.value : '[' + seg.value + ']'))
        .join('/'),
    slot: entry.slot,
  }))
}

// ── Validation ───────────────────────────────────────────────────────────────

/**
 * Extract the body of a file's default-exported function.
 *
 * Only the page component's OWN body matters for the loading.tsx rule — sibling
 * components declared in the same file render behind their own boundaries, so
 * their host calls do not block the route's shell.
 */
function defaultExportBody(source: string): string | null {
  const match = source.match(/export\s+default\s+(?:async\s+)?function[^(]*\([^)]*\)\s*{/)
  if (!match) return null

  // Walk from the opening brace to its match, ignoring braces in strings.
  let depth = 0
  const start = match.index! + match[0].length - 1

  for (let i = start; i < source.length; i++) {
    const ch = source[i]
    if (ch === '{') depth++
    else if (ch === '}' && --depth === 0) return source.slice(start, i + 1)
  }

  return null
}

/**
 * Does the page component's own render block on the host callable?
 *
 * Only an awaited call blocks. Starting a call and handing the promise to a
 * child — for a client component to unwrap with use() inside its own Suspense
 * boundary — lets the page paint immediately and needs no loading.tsx.
 *
 * The check is deliberately syntactic: a call awaited indirectly, through a
 * variable, is not caught. That errs toward letting a build through rather than
 * rejecting a page that is actually fine.
 */
function pageBlocksOnHostCall(source: string): boolean {
  const isAsyncDefault = /export\s+default\s+async\s+function/.test(source)
  if (!isAsyncDefault) return false

  const body = defaultExportBody(source)

  // Matches `await rpc(`, and the explicitly-qualified forms a typed codebase
  // may use: `await globalThis.rpc(` / `await (globalThis as any).rpc(`.
  const qualifier = '(?:\\(\\s*globalThis[^)]*\\)\\s*\\.\\s*|globalThis\\s*\\.\\s*)?'
  const awaited = new RegExp(`\\bawait\\s+${qualifier}${hostGlobal}\\s*[<(]`)

  return body !== null && awaited.test(body)
}

/** Walk up from the page directory to app/ looking for a loading file. */
function hasLoadingInChain(pageDir: string): boolean {
  let dir = pageDir

  while (dir.startsWith(appDir)) {
    if (findRouteFile(dir, 'loading')) return true
    if (dir === appDir) break
    dir = dirname(dir)
  }

  return false
}

/**
 * A route needs loading.tsx only when the PAGE ITSELF blocks — an async default
 * export awaiting the host callable, or the host resolving props dynamically. Both
 * suspend before anything can paint, so without a boundary the user sees a
 * blank screen. A page whose slow work lives in children behind their own
 * <Suspense> already paints a shell and needs nothing.
 */
function validateLoadingBoundaries(): string[] {
  const errors: string[] = []

  for (const c of components.values()) {
    if (!c.name.endsWith('/page') && c.name !== 'app/page') continue

    const pageDir = dirname(c.absPath)
    const source = readFileSync(c.absPath, 'utf-8')

    let reason: string | null = null

    if (pageBlocksOnHostCall(source)) {
      reason = `its default export awaits ${hostGlobal}()`
    } else {
      const configPath = routeConfig ? join(pageDir, routeConfig.file) : null

      if (routeConfig && configPath && existsSync(configPath) && routeConfig.dynamicPattern.test(readFileSync(configPath, 'utf-8'))) {
        reason = `${routeConfig.file} resolves props dynamically`
      }
    }

    if (reason && !hasLoadingInChain(pageDir)) {
      errors.push(`  ${c.name} — ${reason}, but has no loading.tsx in its directory chain`)
    }
  }

  return errors
}


// ── Plugin ───────────────────────────────────────────────────────────────────

/** Names of plugins that transform JSX and must run after rsc() has split it. */
const JSX_PLUGIN_PATTERN = /react|babel|oxc/i

export function rscRoutes(options: RscRoutesOptions = {}): PluginOption[] {
  resolvePaths(options)

  const routesPlugin: Plugin = {
    name: 'rsc-routes',

    config(_config, env) {
      if (!existsSync(appDir)) {
        throw new Error(`[rsc-routes] No app directory at ${appDir} — nothing to build.`)
      }

      components.clear()
      discover(appDir)
      log(`Discovered ${components.size} route components:`, [...components.keys()].join(', '))

      const loadingErrors = validateLoadingBoundaries()

      if (loadingErrors.length) {
        throw new Error(
          '[rsc-routes] A page that blocks before it can paint needs a loading.tsx boundary.\n\n' +
            loadingErrors.join('\n') +
            '\n\nAdd loading.tsx in the page directory (or a parent), or move the slow work\n' +
            'into a child component wrapped in its own <Suspense> so the page can paint.',
        )
      }

      // Before the entries, because the app's own source imports these and the
      // module graph is walked as soon as this hook returns.
      const manifest = routeManifest()

      writeHostBindings(manifest)

      if (existsSync(genDir)) rmSync(genDir, { recursive: true, force: true })
      mkdirSync(genDir, { recursive: true })

      writeFileSync(join(genDir, 'entry.rsc.tsx'), generateEntryRsc())
      writeFileSync(join(genDir, 'entry.ssr.tsx'), generateEntrySsr())
      writeFileSync(join(genDir, 'entry.browser.tsx'), generateEntryBrowser())

      // Written beside the entries, for a host to read instead of walking the
      // route tree itself. Laravel scans it a second time today; a JS host
      // would otherwise have to write a third walk of the same directories.
      writeFileSync(join(outDir, 'routes.json'), JSON.stringify(manifest, null, 2))

      return {
        // Off, not merely unused: Vite warns when publicDir sits inside outDir,
        // and assetsDir is normally a directory under the build output. An app
        // that wants static files can set its own publicDir outside it.
        publicDir: false,
        /**
         * The mode this was built in, baked into the server bundles.
         *
         * Vite substitutes `process.env.NODE_ENV` for a client build and
         * leaves it alone for the server ones, because server code runs where
         * `process.env` is real. Reasonable in general, and wrong here: React
         * picks its build from that expression when its module is first
         * evaluated, so leaving it to the runtime makes every server carry a
         * NODE_ENV it must not get wrong — and a production bundle started
         * without one renders every page perfectly and hydrates none of them.
         *
         * The build already knows which mode it is. Saying so here means the
         * answer travels with the bundle instead of with whoever starts it.
         */
        define: {
          'process.env.NODE_ENV': JSON.stringify(
            env.mode === 'development' ? 'development' : 'production',
          ),
        },
        /*
         * This package's client modules are served as source, never
         * pre-bundled.
         *
         * Vite treats an installed package as a dependency and optimizes it,
         * which binds its JSX imports to one particular optimized
         * react/jsx-runtime chunk. The moment Vite discovers another dependency
         * and re-optimizes, that chunk's hash changes and the binding breaks:
         *
         *   SyntaxError: The requested module '.../react_jsx-runtime.js?v=...'
         *   does not provide an export named 't'
         *
         * Which reads as a React or a bundler bug. What it does is take down
         * every page importing Link or Form — the shell renders, hydration
         * throws, React unmounts the document, and the page goes blank with
         * that message the only clue.
         *
         * Excluded rather than pinned, because the package already ships ESM
         * that needs no conversion. The app's own excludes are kept.
         */
        optimizeDeps: {
          exclude: [PACKAGE_NAME, ...(_config.optimizeDeps?.exclude ?? [])],
        },
        // Public URL for browser-facing client assets, and a BUILD concern
        // only: it says where the built files will be served from.
        //
        // Applying it in dev makes it Vite's public base, and then the dev
        // server answers pages only under that prefix — every route 404s with
        // "The server is configured with a public base URL", which reads as a
        // routing bug rather than as this line. In dev the pages are the root;
        // the assets come from the same origin either way.
        base: env.command === 'build' ? assetsBaseUrl : '/',
        root: outDir,
        // Force single instances of React/RSC runtime — critical when the
        // package is symlinked (local dev / monorepo), else "use client"
        // components SSR against a second React copy and hooks throw.
        //
        // react-server-dom-webpack is deliberately absent: @vitejs/plugin-rsc
        // vendors its own copy, nothing here imports the specifier, and the
        // built bundles reference it zero times — deduping it was a no-op left
        // over from the hand-rolled engine.
        resolve: {
          dedupe: ['react', 'react-dom', '@vitejs/plugin-rsc'],
          // `import Link from '<packageAlias>/Link'` resolves to the client
          // runtime shipped here, for hosts that vendor this package outside
          // node_modules. Installed from npm the name resolves on its own.
          alias: aliasEntries(),
        },
        build: { emptyOutDir: true },
        environments: {
          // Server bundles — stay under the (non-public) out dir.
          rsc: { build: { rollupOptions: { input: { index: join(genDir, 'entry.rsc.tsx') } } } },
          ssr: { build: { rollupOptions: { input: { index: join(genDir, 'entry.ssr.tsx') } } } },
          // Client bundle — emitted into public/ for the web server to serve.
          client: {
            build: {
              outDir: publicAssetsDir,
              emptyOutDir: true,
              rollupOptions: { input: { index: join(genDir, 'entry.browser.tsx') } },
            },
          },
        },
      }
    },

    /**
     * Restart when the route tree changes shape.
     *
     * The entries and the route table are generated in `config()`, which runs
     * once. An edit to a page is picked up because Vite re-evaluates the
     * module, but a page that did not exist when the server started is not in
     * the table — the request 404s, and the file is right there on disk, which
     * is a confusing thing to be told.
     *
     * Only add and unlink: a change to an existing file needs no new table,
     * and restarting on every keystroke would throw away the module graph for
     * nothing.
     */
    configureServer(server) {
      // rpc() has to reach the backend while the dev server is serving.
      //
      // A built deployment installs this itself: the server running
      // createRscHandler passes `hostCalls`. Nothing does that here, and with
      // no host installed every rpc() is refused — so a page whose data comes
      // from the backend renders its shell and then blanks, which reads as a
      // hydration bug rather than a missing wire.
      server.httpServer?.once('listening', async () => {
        const env = server.environments?.rsc as
          | { runner?: { import(id: string): Promise<Record<string, unknown>> } }
          | undefined

        if (!env?.runner) return

        // The app's own .env, unprefixed. A Laravel app already has both of
        // these, which is what makes this need no configuring: APP_URL is the
        // backend and RSC_HOST_CALL_SECRET is the secret it checks.
        const fromEnv = loadEnv(server.config.mode, projectRoot, '')
        const secret = hostCallOptions?.secret ?? fromEnv.RSC_HOST_CALL_SECRET
        const origin = hostCallOptions?.endpoint ?? fromEnv.RSC_BACKEND ?? fromEnv.APP_URL

        if (!secret || !origin) return

        const path = hostCallOptions?.path ?? fromEnv.RSC_HOST_CALL_PATH ?? '/__rsc/host-call'
        const endpoint = origin.replace(/\/$/, '') + path

        try {
          const entry = await env.runner.import(join(genDir, 'entry.rsc.tsx'))
          const install = entry.installHostFn as ((fn: unknown) => void) | undefined

          install?.(httpHostCalls({ endpoint, secret }))
        } catch (error) {
          // Reported rather than thrown: the dev server is still useful for
          // every page that needs no data, and a failure here would otherwise
          // look like the server refusing to start.
          server.config.logger.warn(
            `[rsc-routes] could not wire host calls to ${endpoint}: ` +
              (error instanceof Error ? error.message : String(error)),
          )
        }
      })

      // Written once the server is listening, because only then is the port
      // known. Removed on shutdown so a backend can tell a dev server that is
      // gone from one that is merely slow to answer.
      if (hotFile) {
        const remove = () => {
          try {
            if (existsSync(hotFile)) rmSync(hotFile)
          } catch {}
        }

        server.httpServer?.once('listening', () => {
          // The url Vite resolved, not one built from the port. A dev server
          // whose port is already taken on IPv4 binds IPv6 only and keeps the
          // number — so http://127.0.0.1:<port> is a reachable-looking address
          // that nothing answers, and the backend reports the renderer as down
          // while it is plainly running.
          const resolved = server.resolvedUrls?.local?.[0]
          const address = server.httpServer?.address()

          const url =
            resolved ??
            (typeof address === 'object' && address
              ? `http://${address.family === 'IPv6' ? `[${address.address}]` : address.address}:${address.port}`
              : null)

          if (!url) return

          mkdirSync(dirname(hotFile), { recursive: true })
          writeFileSync(hotFile, url.replace(/\/$/, ''))
        })

        for (const signal of ['SIGINT', 'SIGTERM', 'exit'] as const) {
          process.once(signal, remove)
        }

        server.httpServer?.once('close', remove)
      }

      const shapes = new Set(ROUTE_FILES.map((name) => name))

      const affectsRouting = (file: string): boolean => {
        if (!file.startsWith(sourceDir)) return false

        const base = file.split('/').pop() ?? ''
        const stem = base.replace(/\.(tsx|jsx|ts|js)$/, '')

        // The host's route-config file, whatever it named it. Hardcoding one
        // here would put a backend's convention back into a plugin that is
        // published without any — generic-host.test.ts fails if it reappears.
        return (
          (base !== stem && shapes.has(stem)) ||
          SECTION_FILE.test(base) ||
          (routeConfig !== null && base === routeConfig.file)
        )
      }

      const restart = (file: string) => {
        if (!affectsRouting(file)) return

        server.config.logger.info(`[rsc-routes] route tree changed (${file.slice(sourceDir.length + 1)}) — restarting`)
        void server.restart()
      }

      // Watched explicitly: the Vite root is the *out* directory, so the app's
      // source tree is outside it and nothing would report a file appearing.
      server.watcher.add(sourceDir)

      server.watcher.on('add', restart)
      server.watcher.on('unlink', restart)
    },

    /**
     * Freeze what can be frozen, once every bundle exists.
     *
     * `buildApp` runs after all three environments are built, which is the
     * first moment the rsc bundle can be imported — prerendering is the app
     * rendering itself, so it needs the thing the build just produced. This
     * plugin is ordered after @vitejs/plugin-rsc's, so its own buildApp has
     * already run and the bundles are on disk.
     *
     * Automatic because the alternative is a second command to remember, and
     * forgetting it costs the whole difference silently: every page still
     * works, each one just renders again for every visitor.
     *
     * Skipped in watch mode. A rebuild on every keystroke that also re-renders
     * every route is not a feedback loop anyone wants.
     */
    async buildApp() {
      if (isWatch) return

      // Say what the build did, even when it stored nothing.
      //
      // Turning prerendering off used to print no classification at all — no
      // marks, no legend, no counts — so a build that stored nothing looked
      // exactly like a build that had not got to that step. Every route renders
      // per visitor now, which is a thing worth being told rather than left to
      // infer from an absence.
      if (!prerenderAfterBuild) {
        reportAllDynamic()

        return
      }

      await prerenderAfterBundles()
    },

    configResolved(config: ResolvedConfig) {
      isWatch = config.build?.watch != null
      // rsc() splits the module graph into client and server; a JSX transform
      // placed ahead of it sees the wrong graph and fails in ways that are hard
      // to trace back here. Cheaper to refuse than to let it through.
      const names = config.plugins.map((p) => p.name)
      const rscAt = names.findIndex((n) => n === 'rsc' || n.startsWith('rsc:'))
      const jsxAt = names.findIndex((n) => JSX_PLUGIN_PATTERN.test(n))

      if (rscAt !== -1 && jsxAt !== -1 && jsxAt < rscAt) {
        throw new Error(
          `[rsc-routes] Plugin "${names[jsxAt]}" is resolved ahead of rsc(), so it would ` +
            'transform JSX before the client/server split.\n' +
            'Put rscRoutes() first in your plugins array. If it already is, that plugin ' +
            "sets enforce: 'pre' and needs to be moved after rsc() explicitly.",
        )
      }
    },
  }

  // rsc() ships as several plugins, and it has to lead. A promise is a legal
  // member of a Vite plugins array and is flattened in place, so this keeps
  // rscRoutes() one entry in the app's config while still resolving the
  // plugin at call time — see appPluginRsc for why that matters.
  return [appPluginRsc(), routesPlugin]
}

/**
 * @vitejs/plugin-rsc, resolved from the app rather than from here.
 *
 * `isRunnableDevEnvironment` is an instanceof check that plugin-rsc runs
 * against its own copy of Vite. Two copies — this package's and the app's —
 * make a perfectly runnable environment report false, and the message names
 * the environment rather than the duplication.
 *
 * That is not a hypothetical layout. It is what installing this package from a
 * directory produces, because the checkout carries its own devDependencies:
 * the app runs its Vite, this file imports that Vite's plugin, and the two
 * never recognise each other. A build never reaches the check, so everything
 * works right up until dev mode.
 *
 * Resolving from the project root gets the app's copy, whose own `vite` import
 * then resolves to the app's Vite as well — one pair, and the check passes.
 */
async function appPluginRsc(): Promise<PluginOption[]> {
  try {
    // Resolved against a file *in* the root, since a directory specifier
    // resolves relative to its parent.
    const fromApp = createRequire(join(projectRoot, 'package.json'))
    const entry = fromApp.resolve('@vitejs/plugin-rsc')
    const mod = (await import(pathToFileURL(entry).href)) as { default: typeof rsc }

    return (mod.default ?? rsc)()
  } catch {
    // The app does not have its own; one copy, and the bundled import is it.
    return rsc()
  }
}
