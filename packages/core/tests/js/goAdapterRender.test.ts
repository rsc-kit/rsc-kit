// The whole loop: a browser request served by the JS renderer, whose page
// fetches its data from a Go process, and whose HTML carries the answer.
//
// Everything else about this adapter is tested a half at a time. This is the
// only test that would notice if the halves fit together and still produced
// the wrong page — a render that swallows a host-call failure, a result
// arriving too late to be in the shell, a page that renders its fallback and
// nothing else.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createRscHandler } from '../../src/host'
import { httpHostCalls } from '../../src/hostCalls'
import { buildFixtureOnce, bundlePath, startGoHost, realFetch } from './goHost'

const hasGo = Bun.which('go') !== null
const SECRET = 'render-secret'

let engine: any
let handle: (request: Request) => Promise<Response | null>
let stop: (() => void) | null = null

beforeAll(async () => {
  if (!hasGo) return

  await buildFixtureOnce()

  const { address, kill } = await startGoHost(SECRET)
  stop = kill

  engine = await import(bundlePath)

  handle = createRscHandler({
    engine,
    // The fixture page calls rpc('getUser'), which this host does not
    // implement — it goes to Go, exactly as a real backend's would.
    hostCalls: httpHostCalls({
      endpoint: `${address}/__rsc/host-call`,
      secret: SECRET,
      fetch: realFetch,
    }),
  })
}, 180_000)

afterAll(() => stop?.())

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
