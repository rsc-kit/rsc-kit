// The JS host adapter: url → route, and the header protocol around it.
//
// Every host would otherwise write this, and each would get the same things
// subtly wrong — matching /docs/new against [slug], answering a navigation
// with a whole document. A fake engine stands in for the bundle, so these run
// without a build and assert on what the adapter decided rather than on
// rendered output.

import { cookies } from '../../src/request'
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const packageRoot = join(import.meta.dir, '../..')
import { createRscHandler, matchRoute, sharedDepth } from '../../src/host'
import { resolveScope, revalidate, withRevalidation } from '../../src/revalidate'
import { retentionKey } from '../../src/routing'
import type { RouteManifest } from '../../src/manifest'

const segments = (spec: string) =>
  spec
    .split('/')
    .filter(Boolean)
    .map((part) =>
      part.startsWith('[...')
        ? { type: 'catchAll' as const, value: part.slice(4, -1) }
        : part.startsWith('[')
          ? { type: 'param' as const, value: part.slice(1, -1) }
          : { type: 'static' as const, value: part },
    )

function manifestOf(specs: Record<string, string[]>): RouteManifest {
  return {
    version: 1,
    build: { output: 'server', exportPath: 'dist', payloadName: '' },
    routes: Object.entries(specs).map(([url, layouts]) => ({
      component: `app${url === '/' ? '' : url}/page`,
      segments: segments(url),
      layouts,
      loadings: [],
      middleware: [],
      slots: {},
      sections: [],
      config: null,
      ancestorConfigs: [],
      staticParams: false,
      clientJs: true,
    })),
    intercepts: [],
  }
}

/**
 * Records what it was asked to render, and answers with an empty stream.
 *
 * `onAction` stands in for the body of a server action. Per engine rather than
 * shared, so two actions can be in flight without one overwriting the other's
 * behaviour — which is the only way to test that their marks stay apart.
 */
function fakeEngine(onAction?: () => void | Promise<void>) {
  const calls: Record<string, unknown[]> = { rsc: [], html: [], action: [], revalidate: [] }
  let hostFn: ((name: string, ...args: unknown[]) => unknown) | null = null

  const empty = () => new ReadableStream({ start: (c) => c.close() })

  return {
    calls,
    callHost: (name: string, ...args: unknown[]) => hostFn!(name, ...args),
    installHostFn(fn: (name: string, ...args: unknown[]) => unknown) {
      hostFn = fn
    },
    async handleRscStream(
      component: string,
      props: unknown,
      layouts: unknown,
      loadings: unknown,
      slots: unknown,
      overrides: unknown,
      from: number,
      pageKey?: string,
    ) {
      calls.rsc.push({ component, props, layouts, slots, overrides, from, pageKey })

      // The engine decides the real depth; here it agrees with the proposal.
      return { stream: empty(), segmentDepth: from }
    },
    async handleRscHtmlStream(
      component: string,
      props: unknown,
      layouts: unknown,
      loadings: unknown,
      slots: unknown,
      overrides: unknown,
      nonce: unknown,
      pageKey: unknown,
      bootstrap?: boolean,
    ) {
      calls.html.push({ component, props, bootstrap })

      return { htmlStream: empty() }
    },
    async handleAction(
      actionId: string,
      body: Uint8Array,
      contentType: string,
      page: unknown,
      takeRevalidated?: () => string[],
    ) {
      // Awaited, so marking and reading are separated by a suspension point —
      // marks that leaked between requests would show up here and nowhere in a
      // synchronous test.
      await onAction?.()
      calls.action.push({
        actionId,
        body: new TextDecoder().decode(body),
        contentType,
        page,
        revalidated: takeRevalidated?.() ?? [],
      })

      return { stream: empty() }
    },
    async handleRscRevalidate(target: string, page: unknown) {
      calls.revalidate.push({ target, page })

      return { rscPayload: `payload for ${target}` }
    },
  }
}

describe('matching a url to a route', () => {
  // The dynamic route is declared first deliberately: taking the first match
  // rather than the most specific one would then answer /docs/new with [slug],
  // and this ordering is what the manifest actually produces — it is sorted by
  // component name, and '[' sorts before 'n'.
  const manifest = manifestOf({
    '/': [],
    '/docs': ['app/layout'],
    '/docs/[slug]': ['app/layout'],
    '/docs/new': ['app/layout'],
    '/files/[...path]': ['app/layout'],
  })

  test('binds a dynamic segment as a param', () => {
    expect(matchRoute(manifest, '/docs/routing')?.params).toEqual({ slug: 'routing' })
  })

  test('prefers the static page over the dynamic one', () => {
    // /docs/new is the page called new, not [slug] with slug="new". Manifest
    // order must not decide this: it is sorted by component name, so the
    // dynamic route can perfectly well come first.
    expect(matchRoute(manifest, '/docs/new')?.route.component).toBe('app/docs/new/page')
  })

  test('a catch-all takes the rest of the path', () => {
    expect(matchRoute(manifest, '/files/a/b/c.txt')?.params).toEqual({ path: 'a/b/c.txt' })
  })

  test('decodes what the url encoded', () => {
    expect(matchRoute(manifest, '/docs/hello%20world')?.params).toEqual({ slug: 'hello world' })
  })

  test('matches the root', () => {
    expect(matchRoute(manifest, '/')?.route.component).toBe('app/page')
  })

  test('does not match a longer path against a shorter route', () => {
    // Without the length check /docs would answer for /docs/a/b as well.
    expect(matchRoute(manifest, '/nope')).toBeNull()
    expect(matchRoute(manifest, '/docs/a/b')).toBeNull()
  })
})

