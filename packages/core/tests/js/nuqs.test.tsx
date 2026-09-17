// nuqs, through this router.
//
// Two behaviours, and they are the two the stock react adapter gets wrong or
// cannot do. A shallow update has to be seen by our own useSearchParams, which
// listens for an event rather than for history — an adapter that only writes
// history leaves the rest of the page on the old query. And a non-shallow
// update has to go through navigate(), not location.assign().

import { registerDom } from './dom'

registerDom()

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { useQueryState } from 'nuqs'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { NuqsAdapter } from '../../src/js/nuqs'
import { useSearchParams } from '../../src/js/useSearchParams'

let navigated: { url: string; replace?: boolean }[] = []

beforeEach(() => {
  navigated = []
  history.replaceState({}, '', '/listings')
  // navigate() is the router's; the adapter must reach it for a non-shallow
  // update. Recorded rather than run — there is no server here to fetch from.
  ;(window as any).__rsc_navigate = (url: string, opts: { replace?: boolean }) => {
    navigated.push({ url, replace: opts?.replace })

    return Promise.resolve()
  }
})

afterEach(() => {
  delete (window as any).__rsc_navigate
})

/** A filter, and beside it something else on the page reading the query. */
function Page({ shallow }: { shallow: boolean }) {
  const [kind, setKind] = useQueryState('kind', { shallow })
  const seenByRest = useSearchParams().get('kind')

  return (
    <>
      <button id="set" onClick={() => setKind('stay')} />
      <span id="nuqs">{kind ?? ''}</span>
      <span id="rest">{seenByRest ?? ''}</span>
    </>
  )
}

const mount = async (shallow: boolean) => {
  const host = document.createElement('div')
  document.body.append(host)

  await act(async () => {
    createRoot(host).render(
      <NuqsAdapter>
        <Page shallow={shallow} />
      </NuqsAdapter>,
    )
  })

  return host
}

describe('a shallow update', () => {
  test('writes the url and the rest of the page sees it', async () => {
    const host = await mount(true)

    await act(async () => {
      host.querySelector<HTMLButtonElement>('#set')!.click()
      await new Promise((r) => setTimeout(r, 60)) // nuqs batches through a throttle
    })

    expect(location.search).toBe('?kind=stay')
    expect(host.querySelector('#nuqs')!.textContent).toBe('stay')
    // The part the stock adapter misses: our own hook, in another component,
    // sees the new query without anything being fetched.
    expect(host.querySelector('#rest')!.textContent).toBe('stay')
    expect(navigated).toEqual([])
  })
})

describe('a non-shallow update', () => {
  test('goes through the router, not a page load', async () => {
    const host = await mount(false)

    await act(async () => {
      host.querySelector<HTMLButtonElement>('#set')!.click()
      await new Promise((r) => setTimeout(r, 60))
    })

    expect(navigated).toEqual([{ url: '/listings?kind=stay', replace: true }])
  })
})
