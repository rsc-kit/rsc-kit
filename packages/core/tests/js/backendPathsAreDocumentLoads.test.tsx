/**
 * A url the app handed to its backend is never a page the router can render.
 *
 * `redirect('/gitlab/connect')` from a page, with /gitlab named in
 * `backendPaths`, is a real 3xx on a document load and `X-RSC-Redirect` on a
 * navigation. The router followed the header by fetching /gitlab/connect as a
 * payload, the backend bounced it to gitlab.com, and the browser refused that
 * hop - a fetch cannot follow a redirect to another origin with a header it
 * added. The navigation threw, the old page stayed up and the app was marked
 * unreachable. A url named in `backendPaths` is now loaded as a document, the
 * way a route.ts is, wherever the router meets it: a click, a redirect, or a
 * hover (which must not start an OAuth flow).
 */

import { registerDom } from './dom'

registerDom()

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  isApiRoute,
  navigate,
  prefetch,
  setApiRoutes,
  setCallServer,
  setDeserializer,
  setHeldLayouts,
  setInterceptManifest,
  setNavigateHandler,
  setRestoreHandler,
} from '../../src/js/navigate'
import { backendPatterns } from '../../src/vite'

let sent: string[] = []
let went: string[] = []
let replaced: string[] = []
let announced: { url: string; reason: string }[] = []
const realLocation = Object.getOwnPropertyDescriptor(window, 'location')

const onLoad = (e: Event) => announced.push((e as CustomEvent).detail)

/** Answers each url as a test said it should; anything else is a page. */
function installServer(answers: Record<string, () => Response> = {}) {
  ;(globalThis as { fetch: unknown }).fetch = (input: unknown) => {
    const url = new URL(String(input), 'https://example.test').pathname
    sent.push(url)

    return Promise.resolve(
      answers[url]?.() ??
        new Response('page', {
          headers: { 'Content-Type': 'text/x-component', 'X-RSC-Segment-Depth': '1', 'X-RSC-Layouts': '' },
        }),
    )
  }
}

beforeEach(() => {
  sent = []
  went = []
  replaced = []
  announced = []
  history.replaceState({}, '', '/start')
  setDeserializer(async (stream: ReadableStream) => await new Response(stream).text())
  setCallServer(async () => null)
  setNavigateHandler(() => {})
  setRestoreHandler(() => false)
  setInterceptManifest([])
  setHeldLayouts([])
  setApiRoutes(backendPatterns(['/gitlab', '/auth']))

  // A document load is observed, not performed: it is where the test ends.
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: {
      ...window.location,
      origin: 'https://example.test',
      set href(v: string) {
        went.push(v)
      },
      replace: (v: string) => replaced.push(v),
    },
  })
  window.addEventListener('rsc-kit:document-load', onLoad)
})

afterEach(() => {
  if (realLocation) Object.defineProperty(window, 'location', realLocation)
  window.removeEventListener('rsc-kit:document-load', onLoad)
})

describe('a backend prefix, as the client reads it', () => {
  test('is the prefix and everything under it, at a segment boundary', () => {
    expect(isApiRoute('/gitlab')).toBe(true)
    expect(isApiRoute('/gitlab/')).toBe(true)
    expect(isApiRoute('/gitlab/connect')).toBe(true)
    expect(isApiRoute('/gitlab/connect?next=/billing')).toBe(true)
    expect(isApiRoute('/gitlab/a/b/c')).toBe(true)
    expect(isApiRoute('/auth/github/callback')).toBe(true)

    // A team called gitlabs is the app's, as it is for the server.
    expect(isApiRoute('/gitlabs')).toBe(false)
    expect(isApiRoute('/authors/ada')).toBe(false)
    expect(isApiRoute('/billing')).toBe(false)
  })

  test('is the same patterns the server tests a url against, one for the prefix and one for what is under it', () => {
    expect(backendPatterns(['/gitlab'])).toEqual(['/gitlab', '/gitlab/[...rest]'])
    expect(backendPatterns([])).toEqual([])
  })

  test('treats a dot in the prefix as a dot', () => {
    setApiRoutes(backendPatterns(['/.well-known']))

    expect(isApiRoute('/.well-known/acme')).toBe(true)
    expect(isApiRoute('/xwell-known/acme')).toBe(false)
  })
})

describe('a navigation to one', () => {
  test('is a document load, and asks the server for nothing', async () => {
    installServer()

    await navigate('/gitlab/connect' as never)

    expect(went).toEqual(['/gitlab/connect'])
    expect(sent).toEqual([])
    expect(announced).toEqual([{ url: '/gitlab/connect', reason: 'api-route' }])
  })

  test('replaces the entry it was asked to replace, so Back does not return to what redirected', async () => {
    installServer()

    await navigate('/gitlab/connect' as never, { replace: true })

    expect(replaced).toEqual(['/gitlab/connect'])
    expect(went).toEqual([])
  })

  test('is never prefetched: a hover must not start an OAuth flow', () => {
    installServer()

    prefetch('/gitlab/connect')
    prefetch('/billing')

    expect(sent).toEqual(['/billing'])
  })
})

describe('a redirect to one, answered before the shell', () => {
  test('is followed as a document load, not fetched as a payload the backend will bounce', async () => {
    installServer({
      '/integrations': () => new Response(null, { status: 204, headers: { 'X-RSC-Redirect': '/gitlab/connect' } }),
    })

    await navigate('/integrations' as never)

    // The page that redirected was asked once; the destination never was.
    expect(sent).toEqual(['/integrations'])
    expect(went).toEqual(['/gitlab/connect'])
    expect(announced).toEqual([{ url: '/gitlab/connect', reason: 'api-route' }])
  })

  test('keeps the replace of the navigation that met it', async () => {
    installServer({
      '/integrations': () => new Response(null, { status: 204, headers: { 'X-RSC-Redirect': '/gitlab/connect' } }),
    })

    await navigate('/integrations' as never, { replace: true })

    expect(replaced).toEqual(['/gitlab/connect'])
    expect(went).toEqual([])
  })
})

describe('a redirect to another site, answered before the shell', () => {
  test('is followed as a document load too, with nothing named in backendPaths', async () => {
    setApiRoutes([])
    installServer({
      '/integrations': () =>
        new Response(null, { status: 204, headers: { 'X-RSC-Redirect': 'https://gitlab.com/oauth/authorize?state=1' } }),
    })

    await navigate('/integrations' as never)

    expect(sent).toEqual(['/integrations'])
    expect(went).toEqual(['https://gitlab.com/oauth/authorize?state=1'])
    expect(announced).toEqual([{ url: 'https://gitlab.com/oauth/authorize?state=1', reason: 'external' }])
  })
})

// A redirect decided inside a <Suspense> boundary arrives after the shell was
// shown and its entry written, and RedirectBoundary performs it with
// replace: true. Whatever it lands on, the url it left must not stay in
// history: Back would return to a page that redirects again.
describe('a document load that replaces', () => {
  test('is also how a destination off the origin is left', async () => {
    installServer()

    await navigate('https://gitlab.com/oauth/authorize?state=1' as never, { replace: true })

    expect(replaced).toEqual(['https://gitlab.com/oauth/authorize?state=1'])
    expect(went).toEqual([])
    expect(announced).toEqual([{ url: 'https://gitlab.com/oauth/authorize?state=1', reason: 'external' }])
  })

  test('and a plain navigation off the origin still pushes', async () => {
    installServer()

    await navigate('https://gitlab.com/oauth/authorize?state=1' as never)

    expect(went).toEqual(['https://gitlab.com/oauth/authorize?state=1'])
    expect(replaced).toEqual([])
  })
})