describe('how much of the page to send', () => {
  test('nothing held means a whole document', () => {
    expect(sharedDepth(null, ['app/layout'])).toBe(0)
  })

  test('the shared prefix is what the client can keep', () => {
    expect(sharedDepth('app/layout,app/docs/layout', ['app/layout', 'app/docs/layout'])).toBe(2)
  })

  test('stops at the first difference rather than counting matches', () => {
    expect(sharedDepth('app/layout,app/blog/layout', ['app/layout', 'app/docs/layout'])).toBe(1)
  })

  test('shares nothing with the same layouts in a different order', () => {
    // Depth is a position in the chain, not a set. Asking whether the chain
    // merely contains each held layout says 2 here — and the client would be
    // handed a segment for a boundary it does not have at that depth.
    expect(sharedDepth('app/docs/layout,app/layout', ['app/layout', 'app/docs/layout'])).toBe(0)
  })

  test('never claims more than either chain has', () => {
    expect(sharedDepth('app/layout,app/docs/layout', ['app/layout'])).toBe(1)
  })
})

describe('the request the browser makes', () => {
  const manifest = manifestOf({ '/': [], '/docs/[slug]': ['app/layout'] })

  function handlerFor(engine: ReturnType<typeof fakeEngine>) {
    return createRscHandler({ engine: engine as never, manifest, version: 'build-1' })
  }

  test('a plain request gets the document', async () => {
    const engine = fakeEngine()
    const res = await handlerFor(engine)(new Request('http://x/docs/routing'))

    expect(res?.headers.get('Content-Type')).toStartWith('text/html')
    expect(engine.calls.html).toHaveLength(1)
    expect(engine.calls.rsc).toHaveLength(0)
  })

  test('X-RSC gets a payload on the same url', async () => {
    const engine = fakeEngine()
    const res = await handlerFor(engine)(
      new Request('http://x/docs/routing', { headers: { 'X-RSC': '1' } }),
    )

    expect(res?.headers.get('Content-Type')).toStartWith('text/x-component')
    expect(engine.calls.rsc).toHaveLength(1)
  })

  test('both answers vary on the header that chose between them', async () => {
    // One url, two representations. Without Vary on *both* a cache serves the
    // Flight payload to a browser asking for the page, or the page to a
    // navigation asking for the payload.
    const document = await handlerFor(fakeEngine())(new Request('http://x/'))
    const payload = await handlerFor(fakeEngine())(
      new Request('http://x/', { headers: { 'X-RSC': '1' } }),
    )

    // Contains, not equals: the answer also varies on the headers that choose
    // between a partial, a named region and an interceptor — a cache keyed on
    // X-RSC alone hands one client another's body.
    expect(document?.headers.get('Vary')).toContain('X-RSC')
    expect(payload?.headers.get('Vary')).toContain('X-RSC-Revalidate')
  })

  test('the url params reach the page as props', async () => {
    const engine = fakeEngine()
    await handlerFor(engine)(new Request('http://x/docs/routing'))

    expect(engine.calls.html[0]).toMatchObject({ props: { slug: 'routing' } })
  })

  test('the held chain becomes the depth to render from', async () => {
    const engine = fakeEngine()
    const res = await handlerFor(engine)(
      new Request('http://x/docs/routing', {
        headers: { 'X-RSC': '1', 'X-RSC-Segments': 'app/layout' },
      }),
    )

    expect(engine.calls.rsc[0]).toMatchObject({ from: 1 })
    expect(res?.headers.get('X-RSC-Segment-Depth')).toBe('1')
    // What to send back next time.
    expect(res?.headers.get('X-RSC-Layouts')).toBe('app/layout')
  })

  test('the build is named on every answer', async () => {
    // The client compares it and falls back to a full load when it changes;
    // without it a session keeps talking to a deployment that is gone.
    const res = await handlerFor(fakeEngine())(new Request('http://x/'))

    expect(res?.headers.get('X-RSC-Version')).toBe('build-1')
  })

  test('a url the manifest does not claim falls through', async () => {
    // Null, not 404: the host may have its own routes below this one.
    expect(await handlerFor(fakeEngine())(new Request('http://x/health'))).toBeNull()
  })
})

