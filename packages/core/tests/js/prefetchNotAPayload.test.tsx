/**
 * A prefetch that is answered with something other than a payload - a 404
 * page, the backend's HTML, a proxy's error - is not a page to keep.
 *
 * A navigation checked the content type and left for a document load; a
 * prefetch did not, and stored whatever came back. So a link to a url nothing
 * answers worked only if it was never hovered: hovered first, the click was
 * handed the 404's text to decode as a tree, and the page stayed where it
 * was with nothing said - the answer visible only in the network tab. A port
 * met it on a "Continue with Google" button whose route did not exist yet.
 */

import { registerDom } from './dom'

registerDom()

import { afterEach, beforeEach, expect, test } from 'bun:test'
import {
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

let sent: string[] = []
let went: string[] = []
let shown: unknown[] = []
const realLocation = Object.getOwnPropertyDescriptor(window, 'location')

function installServer(answers: Record<string, () => Response>) {
  ;(globalThis as { fetch: unknown }).fetch = (input: unknown) => {
    const url = new URL(String(input), 'https://example.test').pathname
    sent.push(url)

    return Promise.resolve(
      answers[url]?.() ??
        new Response('page', {
          headers: { 'Content-Type': 'text/x-component', 'X-RSC-Segment-Depth': '0', 'X-RSC-Layouts': '' },
        }),
    )
  }
}

beforeEach(() => {
  sent = []
  went = []
  shown = []
  history.replaceState({}, '', '/start')
  setDeserializer(async (stream: ReadableStream) => await new Response(stream).text())
  setCallServer(async () => null)
  setNavigateHandler((tree: unknown) => shown.push(tree))
  setRestoreHandler(() => false)
  setInterceptManifest([])
  setHeldLayouts([])
  setApiRoutes([])

  Object.defineProperty(window, 'location', {
    configurable: true,
    value: {
      ...window.location,
      origin: 'https://example.test',
      set href(v: string) {
        went.push(v)
      },
      replace: (v: string) => went.push(v),
    },
  })
})

afterEach(() => {
  if (realLocation) Object.defineProperty(window, 'location', realLocation)
})

const settle = () => new Promise((r) => setTimeout(r, 5))

test('a hovered link to a url that answers a 404 page loads that page on click', async () => {
  installServer({
    '/login/google': () => new Response('<h1>Not Found</h1>', { status: 404, headers: { 'Content-Type': 'text/html' } }),
  })

  prefetch('/login/google')
  await settle()

  await navigate('/login/google' as never)

  expect(went).toEqual(['/login/google'])
  expect(shown).toEqual([])
})

test('a click that lands while that prefetch is still arriving loads the page too', async () => {
  installServer({
    '/login/google': () => new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain' } }),
  })

  prefetch('/login/google')
  await navigate('/login/google' as never)

  expect(went).toEqual(['/login/google'])
  expect(shown).toEqual([])
})

test('a prefetched payload is still used, and asked for once', async () => {
  installServer({})

  prefetch('/about')
  await settle()
  await navigate('/about' as never)

  expect(sent).toEqual(['/about'])
  expect(went).toEqual([])
})
