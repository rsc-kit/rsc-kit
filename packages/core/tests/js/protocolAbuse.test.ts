/**
 * What a forged request must not get.
 *
 * Every other suite asserts that honest inputs produce right answers. None of
 * them could see the hole this one exists for: a client that simply *claimed*
 * to already hold a guard layout was handed the page it middleware, with a 200,
 * and every test still passed.
 *
 * The rule these encode: no header a client controls may decide whether
 * server-side code runs. `X-RSC-Segments`, `X-RSC-Revalidate`,
 * `X-RSC-Intercept` and `X-RSC-Referer` are all attacker-supplied and none of
 * them is verifiable — the server cannot know what a browser really has
 * mounted. So they may narrow what is *sent*, never what is *run*.
 */

import { describe, expect, test } from 'bun:test'
import { createRscHandler } from '../../src/host'
import { redirect } from '../../src/redirect'
import type { RouteManifest } from '../../src/manifest'

const GUARDED = 'app/guarded/middleware'

function manifest(): RouteManifest {
  return {
    version: 'b1',
    routes: [
      {
        url: '/guarded',
        component: 'app/guarded/page',
        segments: [{ type: 'static', value: 'guarded' }],
        layouts: ['app/layout', 'app/guarded/layout'],
        middleware: [GUARDED],
        loadings: [],
        slots: {},
        sections: [],
        config: null,
        ancestorConfigs: [],
        staticParams: false,
        clientJs: true,
      },
    ],
    intercepts: [],
  } as unknown as RouteManifest
}

const secret = () =>
  new ReadableStream({
    start(c) {
      c.enqueue(new TextEncoder().encode('THE GUARDED CONTENT'))
      c.close()
    },
  })

/**
 * An engine that behaves the way the real one does: the route's middleware run on
 * every render path, whatever the caller asked for, because they are not part
 * of what a partial render narrows.
 */
function guardedEngine() {
  const ran: string[] = []

  const runMiddleware = () => {
    ran.push(GUARDED)
    redirect('/login')
  }

  return {
    ran,
    manifest,
    installHostFn: () => () => {},
    async handleRscHtmlStream() {
      runMiddleware()

      return { htmlStream: secret() }
    },
    async handleRscStream(
      _c: string,
      _p: unknown,
      _layouts: unknown,
      _l: unknown,
      _s: unknown,
      _o: unknown,
      from: number,
    ) {
      runMiddleware()

      return { stream: secret(), segmentDepth: from }
    },
    async handleRscRevalidate() {
      runMiddleware()

      return { rscPayload: 'THE GUARDED CONTENT' }
    },
  }
}

async function bodyOf(response: Response | null): Promise<string> {
  return response?.body ? await new Response(response.body).text() : ''
}

describe('a forged layout chain', () => {
  test('does not skip the guard it names', async () => {
    // The whole attack: claim to already hold every layout, so none render.
    const engine = guardedEngine()
    const handle = createRscHandler({ engine: engine as never })

    const response = await handle(
      new Request('https://x.test/guarded', {
        headers: { 'X-RSC': 'true', 'X-RSC-Segments': 'app/layout,app/guarded/layout' },
      }),
    )

    expect(engine.ran).toContain(GUARDED)
    expect(response!.status).toBe(204)
    expect(response!.headers.get('X-RSC-Redirect')).toBe('/login')
    expect(await bodyOf(response)).not.toContain('THE GUARDED CONTENT')
  })

  test('and an honest one is still answered normally', async () => {
    // The fix must not close the hole by refusing everything.
    const engine = {
      ...guardedEngine(),
      async handleRscStream(
        _c: string,
        _p: unknown,
        _layouts: unknown,
        _l: unknown,
        _s: unknown,
        _o: unknown,
        from: number,
      ) {
        return { stream: secret(), segmentDepth: from }
      },
    }

    const response = await createRscHandler({ engine: engine as never })(
      new Request('https://x.test/guarded', {
        headers: { 'X-RSC': 'true', 'X-RSC-Segments': 'app/layout' },
      }),
    )

    expect(response!.status).toBe(200)
  })
})