describe('server actions', () => {
  const manifest = manifestOf({ '/': [], '/docs/[slug]': ['app/layout'] })

  test('are taken on the path the client posts to, and nowhere else', async () => {
    // createViteRscApp posts to /_rsc/action unconditionally. Mounted anywhere
    // else the request falls through, the decoder never runs, and the button
    // does nothing — with no error on either side.
    const engine = fakeEngine()
    const handle = createRscHandler({ engine: engine as never, manifest })

    const wrong = await handle(new Request('http://x/action', { method: 'POST' }))
    expect(wrong).toBeNull()

    const right = await handle(
      new Request('http://x/_rsc/action', {
        method: 'POST',
        headers: { 'X-RSC-Action': 'file#greet' },
        body: '["ramon"]',
      }),
    )

    expect(right?.status).toBe(200)
    expect(engine.calls.action[0]).toMatchObject({ actionId: 'file#greet', body: '["ramon"]' })
  })

  test('a cookie the action set lands on its own response', async () => {
    // Signing someone in is a mutation whose whole result is a cookie. The
    // action body runs inside the window where a response can still be
    // changed; nothing about that is visible from the action's own return.
    const engine = fakeEngine(async () => {
      const jar = await cookies()

      jar.set('session', 'abc', { httpOnly: true })
      jar.set('locale', 'fr')
    })
    const handle = createRscHandler({ engine: engine as never, manifest })

    const response = await handle(
      new Request('http://x/_rsc/action', {
        method: 'POST',
        headers: { 'X-RSC-Action': 'file#login' },
        body: '[]',
      }),
    )

    // Several cookies are several headers: joining them gives the browser one
    // malformed cookie and no session.
    expect(response?.headers.getSetCookie()).toEqual([
      'session=abc; Path=/; HttpOnly',
      'locale=fr; Path=/',
    ])
  })

  test('carry the real content type, which the body does not', async () => {
    // The body goes out as octet-stream so a host that parses multipart cannot
    // consume it first; treating that as the real type leaves an upload
    // undecodable.
    const engine = fakeEngine()

    await createRscHandler({ engine: engine as never, manifest })(
      new Request('http://x/_rsc/action', {
        method: 'POST',
        headers: {
          'X-RSC-Action': 'a#b',
          'X-RSC-Content-Type': 'multipart/form-data; boundary=xyz',
          'Content-Type': 'application/octet-stream',
        },
        body: 'x',
      }),
    )

    expect(engine.calls.action[0]).toMatchObject({ contentType: 'multipart/form-data; boundary=xyz' })
  })

  test('know the page they were invoked from, so they can re-render part of it', async () => {
    const engine = fakeEngine()

    await createRscHandler({ engine: engine as never, manifest })(
      new Request('http://x/_rsc/action', {
        method: 'POST',
        headers: { 'X-RSC-Action': 'a#b', 'X-RSC-Referer': '/docs/routing' },
        body: '[]',
      }),
    )

    expect(engine.calls.action[0]).toMatchObject({
      page: { component: 'app/docs/[slug]/page', props: { slug: 'routing' } },
    })
  })

  test('are refused without naming one', async () => {
    const res = await createRscHandler({ engine: fakeEngine() as never, manifest })(
      new Request('http://x/_rsc/action', { method: 'POST', body: '[]' }),
    )

    expect(res?.status).toBe(400)
  })
})

describe('host functions', () => {
  const manifest = manifestOf({ '/': [] })

  test('are reached by the name a server component calls', async () => {
    const engine = fakeEngine()

    createRscHandler({
      engine: engine as never,
      manifest,
      rpc: { getUser: (id) => ({ id, name: 'ramon' }) },
    })

    expect(await engine.callHost('getUser', 7)).toEqual({ id: 7, name: 'ramon' })
  })

  test('say so when the name is not one of them', async () => {
    // Returning null instead renders as missing data, with nothing anywhere
    // saying the name was wrong.
    const engine = fakeEngine()

    createRscHandler({ engine: engine as never, manifest, rpc: { known: () => 1 } })

    expect(engine.callHost('typo')).rejects.toThrow(/No host function named "typo"/)
  })
})

