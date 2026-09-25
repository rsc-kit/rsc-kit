// instrumentation.ts: the app's process bootstrap.
//
// Three claims, each the reason the file is a framework concern rather than
// an import the app adds itself. It is evaluated before any page module,
// because it is the generated entry's first import. Its register() is
// awaited before the first render, whichever entry point the render came
// through. And it runs once for the life of the process, however many renders
// follow - on a long-lived server, at startup, before any request.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { buildFixtureOnce, bundlePath } from './goHost'
import { assertServerRuntime } from './serverRuntime'

assertServerRuntime('instrumentation.test.ts')

let engine: any

beforeAll(async () => {
  await buildFixtureOnce()
  engine = await import(bundlePath)
}, 180_000)

afterAll(() => {
  engine?.installHostFn(async () => null)
})

async function renderInstrumented(): Promise<string> {
  const { htmlStream } = await engine.handleRscHtmlStream('app/instrumented/page', {}, [], [], {}, {}, undefined, '/instrumented')

  return await new Response(htmlStream).text()
}

const field = (html: string, label: string): string =>
  html.match(new RegExp(`<dt>${label}</dt><dd>(?:<!-- -->)?([^<]*)</dd>`))?.[1] ?? '(missing)'

describe('instrumentation.ts', () => {
  test('on a long-lived server, register() ran at startup, before any request', async () => {
    // The bundle was imported in beforeAll and nothing has rendered yet. A
    // process that starts the bootstrap eagerly has already run it.
    await new Promise((r) => setTimeout(r, 40))

    expect(globalThis.__instrumentation.registered).toBe(1)
    expect(globalThis.__instrumentation.ready).toBe(true)
  })

  test('the page module evaluated after the instrumentation module', async () => {
    const html = await renderInstrumented()

    expect(field(html, 'evaluated before this page')).toBe('true')
  })

  test('register() had finished before the page rendered', async () => {
    const html = await renderInstrumented()

    expect(field(html, 'register finished before render')).toBe('true')
  })

  test('it ran once, however many renders followed and whichever entry point they used', async () => {
    await renderInstrumented()
    await renderInstrumented()
    await engine.runRouteMiddleware('app/instrumented/page', {})
    await engine.resolveMetadata('app/instrumented/page', {}, [])
    await engine.getStaticParams('app/instrumented/page')

    const html = await renderInstrumented()

    expect(field(html, 'register calls')).toBe('1')
    expect(globalThis.__instrumentation.registered).toBe(1)
  })
})
