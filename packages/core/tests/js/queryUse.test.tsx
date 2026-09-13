// Reading with use(), and the one thing Suspense does not do for you.
//
// React handles the suspending: put the component under a boundary and a
// pending read shows the fallback, with no loading flag to thread anywhere.
// What Suspense does NOT decide is when the reads START, and two use() calls in
// a row serialise — the first throws before the second line is ever reached, so
// the second read begins only after the first has answered.
//
// That is a waterfall, and it is the same distinction as `await a; await b`
// against Promise.all. Batching cannot rescue it, because by the time the
// second read is queued the first batch has long since gone out. Both shapes
// are pinned here so the difference is a fact rather than advice.

import { registerDom } from './dom'

registerDom()

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { Suspense, act, createElement, use } from 'react'
import { createRoot } from 'react-dom/client'
import { claimRead, clearQueries, readQuery, setQueryCodec } from '../../src/js/queryClient'

function reference(id: string) {
  const stub = (...args: unknown[]) =>
    claimRead(id, args) ?? Promise.reject(new Error('posted instead of read'))

  return stub as unknown as (...args: never[]) => Promise<string>
}

const getListings = reference('m#getListings')
const getCount = reference('m#getCount')

let sent: string[][] = []
let priorFetch: typeof fetch

/** The ids carried by each request, in the order they went out. */
function idsOf(url: string): string[] {
  const q = new URL(url, 'https://example.test').searchParams.get('q') ?? '[]'

  return (JSON.parse(q) as [string, string][]).map(([id]) => id.split('#')[1])
}

beforeEach(() => {
  sent = []
  clearQueries()

  setQueryCodec({
    encode: async (args) => JSON.stringify(args),
    deserialize: async (stream) => {
      const url = await new Response(stream).text()
      const q = new URL(url, 'https://example.test').searchParams.get('q') ?? '[]'
      const entries = JSON.parse(q) as [string, string][]

      return { results: entries.map(([id]) => `answer-to-${id.split('#')[1]}`) }
    },
  })

  priorFetch = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    sent.push(idsOf(String(input)))

    return new Response(String(input))
  }) as typeof fetch
})

afterEach(() => {
  globalThis.fetch = priorFetch
})

async function mount(element: React.ReactElement) {
  const host = document.createElement('div')

  document.body.append(host)

  const root = createRoot(host)

  await act(async () => {
    root.render(element)
  })

  // Enough turns for a waterfall to finish its second leg, so the serialised
  // shape is measured at rest rather than caught halfway.
  for (let i = 0; i < 3; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }

  return {
    text: () => host.textContent ?? '',
    unmount: () => act(() => root.unmount()),
  }
}

function boundary(child: React.ReactElement) {
  return createElement(Suspense, { fallback: createElement('span', null, 'loading') }, child)
}

/** One use() per line. Reads as if it were Promise.all. It is not. */
function Serialised() {
  const listings = use(readQuery(getListings, []))
  const count = use(readQuery(getCount, []))

  return createElement('span', null, `${listings}/${count}`)
}

/** Both reads started, then both awaited. */
function Together() {
  const listingsRead = readQuery(getListings, [])
  const countRead = readQuery(getCount, [])

  return createElement('span', null, `${use(listingsRead)}/${use(countRead)}`)
}

describe('two reads in one component', () => {
  test('written one use() per line, they waterfall into two requests', async () => {
    const view = await mount(boundary(createElement(Serialised)))

    expect(view.text()).toBe('answer-to-getListings/answer-to-getCount')

    // The cost of the obvious spelling. `use()` throws at the first line, so
    // the second read is not even queued until the first has come back —
    // nothing is in flight to batch it with.
    expect(sent).toEqual([['getListings'], ['getCount']])

    view.unmount()
  })

  test('started before either is awaited, they are one request', async () => {
    const view = await mount(boundary(createElement(Together)))

    expect(view.text()).toBe('answer-to-getListings/answer-to-getCount')
    expect(sent).toEqual([['getCount', 'getListings']])

    view.unmount()
  })

  test('a repeat from another component is not a second request', async () => {
    function Same() {
      return createElement('span', null, use(readQuery(getListings, [])))
    }

    const view = await mount(
      boundary(createElement('div', null, createElement(Together), createElement(Same))),
    )

    expect(sent).toEqual([['getCount', 'getListings']])

    view.unmount()
  })
})
