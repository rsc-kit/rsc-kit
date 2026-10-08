/**
 * A client component that calls a generated stub, tested through its handlers.
 *
 * This is the recipe in the testing guide, run: a DOM registered once, the
 * stub module replaced, the component mounted and clicked inside `act`. No
 * fake of React's internals - the handler is the one the component wrote.
 */

import './domBeforeImports'

import { act, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, describe, expect, mock, test } from 'bun:test'
import { isRedirected } from '../../src/js/errors'

let appsPause: (id: string) => Promise<unknown> = async () => {}
let invitesAccept: (token: string) => Promise<unknown> = async () => ''
const visited: string[] = []

mock.module('./redirectedStubs.fixture', () => ({
  appsPause: (id: string) => appsPause(id),
  invitesAccept: (token: string) => invitesAccept(token),
}))

const { appsPause: stubPause, invitesAccept: stubAccept } = await import('./redirectedStubs.fixture')

function Pause() {
  const [status, setStatus] = useState('idle')

  return (
    <button
      onClick={async () => {
        if (isRedirected(await stubPause('a1'))) return

        setStatus('paused')
      }}
    >
      {status}
    </button>
  )
}

function Accept() {
  return (
    <button
      onClick={async () => {
        const id = await stubAccept('tok')

        if (isRedirected(id)) return

        visited.push(`/t/${id}`)
      }}
    >
      accept
    </button>
  )
}

const click = async (node: React.ReactNode) => {
  const host = document.createElement('div')

  document.body.append(host)

  await act(async () => {
    createRoot(host).render(node)
  })

  await act(async () => {
    host.querySelector('button')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })

  return host
}

beforeEach(() => {
  document.body.innerHTML = ''
  visited.length = 0
})

describe('a component calling a stub', () => {
  test('reports success when the call did what it asked', async () => {
    appsPause = async () => {}

    expect((await click(<Pause />)).textContent).toBe('paused')
  })

  test('reports nothing when the call was redirected', async () => {
    appsPause = async () => ({ redirected: '/login' })

    expect((await click(<Pause />)).textContent).toBe('idle')
  })

  test('navigates to what it was given, and not to a redirect read as text', async () => {
    invitesAccept = async () => 'team-9'
    await click(<Accept />)

    invitesAccept = async () => ({ redirected: '/login' })
    await click(<Accept />)

    expect(visited).toEqual(['/t/team-9'])
  })
})
