// The whole app as a function, for tests.
//
//   import { createTestApp } from '@rsc-kit/core/testing'
//
//   const app = await createTestApp()
//   const res = await app.fetch('/api/orders', { headers: { Cookie: 'user=ada' } })
//
// No port, no browser, no server process. The built entry already exports the
// same Request → Response handler the dev server and the production server
// both call, so a test can hand it a Request and read the Response — through
// the real router, the real middleware, the real api routes, and the pages the
// build stored.
//
// That is the tier between a unit test and a browser. An action or a route is
// a function and can be imported and called; a browser test proves the page
// works; this proves the app answers a url the way it is deployed, which is
// where a route that renders fine and is served wrong shows up.

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { extname, join, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { httpHostCalls } from './hostCalls.js'
import { configureChanged } from './changed.js'
import { testHostFetch, type TestHost } from './testHost.js'

export { hostReply, testChanges, HOST_MIDDLEWARE, type HostCallInput, type HostHandler, type TestHost } from './testHost.js'

export interface TestApp {
  /** A path, not a url. The origin is whatever the app was told it is. */
  fetch(path: string, init?: RequestInit): Promise<Response>
  /**
   * What each region of the page at `path` refreshes on, rendered for this
   * request: `{ page: ['ledger'], repos: ['team:1:repos'] }` - `page` for the
   * page's own `refreshOn`, a section's name for each section's. A region
   * whose refreshOn gave no names is there with `[]`; one with no refreshOn
   * is not there at all.
   *
   *     expect(await app.watched('/teams/1')).toMatchObject({ repos: ['team:1:repos'] })
   *
   * The names a tab would be handed, without reading them out of the payload.
   */
  watched(path: string, init?: RequestInit): Promise<Record<string, string[]>>
  /**
   * The page at `path` as markup: the whole streamed document, with every
   * `<script>` taken out.
   *
   * The document carries the page's payload for the browser to hydrate from,
   * and the payload holds everything the page was given - a client
   * component's props included, shown or not. A test asserting that something
   * is NOT on the page reads this, not `fetch`:
   *
   *     expect(await app.markup('/teams/1')).not.toContain('internal note')
   *
   * Regions that streamed in later are included where they arrived; a
   * Suspense fallback they replaced is still in the markup too, as the
   * server sent it.
   */
  markup(path: string, init?: RequestInit): Promise<string>
  /** Where the build was read from, for a test that wants to look. */
  bundle: string
}

export interface TestAppOptions {
  /** The project. Defaults to the working directory. */
  root?: string
  /**
   * Whether to build first.
   *
   * `true` builds when the source is newer than the last build, which is what
   * a test run wants: the first run pays for it, the rest do not, and an edit
   * is picked up. `false` never builds and fails loudly if there is nothing to
   * read — for a ci step that already built.
   */
  build?: boolean
  /** The origin requests are made against. Nothing reads it; it is a url. */
  origin?: string
  /**
   * The backend, answered in the test: rpc() calls and host guards by name.
   * The app reaches it through the same client it uses against a real one,
   * so nothing listens and RSC_BACKEND is not called. See `hostReply`.
   */
  host?: TestHost
  /**
   * What answers a url this app does not own - a Go route, a Laravel page,
   * /login - in place of the backend the app forwards it to. Handed the
   * request as the backend would receive it. Without one, such a url is
   * forwarded to RSC_BACKEND, and in a test that is usually a 502.
   */
  backend?: (request: Request) => Response | Promise<Response>
}

/**
 * Where the build put the server bundle.
 *
 * Two layouts, because two ways of building. Under Nitro — every scaffolded
 * app — it is inside Nitro's own directory. On its own the plugin writes
 * <outDir>/dist/rsc. The first that exists wins.
 */
function findBundle(root: string): string | null {
  const candidates = [
    join(root, 'node_modules/.nitro/vite/services/rsc/index.js'),
    // The default outDir since 0.29.8; .rsc before it.
    join(root, '.rsc-kit/dist/rsc/index.js'),
    join(root, '.rsc/dist/rsc/index.js'),
    join(root, 'build/dist/rsc/index.js'),
  ]

  return candidates.find((path) => existsSync(path)) ?? null
}

/**
 * When anything a build is made from last changed: the app's source, its
 * Vite config, its dependencies - package.json, the lockfile, and the
 * installed engine itself. Only src/ used to count, so an app that upgraded
 * @rsc-kit/core kept testing the build the old one made, and passed.
 */
function newestInput(root: string): number {
  const files = [
    'vite.config.ts', 'vite.config.mts', 'vite.config.js', 'vite.config.mjs',
    'package.json', 'bun.lock', 'bun.lockb', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock',
  ]
  let latest = newest(join(root, 'src'))

  for (const file of files) {
    const path = join(root, file)

    if (existsSync(path)) latest = Math.max(latest, statSync(path).mtimeMs)
  }

  // The engine as installed: a workspace link changes without the lockfile.
  const engine = join(root, 'node_modules/@rsc-kit/core/dist')

  return Math.max(latest, newest(engine))
}

/** The newest mtime under a directory, for deciding whether a build is stale. */
function newest(dir: string): number {
  if (!existsSync(dir)) return 0

  let latest = 0

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue

    const path = join(dir, entry.name)
    const time = entry.isDirectory() ? newest(path) : statSync(path).mtimeMs

    if (time > latest) latest = time
  }

  return latest
}

