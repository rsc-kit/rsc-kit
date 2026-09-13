// Reading a query from a client component.
//
// The hook is state rather than Suspense because React refuses a server
// function call during the initial render, so the first assertion here is the
// one that shape exists for: rendering on the server produces a loading state
// instead of throwing or hanging.

import { registerDom } from './dom'

registerDom()

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { act } from 'react'
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { useQuery, useSuspenseQuery } from '../../src/js/useQuery'
import { claimRead, clearQueries, setQueryCodec } from '../../src/js/queryClient'
import { Suspense } from 'react'

/** What plugin-rsc hands a client component: a stub that calls callServer. */
function reference(id: string) {
  const stub = (...args: unknown[]) =>
    claimRead(id, args) ?? Promise.reject(new Error('posted instead of read'))

  return stub as unknown as (...args: never[]) => Promise<string>
}

let served = 0
let priorFetch: typeof fetch

beforeEach(() => {
  served = 0
  clearQueries()

  setQueryCodec({
    encode: async (args) => JSON.stringify(args),
    deserialize: async (stream) => {
      const url = await new Response(stream).text()
      const q = new URL(url, 'https://example.test').searchParams.get('q') ?? '[]'
      const entries = JSON.parse(q) as [string, string][]

      // Answers change between reads, so a test can tell a re-read from a
      // cache hit without counting requests.
      return { results: entries.map(() => `read-${served}`) }
    },
  })

  priorFetch = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    served += 1

    return new Response(String(input))
  }) as typeof fetch
})

afterEach(() => {
  globalThis.fetch = priorFetch
})

const get = reference('m#get')

function Reader({ kind, initial }: { kind: string; initial?: string }) {
  const { data, error, isLoading, refresh } = useQuery<string>(get, [kind], {
    initialData: initial,
  })

  return createElement(
    'div',
    null,
    createElement('span', { id: 'state' }, error ? `error:${error.message}` : isLoading ? 'loading' : String(data)),
    createElement('button', { id: 'refresh', onClick: refresh }, 'Refresh'),
  )
}

async function mount(element: React.ReactElement) {
  const host = document.createElement('div')

  document.body.append(host)

  const root = createRoot(host)

  await act(async () => {
    root.render(element)
  })

  return {
    host,
    text: () => host.querySelector('#state')?.textContent ?? '',
    click: async (id: string) => {
      await act(async () => {
        host.querySelector<HTMLButtonElement>(`#${id}`)?.click()
      })
    },
    unmount: () => act(() => root.unmount()),
  }
}

describe('useQuery', () => {
  test('renders a loading state on the server rather than throwing', () => {
    // The whole reason this is not `use(readQuery(...))`. React refuses a
    // server-function call during the initial render, and suspending on a
    // promise that never settles would hold the HTML stream open instead.
    const html = renderToString(createElement(Reader, { kind: 'stay' }))

    expect(html).toContain('loading')
  })

  test('reads once the browser has it', async () => {
    const view = await mount(createElement(Reader, { kind: 'stay' }))

    expect(view.text()).toBe('read-1')

    view.unmount()
  })

  test('two components reading the same thing are one request', async () => {
    const view = await mount(
      createElement(
        'div',
        null,
        createElement(Reader, { kind: 'stay' }),
        createElement(Reader, { kind: 'stay' }),
      ),
    )

    expect(served).toBe(1)

    view.unmount()
  })

  test('refresh forgets the answer and reads again', async () => {
    const view = await mount(createElement(Reader, { kind: 'stay' }))

    expect(view.text()).toBe('read-1')

    await view.click('refresh')

    // Both halves matter: the request went out again, and the component shows
    // the new answer. Invalidating without re-reading would leave the old
    // value on screen with the cache empty behind it.
    expect(served).toBe(2)
    expect(view.text()).toBe('read-2')

    view.unmount()
  })

  test('changing the arguments reads again', async () => {
    const host = document.createElement('div')

    document.body.append(host)

    const root = createRoot(host)

    await act(async () => {
      root.render(createElement(Reader, { kind: 'stay' }))
    })

    expect(host.querySelector('#state')?.textContent).toBe('read-1')

    await act(async () => {
      root.render(createElement(Reader, { kind: 'experience' }))
    })

    expect(served).toBe(2)

    act(() => root.unmount())
  })

  test('the same arguments in a new array do not read again', async () => {
    const host = document.createElement('div')

    document.body.append(host)

    const root = createRoot(host)

    await act(async () => {
      root.render(createElement(Reader, { kind: 'stay' }))
    })

    // A re-render with an inline array builds a new one every time. Keying the
    // effect on the array's identity would refetch on every render of every
    // parent, which is the bug this primitive exists to prevent.
    await act(async () => {
      root.render(createElement(Reader, { kind: 'stay' }))
    })

    expect(served).toBe(1)

    act(() => root.unmount())
  })
})

