// Reading a query through somebody else's cache.
//
// `useQuery` in this package is a small, deliberately unambitious subset of
// what TanStack Query and SWR already do well, and an app that wants retries,
// focus revalidation, devtools, pagination or persistence should use one of
// them rather than wait for this to grow them. That only works if the transport
// composes, so this is the test that says it does — and that fails if a change
// here ever makes `readQuery` unusable as an ordinary async function.
//
// The division: the transport is ours because nobody else can have it. Reaching
// a query's id means being handed it by React inside the callServer this
// package owns, and batching has to happen below any cache, because a cache
// keyed per query cannot coalesce two different queries into one request.
// Everything above that line is replaceable.

import { registerDom } from './dom'

registerDom()

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { QueryClient, QueryClientProvider, useQuery as useTanstackQuery } from '@tanstack/react-query'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { claimRead, clearQueries, fetchQuery, readQuery, setQueryCodec } from '../../src/js/queryClient'

function reference(id: string) {
  const stub = (...args: unknown[]) =>
    claimRead(id, args) ?? Promise.reject(new Error('posted instead of read'))

  return stub as unknown as (...args: never[]) => Promise<string>
}

const getListings = reference('m#getListings')
const getCount = reference('m#getCount')

let served: string[] = []
let priorFetch: typeof fetch

/** What the server answers. Reassignable, so a revalidation can differ. */
let answer: (entries: [string, string][]) => unknown[] = (entries) =>
  entries.map(([id]) => `answer-to-${id.split('#')[1]}`)

beforeEach(() => {
  served = []
  clearQueries()
  answer = (entries) => entries.map(([id]) => `answer-to-${id.split('#')[1]}`)

  setQueryCodec({
    encode: async (args) => JSON.stringify(args),
    deserialize: async (stream) => {
      const url = await new Response(stream).text()
      const q = new URL(url, 'https://example.test').searchParams.get('q') ?? '[]'
      const entries = JSON.parse(q) as [string, string][]

      return { results: answer(entries) }
    },
  })

  priorFetch = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    served.push(String(input))

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

  // TanStack settles its own state a tick or two after the promise resolves,
  // so one act() is not enough to see the answer on screen.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })

  return {
    text: (id: string) => host.querySelector(`#${id}`)?.textContent ?? '',
    unmount: () => act(() => root.unmount()),
  }
}

function withClient(children: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  return createElement(QueryClientProvider, { client }, children)
}

function Listings() {
  // fetchQuery, not readQuery. Both are ordinary async functions and both
  // batch, but only fetchQuery goes to the server every time — see the
  // revalidation test below for what readQuery does here instead.
  const { data, isPending } = useTanstackQuery({
    queryKey: ['listings'],
    queryFn: () => fetchQuery(getListings, []),
  })

  return createElement('span', { id: 'listings' }, isPending ? 'loading' : String(data))
}

function Count() {
  const { data, isPending } = useTanstackQuery({
    queryKey: ['count'],
    queryFn: () => fetchQuery(getCount, []),
  })

  return createElement('span', { id: 'count' }, isPending ? 'loading' : String(data))
}

describe('fetchQuery as a TanStack Query fetcher', () => {
  test('answers an ordinary useQuery', async () => {
    const view = await mount(withClient(createElement(Listings)))

    expect(view.text('listings')).toBe('answer-to-getListings')

    view.unmount()
  })

  test('two TanStack queries still leave as one request', async () => {
    const view = await mount(
      withClient(createElement('div', null, createElement(Listings), createElement(Count))),
    )

    expect(view.text('listings')).toBe('answer-to-getListings')
    expect(view.text('count')).toBe('answer-to-getCount')

    // The property no cache library can give you, because batching has to
    // happen below the cache: TanStack sees two unrelated queryKeys and calls
    // two queryFns, and they still coalesce into a single GET.
    expect(served).toHaveLength(1)

    view.unmount()
  })

  test('a seed is initialData — but TanStack re-reads it unless told not to', async () => {
    function Seeded({ staleTime }: { staleTime?: number }) {
      const { data } = useTanstackQuery({
        queryKey: ['listings'],
        queryFn: () => fetchQuery(getListings, []),
        initialData: 'from-the-server',
        staleTime,
      })

      return createElement('span', { id: 'listings' }, String(data))
    }

    const naive = await mount(withClient(createElement(Seeded, {})))

    // TanStack treats initialData as stale at staleTime: 0 — its default — so
    // it revalidates on mount: the seed paints first, then is replaced, and the
    // round trip the seed existed to remove happens anyway. Worth knowing
    // before recommending TanStack as the cache layer.
    expect(served).toHaveLength(1)
    expect(naive.text('listings')).toBe('answer-to-getListings')

    naive.unmount()
    served = []
    clearQueries()

    const told = await mount(withClient(createElement(Seeded, { staleTime: 60_000 })))

    expect(told.text('listings')).toBe('from-the-server')
    expect(served).toHaveLength(0)

    told.unmount()
  })
})

describe('which read a cache library must be given', () => {
  function View(props: { queryFn: () => Promise<unknown> }) {
    const { data } = useTanstackQuery({
      queryKey: ['k'],
      queryFn: props.queryFn,
      staleTime: 0,
    })

    return createElement('span', { id: 'listings' }, String(data))
  }

  async function revalidate(queryFn: () => Promise<unknown>) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const host = document.createElement('div')

    document.body.append(host)

    const root = createRoot(host)
    const render = createElement(
      QueryClientProvider,
      { client },
      createElement(View, { queryFn }),
    )

    await act(async () => {
      root.render(render)
    })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    const first = host.querySelector('#listings')?.textContent

    // What the server answers changes between the two reads.
    answer = () => ['second-answer']

    await act(async () => {
      await client.invalidateQueries({ queryKey: ['k'] })
    })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    const second = host.querySelector('#listings')?.textContent

    act(() => root.unmount())

    return { first, second }
  }

  test('fetchQuery lets it actually revalidate', async () => {
    const { first, second } = await revalidate(() => fetchQuery(getListings, []))

    expect(first).toBe('answer-to-getListings')
    expect(second).toBe('second-answer')
  })

  test('readQuery does not, because it hands back the same promise forever', async () => {
    // Not a wart to work around — it is what makes `use(readQuery(...))` safe
    // during render. But given to a queryFn it makes the library's staleness
    // handling silently inert: invalidateQueries runs, the queryFn is called,
    // and the first answer comes back for the life of the page.
    const { first, second } = await revalidate(() => readQuery(getListings, []))

    expect(first).toBe('answer-to-getListings')
    expect(second).toBe(first)
  })
})
