// Binding one field so the component holds its value.
//
// The gap this closes: a control with no native element behind it — a rich
// editor, a Radix select — cannot be read back as FormData, and a value you
// want to show as it is typed cannot be read from an uncontrolled input at all.
// react-hook-form solves both with <Controller>; this is the same four props.

import { registerDom } from './dom'

registerDom()

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, test } from 'bun:test'
import Form from '../../src/js/Form'

const mount = async (node: React.ReactNode) => {
  const host = document.createElement('div')
  document.body.append(host)

  await act(async () => {
    createRoot(host).render(node)
  })

  return host
}

describe('field()', () => {
  test('starts from defaultValues', async () => {
    const host = await mount(
      <Form action={async () => ({})} defaultValues={{ title: 'hello' }}>
        {({ field }) => <input {...field('title')} />}
      </Form>,
    )

    expect(host.querySelector('input')!.value).toBe('hello')
  })

  test('and the value is readable as it changes', async () => {
    // The character count in every form design, which an uncontrolled input
    // cannot do — the DOM has the value and React never sees it.
    //
    // Driven through the binding rather than by dispatching a DOM event: what
    // is being tested is that a new value re-renders everything reading it,
    // and React's synthetic event plumbing is happy-dom's problem, not this
    // component's.
    let type: ((next: unknown) => void) | null = null

    const host = await mount(
      <Form action={async () => ({})} defaultValues={{ body: '' }}>
        {({ field }) => {
          const bound = field('body')
          type = bound.onChange

          return (
            <>
              <input {...bound} readOnly />
              <span id="count">{bound.value.length}</span>
            </>
          )
        }}
      </Form>,
    )

    expect(host.querySelector('#count')!.textContent).toBe('0')

    await act(async () => {
      type!('abcd')
    })

    expect(host.querySelector('#count')!.textContent).toBe('4')
    expect(host.querySelector('input')!.value).toBe('abcd')
  })

  test('takes a bare value as well as an event', async () => {
    // A native input passes the event; a Radix select or an editor passes what
    // was chosen. A binder understanding only one works on half the controls
    // people actually use.
    let onChange: ((next: unknown) => void) | null = null

    const host = await mount(
      <Form action={async () => ({})} defaultValues={{ kind: '' }}>
        {({ field }) => {
          const bound = field('kind')
          onChange = bound.onChange

          return <input {...bound} readOnly />
        }}
      </Form>,
    )

    await act(async () => {
      onChange!('post')
    })

    expect(host.querySelector('input')!.value).toBe('post')
  })

  test('and a bound field still arrives in the submitted data', async () => {
    // It is an ordinary named input, so FormData reads it with everything
    // else. Nothing merges — there is one source of truth.
    let submitted: Record<string, unknown> = {}

    const host = await mount(
      <Form
        action={async (formData: FormData) => {
          submitted = Object.fromEntries(formData.entries())

          return {}
        }}
        defaultValues={{ kind: 'post' }}
      >
        {({ field }) => (
          <>
            <input {...field('kind')} readOnly />
            <input name="title" defaultValue="unbound" />
          </>
        )}
      </Form>,
    )

    await act(async () => {
      host.querySelector('form')!.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true }),
      )
    })

    expect(submitted).toEqual({ kind: 'post', title: 'unbound' })
  })
})

describe('after a successful submit', () => {
  test('says so, and stops saying so', async () => {
    // The "Saved ✓" that fades. State rather than a timer in every form that
    // wants one, because the timer has to be cleared when the component goes
    // away and that is the part people forget.
    let seen: { succeeded: boolean; recentlySucceeded: boolean } = {
      succeeded: false,
      recentlySucceeded: false,
    }

    const host = await mount(
      <Form action={async () => ({})}>
        {({ succeeded, recentlySucceeded }) => {
          seen = { succeeded, recentlySucceeded }

          return <input name="title" defaultValue="hi" />
        }}
      </Form>,
    )

    expect(seen.succeeded).toBe(false)

    await act(async () => {
      host.querySelector('form')!.dispatchEvent(
        new (window as never as { Event: typeof Event }).Event('submit', {
          bubbles: true,
          cancelable: true,
        }),
      )
    })

    expect(seen.succeeded).toBe(true)
    expect(seen.recentlySucceeded).toBe(true)
  })

  test('and a refused submit says neither', async () => {
    let seen = { succeeded: true, recentlySucceeded: true }

    const host = await mount(
      <Form action={async () => ({ validationErrors: { title: ['too short'] } })}>
        {({ succeeded, recentlySucceeded, errors }) => {
          seen = { succeeded, recentlySucceeded }

          return (
            <>
              <input name="title" defaultValue="x" />
              <span id="err">{errors.title?.[0] ?? ''}</span>
            </>
          )
        }}
      </Form>,
    )

    await act(async () => {
      host.querySelector('form')!.dispatchEvent(
        new (window as never as { Event: typeof Event }).Event('submit', {
          bubbles: true,
          cancelable: true,
        }),
      )
    })

    expect(host.querySelector('#err')!.textContent).toBe('too short')
    expect(seen.succeeded).toBe(false)
  })
})
