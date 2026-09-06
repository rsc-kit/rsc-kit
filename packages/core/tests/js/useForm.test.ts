// useForm hook behaviour, run against a real React renderer in a DOM.
//
// The hook is the surface apps actually touch — data, validation errors,
// reset/defaults, transform, and the submit lifecycle. It needs a DOM, so
// happy-dom is registered before react-dom/client is imported.
//
// Run with: bun test tests/js
import { registerDom } from './dom'

registerDom()

const { afterEach, describe, expect, test } = await import('bun:test')
const { act } = await import('react')
const { createElement } = await import('react')
const { createRoot } = await import('react-dom/client')
const { useForm } = await import('../../src/js/useForm')
const { ServerValidationError, ServerDumpError } = await import('../../src/js/errors')

type Hook<T extends Record<string, unknown>> = ReturnType<typeof useForm<T>>

const roots: Array<{ unmount: () => void }> = []

/**
 * Render a hook and expose its latest return value.
 *
 * `current` is re-read after every commit, so assertions always see the state
 * the component would render with rather than a stale closure.
 */
function renderUseForm<T extends Record<string, unknown>>(
  initial: T,
  options: { schema?: unknown } = {},
) {
  const container = document.createElement('div')
  document.body.appendChild(container)

  const box: { current: Hook<T> } = { current: null as unknown as Hook<T> }

  function Probe() {
    box.current = useForm<T>(initial, options as never)

    return null
  }

  const root = createRoot(container)
  roots.push(root)

  act(() => {
    root.render(createElement(Probe))
  })

  return box
}

afterEach(() => {
  act(() => {
    while (roots.length) roots.pop()!.unmount()
  })
})

describe('useForm data', () => {
  test('starts with the initial values', () => {
    const form = renderUseForm({ name: 'ramon', age: 41 })

    expect(form.current.data).toEqual({ name: 'ramon', age: 41 })
  })

  test('sets a single field by name', () => {
    const form = renderUseForm({ name: 'ramon', age: 41 })

    act(() => form.current.setData('name', 'alex'))

    expect(form.current.data).toEqual({ name: 'alex', age: 41 })
  })

  test('merges an object of values', () => {
    const form = renderUseForm({ name: 'ramon', age: 41 })

    act(() => form.current.setData({ name: 'alex', age: 30 }))

    expect(form.current.data).toEqual({ name: 'alex', age: 30 })
  })
})

describe('useForm validation errors', () => {
  /** An action that fails validation the way the server action path does. */
  const failing = (errors: Record<string, string[]>) => () =>
    Promise.reject(new ServerValidationError('The given data was invalid.', errors))

  test('exposes errors returned by a failed submit', async () => {
    const form = renderUseForm({ email: '' })

    await act(async () => {
      await form.current.submit(failing({ email: ['The email field is required.'] })).catch(() => {})
    })

    expect(form.current.errors.email).toEqual(['The email field is required.'])
    expect(form.current.hasErrors).toBe(true)
  })

  // The other half of the Go adapter's story. Its action does not throw: it
  // returns what the backend answered, verbatim. This is that exact shape,
  // copied from what goAdapterAction.test.ts gets back over the wire — so if
  // the returned path ever stops feeding the form, it fails here rather than
  // only in a browser.
  test('errors a backend RETURNED, rather than threw, land on their fields', async () => {
    const form = renderUseForm({ name: '', quantity: '' })

    await act(async () => {
      await form.current.submit(async () => ({
        validationErrors: {
          name: ['The name field is required.'],
          quantity: ['The quantity must be a number.'],
        },
      }))
    })

    expect(form.current.error('name')).toBe('The name field is required.')
    expect(form.current.error('quantity')).toBe('The quantity must be a number.')
    expect(form.current.hasErrors).toBe(true)

    // A returned failure is not a rejection, so nothing here counts as success.
    expect(form.current.wasSuccessful).toBe(false)
  })

  test('error() returns the first message for a field', async () => {
    const form = renderUseForm({ email: '' })

    await act(async () => {
      await form.current.submit(failing({ email: ['first', 'second'] })).catch(() => {})
    })

    expect(form.current.error('email')).toBe('first')
  })

  test('error() is undefined for a field with no errors', () => {
    const form = renderUseForm({ email: '' })

    expect(form.current.error('email')).toBeUndefined()
    expect(form.current.hasErrors).toBe(false)
  })

  test('clearErrors() with no arguments clears everything', async () => {
    const form = renderUseForm({ email: '', name: '' })

    await act(async () => {
      await form.current.submit(failing({ email: ['bad'], name: ['bad'] })).catch(() => {})
    })
    act(() => form.current.clearErrors())

    expect(form.current.hasErrors).toBe(false)
  })

  test('clearErrors() with field names clears only those', async () => {
    const form = renderUseForm({ email: '', name: '' })

    await act(async () => {
      await form.current.submit(failing({ email: ['bad'], name: ['bad'] })).catch(() => {})
    })
    act(() => form.current.clearErrors('email'))

    expect(form.current.errors.email).toBeUndefined()
    expect(form.current.errors.name).toEqual(['bad'])
  })

  test('a fresh submit clears errors from the previous one', async () => {
    const form = renderUseForm({ email: '' })

    await act(async () => {
      await form.current.submit(failing({ email: ['bad'] })).catch(() => {})
    })
    await act(async () => {
      await form.current.submit(async () => ({ ok: true }))
    })

    expect(form.current.hasErrors).toBe(false)
  })
})

