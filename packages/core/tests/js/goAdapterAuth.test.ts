// Can authorization live in Go?
//
// The Laravel host does this in route.php — middleware() and can() — which is
// machinery a Go host has no equivalent of, and the reason to doubt the whole
// arrangement is feasible. The JS answer is a middleware.ts in the app tree,
// run before anything at or below it renders. Whether that is a real answer
// depends on one thing nothing else tests: whether a guard can reach the
// backend, with the visitor's own cookie, and refuse.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRscHandler } from '../../src/host'
import { httpHostCalls } from '../../src/hostCalls'

const packageRoot = join(import.meta.dir, '../..')
const adapterDir = join(packageRoot, '../../adapters/go')
const appDir = join(packageRoot, 'tests/fixtures/auth-app')
const outDir = join(packageRoot, '.tmp/vite-auth-test')
const bundlePath = join(outDir, 'dist/rsc/index.js')
const hasGo = Bun.which('go') !== null

// See the note in goAdapter.test.ts: happy-dom replaces fetch and
// AbortController process-wide, and neither survives contact with a real socket.
const realFetch = ((url: unknown, init: Record<string, unknown> = {}) =>
  Bun.fetch(url as string, { ...init, signal: undefined })) as unknown as typeof fetch

const SECRET = 'auth-secret'

let handle: (request: Request) => Promise<Response | null>
let server: ReturnType<typeof Bun.spawn> | null = null
let workDir = ''
let asked: string[] = []

beforeAll(async () => {
  if (!hasGo) return

  const build = Bun.spawn(['bun', join(packageRoot, 'src/build-rsc-vite.ts')], {
    cwd: packageRoot,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      RSC_PROJECT_ROOT: packageRoot,
      RSC_SOURCE_DIR: appDir,
      RSC_OUT_DIR: outDir,
      RSC_ASSETS_DIR: join(outDir, 'public'),
      RSC_VITE_CONFIG: join(packageRoot, 'tests/fixtures/vite.rsc.config.mjs'),
    },
    stdout: 'pipe',
    stderr: 'pipe',
  })

  if ((await build.exited) !== 0) {
    throw new Error(`auth app build failed:\n${await new Response(build.stderr).text()}`)
  }

  workDir = mkdtempSync(join(tmpdir(), 'rsckit-auth-'))
  const binary = join(workDir, 'hostserver')

  const built = Bun.spawnSync(['go', 'build', '-o', binary, './examples/hostserver'], {
    cwd: adapterDir,
    stderr: 'pipe',
  })

  if (built.exitCode !== 0) throw new Error(`go build failed: ${built.stderr.toString()}`)

  server = Bun.spawn([binary, '-secret', SECRET, '-addr', '127.0.0.1:0'], { stdout: 'pipe' })

  const reader = (server.stdout as ReadableStream<Uint8Array>).getReader()
  const decoder = new TextDecoder()
  let banner = ''

  while (!banner.includes('\n')) {
    const { value, done } = await reader.read()
    if (done) break
    banner += decoder.decode(value, { stream: true })
  }

  reader.releaseLock()

  const address = banner.match(/listening on (\S+)/)?.[1]
  if (!address) throw new Error(`host server did not report an address: ${banner}`)

  const engine = await import(bundlePath)

  handle = createRscHandler({
    engine,
    hostCalls: async (name, ...args) => {
      asked.push(name)

      return httpHostCalls({
        endpoint: `${address}/__rsc/host-call`,
        secret: SECRET,
        fetch: realFetch,
      })(name, ...args)
    },
  })
}, 120_000)

afterAll(() => {
  server?.kill()
  if (workDir) rmSync(workDir, { recursive: true, force: true })
})

describe.skipIf(!hasGo)('authorization decided in Go', () => {
  test('an unguarded page renders without asking anything', async () => {
    asked = []
    const html = await (await handle(new Request('http://app.test/')))!.text()

    expect(html).toContain('public')
    expect(asked).toEqual([])
  })

  // Auth.check in the Go example reads the forwarded cookie. No cookie, no
  // session, and the guard sends the visitor to /login.
  test('a guard reaches Go and refuses, before the page renders', async () => {
    asked = []
    const response = await handle(new Request('http://app.test/private'))

    expect(asked).toContain('Auth.check')
    // 307, not 302: the engine's redirect preserves the method, so a guarded
    // POST is not silently turned into a GET of the login page.
    expect(response?.status).toBe(307)
    expect(response?.headers.get('Location')).toBe('/login')
  })

  test('with the visitor session, the same guard lets them through', async () => {
    asked = []
    const response = await handle(
      new Request('http://app.test/private', { headers: { cookie: 'session=valid' } }),
    )

    expect(asked).toContain('Auth.check')
    expect(response?.status).toBe(200)
    expect(await response!.text()).toContain('the private page')
  })

  // The guarded page must not be reachable by asking for less of it — the
  // narrowing headers in PROTOCOL.md Part 3b are exactly this attack.
  test('a payload request cannot skip the guard', async () => {
    const response = await handle(
      new Request('http://app.test/private', { headers: { 'X-RSC': '1' } }),
    )

    expect(await response!.text()).not.toContain('the private page')
  })
})
