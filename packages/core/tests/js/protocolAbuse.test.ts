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

/** The same manifest with an unguarded route added, for the cacheable path. */
function openManifest(): RouteManifest {
  const m = manifest()

  m.routes.push({
    ...m.routes[0],
    url: '/open',
    component: 'app/open/page',
    segments: [{ type: 'static', value: 'open' }],
    layouts: ['app/layout'],
    middleware: [],
  } as (typeof m.routes)[0])

  return m
}

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

  test('the resume endpoint cannot be used to walk past a guard', async () => {
    // The endpoint an edge worker calls to finish a shell. It is the most
    // attractive thing on the host to attack: the shell is chrome, and
    // everything a guard exists to protect is in the holes this fills in.
    //
    // So it runs the same middleware the page would, against the cookies the
    // caller actually sent, and refuses before rendering anything.
    let resumed = 0

    const engine = {
      ...guardedEngine(),
      async runRouteMiddleware() {
        redirect('/login')
      },
      async handleRscResume() {
        resumed++

        return { htmlStream: secret() }
      },
    }

    const response = await createRscHandler({
      engine: engine as never,
      prerendered: async (name: string) =>
        name.endsWith('.ppr.html')
          ? '<html><body>chrome'
          : name.endsWith('.postponed.json')
            ? JSON.stringify({ resumableState: {} })
            : null,
    })(new Request('https://x.test/_rsc/ppr-resume?url=/guarded', { method: 'POST' }))

    expect(response!.status).toBe(307)
    expect(response!.headers.get('Location')).toBe('/login')

    // Refused before the render, not after. Rendering and then discarding
    // would still run the page's own data access for someone turned away.
    expect(resumed).toBe(0)
    expect(await response!.text()).not.toContain('SECRET')
  })

  test('the shell endpoint sends a header an edge can actually cache on', async () => {
    // The rest of the host sends `max-age=0, must-revalidate`, which is right
    // for a page and wrong for this: a cache honours it by treating the entry
    // as stale on arrival, so an edge would store the shell and never once
    // serve it. The worker would miss every time, fall through to the origin,
    // and the whole feature would do nothing while looking like it worked —
    // because the miss path serves correct pages.
    const response = await createRscHandler({
      engine: {
        ...guardedEngine(),
        manifest: openManifest,
      } as never,
      prerendered: async (name: string) => (name.endsWith('.ppr.html') ? '<html>' : null),
    })(new Request('https://x.test/_rsc/ppr-shell?url=/open'))

    expect(response!.status).toBe(200)

    const cacheControl = response!.headers.get('Cache-Control')!

    expect(cacheControl).toContain('public')
    expect(cacheControl).not.toContain('max-age=0')
    expect(cacheControl).not.toContain('must-revalidate')
  })

  test('and the shell endpoint refuses a guarded route outright', async () => {
    // Not "guarded here" — refused. A guarded route's shell is not cacheable by
    // a shared cache at all, so handing one to an edge whose entire job is
    // caching is an invitation to a mistake nobody would ever see.
    const response = await createRscHandler({
      engine: guardedEngine() as never,
      prerendered: async () => '<html><body>chrome',
    })(new Request('https://x.test/_rsc/ppr-shell?url=/guarded'))

    expect(response!.status).toBe(404)
  })

  test('the resume endpoint takes no postponed state from the caller', async () => {
    // Next's protocol hands the postponed blob to the CDN and takes it back on
    // the resume, which makes the endpoint parse something an attacker writes —
    // the shape of a known denial-of-service against it. Our origin has the
    // file, so the state never leaves and a body is simply ignored.
    let seen: unknown

    const engine = {
      ...guardedEngine(),
      async runRouteMiddleware() {},
      async handleRscResume(
        _c: string,
        _p: unknown,
        _l: unknown,
        _lo: unknown,
        _s: unknown,
        _o: unknown,
        postponed: unknown,
      ) {
        seen = postponed

        return { htmlStream: secret() }
      },
    }

    await createRscHandler({
      engine: engine as never,
      prerendered: async (name: string) =>
        name.endsWith('.ppr.html')
          ? '<html><body>chrome'
          : name.endsWith('.postponed.json')
            ? JSON.stringify({ fromDisk: true })
            : null,
    })(
      new Request('https://x.test/_rsc/ppr-resume?url=/guarded', {
        method: 'POST',
        body: JSON.stringify({ fromTheCaller: true }),
      }),
    )

    expect(seen).toEqual({ fromDisk: true })
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

describe('an interceptor and the route it stands in for', () => {
  test('are chosen the same way, so the guard matches the content', async () => {
    // matchRoute scores (static beats dynamic); matchIntercept took the first
    // match. When they disagreed the guard was checked against one route and
    // the content rendered from the other.
    const engine = recordingEngine()
    const m = manifest()

    ;(m as unknown as { intercepts: unknown[] }).intercepts = [
      {
        component: 'app/@modal/(.)guarded/[id]/page',
        slot: 'modal',
        segments: [
          { type: 'static', value: 'guarded' },
          { type: 'param', value: 'id' },
        ],
        marker: '(.)',
      },
      {
        component: 'app/@modal/(.)guarded/new/page',
        slot: 'modal',
        segments: [
          { type: 'static', value: 'guarded' },
          { type: 'static', value: 'new' },
        ],
        marker: '(.)',
      },
    ]

    const { matchIntercept } = await import('../../src/routing')
    const picked = matchIntercept(m, '/guarded/new', 'modal')

    expect(picked?.component).toBe('app/@modal/(.)guarded/new/page')
  })

  test('and a url with no route behind it is refused, not rendered', async () => {
    // Nothing to guard means nothing to serve: there is no middleware chain to
    // consult, so there is no way to know whether this caller may see it.
    const engine = recordingEngine()
    const m = manifest()

    ;(m as unknown as { intercepts: unknown[] }).intercepts = [
      {
        component: 'app/@modal/(.)nowhere/page',
        slot: 'modal',
        segments: [{ type: 'static', value: 'nowhere' }],
        marker: '(.)',
      },
    ]

    const response = await createRscHandler({ engine: engine as never, manifest: m })(
      new Request('http://x/nowhere', { headers: { 'X-RSC': '1', 'X-RSC-Intercept': 'modal' } }),
    )

    expect(response?.status).toBe(404)
    expect(await bodyOf(response)).not.toContain('THE GUARDED CONTENT')
  })
})