describe('a revalidation', () => {
  test('cannot reach a page past its guard', async () => {
    // Renders without the chain above it by design, which is the same skip.
    const engine = guardedEngine()

    const response = await createRscHandler({ engine: engine as never })(
      new Request('https://x.test/guarded', {
        headers: {
          'X-RSC': 'true',
          'X-RSC-Revalidate': 'page',
          'X-RSC-Referer': 'https://x.test/guarded',
        },
      }),
    )

    expect(engine.ran).toContain(GUARDED)
    expect(response!.status).toBe(204)
    expect(await bodyOf(response)).not.toContain('THE GUARDED CONTENT')
  })
})

describe('the asset reader', () => {
  test('refuses to climb out of its directory', async () => {
    const { assetsFrom } = await import('../../src/files')
    const read = assetsFrom('/tmp/does-not-matter')

    for (const attempt of [
      '/assets/../../../etc/passwd',
      '/assets/..%2f..%2fetc/passwd',
      '/assets/foo/../../bar',
    ]) {
      expect(await read(attempt)).toBeNull()
    }
  })

  test('and anything outside its prefix', async () => {
    const { assetsFrom } = await import('../../src/files')
    const read = assetsFrom('/tmp/does-not-matter')

    expect(await read('/etc/passwd')).toBeNull()
  })
})

describe('the prerendered reader', () => {
  test('refuses to climb out of its directory', async () => {
    const { prerenderedFrom } = await import('../../src/files')
    const read = prerenderedFrom('/tmp/does-not-matter')

    expect(await read('../../etc/passwd')).toBeNull()
  })
})

describe('a frozen page behind a guard', () => {
  test('is not handed over until the guard passes', async () => {
    // The point of freezing is that serving costs nothing. The point of the
    // guard is that not everyone may have it. Both hold: the file is read only
    // after the check, so a refusal never touches it.
    let readFrozen = false
    const engine = {
      ...guardedEngine(),
      async runRouteMiddleware() {
        redirect('/login')
      },
    }

    const response = await createRscHandler({
      engine: engine as never,
      prerendered: async () => {
        readFrozen = true

        return 'THE GUARDED CONTENT'
      },
    })(new Request('https://x.test/guarded'))

    expect(response!.status).toBe(307)
    expect(response!.headers.get('Location')).toBe('/login')
    expect(readFrozen).toBe(false)
    expect(await bodyOf(response)).not.toContain('THE GUARDED CONTENT')
  })

  test('and is served straight from disk once it does', async () => {
    let ran = 0
    const engine = {
      ...guardedEngine(),
      async runRouteMiddleware() {
        ran++
      },
    }

    const response = await createRscHandler({
      engine: engine as never,
      prerendered: async (name: string) => (name.endsWith('.html') ? '<p>frozen</p>' : null),
    })(new Request('https://x.test/guarded'))

    expect(ran).toBe(1)
    expect(response!.status).toBe(200)
    expect(await bodyOf(response)).toContain('frozen')
  })
})

describe('a route that only redirects', () => {
  test('is served from the frozen answer, without rendering', async () => {
    // The answer is the redirect, not a page. Rendering it per request
    // re-derives a constant, and a static host could not derive it at all.
    let rendered = false
    const engine = {
      ...guardedEngine(),
      manifest: () => ({ version: 'b1', routes: [], intercepts: [] }),
      async handleRscHtmlStream() {
        rendered = true

        return { htmlStream: secret() }
      },
    }

    const response = await createRscHandler({
      engine: engine as never,
      prerendered: async (name: string) =>
        name === 'old-pricing.redirect.json' ? '{"status":308,"location":"/pricing"}' : null,
    })(new Request('https://x.test/old-pricing'))

    expect(response!.status).toBe(308)
    expect(response!.headers.get('Location')).toBe('/pricing')
    expect(rendered).toBe(false)
  })

  test('and a navigation gets the header, not a 3xx fetch would follow', async () => {
    const response = await createRscHandler({
      engine: guardedEngine() as never,
      prerendered: async (name: string) =>
        name === 'old-pricing.redirect.json' ? '{"status":307,"location":"/pricing"}' : null,
    })(new Request('https://x.test/old-pricing', { headers: { 'X-RSC': 'true' } }))

    expect(response!.status).toBe(204)
    expect(response!.headers.get('X-RSC-Redirect')).toBe('/pricing')
  })
})

