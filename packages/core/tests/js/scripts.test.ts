// What React 19 does with a <script> rendered from a server component.
//
// This is React's behaviour, not ours, and that is the point of pinning it:
// the decision NOT to ship a <Script> component rests on it. If React stops
// hoisting or deduplicating, the guide that says "just write the tag" is wrong
// and this is what says so.

import { beforeAll, describe, expect, test } from 'bun:test'
import { createRscHandler } from '../../src/host'
import { assertServerRuntime } from './serverRuntime'

assertServerRuntime('scripts.test.ts')

let html: string

beforeAll(async () => {
  const { buildFixtureOnce, bundlePath } = await import('./goHost')

  await buildFixtureOnce()

  const engine: any = await import(bundlePath)
  const handle = createRscHandler({
    engine: { ...engine, manifest: engine.manifest },
    manifest: engine.manifest(),
  } as never)

  html = await (await handle(new Request('https://app.test/scripts')))!.text()
}, 300_000)

describe('an external script with async', () => {
  test('is hoisted into <head>', () => {
    const head = html.slice(0, html.indexOf('</head>'))

    expect(head).toContain('src="https://www.clarity.ms/tag/abc123"')
  })

  test('and deduplicated, however many times it is rendered', () => {
    // The fixture renders it twice. One tag, or a tag manager installed twice
    // double-counts every visitor.
    expect(html.match(/clarity\.ms\/tag\/abc123/g)).toHaveLength(1)
  })
})

describe('an inline script', () => {
  test('renders where it was written, before the bootstrap', () => {
    // So it runs during parse, before hydration — which for an analytics
    // snippet is the earlier of the two, and the one its authors intended.
    const snippet = html.indexOf('id="ms-clarity"')
    const bootstrap = html.indexOf('id="_R_"')

    expect(snippet).toBeGreaterThan(-1)
    expect(snippet).toBeLessThan(bootstrap)
  })

  test('with its content intact', () => {
    expect(html).toContain('"clarity","script","abc123"')
  })
})
