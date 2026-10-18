/**
 * A search on the page it is on is the page, asked again.
 *
 * A GET form whose action is the page on screen pushed `/lookup?q=beta` as a
 * page of its own: it mounted beside the one it left, so every Suspense
 * boundary in it showed its fallback and a view that held the form and its
 * results was a skeleton until the results arrived. The form asks for the
 * navigation in place, and the router tells the store which page it moves.
 * What it must not do is move a page for a link or a url that is not the same
 * path.
 */

import { registerDom } from './dom'

registerDom()

import { beforeEach, describe, expect, test } from 'bun:test'
import {
  navigate,
  setApiRoutes,
  setCallServer,
  setDeserializer,
  setHeldLayouts,
  setInterceptManifest,
  setNavigateHandler,
  setRestoreHandler,
} from '../../src/js/navigate'

let shown: { key: string; inPlaceOf: string | null | undefined; keepsPrevious: boolean | undefined }[] = []

beforeEach(() => {
  shown = []
  history.replaceState({}, '', '/lookup?q=alpha')
  ;(globalThis as { fetch: unknown }).fetch = () =>
    Promise.resolve(
      new Response('page', {
        headers: { 'Content-Type': 'text/x-component', 'X-RSC-Segment-Depth': '1', 'X-RSC-Layouts': '' },
      }),
    )
  setDeserializer(async (stream: ReadableStream) => await new Response(stream).text())
  setCallServer(async () => null)
  setNavigateHandler((_tree, key, _depth, inPlaceOf, keepsPrevious) => void shown.push({ key, inPlaceOf, keepsPrevious }))
  setRestoreHandler(() => false)
  setInterceptManifest([])
  setHeldLayouts([])
  setApiRoutes([])
})

describe('navigating in place', () => {
  test('names the page it moves, and that the one it leaves is kept for Back', async () => {
    await navigate('/lookup?q=beta' as never, { inPlace: true })

    expect(shown).toEqual([{ key: '/lookup?q=beta', inPlaceOf: '/lookup?q=alpha', keepsPrevious: true }])
  })

  test('a replace names it too, and the one it leaves is not kept', async () => {
    await navigate('/lookup?q=beta' as never, { inPlace: true, replace: true })

    expect(shown).toEqual([{ key: '/lookup?q=beta', inPlaceOf: '/lookup?q=alpha', keepsPrevious: false }])
  })

  test('a push that did not ask is a page of its own, as it was', async () => {
    await navigate('/lookup?q=beta' as never)

    expect(shown).toEqual([{ key: '/lookup?q=beta', inPlaceOf: null, keepsPrevious: true }])
  })

  test('another path is another page, whatever was asked', async () => {
    await navigate('/orders?q=beta' as never, { inPlace: true })

    expect(shown.map((s) => s.inPlaceOf)).toEqual([null])
  })
})
