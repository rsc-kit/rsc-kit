/**
 * A section an action refreshed keeps showing what it showed until the new
 * content is ready.
 *
 * The store's write reached the boundary through useSyncExternalStore, which
 * React applies at once and never as a transition, so content still arriving
 * suspended to the nearest fallback: a team picker and its breadcrumb blinked
 * to their skeleton on every save.
 */

import { registerDom } from './dom'

registerDom()

import { act, Suspense, use } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, test } from 'bun:test'
import { SlotBoundary } from '../../src/js/SlotBoundary'
import { clearSlots, setSlot } from '../../src/js/slotStore'

afterEach(() => {
  clearSlots()
  document.body.innerHTML = ''
})

function Later({ promise }: { promise: Promise<string> }) {
  return <span data-picker>{use(promise)}</span>
}

async function mount() {
  const container = document.createElement('div')
  document.body.appendChild(container)

  await act(async () => {
    createRoot(container).render(
      <Suspense fallback={<span data-skeleton>loading</span>}>
        <SlotBoundary name="picker">
          <span data-picker>Old team</span>
        </SlotBoundary>
      </Suspense>,
    )
  })

  return container
}

test('a refresh still arriving keeps the old content on screen, not the skeleton', async () => {
  const container = await mount()
  let resolve!: (value: string) => void
  const promise = new Promise<string>((r) => (resolve = r))

  await act(async () => {
    setSlot('picker', <Later promise={promise} />)
  })

  expect(container.querySelector('[data-skeleton]')).toBeNull()
  expect(container.textContent).toBe('Old team')

  await act(async () => {
    resolve('New team')
    await promise
  })

  expect(container.textContent).toBe('New team')
})

test('a refresh that is ready is shown at once', async () => {
  const container = await mount()

  await act(async () => {
    setSlot('picker', <span data-picker>Renamed</span>)
  })

  expect(container.textContent).toBe('Renamed')
})

test('a navigation that clears the section shows the first render again', async () => {
  const container = await mount()

  await act(async () => {
    setSlot('picker', <span data-picker>Renamed</span>)
  })
  await act(async () => {
    clearSlots()
  })

  expect(container.textContent).toBe('Old team')
})
