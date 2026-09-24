// Whether one field can re-render without the rest of the form.
//
// This is the thing a per-field render prop buys in react-hook-form and
// TanStack Form, and the reason to want one. Counting renders is the only way
// to know it works — everything looks right either way.

import { registerDom } from './dom'

registerDom()

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, test } from 'bun:test'
import Form, { useField, useFormStore } from '../../src/js/Form'

const mount = async (node: React.ReactNode) => {
  const host = document.createElement('div')
  document.body.append(host)

  await act(async () => {
    createRoot(host).render(node)
  })

  return host
}

describe('a field that subscribes for itself', () => {
  test('re-renders alone, leaving the form and its siblings alone', async () => {
    let formRenders = 0
    let titleRenders = 0
    let otherRenders = 0
    let type: ((next: string) => void) | null = null

    function Title() {
      const { field: bound } = useField('title')

      titleRenders++
      type = bound.onChange as (next: string) => void

      return <input {...bound} readOnly />
    }

    function Other() {
      otherRenders++

      return <input name="other" />
    }

    await mount(
      <Form action={async () => ({})} defaultValues={{ title: '' }}>
        {() => {
          formRenders++

          return (
            <>
              <Title />
              <Other />
            </>
          )
        }}
      </Form>,
    )

    const before = { formRenders, titleRenders, otherRenders }

    await act(async () => {
      type!('typed')
    })

    // The field rendered again. Nothing else did — which is the whole claim,
    // and holds because this form never reads `dirty`: a form that does is
    // rendered once when the value first differs, and not for typing after.
    expect(titleRenders).toBe(before.titleRenders + 1)
    expect(formRenders).toBe(before.formRenders)
    expect(otherRenders).toBe(before.otherRenders)
  })

  test('while a field read through the render prop does re-render the form', async () => {
    // Not a flaw, a consequence: the value is being displayed *in* the render
    // prop, so the render prop has to run again to show it. The point is that
    // the caller chooses which.
    let formRenders = 0
    let type: ((next: string) => void) | null = null

    await mount(
      <Form action={async () => ({})} defaultValues={{ title: '' }}>
        {({ field }) => {
          formRenders++

          const bound = field('title')
          type = bound.onChange as (next: string) => void

          return <input {...bound} readOnly />
        }}
      </Form>,
    )

    const before = formRenders

    await act(async () => {
      type!('typed')
    })

    expect(formRenders).toBe(before + 1)
  })
})

describe('reading the values from elsewhere in the form', () => {
  test('a component that is not a field can watch them', async () => {
    // A summary, a preview, a count of what has changed — something that reads
    // the form without being part of it.
    let type: ((next: string) => void) | null = null

    function Editor() {
      const { field: bound } = useField('title')
      type = bound.onChange as (next: string) => void

      return <input {...bound} readOnly />
    }

    function Preview() {
      const { field } = useField('title')

      return <p id="preview">{field.value}</p>
    }

    const host = await mount(
      <Form action={async () => ({})} defaultValues={{ title: 'first' }}>
        {() => (
          <>
            <Editor />
            <Preview />
          </>
        )}
      </Form>,
    )

    expect(host.querySelector('#preview')!.textContent).toBe('first')

    await act(async () => {
      type!('second')
    })

    expect(host.querySelector('#preview')!.textContent).toBe('second')
  })

  test('and outside a form it says so rather than returning nothing', async () => {
    // Silently empty would look like a form with no values in it, which is a
    // long way from "there is no form here".
    //
    // Caught from the render rather than from the call: React runs the
    // component, so the throw arrives through its error handling and a bare
    // expect().toThrow() around createRoot never sees it.
    let raised: Error | null = null

    function Orphan() {
      try {
        useField('title')
      } catch (error) {
        raised = error as Error
      }

      return null
    }

    await mount(<Orphan />)

    expect(raised).not.toBeNull()
    expect((raised as unknown as Error).message).toContain('outside a <Form>')
  })
})

describe('a store created above the form', () => {
  test('lets something outside the form read its values', async () => {
    // The one case the context cannot reach: a sibling. react-hook-form and
    // TanStack get this from useForm() being the caller's to place; here it is
    // the store that moves rather than a whole form api.
    let type: ((next: string) => void) | null = null

    function TopBar({ store }: { store: ReturnType<typeof useFormStore> }) {
      const title = useField('title', store).field.value

      return <h1 id="bar">{title || 'Untitled'}</h1>
    }

    function Editor() {
      const { field: bound } = useField('title')
      type = bound.onChange as (next: string) => void

      return <input {...bound} readOnly />
    }

    function Page() {
      const store = useFormStore<{ title: string }>({ title: '' })

      return (
        <>
          <TopBar store={store} />
          <Form action={async () => ({})} store={store}>
            {() => <Editor />}
          </Form>
        </>
      )
    }

    const host = await mount(<Page />)

    expect(host.querySelector('#bar')!.textContent).toBe('Untitled')

    await act(async () => {
      type!('A bug report')
    })

    // Written inside the form, read outside it.
    expect(host.querySelector('#bar')!.textContent).toBe('A bug report')
  })

  test('and holding the store does not re-render the holder', async () => {
    // Creating it must not subscribe to it: the holder is an ancestor of the
    // form, so re-rendering it would re-render everything the scoping just
    // avoided.
    let pageRenders = 0
    let type: ((next: string) => void) | null = null

    function Editor() {
      const { field: bound } = useField('title')
      type = bound.onChange as (next: string) => void

      return <input {...bound} readOnly />
    }

    function Page() {
      const store = useFormStore<{ title: string }>({ title: '' })

      pageRenders++

      return (
        <Form action={async () => ({})} store={store}>
          {() => <Editor />}
        </Form>
      )
    }

    await mount(<Page />)

    const before = pageRenders

    await act(async () => {
      type!('typed')
    })

    expect(pageRenders).toBe(before)
  })
})