describe('route interception', () => {
  const manifest: RouteManifest = {
    ...manifestOf({ '/': [], '/feed': ['app/layout'], '/posts/[slug]': ['app/layout'] }),
    intercepts: [
      {
        component: 'app/@modal/(.)posts/[slug]/page',
        slot: 'modal',
        segments: segments('/posts/[slug]'),
        marker: '(.)',
      },
    ],
  }

  // The page the modal opens over declares the slot.
  manifest.routes.find((r) => r.component === 'app/feed/page')!.slots = { modal: 'app/@modal/default' }

  const intercepting = (headers: Record<string, string>) =>
    new Request('http://x/posts/hello', { headers: { 'X-RSC': '1', ...headers } })

  test('renders the interceptor alone, not the page it opens over', async () => {
    // The page underneath is already mounted and still correct. Re-rendering
    // it to place the modal rebuilds everything below the layout that owns
    // the slot — so opening a modal from a half-filled form throws the form
    // away.
    const engine = fakeEngine()

    await createRscHandler({ engine: engine as never, manifest })(
      intercepting({ 'X-RSC-Intercept': 'modal', 'X-RSC-Referer': '/feed' }),
    )

    expect(engine.calls.rsc).toHaveLength(0)
    expect(engine.calls.revalidate[0]).toMatchObject({
      target: 'modal',
      page: { parallelSlots: { modal: 'app/@modal/(.)posts/[slug]/page' } },
    })
  })

  test('the interceptor gets the target url params, not the page it opens over', async () => {
    // A modal for /posts/hello opened from /feed is about hello.
    const engine = fakeEngine()

    await createRscHandler({ engine: engine as never, manifest })(
      intercepting({ 'X-RSC-Intercept': 'modal', 'X-RSC-Referer': '/feed' }),
    )

    expect(engine.calls.revalidate[0]).toMatchObject({ page: { props: { slug: 'hello' } } })
  })

  test('says which region the answer fills', async () => {
    // Without it the client has no way to tell a region from a segment of the
    // page, and applying one as the other replaces the page it was meant to
    // open over.
    const engine = fakeEngine()

    const res = await createRscHandler({ engine: engine as never, manifest })(
      intercepting({ 'X-RSC-Intercept': 'modal', 'X-RSC-Referer': '/feed' }),
    )

    expect(res?.headers.get('X-RSC-Revalidate')).toBe('modal')
  })

  test('falls back to rendering the page for a build that cannot render a region', async () => {
    // An older bundle has no handleRscRevalidate. Refusing would be worse than
    // the behaviour it replaces, which put the modal on screen at the cost of
    // the page beneath.
    const engine = fakeEngine()

    delete (engine as { handleRscRevalidate?: unknown }).handleRscRevalidate

    await createRscHandler({ engine: engine as never, manifest })(
      intercepting({ 'X-RSC-Intercept': 'modal', 'X-RSC-Referer': '/feed' }),
    )

    expect(engine.calls.rsc[0]).toMatchObject({
      component: 'app/feed/page',
      pageKey: '__intercept:modal:/posts/hello',
    })
  })

  test('falls back to the interceptor alone when there is no page to open over', async () => {
    const engine = fakeEngine()

    await createRscHandler({ engine: engine as never, manifest })(
      intercepting({ 'X-RSC-Intercept': 'modal' }),
    )

    expect(engine.calls.rsc[0]).toMatchObject({
      component: 'app/@modal/(.)posts/[slug]/page',
      props: { slug: 'hello' },
    })
  })

  test('a slot with no interceptor for this url is a 404, not the plain page', async () => {
    const res = await createRscHandler({ engine: fakeEngine() as never, manifest })(
      intercepting({ 'X-RSC-Intercept': 'sidebar', 'X-RSC-Referer': '/feed' }),
    )

    expect(res?.status).toBe(404)
  })

  test('a plain request for the same url gets the real page', async () => {
    // A hard load, or opening the link in a new tab. Nothing to open over, and
    // the header the client sends on an intercepted navigation is absent.
    const engine = fakeEngine()

    await createRscHandler({ engine: engine as never, manifest })(
      new Request('http://x/posts/hello', { headers: { 'X-RSC': '1' } }),
    )

    expect(engine.calls.rsc[0]).toMatchObject({ component: 'app/posts/[slug]/page' })
  })

  test('only ever intercepts a client navigation, never a document load', async () => {
    // The header can arrive on a full page load — a restored tab, a proxy that
    // replays headers. Without the X-RSC check that serves an interception as
    // the whole document: a modal with no page behind it and no way back.
    const engine = fakeEngine()

    await createRscHandler({ engine: engine as never, manifest })(
      new Request('http://x/posts/hello', { headers: { 'X-RSC-Intercept': 'modal', 'X-RSC-Referer': '/feed' } }),
    )

    expect(engine.calls.rsc).toHaveLength(0)
    expect(engine.calls.html[0]).toMatchObject({ component: 'app/posts/[slug]/page' })
  })

  test('the slots a page declares reach the render', async () => {
    // Parallel slots are not interception: the feed renders its @modal/default
    // whether or not anything is intercepting.
    const engine = fakeEngine()

    await createRscHandler({ engine: engine as never, manifest })(
      new Request('http://x/feed', { headers: { 'X-RSC': '1' } }),
    )

    expect(engine.calls.rsc[0]).toMatchObject({ slots: { modal: 'app/@modal/default' } })
  })
})

describe('where the route table comes from', () => {
  test('defaults to the one the bundle carries', async () => {
    // An adapter passes the engine and nothing else. Requiring the manifest
    // separately is the version-skew bug waiting to happen.
    const engine = Object.assign(fakeEngine(), {
      manifest: () => manifestOf({ '/only-in-bundle': [] }),
    })

    const res = await createRscHandler({ engine: engine as never })(
      new Request('http://x/only-in-bundle'),
    )

    expect(res?.status).toBe(200)
  })

  test('an explicit one still wins, for a host that builds its own', async () => {
    const engine = Object.assign(fakeEngine(), {
      manifest: () => manifestOf({ '/from-bundle': [] }),
    })

    const handle = createRscHandler({
      engine: engine as never,
      manifest: manifestOf({ '/from-option': [] }),
    })

    expect(await handle(new Request('http://x/from-option'))).not.toBeNull()
    expect(await handle(new Request('http://x/from-bundle'))).toBeNull()
  })

  test('says so when there is no table at all', async () => {
    // Rather than matching nothing and 404ing every page, which reads as a
    // routing bug in the app.
    expect(() => createRscHandler({ engine: fakeEngine() as never })).toThrow(/No route table/)
  })
})

