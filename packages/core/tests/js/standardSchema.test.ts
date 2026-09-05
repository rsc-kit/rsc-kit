/**
 * Checking a form before it is submitted, with whatever library the app uses.
 *
 * Tested against real Zod rather than a hand-written stand-in: the whole point
 * is that we speak the contract libraries actually implement, and a fake would
 * agree with whatever this file assumed.
 */

import { describe, expect, test } from 'bun:test'
import { z } from 'zod'
import { issuesToErrors, validateWith } from '../../src/js/standardSchema'

const schema = z.object({
  title: z.string().min(3, 'Too short'),
  body: z.string().min(10, 'Too short'),
})

describe('a Standard Schema', () => {
  test('accepting a value reports nothing to show', async () => {
    expect(await validateWith(schema, { title: 'Hello', body: 'A body long enough' })).toBeNull()
  })

  test('rejecting it groups the messages by field', async () => {
    const errors = await validateWith(schema, { title: 'x', body: 'y' })

    expect(Object.keys(errors!).sort()).toEqual(['body', 'title'])
    expect(errors!.title[0]).toContain('Too short')
  })

  test('several messages for one field are kept, not collapsed', async () => {
    // `errors` is field → messages, and a form that renders only the first
    // still gets to choose. Dropping the rest here would take that away.
    const strict = z.object({
      slug: z.string().min(5, 'Too short').regex(/^[a-z]+$/, 'Lowercase only'),
    })

    const errors = await validateWith(strict, { slug: 'AB' })

    expect(errors!.slug.length).toBe(2)
  })

  test('a nested field is named the way it was written', async () => {
    const nested = z.object({ address: z.object({ city: z.string().min(1, 'Required') }) })

    const errors = await validateWith(nested, { address: { city: '' } })

    expect(Object.keys(errors!)).toEqual(['address.city'])
  })

  test('an issue about the form rather than a field goes under the empty key', async () => {
    // A cross-field rule — "these two must match" — belongs to no field, and
    // dropping it would fail a submit with nothing on screen to explain why.
    const matching = z
      .object({ a: z.string(), b: z.string() })
      .refine((v) => v.a === v.b, { message: 'Must match' })

    const errors = await validateWith(matching, { a: '1', b: '2' })

    expect(errors!['']).toEqual(['Must match'])
  })

  test('no schema means no opinion', async () => {
    expect(await validateWith(undefined, { anything: true })).toBeNull()
  })

  test('an async schema is awaited', async () => {
    const taken = z.object({
      name: z.string().refine(async (v) => v !== 'taken', { message: 'Already taken' }),
    })

    expect(await validateWith(taken, { name: 'taken' })).toEqual({ name: ['Already taken'] })
    expect(await validateWith(taken, { name: 'free' })).toBeNull()
  })
})

describe('the issue mapping', () => {
  test('accepts the object form of a path segment', async () => {
    // The spec allows a segment to be `{ key }` rather than the key itself.
    // A library that uses it would otherwise produce fields named
    // "[object Object]".
    expect(
      issuesToErrors([{ message: 'Nope', path: [{ key: 'user' }, { key: 'email' }] }]),
    ).toEqual({ 'user.email': ['Nope'] })
  })
})
