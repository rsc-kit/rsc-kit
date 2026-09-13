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
import { useQuery } from '../../src/js/useQuery'
import { claimRead, clearQueries, setQueryCodec } from '../../src/js/queryClient'

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

function Reader({ kind }: { kind: string }) {
  const { data, error, isLoading, refresh } = useQuery<string>(reference('m#get'), [kind])

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