describe('host functions already installed', () => {
  test('are left alone by a handler that brings none', async () => {
    // A prerenderer sharing this engine instance installs its own, and a host
    // may set one up before building the handler. Installing unconditionally
    // replaces it, and every call then fails as unregistered — which reads as
    // the app calling a name it never registered.
    const engine = fakeEngine()

    engine.installHostFn(async () => 'from the host')

    createRscHandler({ engine: engine as never, manifest: manifestOf({ '/': [] }) })

    expect(await engine.callHost('anything')).toBe('from the host')
  })

  test('are replaced when the handler brings its own', async () => {
    const engine = fakeEngine()

    engine.installHostFn(async () => 'from the host')

    createRscHandler({
      engine: engine as never,
      manifest: manifestOf({ '/': [] }),
      rpc: { greet: () => 'from the handler' },
    })

    expect(await engine.callHost('greet')).toBe('from the handler')
  })
})

describe('revalidating part of a page', () => {
  const manifest = manifestOf({ '/': [], '/orders/[id]': ['app/layout'] })

  test('a request naming a region gets that region alone', async () => {
    const engine = fakeEngine()

    const res = await createRscHandler({ engine: engine as never, manifest })(
      new Request('http://x/orders/7', {
        headers: { 'X-RSC': '1', 'X-RSC-Revalidate': 'orders' },
      }),
    )

    expect(await res!.text()).toBe('payload for orders')
    expect(engine.calls.rsc).toHaveLength(0)
  })

  test('rendered against the page it belongs to', async () => {
    // A section is a region *of a page*, so it needs that page's props — the
    // orders list for order 7, not for whatever page happens to be first.
    const engine = fakeEngine()

    await createRscHandler({ engine: engine as never, manifest })(
      new Request('http://x/orders/7', {
        headers: { 'X-RSC': '1', 'X-RSC-Revalidate': 'orders' },
      }),
    )

    expect(engine.calls.revalidate[0]).toMatchObject({
      target: 'orders',
      page: { component: 'app/orders/[id]/page', props: { id: '7' } },
    })
  })

  test('says which region it is answering with', async () => {
    // The client applies it to a named boundary; an answer that does not say
    // which one would have to be guessed at.
    const res = await createRscHandler({ engine: fakeEngine() as never, manifest })(
      new Request('http://x/', { headers: { 'X-RSC': '1', 'X-RSC-Revalidate': 'orders' } }),
    )

    expect(res?.headers.get('X-RSC-Revalidate')).toBe('orders')
  })

  test('is only ever a payload request, never a document one', async () => {
    // The header can arrive on a navigation. Answering a document request with
    // a bare region replaces the page with a fragment.
    const engine = fakeEngine()

    await createRscHandler({ engine: engine as never, manifest })(
      new Request('http://x/', { headers: { 'X-RSC-Revalidate': 'orders' } }),
    )

    expect(engine.calls.revalidate).toHaveLength(0)
    expect(engine.calls.html).toHaveLength(1)
  })
})

describe('what an action marks while it runs', () => {
  const manifest = manifestOf({ '/': [], '/orders/[id]': ['app/layout'] })

  const invoke = (engine: ReturnType<typeof fakeEngine>) =>
    createRscHandler({ engine: engine as never, manifest })(
      new Request('http://x/_rsc/action', {
        method: 'POST',
        headers: { 'X-RSC-Action': 'a#b', 'X-RSC-Referer': '/orders/7' },
        body: '[]',
      }),
    )

  test('comes back with the action, rather than being fetched afterwards', async () => {
    // One round trip: the answer the user is waiting on carries the
    // re-rendered region with it. Telling the client to go and ask means the
    // result arrives before the screen is right.
    const engine = fakeEngine(() => revalidate('orders'))

    await invoke(engine)

    expect(engine.calls.action[0]).toMatchObject({ revalidated: ['orders'] })
  })

  test('marking nothing marks nothing', async () => {
    const engine = fakeEngine()

    await invoke(engine)

    expect(engine.calls.action[0]).toMatchObject({ revalidated: [] })
  })

  test('the same region marked twice is one region', async () => {
    const engine = fakeEngine(() => {
      revalidate('orders')
      revalidate('orders')
    })

    await invoke(engine)

    expect(engine.calls.action[0]).toMatchObject({ revalidated: ['orders'] })
  })

  test('marking outside an action is ignored rather than fatal', () => {
    // Shared code may mark; being called during an ordinary render must not
    // make it throw.
    expect(() => revalidate('orders')).not.toThrow()
  })

  test('marks belong to the action that made them', async () => {
    // Two actions in flight at once must not see each other's marks. Global
    // state would hand one request the other's regions.
    const first = fakeEngine(async () => {
      revalidate('orders')
      // Yield mid-action, so the other request is running when this one reads.
      await new Promise((r) => setTimeout(r, 5))
    })
    const second = fakeEngine(async () => {
      revalidate('invoices')
      await new Promise((r) => setTimeout(r, 5))
    })

    await Promise.all([invoke(first), invoke(second)])

    expect(first.calls.action[0]).toMatchObject({ revalidated: ['orders'] })
    expect(second.calls.action[0]).toMatchObject({ revalidated: ['invoices'] })
  })
})

