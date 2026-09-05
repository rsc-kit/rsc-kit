/**
 * Optimistic updates, against a real React renderer.
 *
 * Both <Form> and useForm call the updater inside their transition, on the
 * stated grounds that React's useOptimistic will then revert it when the
 * action settles. The first half works. The second does not: supplying an
 * optimistic callback leaves the transition permanently pending, so nothing
 * ever settles and the optimistic layer is never dropped.
 *
 * Isolated rather than assumed — plain useOptimistic driven by an async
 * transition reverts correctly here, including with the hook in a parent and
 * the transition in a child, and <Form> settles normally when no optimistic
 * callback is passed. It is the combination that wedges.
 */

import { registerDom } from './dom'

registerDom()

import { act, useOptimistic, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import Form, { useFormStatus } from '../../src/js/Form'
import { ServerValidationError } from '../../src/js/errors'

let release: (() => void) | null = null
let settled: Promise<void>
let mounted: Array<{ unmount: () => void }> = []

beforeEach(() => {
  history.replaceState({}, '', '/start')
  settled = new Promise<void>((r) => {
    release = r
  })
})

function PendingProbe() {
  const { pending } = useFormStatus()

  return <span data-pending={pending ? 'yes' : 'no'} />
}

/** A list whose server write is held open until the test releases it. */
function TodoList({
  failing,
  onError,
}: {
  failing?: 'validation' | 'unexpected'
  onError?: (errors: Record<string, string[]>, error?: unknown) => void
}) {
  const [items, setItems] = useState<string[]>(['first'])
  const [shown, addOptimistic] = useOptimistic(items, (state: string[], next: string) => [...state, next])

  async function save(formData: FormData) {
    await settled

    if (failing === 'validation') {
      throw new ServerValidationError('invalid', { title: ['Title is taken'] })
    }

    if (failing === 'unexpected') throw new Error('server said no')

    setItems((prev) => [...prev, String(formData.get('title'))])
  }

  return (
    <Form
      action={save}
      onError={onError}
      optimistic={(data: { title?: string }) => addOptimistic(String(data.title))}
    >
      <input name="title" defaultValue="second" />
      <PendingProbe />
      <ul>
        {shown.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ul>
    </Form>
  )
}

async function render(node: React.ReactNode) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  await act(async () => {
    const root = createRoot(container)
    mounted.push(root)
    root.render(node)
  })

  return container
}

// These trees deliberately end with a transition still pending, and a root left
// mounted carries that into whatever runs next — which is how this file first
// broke a useForm test three files later.
afterEach(async () => {
  release?.()
  await act(async () => {
    for (const root of mounted) root.unmount()
  })
  mounted = []
  document.body.innerHTML = ''
})

const shownItems = (c: Element) => [...c.querySelectorAll('li')].map((li) => li.textContent!)
const pendingState = (c: Element) => c.querySelector('[data-pending]')!.getAttribute('data-pending')

async function submit(container: Element) {
  await act(async () => {
    container
      .querySelector('form')!
      .dispatchEvent(new (window as any).Event('submit', { bubbles: true, cancelable: true }))
    await Promise.resolve()
  })
}

async function serverAnswers() {
  await act(async () => {
    release!()
    await settled.catch(() => {})
    await new Promise((r) => setTimeout(r, 500))
  })
}

describe('an optimistic update', () => {
  test('shows before the server has answered', async () => {
    // The half that works: the row is on screen while the write is in flight.
    const container = await render(<TodoList />)

    expect(shownItems(container)).toEqual(['first'])

    await submit(container)

    expect(shownItems(container)).toEqual(['first', 'second'])
  })

  test('stops pending once the server answers', async () => {
    // Slower than it looks: settling takes appreciably longer than a tick, so
    // a short window reads as though the transition were wedged.
    const container = await render(<TodoList />)

    await submit(container)
    await serverAnswers()

    expect(pendingState(container)).toBe('no')
  })

  test('is dropped once the real state contains it', async () => {
    // Otherwise the optimistic layer stacks on the state the write produced
    // and the row appears twice.
    const container = await render(<TodoList />)

    await submit(container)
    await serverAnswers()

    expect(shownItems(container)).toEqual(['first', 'second'])
  })

  test('is taken back when the server rejects it', async () => {
    // A validation failure is caught, so the action settles normally and the
    // optimistic layer goes with it.
    const container = await render(<TodoList failing="validation" />)

    await submit(container)

    expect(shownItems(container)).toEqual(['first', 'second'])

    await serverAnswers()

    expect(shownItems(container)).toEqual(['first'])
  })

  test('is taken back when the write throws something unexpected', async () => {
    // Rethrowing left the action rejected, and until it settles React keeps
    // the optimistic row on screen — showing a write that had failed.
    const container = await render(<TodoList failing="unexpected" onError={() => {}} />)

    await submit(container)
    await serverAnswers()

    expect(shownItems(container)).toEqual(['first'])
  })

  test('an unexpected failure reaches onError, with the thrown value', async () => {
    const seen: Array<{ errors: Record<string, string[]>; error?: unknown }> = []
    const container = await render(
      <TodoList failing="unexpected" onError={(errors, error) => seen.push({ errors, error })} />,
    )

    await submit(container)
    await serverAnswers()

    expect(seen).toHaveLength(1)
    expect(seen[0].errors).toEqual({})
    expect((seen[0].error as Error).message).toBe('server said no')
  })

  test('an unhandled failure is reported rather than swallowed', async () => {
    // Rethrowing at least made an unexpected error loud. Catching it to let
    // the transition settle must not make it disappear instead.
    const original = console.error
    const reported: unknown[] = []
    console.error = (...args: unknown[]) => reported.push(args)

    try {
      const container = await render(<TodoList failing="unexpected" />)
      await submit(container)
      await serverAnswers()

      expect(reported).toHaveLength(1)
      expect(String(reported[0])).toContain('server said no')
    } finally {
      console.error = original
    }
  })

  test('a validation failure still reports field errors and nothing else', async () => {
    // The existing contract: one argument, the field errors.
    const seen: Array<{ errors: Record<string, string[]>; error?: unknown }> = []
    const container = await render(
      <TodoList failing="validation" onError={(errors, error) => seen.push({ errors, error })} />,
    )

    await submit(container)
    await serverAnswers()

    expect(seen).toEqual([{ errors: { title: ['Title is taken'] }, error: undefined }])
  })
})
