// What a form makes of a repeated field.
//
// It kept the last one and dropped the rest, silently — so three checkboxes
// sharing a name validated as a string, and whatever the person actually
// ticked was gone before the schema saw it. Silent is what makes it worth a
// test rather than a fix.

import { registerDom } from './dom'

registerDom()

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, test } from 'bun:test'
import Form from '../../src/js/Form'

/** Submit a form and hand back the object the action was given. */
async function submitted(children: React.ReactNode): Promise<Record<string, unknown>> {
  let seen: Record<string, unknown> = {}

  const action = async (formData: FormData) => {
    seen = Object.fromEntries(
      [...new Set(formData.keys())].map((k) => [k, formData.getAll(k)]),
    )

    return {}
  }

  const host = document.createElement('div')
  document.body.append(host)

  let captured: Record<string, unknown> = {}

  await act(async () => {
    createRoot(host).render(
      <Form
        action={action}
        schema={{
          '~standard': {
            version: 1,
            vendor: 'test',
            // The schema is where the shape matters: this is what the object
            // looks like by the time anything validates it.
            validate: (value: unknown) => {
              captured = value as Record<string, unknown>

              return { value }
            },
          },
        } as never}
      >
        {children}
      </Form>,
    )
  })

  await act(async () => {
    host.querySelector('form')!.dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    )
  })

  void seen

  return captured
}

describe('a repeated name', () => {
  test('is an array, not whichever one happened to be last', async () => {
    const data = await submitted(
      <>
        <input name="tags" defaultValue="react" />
        <input name="tags" defaultValue="vite" />
      </>,
    )

    expect(data.tags).toEqual(['react', 'vite'])
  })

  test('and a name used once is still a plain value', async () => {
    const data = await submitted(<input name="title" defaultValue="hello" />)

    expect(data.title).toBe('hello')
  })
})

describe('a name ending in []', () => {
  test('is an array even when only one is selected', async () => {
    // Otherwise a checkbox list is a string with one ticked and an array with
    // two, and no schema can describe both.
    const data = await submitted(
      <input type="checkbox" name="tags[]" value="react" defaultChecked />,
    )

    expect(data.tags).toEqual(['react'])
  })

  test('and loses the brackets from the key', async () => {
    const data = await submitted(
      <input type="checkbox" name="tags[]" value="react" defaultChecked />,
    )

    expect(Object.keys(data)).toContain('tags')
    expect(Object.keys(data)).not.toContain('tags[]')
  })

  test('which is what useForm writes, so the two round-trip', async () => {
    // useForm serialises an array as `key[]`. Parsing it back the same way is
    // what makes a value survive a trip through both.
    const data = await submitted(
      <>
        <input name="tags[]" defaultValue="a" />
        <input name="tags[]" defaultValue="b" />
      </>,
    )

    expect(data.tags).toEqual(['a', 'b'])
  })
})

describe('a repeating group', () => {
  test('builds the objects it describes', async () => {
    // items[0].name is the shape the schema was written against. Arriving as a
    // literal key called "items[0].name" made a nested schema unusable.
    const data = await submitted(
      <>
        <input name="items[0].name" defaultValue="first" />
        <input name="items[0].qty" defaultValue="2" />
        <input name="items[1].name" defaultValue="second" />
        <input name="items[1].qty" defaultValue="3" />
      </>,
    )

    expect(data.items).toEqual([
      { name: 'first', qty: '2' },
      { name: 'second', qty: '3' },
    ])
  })

  test('and takes either spelling, because both are in use', async () => {
    const data = await submitted(
      <>
        <input name="items[0][name]" defaultValue="bracketed" />
        <input name="items[1].name" defaultValue="dotted" />
      </>,
    )

    expect(data.items).toEqual([{ name: 'bracketed' }, { name: 'dotted' }])
  })
})

describe('a nested object', () => {
  test('nests', async () => {
    const data = await submitted(
      <>
        <input name="address.city" defaultValue="Kingston" />
        <input name="address.country" defaultValue="JM" />
        <input name="name" defaultValue="Ada" />
      </>,
    )

    expect(data).toEqual({
      address: { city: 'Kingston', country: 'JM' },
      name: 'Ada',
    })
  })

  test('as deep as it is written', async () => {
    const data = await submitted(<input name="a.b.c.d" defaultValue="deep" />)

    expect(data).toEqual({ a: { b: { c: { d: 'deep' } } } })
  })

  test('and the error key matches, because issue paths join with dots too', async () => {
    // `errors['address.city']` is what a Standard Schema issue for that field
    // produces, so the name you wrote is the key you look under.
    const data = await submitted(<input name="address.city" defaultValue="Kingston" />)

    expect((data.address as Record<string, string>).city).toBe('Kingston')
  })
})
