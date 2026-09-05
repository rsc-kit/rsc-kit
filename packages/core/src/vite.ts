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
import type { Plugin, PluginOption, ResolvedConfig } from 'vite'
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

/** hostActions supplied through the environment, for out-of-process hosts. */
function envHostActions(): Record<string, string> {
  const raw = process.env.RSC_HOST_ACTIONS

  if (!raw) return {}

  return JSON.parse(raw) as Record<string, string>
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
  hostActions = options.hostActions ?? envHostActions()
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
  import type { RscEngine } from '@rsc-router/core/host'
  import type { PrerenderEngine } from '@rsc-router/core/prerender'

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
async function prerenderAfterBundles(): Promise<void> {
  const bundle = join(outDir, 'dist/rsc/index.js')

  if (!existsSync(bundle)) return

  const [{ prerender }, { writeTo }] = await Promise.all([
    import('./prerender.js'),
    import('./files.js'),
  ])

  const staticDir = join(outDir, 'static')

  // Cleared first: a route that changes classification between builds
  // otherwise leaves its old shell on disk and the host goes on serving it.
  // Nothing warns — the page loads, with content from the previous build.
  rmSync(staticDir, { recursive: true, force: true })

  const engine = (await import(pathToFileURL(bundle).href)) as never
  const mark: Record<string, string> = { frozen: '○', shell: '◔', error: '✗' }
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
  ○  the whole page is stored
  ◔  the chrome is stored; the rest is rendered per request

  ${count('frozen')} stored, ${count('shell')} shells`)

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
 * The app's routes as a union, for `@rsc-router/core/routes` to derive from.
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
    "declare module '@rsc-router/core/routes' {",
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
import { sectionComponent, sectionNames } from ${JSON.stringify(join(packageDir, "js/section"))}
import { PathnameProvider } from ${JSON.stringify(join(packageDir, "js/PathnameProvider"))}
import { searchParams as requestSearchParams } from ${JSON.stringify(join(packageDir, "request"))}
import { redirectDigest } from ${JSON.stringify(join(packageDir, "redirectDigest"))}
import { createRscHandler } from ${JSON.stringify(join(packageDir, "host"))}
import { renderToReadableStream, decodeReply, loadServerAction } from '@vitejs/plugin-rsc/rsc'
import { Suspense, createElement, Fragment } from 'react'
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

let currentHost: HostFn | null = null

export function installHostFn(fn: HostFn) {
  currentHost = fn
  return () => {
    if (currentHost === fn) currentHost = null
  }
}

function applyHost() {
  ;(globalThis as Record<string, unknown>)[HOST_GLOBAL] = currentHost
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

async function runMiddleware(component: string, props: Record<string, unknown> = {}): Promise<void> {
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

    if (!guard) continue

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
  // app eagerly — so every *.section.tsx anywhere is in it by the time a
  // request arrives. Looking a client-supplied name up there directly reads
  // any page's region from any url, bounded only by whatever guard happens to
  // sit on the url that was asked for.
  //
  // Read from the manifest rather than from the message. The host is not the
  // adversary here, but the route table is build-time truth and is already in
  // this bundle, so there is no reason to depend on a field a host has to
  // remember to send — and a host that forgot would silently be unprotected.
  const owner = manifest().routes.find((route: any) => route.component === page.component)
  const declared: string[] = owner?.sections ?? page.sections ?? []
  const ownsTarget = declared.some(
    (name) => name === target || name.endsWith('/' + target + '.section') || name.endsWith('/' + target),
  )

  if (!ownsTarget && sectionComponent(target)) {
    throw new Error(
      'Cannot revalidate ' + target + ': it is not a section of ' + page.component + '. ' +
        'Sections here: ' + (declared.join(', ') || 'none') + '.',
    )
  }

  const Section = ownsTarget ? sectionComponent(target) : null

  if (Section) {
    // The component, not the wrapper section() returned. The client replaces
    // what is inside the boundary, so sending the wrapper would nest a new
    // boundary inside the old one on every refresh.
    return createElement(Section, page.props)
  }

  const slotComponent = page.parallelSlots[target]

  if (!slotComponent) {
    throw new Error(
      'Cannot revalidate ' + target + ': no section or slot by that name. Sections: ' +
        (sectionNames().join(', ') || 'none') + '. Slots: ' +
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
): Promise<{ body: string; rscPayload: string; clientChunks: unknown; usedDynamicApis: boolean; clientComponents: string[] }> {
  applyHost()
  // renderTree (not bare buildElement) so the prerendered Flight payload carries
  // the same <title>/<meta> elements the live SPA payload does.
  const flight = renderToReadableStream(
    await renderTree(component, props, layouts, loadings, parallelSlots, {}, from, pageKey, bootstrap),
    { onError: flightOnError },
  )
  const [forHtml, forPayload] = flight.tee()
  const rscPayload = await new Response(forPayload).text()
  const ssr = await (import.meta as any).viteRsc.loadModule('ssr', 'index')
  const htmlStream = await ssr.handleSsr(forHtml, undefined, undefined, bootstrap)
  const body = await new Response(htmlStream).text()

  return {
    body,
    rscPayload,
    clientChunks: {},
    usedDynamicApis: false,
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
): Promise<{ shellHtml: string; clientChunks: unknown; timedOut: boolean; usedDynamicApis: boolean; error?: string }> {
  // Deliberately no middleware here. The probe is asking whether the content is
  // the same for everyone, which is a question about the page. Whether a
  // particular caller may see it is a question about the request, and there is
  // no request at build time — running a guard here would refuse every time
  // and make every guarded route dynamic for the wrong reason.
  let usedDynamicApis = false
  const realHost = (globalThis as Record<string, unknown>)[HOST_GLOBAL]

  ;(globalThis as Record<string, unknown>)[HOST_GLOBAL] = (..._args: unknown[]) => {
    usedDynamicApis = true
    // Never resolves: the awaiting component suspends and React renders its
    // Suspense fallback into the shell instead of the real content.
    return new Promise(() => {})
  }

  let shellHtml = ''
  let completed = false
  let error: string | undefined
  let cancel: (() => void) | null = null

  const produce = (async () => {
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
      const flight = renderToReadableStream(tree, { onError: flightOnError })
      const ssr = await (import.meta as any).viteRsc.loadModule('ssr', 'index')
      // Errors here are expected: the render is aborted once the shell is out.
      const htmlStream = await ssr.handleSsr(flight, undefined, () => {})

      const reader = htmlStream.getReader()
      // Cancelling aborts the suspended SSR render, which surfaces React's
      // "render was aborted" both synchronously and as a rejection. Neither is
      // interesting — we already have the shell.
      cancel = () => {
        try {
          const pending = reader.cancel()
          if (pending && typeof pending.catch === 'function') pending.catch(() => {})
        } catch {}
      }
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
  })()

  await Promise.race([produce, new Promise((r) => setTimeout(r, PPR_SHELL_TIMEOUT_MS))])

  // Release the suspended render; its pending php() promises never settle.
  if (!completed) cancel?.()
  ;(globalThis as Record<string, unknown>)[HOST_GLOBAL] = realHost

  return { shellHtml, clientChunks: {}, timedOut: !completed, usedDynamicApis, error }
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
import { renderToReadableStream } from 'react-dom/server.edge'
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
        // Public URL for browser-facing client assets (served from public/ by
        // the web server — never through PHP).
        base: assetsBaseUrl,
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
      if (!prerenderAfterBuild || isWatch) return

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