describe('two actions in flight at once', () => {
  test('each writes its own cookies, not the other request\'s', async () => {
    // Nothing sequences actions here, so two are genuinely inside at the same
    // moment. A response draft that was module state rather than request state
    // would hand one visitor the other's session — and only under load, which
    // is where it would never be found.
    const first = fakeEngine(async () => {
      ;(await cookies()).set('session', 'alice')
      // Yield mid-action, so the other request is running when this one writes.
      await new Promise((r) => setTimeout(r, 5))
      ;(await cookies()).set('role', 'admin')
    })
    const second = fakeEngine(async () => {
      ;(await cookies()).set('session', 'bob')
      await new Promise((r) => setTimeout(r, 5))
      ;(await cookies()).set('role', 'guest')
    })

    const post = (engine: ReturnType<typeof fakeEngine>) =>
      createRscHandler({ engine: engine as never, manifest: manifestOf({ '/': [] }) })(
        new Request('http://x/_rsc/action', {
          method: 'POST',
          headers: { 'X-RSC-Action': 'file#act' },
          body: '[]',
        }),
      )

    const [a, b] = await Promise.all([post(first), post(second)])

    expect(a?.headers.getSetCookie()).toEqual(['session=alice; Path=/', 'role=admin; Path=/'])
    expect(b?.headers.getSetCookie()).toEqual(['session=bob; Path=/', 'role=guest; Path=/'])
  })
})

describe('marking across module copies', () => {
  test('a second copy of the module marks into the same place', async () => {
    // The app's actions are bundled into the server bundle; the host running
    // them is not. So this module is loaded twice, and a store per copy means
    // the action marks in one and the host reads the other. Nothing errors —
    // the action's answer simply never carries anything back, which reads as
    // revalidation not being implemented.
    const other = (await import('../../src/revalidate.ts?copy=2')) as typeof import('../../src/revalidate')

    // Genuinely a different module object, or this proves nothing.
    expect(other.revalidate).not.toBe(revalidate)

    const taken = await withRevalidation(async (take) => {
      other.revalidate('orders')

      return take()
    })

    expect(taken).toEqual(['orders'])
  })
})

describe('a client built to ask for payload files', () => {
  const exportBuilt = (): RouteManifest => ({
    ...manifestOf({ '/': [], '/docs': ['app/layout'] }),
    build: { output: 'export', exportPath: 'dist', payloadName: 'index.rsc' },
  })

  test('is answered by a server too', async () => {
    // Previewing an export, or one build served both ways. Without this the
    // page renders and every navigation 404s in the console — the only place
    // it shows.
    const engine = fakeEngine()

    const res = await createRscHandler({ engine: engine as never, manifest: exportBuilt() })(
      new Request('http://x/docs/index.rsc'),
    )

    expect(res?.headers.get('Content-Type')).toStartWith('text/x-component')
    expect(engine.calls.rsc[0]).toMatchObject({ component: 'app/docs/page' })
  })

  test('at the root as well', async () => {
    const engine = fakeEngine()

    await createRscHandler({ engine: engine as never, manifest: exportBuilt() })(
      new Request('http://x/index.rsc'),
    )

    expect(engine.calls.rsc[0]).toMatchObject({ component: 'app/page' })
  })

  test('and a server build still reads the header', async () => {
    // With no payload filename, a url ending in index.rsc is just a url.
    const engine = fakeEngine()

    const res = await createRscHandler({
      engine: engine as never,
      manifest: manifestOf({ '/': [] }),
    })(new Request('http://x/index.rsc'))

    expect(res).toBeNull()
  })
})

describe('serving a route that ships no client runtime', () => {
  const manifest = () => {
    const m = manifestOf({ '/': [], '/plain': [] })

    m.routes.find((r) => r.component === 'app/plain/page')!.clientJs = false

    return m
  }

  test('renders it without a bootstrap', async () => {
    // Not only at build time: a route serving on demand has to ship the same
    // thing it would have been frozen as, or the two disagree about whether
    // React is on the page.
    const engine = fakeEngine()

    await createRscHandler({ engine: engine as never, manifest: manifest() })(
      new Request('http://x/plain'),
    )

    expect(engine.calls.html[0]).toMatchObject({ bootstrap: false })
  })

  test('and every other route still gets one', async () => {
    const engine = fakeEngine()

    await createRscHandler({ engine: engine as never, manifest: manifest() })(new Request('http://x/'))

    expect(engine.calls.html[0]).toMatchObject({ bootstrap: true })
  })
})