/** One build per process per root, however many test files ask. */
const built = new Map<string, Promise<string>>()

/** The content types a test is likely to assert on; anything else is octet-stream. */
const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.xml': 'application/xml',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.map': 'application/json',
}

/**
 * A file the build put in .output/public, answered the way Nitro's static
 * layer would - which the handler this harness loads does not include. The
 * handler is the rsc service: routing, pages, actions, api routes. Assets,
 * the service worker, the manifest and the icons are files Nitro serves in
 * production from .output/public, and a test that asked for /sw.js used to
 * get the router's 404 for a file the deployment serves fine - the one
 * shape this harness exists to catch, in the other direction.
 *
 * Files only, for GET and HEAD, within the directory: a path that escapes it
 * is a request for the handler, not a file.
 */
/** @internal Exported for its test. */
export function staticFile(root: string, request: Request): Response | null {
  if (request.method !== 'GET' && request.method !== 'HEAD') return null

  const publicDir = join(root, '.output/public')
  const pathname = decodeURIComponent(new URL(request.url).pathname)
  const file = resolve(publicDir, '.' + pathname)

  if (!file.startsWith(publicDir + sep) || !existsSync(file) || !statSync(file).isFile()) return null

  const type = CONTENT_TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream'
  const body = request.method === 'HEAD' ? null : readFileSync(file)

  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-RSC-Kit-Test': 'static' },
  })
}

/**
 * How this project builds: its own `build` script, run by the package manager
 * this test is running under. Without a script, Vite directly - on Bun's
 * runtime when the tests are, since a bin's node shebang would otherwise
 * start it under Node.
 */
/** @internal Exported for its test. */
export function buildCommand(root: string): [string, string[]] {
  const onBun = typeof process.versions.bun === 'string'

  let scripts: Record<string, string> = {}

  try {
    scripts = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8')).scripts ?? {}
  } catch {
    // No package.json, or not JSON: there is no script to run.
  }

  if (typeof scripts.build === 'string') {
    return onBun ? ['bun', ['run', 'build']] : ['npm', ['run', 'build']]
  }

  return onBun ? ['bun', ['--bun', 'vite', 'build']] : ['npx', ['vite', 'build']]
}

async function ensureBuilt(root: string, build: boolean): Promise<string> {
  const existing = findBundle(root)

  if (!build) {
    if (!existing) {
      throw new Error(
        `[rsc-kit] No build to test against under ${root}. Run the build first, or let createTestApp() do it by leaving \`build\` on.`,
      )
    }

    return existing
  }

  const fresh = existing && statSync(existing).mtimeMs > newestInput(root)

  if (fresh) return existing

  // The user's own build command, so what is tested is what ships. A test
  // that built some other way would pass against a bundle nobody deploys -
  // and used to: this ran `npx vite build` whatever package.json said, which
  // on a Bun project built under Node and failed on the first `import 'bun'`.
  const [command, args] = buildCommand(root)
  const run = spawnSync(command, args, {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, NODE_ENV: 'production' },
  })

  if (run.status !== 0) {
    throw new Error(`[rsc-kit] The build failed, so there is nothing to test:\n${run.stderr}`)
  }

  const bundle = findBundle(root)

  if (!bundle) {
    throw new Error(
      `[rsc-kit] The build finished but no server bundle was found under ${root}. Is rscKit() in vite.config?`,
    )
  }

  return bundle
}

