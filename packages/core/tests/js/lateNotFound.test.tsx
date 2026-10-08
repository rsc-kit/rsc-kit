// A page that says it does not exist after its shell went out.
//
// The mark travels as an error digest to the boundary around the page, and
// that boundary took it for a failure: a person saw "Something went wrong" over
// a record that is simply not there. It is passed up like a redirect, and the
// RedirectBoundary asks the server for not-found.tsx and puts it where the page
// was. These are the cases a browser run cannot reach: the answer that is
// itself missing, and the request that fails.

import './domBeforeImports'

import { describe, expect, test, beforeEach } from 'bun:test'
import { act, createElement, type ReactElement, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { RedirectBoundary } from '../../src/js/RedirectBoundary'
import { RouteErrorBoundary, type RouteErrorProps } from '../../src/js/RouteErrorBoundary'

const MISSING = Object.assign(new Error('An error occurred'), { digest: 'RSC_NOT_FOUND' })

function Missing(): ReactNode {
  throw MISSING
}

const ErrorScreen = ({ error }: RouteErrorProps) => createElement('p', { id: 'error-tsx' }, `error.tsx: ${error.message}`)

const page = (child: ReactNode): ReactElement =>
  createElement(RedirectBoundary, null, createElement(RouteErrorBoundary, { fallback: ErrorScreen, resetKey: '/x' }, child))

async function mount(element: ReactElement) {
  const host = document.createElement('div')

  document.body.append(host)

  const root = createRoot(host)
  const quiet = console.error
  const run = async (fn: () => void | Promise<void>) => {
    console.error = () => {}
    await act(async () => void (await fn()))
    console.error = quiet
  }

  await run(() => root.render(element))

  return {
    host,
    show: (next: ReactElement) => run(() => root.render(next)),
    settle: () => run(() => new Promise<void>((resolve) => setTimeout(resolve, 20))),
    text: () => host.textContent ?? '',
  }
}

let asked: { url: string; opts: { replace?: boolean; notFound?: boolean } }[] = []
let answer: (() => Promise<void>) | null = null

beforeEach(() => {
  asked = []
  answer = async () => {}
  ;(window as unknown as { __rsc_navigate: unknown }).__rsc_navigate = (url: string, opts: never) => {
    asked.push({ url, opts })

    return answer!()
  }
  history.replaceState({}, '', '/c/clay/travel/nope')
})

describe('a missing page decided after the shell', () => {
  test('is not an error for error.tsx: the server is asked for not-found.tsx for this url', async () => {
    const view = await mount(page(createElement(Missing)))

    await view.settle()

    expect(asked).toEqual([{ url: '/c/clay/travel/nope', opts: { replace: true, notFound: true } }])
    expect(view.text()).not.toContain('error.tsx')
    expect(view.text()).not.toContain('Something went wrong')
  })

  test('shows what comes back, in place of the page', async () => {
    const view = await mount(page(createElement(Missing)))

    await view.settle()
    // The router put the not-found tree where the page was.
    await view.show(page(createElement('h1', null, 'Nothing here')))

    expect(view.text()).toContain('Nothing here')
  })

  test('a parent rendering again is not the answer: the same page would only throw again', async () => {
    const children = createElement(Missing)
    const view = await mount(createElement(RedirectBoundary, null, children))

    await view.settle()
    await view.show(createElement(RedirectBoundary, null, children))

    expect(asked).toHaveLength(1)
    expect(view.text()).toBe('')
  })

  test('an answer that is itself missing is shown as the error it is, not asked for again', async () => {
    const view = await mount(createElement(RedirectBoundary, null, createElement(Missing)))

    await view.settle()
    await view.show(createElement(RedirectBoundary, null, createElement(() => Missing())))

    expect(asked).toHaveLength(1)
    expect(view.text()).toContain('Something went wrong')
  })

  test('a request that fails leaves the error, not an empty space', async () => {
    answer = async () => {
      throw new Error('offline')
    }

    const view = await mount(createElement(RedirectBoundary, null, createElement(Missing)))

    await view.settle()

    expect(view.text()).toContain('Something went wrong')
  })

  test('a failure that is not a missing page is still error.tsx', async () => {
    const Broken = (): ReactNode => {
      throw new Error('the orders service is down')
    }
    const view = await mount(page(createElement(Broken)))

    await view.settle()

    expect(asked).toHaveLength(0)
    expect(view.text()).toContain('error.tsx: the orders service is down')
  })
})