describe('the key a page is remembered by', () => {
  test('is the same however the url is written', async () => {
    // A static host serves /orders as a directory, so the browser's url ends
    // in a slash while the build wrote the page down as /orders. Unequal keys
    // mean the retained page is never the one found on the way back: it stays
    // hidden in the document while a second copy renders beside it.
    expect(retentionKey('/orders/')).toBe(retentionKey('/orders'))
    expect(retentionKey('http://x/orders/')).toBe(retentionKey('/orders'))
  })

  test('keeps the root distinguishable from nothing', () => {
    expect(retentionKey('/')).toBe('/')
    expect(retentionKey('http://x/')).toBe('/')
  })

  test('keeps a query, which is part of what makes the page', () => {
    expect(retentionKey('/search/?q=a')).toBe('/search?q=a')
    expect(retentionKey('/search?q=a')).not.toBe(retentionKey('/search?q=b'))
  })

  test('and an interception is still its own thing', () => {
    expect(retentionKey('/posts/1/', 'modal')).toBe('__intercept:modal:/posts/1')
  })
})

describe('where marking finds its async context', () => {
  test('prefers the one the platform exposes globally', async () => {
    // A Worker has it on globalThis rather than as node:async_hooks — and so
    // does the engine, which assigns it there for React's edge build.
    // Reaching for the import first would work here and fail there.
    class Ambient {
      static used = false
      getStore() {
        return undefined
      }
      run<T>(_store: unknown, fn: () => T): T {
        Ambient.used = true

        return fn()
      }
    }

    const resolved = await resolveScope({ AsyncLocalStorage: Ambient })

    resolved.run(new Set(), () => null)

    expect(Ambient.used).toBe(true)
  })

  test('and keeps two overlapping actions apart', async () => {
    // The reason it is scoped at all: two requests can be in flight, and
    // marking is per-request state.
    const marks = await Promise.all([
      withRevalidation(async (take) => {
        revalidate('orders')
        await new Promise((r) => setTimeout(r, 20))

        return take()
      }),
      withRevalidation(async (take) => {
        await new Promise((r) => setTimeout(r, 5))
        revalidate('invoices')

        return take()
      }),
    ])

    expect(marks).toEqual([['orders'], ['invoices']])
  })
})

describe('marking across module copies', () => {
  test('a second copy of the module marks into the same place', async () => {
    // The app's actions are bundled into the server bundle; the host running
    // them is not. So this module is loaded twice, and a store per copy means
    // the action marks in one and the host reads the other. Nothing errors —
    // the action's answer simply never carries anything back, which reads as
    // revalidation not being implemented.
    const other = (await import('../../src/revalidate.ts?copy=2')) as typeof import('../../src/revalidate')

    // Genuinely a different module object, or this proves nothing.
    expect(other.revalidate).not.toBe(revalidate)

    const taken = await withRevalidation(async (take) => {
      other.revalidate('orders')

      return take()
    })

    expect(taken).toEqual(['orders'])
  })
})

describe('a client built to ask for payload files', () => {
  const exportBuilt = (): RouteManifest => ({
    ...manifestOf({ '/': [], '/docs': ['app/layout'] }),
    build: { output: 'export', exportPath: 'dist', payloadName: 'index.rsc' },
  })

  test('is answered by a server too', async () => {
    // Previewing an export, or one build served both ways. Without this the
    // page renders and every navigation 404s in the console — the only place
    // it shows.
    const engine = fakeEngine()

    const res = await createRscHandler({ engine: engine as never, manifest: exportBuilt() })(
      new Request('http://x/docs/index.rsc'),
    )

    expect(res?.headers.get('Content-Type')).toStartWith('text/x-component')
    expect(engine.calls.rsc[0]).toMatchObject({ component: 'app/docs/page' })
  })

  test('at the root as well', async () => {
    const engine = fakeEngine()

    await createRscHandler({ engine: engine as never, manifest: exportBuilt() })(
      new Request('http://x/index.rsc'),
    )

    expect(engine.calls.rsc[0]).toMatchObject({ component: 'app/page' })
  })

  test('and a server build still reads the header', async () => {
    // With no payload filename, a url ending in index.rsc is just a url.
    const engine = fakeEngine()

    const res = await createRscHandler({
      engine: engine as never,
      manifest: manifestOf({ '/': [] }),
    })(new Request('http://x/index.rsc'))

    expect(res).toBeNull()
  })
})

describe('serving a route that ships no client runtime', () => {
  const manifest = () => {
    const m = manifestOf({ '/': [], '/plain': [] })

    m.routes.find((r) => r.component === 'app/plain/page')!.clientJs = false

    return m
  }

  test('renders it without a bootstrap', async () => {
    // Not only at build time: a route serving on demand has to ship the same
    // thing it would have been frozen as, or the two disagree about whether
    // React is on the page.
    const engine = fakeEngine()

    await createRscHandler({ engine: engine as never, manifest: manifest() })(
      new Request('http://x/plain'),
    )

    expect(engine.calls.html[0]).toMatchObject({ bootstrap: false })
  })

  test('and every other route still gets one', async () => {
    const engine = fakeEngine()

    await createRscHandler({ engine: engine as never, manifest: manifest() })(new Request('http://x/'))

    expect(engine.calls.html[0]).toMatchObject({ bootstrap: true })
  })
})

