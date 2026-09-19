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
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export interface TestApp {
  /** A path, not a url. The origin is whatever the app was told it is. */
  fetch(path: string, init?: RequestInit): Promise<Response>
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
    join(root, '.rsc/dist/rsc/index.js'),
    join(root, 'build/dist/rsc/index.js'),
  ]

  return candidates.find((path) => existsSync(path)) ?? null
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

  const fresh = existing && statSync(existing).mtimeMs > newest(join(root, 'src'))

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
export async function createTestApp(options: TestAppOptions = {}): Promise<TestApp> {
  const root = resolve(options.root ?? process.cwd())
  const origin = options.origin ?? 'https://app.test'

  built.set(root, built.get(root) ?? ensureBuilt(root, options.build ?? true))

  const bundle = await built.get(root)!
  const entry = (await import(pathToFileURL(bundle).href)) as {
    default: (request: Request) => Promise<Response>
  }

  if (typeof entry.default !== 'function') {
    throw new Error(`[rsc-kit] ${bundle} does not export a request handler.`)
  }

  return {
    bundle,
    fetch: (path, init) => entry.default(new Request(new URL(path, origin), init)),
  }
}
