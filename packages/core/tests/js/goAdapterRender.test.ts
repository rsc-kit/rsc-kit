// The whole loop: a browser request served by the JS renderer, whose page
// fetches its data from a Go process, and whose HTML carries the answer.
//
// Everything else about this adapter is tested a half at a time. This is the
// only test that would notice if the halves fit together and still produced
// the wrong page — a render that swallows a host-call failure, a result
// arriving too late to be in the shell, a page that renders its fallback and
// nothing else.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRscHandler } from '../../src/host'
import { httpHostCalls } from '../../src/hostCalls'

const packageRoot = join(import.meta.dir, '../..')
const adapterDir = join(packageRoot, '../../adapters/go')
// Its own build directory, not the one prerender.test.ts uses. Sharing it
// means two files building the same fixture into the same place: whichever
// imports while the other is writing gets a half-built bundle, and the error
// names a missing vite manifest rather than a collision.
const outDir = join(packageRoot, '.tmp/vite-go-test')
const bundlePath = join(outDir, 'dist/rsc/index.js')
const hasGo = Bun.which('go') !== null

// happy-dom, registered by the DOM tests in this suite, replaces several
// globals for the whole process — fetch, which then blocks a plain-http
// request from a page it considers https, and AbortController, whose signal
// the runtime's own fetch will not accept. Both are still installed by the
// time these files run.
//
// So these ask for the runtime's fetch by name, and drop the signal: what is
// under test here is the round trip to Go, and the timeout path has its own
// coverage in hostCalls.test.ts against a stub, where no real socket is
// involved and no global is in the way.
const realFetch = ((url: unknown, init: Record<string, unknown> = {}) =>
  Bun.fetch(url as string, { ...init, signal: undefined })) as unknown as typeof fetch

const SECRET = 'render-secret'

let engine: any
let handle: (request: Request) => Promise<Response | null>
let server: ReturnType<typeof Bun.spawn> | null = null
let workDir = ''

beforeAll(async () => {
  if (!hasGo) return

  const build = Bun.spawn(['bun', join(packageRoot, 'src/build-rsc-vite.ts')], {
    cwd: packageRoot,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      RSC_PROJECT_ROOT: packageRoot,
      RSC_SOURCE_DIR: join(packageRoot, 'tests/fixtures/rsc-app'),
      RSC_OUT_DIR: outDir,
      RSC_ASSETS_DIR: join(outDir, 'public'),
      RSC_VITE_CONFIG: join(packageRoot, 'tests/fixtures/vite.rsc.config.mjs'),
    },
    stdout: 'pipe',
    stderr: 'pipe',
  })

  if ((await build.exited) !== 0) {
    throw new Error(`fixture build failed:\n${await new Response(build.stderr).text()}`)
  }

  workDir = mkdtempSync(join(tmpdir(), 'rsckit-render-'))
  const binary = join(workDir, 'hostserver')

  const built = Bun.spawnSync(['go', 'build', '-o', binary, './examples/hostserver'], {
    cwd: adapterDir,
    stderr: 'pipe',
  })

  if (built.exitCode !== 0) throw new Error(`go build failed: ${built.stderr.toString()}`)

  server = Bun.spawn([binary, '-secret', SECRET, '-addr', '127.0.0.1:0'], { stdout: 'pipe' })

  // Bun types stdout as a number when it is inherited; 'pipe' makes it a
  // stream, and the spawn above says so.
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

  engine = await import(bundlePath)

  handle = createRscHandler({
    engine,
    // The fixture page calls rpc('getUser'), which this host does not
    // implement — it goes to Go, exactly as a real backend's would.
    hostCalls: httpHostCalls({ endpoint: `${address}/__rsc/host-call`, secret: SECRET, fetch: realFetch }),
  })
}, 120_000)

afterAll(() => {
  server?.kill()
  if (workDir) rmSync(workDir, { recursive: true, force: true })
})

describe.skipIf(!hasGo)('a page whose data comes from Go', () => {
  test("Go's answer is in the HTML the browser receives", async () => {
    const response = await handle(new Request('http://app.test/'))
    expect(response?.status).toBe(200)

    const html = await response!.text()

    // "via go" is added by the Go process and by nothing else, so its presence
    // means the call crossed, came back, and was rendered into the shell —
    // rather than the page serving its loading fallback and giving up.
    //
    // React separates adjacent text nodes with an empty comment, so the h1
    // reads `Hello <!-- -->world via go`. Asserting the rendered string
    // without allowing for that fails on a page that is completely correct.
    expect(html.replace(/<!-- -->/g, '')).toContain('<h1>Hello world via go</h1>')
    expect(html).toStartWith('<!DOCTYPE html>')
    expect(html).toContain('</html>')
  })

  test('a payload request gets Flight, with the same data in it', async () => {
    const response = await handle(
      new Request('http://app.test/', { headers: { 'X-RSC': '1' } }),
    )

    expect(response?.headers.get('Content-Type')).toContain('text/x-component')
    expect(await response!.text()).toContain('via go')
  })

  test('a second request is answered by the same Go process', async () => {
    // Cheap, and it catches a transport that works once — a connection left
    // half-read, a body not drained.
    for (let i = 0; i < 3; i++) {
      expect(await (await handle(new Request('http://app.test/')))!.text()).toContain('via go')
    }
  })

  test('when Go is unreachable the page says so rather than hanging', async () => {
    const broken = createRscHandler({
      engine,
      hostCalls: httpHostCalls({
        endpoint: 'http://127.0.0.1:1/__rsc/host-call',
        secret: SECRET,
        timeoutMs: 2000,
        fetch: realFetch,
      }),
    })

    const html = await (await broken(new Request('http://app.test/')))!.text()

    // The shell still arrives — that is the streaming invariant holding — and
    // the boundary below it resolves to an error rather than never resolving.
    expect(html).toStartWith('<!DOCTYPE html>')
    expect(html).not.toContain('via go')
  })
})