describe('the key a page is remembered by', () => {
  test('is the same however the url is written', async () => {
    // A static host serves /orders as a directory, so the browser's url ends
    // in a slash while the build wrote the page down as /orders. Unequal keys
    // mean the retained page is never the one found on the way back: it stays
    // hidden in the document while a second copy renders beside it.
    expect(retentionKey('/orders/')).toBe(retentionKey('/orders'))
    expect(retentionKey('http://x/orders/')).toBe(retentionKey('/orders'))
  })

  test('keeps the root distinguishable from nothing', () => {
    expect(retentionKey('/')).toBe('/')
    expect(retentionKey('http://x/')).toBe('/')
  })

  test('keeps a query, which is part of what makes the page', () => {
    expect(retentionKey('/search/?q=a')).toBe('/search?q=a')
    expect(retentionKey('/search?q=a')).not.toBe(retentionKey('/search?q=b'))
  })

  test('and an interception is still its own thing', () => {
    expect(retentionKey('/posts/1/', 'modal')).toBe('__intercept:modal:/posts/1')
  })
})

describe('running where there is no filesystem', () => {
  test('the adapter names no platform module', () => {
    // A Worker reads its assets from a binding, not from a disk. Anything the
    // handler imports has to exist there — and a bundler that finds `node:fs`
    // in the graph fails the build, or worse, ships a shim that returns
    // nothing and turns every asset into a silent 404.
    const source = readFileSync(join(packageRoot, 'src/host.ts'), 'utf-8')

    expect(source).not.toContain('node:')
  })

  test('and neither do the pieces it is built from', () => {
    for (const shared of ['routing.ts', 'headers.ts', 'manifest.ts']) {
      expect(readFileSync(join(packageRoot, 'src', shared), 'utf-8')).not.toContain('node:')
    }
  })

  test('prerendered pages come from whatever the host can read', async () => {
    // A store, a binding, a map in memory — the handler only asks for a name.
    const store = new Map([
      ['docs.html', '<html><body>from a store</body></html>'],
      ['docs.meta.json', JSON.stringify({ layouts: ['app/layout'] })],
      ['docs.seg1.flight', 'segment payload'],
    ])

    const handle = createRscHandler({
      engine: fakeEngine() as never,
      manifest: manifestOf({ '/docs': ['app/layout'] }),
      prerendered: (name) => store.get(name) ?? null,
    })

    const document = await handle(new Request('http://x/docs'))
    expect(await document!.text()).toContain('from a store')

    const payload = await handle(
      new Request('http://x/docs', { headers: { 'X-RSC': '1', 'X-RSC-Segments': 'app/layout' } }),
    )

    expect(await payload!.text()).toBe('segment payload')
    expect(payload!.headers.get('X-RSC-Segment-Depth')).toBe('1')
  })

  test('and a reader that finds nothing falls through to rendering', async () => {
    const engine = fakeEngine()

    const res = await createRscHandler({
      engine: engine as never,
      manifest: manifestOf({ '/docs': ['app/layout'] }),
      prerendered: () => null,
    })(new Request('http://x/docs'))

    expect(res?.status).toBe(200)
    expect(engine.calls.html).toHaveLength(1)
  })
})

describe('reading prerendered files from disk', () => {
  test('a miss costs a lookup, not a thrown ENOENT', async () => {
    // The host asks for {url}.html, then {url}.ppr.html, then the route's
    // pattern — so a page served by a pattern shell missed twice per request,
    // and each miss was an exception thrown and caught. Roughly half the cost
    // of serving that page, measured.
    const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs')
    const { join } = await import('node:path')
    const { tmpdir } = await import('node:os')
    const { prerenderedFrom } = await import('../../src/files')

    const dir = mkdtempSync(join(tmpdir(), 'rsc-read-'))

    writeFileSync(join(dir, 'index.html'), '<p>home</p>')

    const read = prerenderedFrom(dir)

    expect(await read('index.html')).toBe('<p>home</p>')
    expect(await read('nope.html')).toBeNull()

    // Contents are never cached, only existence: a redeploy that rewrites a
    // page is picked up without restarting.
    writeFileSync(join(dir, 'index.html'), '<p>changed</p>')

    expect(await read('index.html')).toBe('<p>changed</p>')

    rmSync(dir, { recursive: true, force: true })
  })

  test('a page written after the first read is not seen', async () => {
    // The trade-off the listing buys, stated so it cannot change by accident:
    // existence is a snapshot taken on first use. That is safe because the
    // prerender output is a build artefact and the build has finished — but a
    // server that expects to notice new files at runtime will not.
    const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs')
    const { join } = await import('node:path')
    const { tmpdir } = await import('node:os')
    const { prerenderedFrom } = await import('../../src/files')

    const dir = mkdtempSync(join(tmpdir(), 'rsc-read-'))

    writeFileSync(join(dir, 'index.html'), '<p>home</p>')

    const read = prerenderedFrom(dir)

    await read('index.html')

    writeFileSync(join(dir, 'late.html'), '<p>late</p>')

    expect(await read('late.html')).toBeNull()

    rmSync(dir, { recursive: true, force: true })
  })

  test('an absent directory reads as empty rather than throwing', async () => {
    const { prerenderedFrom } = await import('../../src/files')

    expect(await prerenderedFrom('/definitely/not/here')('index.html')).toBeNull()
  })
})