// ── Naming what to render is not the same as being allowed to see it ─────────
//
// Four bypasses of one shape have now been found: the caller names a component,
// a layout chain, a region or an interceptor, and a path exists where that name
// is not checked against the route that owns it. These pin the two found last.

/** The same manifest, plus an interceptor standing in for the guarded route. */
function interceptedManifest(): RouteManifest {
  const m = manifest()

  ;(m as unknown as { intercepts: unknown[] }).intercepts = [
    {
      component: 'app/@modal/(.)guarded/page',
      slot: 'modal',
      segments: [{ type: 'static', value: 'guarded' }],
      marker: '(.)',
    },
  ]

  return m
}

/** Records which components the guards were asked about, and refuses them all. */
function recordingEngine() {
  const engine = guardedEngine()
  const asked: string[] = []

  return Object.assign(engine, {
    asked,
    async runRouteMiddleware(component: string) {
      asked.push(component)
      redirect('/login')
    },
  })
}

describe('an interception', () => {
  test("runs the guards of the route it intercepts, not the referer's", async () => {
    // An interceptor shows the same resource as the route it stands in for, so
    // it belongs behind the same checks. Guarding by X-RSC-Referer instead lets
    // the caller choose which guard runs by naming an unguarded page.
    const engine = recordingEngine()

    const response = await createRscHandler({
      engine: engine as never,
      manifest: interceptedManifest(),
    })(
      new Request('http://x/guarded', {
        headers: { 'X-RSC': '1', 'X-RSC-Intercept': 'modal', 'X-RSC-Referer': '/elsewhere' },
      }),
    )

    expect(engine.asked).toContain('app/guarded/page')
    expect(await bodyOf(response)).not.toContain('THE GUARDED CONTENT')
  })

  test('and with no referer at all, where nothing else would run them', async () => {
    // The path that ran no middleware whatsoever: an interceptor is not in
    // manifest.routes, so the chain keyed off it never matched.
    const engine = recordingEngine()

    const response = await createRscHandler({
      engine: engine as never,
      manifest: interceptedManifest(),
    })(new Request('http://x/guarded', { headers: { 'X-RSC': '1', 'X-RSC-Intercept': 'modal' } }))

    expect(engine.asked).toContain('app/guarded/page')
    expect(await bodyOf(response)).not.toContain('THE GUARDED CONTENT')
  })
})

describe('a route that declares middleware', () => {
  test('is refused outright when the engine cannot run it', async () => {
    // runRouteMiddleware is optional on the interface, so a bundle built by an
    // older plugin simply has no such export. Reading that as "no middleware"
    // serves the guarded page and logs nothing — the only safe reading of a
    // check that cannot run is refusal.
    const engine = guardedEngine()

    const response = await createRscHandler({
      engine: engine as never,
      manifest: manifest(),
      prerendered: async () => 'THE GUARDED CONTENT',
    })(new Request('http://x/guarded'))

    expect(response?.status).toBe(500)
    expect(await bodyOf(response)).not.toContain('THE GUARDED CONTENT')
  })
})

describe('what a response says it varies on', () => {
  test('names every header that changes the body', async () => {
    // One url answers with a document, a partial, a named region or an
    // interceptor depending on these. A cache keyed on the url — or on X-RSC
    // alone — hands one client another's answer.
    const engine = recordingEngine()

    const response = await createRscHandler({
      engine: engine as never,
      manifest: manifest(),
    })(new Request('http://x/guarded', { headers: { 'X-RSC': '1' } }))

    const vary = response?.headers.get('Vary') ?? ''

    for (const header of [
      'X-RSC',
      'X-RSC-Segments',
      'X-RSC-Revalidate',
      'X-RSC-Intercept',
      'X-RSC-Referer',
    ]) {
      expect(vary).toContain(header)
    }
  })
})
