import { describe, expect, test } from 'bun:test'
import * as z from 'zod'
import { shown, slugify } from '../src/conditions'
import { submitForm } from '../src/forms/actions'
import { defineBlueprint } from '../src/forms/blueprint'
import { fieldsOf, valuesFrom } from '../src/resource'
import type { FormSchema } from '../src/resource'

/**
 * A field shown only while another says so, and a slug made from another
 * field: plain data the browser applies while the visitor types, and the
 * server applies again to what was sent.
 */
const submit = (values: Record<string, string>) => {
  const data = new FormData()

  for (const [name, value] of Object.entries(values)) data.set(name, value)

  return data
}

/** A schema as a backend's input arrives: JSON Schema, refusing nothing. */
const described = (input: Record<string, unknown>) =>
  ({ '~standard': { version: 1, vendor: 'rsc-kit', validate: (value: unknown) => ({ value }), jsonSchema: { input: () => input } } }) as unknown as FormSchema

describe('a condition', () => {
  const read = (values: Record<string, string | boolean>) => (name: string) => values[name] ?? ''

  test('is one value, several, or the opposite of them', () => {
    expect(shown({ when: 'type', is: 'business' }, read({ type: 'business' }))).toBe(true)
    expect(shown({ when: 'type', is: 'business' }, read({ type: 'person' }))).toBe(false)
    expect(shown({ when: 'type', is: ['business', 'charity'] }, read({ type: 'charity' }))).toBe(true)
    expect(shown({ when: 'type', not: 'person' }, read({ type: 'business' }))).toBe(true)
    expect(shown({ when: 'count', is: 2 }, read({ count: '2' }))).toBe(true)
  })

  test('with no value, is whether the field is filled in or switched on', () => {
    expect(shown({ when: 'shipping' }, read({ shipping: true }))).toBe(true)
    expect(shown({ when: 'shipping' }, read({ shipping: false }))).toBe(false)
    expect(shown({ when: 'shipping', is: false }, read({ shipping: false }))).toBe(true)
    expect(shown({ when: 'coupon' }, read({}))).toBe(false)
  })
})

test('a slug is lowercase letters, digits and dashes', () => {
  expect(slugify('Café & Bar - Downtown!')).toBe('cafe-bar-downtown')
  expect(slugify('  Hello   World  ')).toBe('hello-world')
})

describe('fields', () => {
  const account = z.object({ type: z.enum(['person', 'business']), company: z.string().optional(), name: z.string(), slug: z.string() })

  test('take visible and from from the app', () => {
    const fields = fieldsOf(account, { company: { visible: { when: 'type', is: 'business' } }, slug: { from: { field: 'name' } } })

    expect(fields.find((field) => field.name === 'company')).toMatchObject({ visible: { when: 'type', is: 'business' }, required: false })
    expect(fields.find((field) => field.name === 'slug')).toMatchObject({ from: { field: 'name' } })
  })

  test('take a backend\'s required_if as shown when, and required then', () => {
    const fields = fieldsOf(
      described({
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['person', 'business'] },
          company: { type: 'string', 'x-visible': { when: 'type', is: ['business'], required: true } },
        },
        required: ['type'],
      }),
    )

    expect(fields[1]).toMatchObject({ name: 'company', required: true, visible: { when: 'type', is: ['business'] } })
  })

  test('that name a field the form does not have fail at startup', () => {
    expect(() => fieldsOf(account, { company: { visible: { when: 'kind', is: 'business' } } })).toThrow('shown when kind')
    expect(() => fieldsOf(account, { slug: { from: { field: 'title' } } })).toThrow('made from title')
  })
})

describe('what the server keeps', () => {
  const fields = fieldsOf(z.object({ type: z.enum(['person', 'business']), company: z.string().optional(), vat: z.boolean(), name: z.string(), slug: z.string() }), {
    company: { visible: { when: 'type', is: 'business' } },
    vat: { visible: { when: 'type', is: 'business' } },
    slug: { from: { field: 'name' } },
  })

  test('drops what a hidden field was sent anyway', () => {
    expect(valuesFrom({ fields }, submit({ type: 'person', company: 'Acme', vat: 'on', name: 'Ada', slug: 'ada' }))).toEqual({ type: 'person', name: 'Ada', slug: 'ada' })
    expect(valuesFrom({ fields }, submit({ type: 'business', company: 'Acme', name: 'Ada', slug: 'ada' }))).toEqual({
      type: 'business',
      company: 'Acme',
      vat: false,
      name: 'Ada',
      slug: 'ada',
    })
  })

  test('makes a slug left empty, and keeps one typed by hand', () => {
    expect(valuesFrom({ fields }, submit({ type: 'person', name: 'Ada Lovelace', slug: '' })).slug).toBe('ada-lovelace')
    expect(valuesFrom({ fields }, submit({ type: 'person', name: 'Ada Lovelace', slug: 'countess' })).slug).toBe('countess')
  })

  test('in a blueprint\'s form, end to end', async () => {
    const saved: unknown[] = []

    defineBlueprint({
      name: 'c1',
      form: z.object({ type: z.enum(['person', 'business']), company: z.string().min(2).optional(), title: z.string(), slug: z.string().min(1) }),
      fields: { company: { visible: { when: 'type', is: 'business' } }, slug: { from: { field: 'title' } } },
      handle: (values) => void saved.push(values),
    })

    await submitForm('c1', null, submit({ type: 'person', company: 'x', title: 'Hello World', slug: '' }))

    // The company a person was never shown is not refused for being short; it is not there.
    expect(saved).toEqual([{ type: 'person', title: 'Hello World', slug: 'hello-world' }])
  })
})