/**
 * Build the app if it needs it, load it, and hand back something to fetch from.
 *
 * Memoised per root: every test file in a run shares one build and one loaded
 * module, which is both the fast path and the correct one — two copies of the
 * server bundle in one process would be two client-reference registries.
 */
/**
 * Whether Request is the runtime's, told apart from a browser's by behaviour.
 *
 * A browser forbids a script from setting Cookie, so happy-dom's Request drops
 * it from an init - and every signed-in request a test makes arrives with no
 * session, bounces to sign-in, and fails far from the cause. Behaviour rather
 * than identity, because identity depends on which file loaded first.
 */
function runtimeRequest(): boolean {
  try {
    return new Request('http://probe.test/', { headers: { cookie: 'probe=1' } }).headers.has('cookie')
  } catch {
    return false
  }
}

export async function createTestApp(options: TestAppOptions = {}): Promise<TestApp> {
  if (!runtimeRequest()) {
    throw new Error(
      "[rsc-kit] createTestApp is running against a browser's Request: a DOM is registered globally " +
        '(happy-dom, in a preload or an earlier test file), and it replaces Request, Response, Headers and fetch. ' +
        'A browser cannot set Cookie, so every signed-in request would arrive with no session. ' +
        'Register the DOM only in the component test file and `GlobalRegistrator.unregister()` after it, ' +
        'and run the suites isolated (`bun test --isolate`). See the testing guide, "Components".',
    )
  }

  const root = resolve(options.root ?? process.cwd())
  const origin = options.origin ?? 'https://app.test'

  built.set(root, built.get(root) ?? ensureBuilt(root, options.build ?? true))

  // The app is built for production, which refuses to sign refreshOn names
  // without a key. One process, one key: a fixed one, unless the test set its own.
  if (!process.env.RSC_SIGNING_SECRET) {
    configureChanged({ secret: 'rsc-kit-test' })
  }

  const bundle = await built.get(root)!
  const entry = (await import(pathToFileURL(bundle).href)) as {
    default: (request: Request) => Promise<Response>
    installHostFn?: (fn: (name: string, ...args: unknown[]) => Promise<unknown>) => () => void
    installBackendForward?: (fn: ((request: Request) => Response | Promise<Response>) | null) => void
  }

  if (typeof entry.default !== 'function') {
    throw new Error(`[rsc-kit] ${bundle} does not export a request handler.`)
  }

  const host = options.host
    ? httpHostCalls({ endpoint: 'http://test-host/__rsc/host-call', secret: 'test', fetch: testHostFetch(options.host) })
    : null

  if (host && !entry.installHostFn) {
    throw new Error(`[rsc-kit] ${bundle} cannot take a host. Rebuild against the current @rsc-kit/core.`)
  }

  const fetch: TestApp['fetch'] = async (path, init) => {
    const request = new Request(new URL(path, origin), init)

    // Per request, not once: the loaded bundle is shared by every app a
    // run creates, and the host is this app's.
    if (host) entry.installHostFn!(host)
    if (options.backend && !entry.installBackendForward) {
      throw new Error(`[rsc-kit] ${bundle} cannot take a backend. Rebuild against the current @rsc-kit/core.`)
    }
    entry.installBackendForward?.(options.backend ?? null)

    return staticFile(root, request) ?? entry.default(request)
  }

  return {
    bundle,
    fetch,
    markup: async (path, init) => {
      const html = await (await fetch(path, init)).text()

      // A script's body never holds its own closing tag: the payload writes
      // "<" as \u003c, and React's scripts are its own.
      return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    },
    watched: async (path, init) => {
      // The render records what each region resolves to while this is set:
      // the app's bundle runs in this process, so it sees the same global.
      const recording: Record<string, string[]> = {}
      const into = globalThis as { [WATCHED]?: Record<string, string[]> }

      into[WATCHED] = recording

      try {
        // Read to the end: the names resolve under their own Suspense, so
        // they are in the stream's tail, not its head.
        await (await fetch(path, init)).text()
      } finally {
        delete into[WATCHED]
      }

      return recording
    },
  }
}

/** Where a render records what its regions refresh on, while watched() asks (js/refreshOn). */
const WATCHED = Symbol.for('rsc-kit.test-watched')