describe('a read seeded by a server component', () => {
  test('has its answer on the first render, with no request', async () => {
    const view = await mount(createElement(Reader, { kind: 'stay', initial: 'from-the-server' }))

    expect(view.text()).toBe('from-the-server')
    expect(served).toBe(0)

    view.unmount()
  })

  test('is never reported as loading, not even for one render', () => {
    // Server-rendered, which is the render that matters: a seeded read showing
    // its loading state here puts a spinner in the HTML for data already in it,
    // and the browser then swaps it out on hydration.
    const html = renderToString(
      createElement(Reader, { kind: 'stay', initial: 'from-the-server' }),
    )

    expect(html).toContain('from-the-server')
    expect(html).not.toContain('loading')
  })

  test('answers a second component that was passed nothing', async () => {
    // The point of seeding a shared cache rather than passing a prop down: any
    // component reading the same query finds it, however far apart they are.
    const view = await mount(
      createElement(
        'div',
        null,
        createElement(Reader, { kind: 'stay', initial: 'from-the-server' }),
        createElement(Reader, { kind: 'stay' }),
      ),
    )

    expect(served).toBe(0)

    view.unmount()
  })

  test('does not overwrite an answer already fetched', async () => {
    const first = await mount(createElement(Reader, { kind: 'stay' }))

    expect(first.text()).toBe('read-1')

    // A seed is rendered with the page; an answer already fetched is newer.
    const second = await mount(createElement(Reader, { kind: 'stay', initial: 'stale-seed' }))

    expect(second.text()).toBe('read-1')

    first.unmount()
    second.unmount()
  })
})

describe('changing arguments', () => {
  test('does not report the previous answer as settled', async () => {
    const host = document.createElement('div')

    document.body.append(host)

    const root = createRoot(host)

    await act(async () => {
      root.render(createElement(Reader, { kind: 'stay', initial: 'stay-data' }))
    })

    expect(host.querySelector('#state')?.textContent).toBe('stay-data')

    // Rendered synchronously, so this catches the render BEFORE the effect for
    // the new arguments has run. Holding the previous answer here with
    // isLoading false shows one query's data under another's arguments — which
    // reads as data that is wrong rather than data that is pending.
    act(() => {
      root.render(createElement(Reader, { kind: 'experience' }))
    })

    expect(host.querySelector('#state')?.textContent).toBe('loading')

    act(() => root.unmount())
  })
})

function Suspending({ kind, initial }: { kind: string; initial?: string }) {
  const data = useSuspenseQuery<string>(get, [kind], { initialData: initial })

  return createElement('span', { id: 'state' }, data)
}

describe('useSuspenseQuery', () => {
  test('renders a seeded read on the server without suspending', () => {
    const html = renderToString(
      createElement(
        Suspense,
        { fallback: createElement('span', null, 'fallback') },
        createElement(Suspending, { kind: 'stay', initial: 'from-the-server' }),
      ),
    )

    expect(html).toContain('from-the-server')
    expect(html).not.toContain('fallback')
  })

  test('suspends and then resolves in the browser', async () => {
    const view = await mount(
      createElement(
        Suspense,
        { fallback: createElement('span', { id: 'state' }, 'fallback') },
        createElement(Suspending, { kind: 'stay' }),
      ),
    )

    expect(view.text()).toBe('read-1')
    expect(served).toBe(1)

    view.unmount()
  })
})