describe('useForm reset and defaults', () => {
  test('reset() restores every field to its initial value', () => {
    const form = renderUseForm({ name: 'ramon', age: 41 })

    act(() => form.current.setData({ name: 'alex', age: 30 }))
    act(() => form.current.reset())

    expect(form.current.data).toEqual({ name: 'ramon', age: 41 })
  })

  test('reset(field) restores only the named fields', () => {
    const form = renderUseForm({ name: 'ramon', age: 41 })

    act(() => form.current.setData({ name: 'alex', age: 30 }))
    act(() => form.current.reset('name'))

    expect(form.current.data).toEqual({ name: 'ramon', age: 30 })
  })

  test('reset() also clears errors', async () => {
    const form = renderUseForm({ email: '' })

    await act(async () => {
      await form.current
        .submit(() => Promise.reject(new ServerValidationError('nope', { email: ['bad'] })))
        .catch(() => {})
    })
    act(() => form.current.reset())

    expect(form.current.hasErrors).toBe(false)
  })

  test('setDefaults() makes the current values the new reset target', () => {
    const form = renderUseForm({ name: 'ramon' })

    act(() => form.current.setData('name', 'alex'))
    act(() => form.current.setDefaults())
    act(() => form.current.setData('name', 'sam'))
    act(() => form.current.reset())

    expect(form.current.data).toEqual({ name: 'alex' })
  })

  test('setDefaults(values) overrides only the given defaults', () => {
    const form = renderUseForm({ name: 'ramon', age: 41 })

    act(() => form.current.setDefaults({ name: 'default-name' }))
    act(() => form.current.reset())

    expect(form.current.data).toEqual({ name: 'default-name', age: 41 })
  })
})

describe('useForm submit', () => {
  test('sends the form state as FormData', async () => {
    const form = renderUseForm({ name: 'ramon', remember: true })
    let sent: FormData | null = null

    await act(async () => {
      await form.current.submit(async (formData) => {
        sent = formData

        return null
      })
    })

    expect(sent!.get('name')).toBe('ramon')
    expect(sent!.get('remember')).toBe('1')
  })

  test('transform() rewrites the payload without changing the state', async () => {
    const form = renderUseForm({ name: 'ramon' })
    let sent: FormData | null = null

    act(() => form.current.transform((data) => ({ ...data, name: String(data.name).toUpperCase() })))
    await act(async () => {
      await form.current.submit(async (formData) => {
        sent = formData

        return null
      })
    })

    expect(sent!.get('name')).toBe('RAMON')
    // The visible state is untouched — transform only shapes what is sent.
    expect(form.current.data.name).toBe('ramon')
  })

  test('marks the form successful after a submit resolves', async () => {
    const form = renderUseForm({ name: 'ramon' })

    expect(form.current.wasSuccessful).toBe(false)

    await act(async () => {
      await form.current.submit(async () => null)
    })

    expect(form.current.wasSuccessful).toBe(true)
    expect(form.current.recentlySuccessful).toBe(true)
  })

  test('runs the optimistic callback before the action', async () => {
    const form = renderUseForm({ name: 'ramon' })
    const order: string[] = []

    await act(async () => {
      await form.current.submit(
        async () => {
          order.push('action')

          return null
        },
        () => order.push('optimistic'),
      )
    })

    expect(order).toEqual(['optimistic', 'action'])
  })

  test('rejects on a non-validation failure so callers can handle it', async () => {
    const form = renderUseForm({ name: 'ramon' })
    let caught: unknown = null

    await act(async () => {
      await form.current.submit(async () => {
        throw new Error('boom')
      }).catch((e) => {
        caught = e
      })
    })

    expect((caught as Error)?.message).toBe('boom')
    expect(form.current.wasSuccessful).toBe(false)
  })

  test('treats a dump response as a resolved submit', async () => {
    // dd()/dump() in an action shows an overlay; it must not surface as a
    // rejected submit that callers have to special-case.
    const form = renderUseForm({ name: 'ramon' })
    let rejected = false

    await act(async () => {
      await form.current.submit(async () => {
        throw new ServerDumpError()
      }).catch(() => {
        rejected = true
      })
    })

    expect(rejected).toBe(false)
  })
})

describe('with a schema', () => {
  test('a rejected form never reaches the action', async () => {
    // The point of validating here at all: a mistake costs no round trip, and
    // the optimistic update never shows a row the server was going to refuse.
    const { z } = await import('zod')
    let called = 0

    const form = renderUseForm(
      { title: '' },
      { schema: z.object({ title: z.string().min(3, 'Too short') }) },
    )

    await act(async () => {
      await form.current.submit(async () => {
        called++
      })
    })

    expect(called).toBe(0)
    expect(form.current.errors.title).toEqual(['Too short'])
  })

  test('and an accepted one does', async () => {
    const { z } = await import('zod')
    let called = 0

    const form = renderUseForm(
      { title: 'long enough' },
      { schema: z.object({ title: z.string().min(3) }) },
    )

    await act(async () => {
      await form.current.submit(async () => {
        called++
      })
    })

    expect(called).toBe(1)
    expect(form.current.errors).toEqual({})
  })

  test('server errors still arrive when there is no schema', async () => {
    // Client validation is an addition, not a replacement: the server is what
    // actually decides, and its answer has to keep working.
    const form = renderUseForm({ title: '' })

    await act(async () => {
      await form.current
        .submit(() => Promise.reject(new ServerValidationError('nope', { title: ['Taken'] })))
        .catch(() => {})
    })

    expect(form.current.errors.title).toEqual(['Taken'])
  })
})
