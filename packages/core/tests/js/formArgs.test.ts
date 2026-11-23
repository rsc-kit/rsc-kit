// A form posted to a backend action, as the arguments the backend is called
// with. One function, imported by every module under server-actions/.

import { describe, expect, test } from 'bun:test'
import { formArgs } from '../../src/formArgs'

function form(entries: [string, string][]): FormData {
  const data = new FormData()
  for (const [key, value] of entries) data.append(key, value)
  return data
}

describe('formArgs', () => {
  test('arguments with no form are left as they are', () => {
    expect(formArgs([1, { a: 1 }], [])).toEqual([1, { a: 1 }])
    expect(formArgs([], [])).toEqual([])
  })

  test('fields are coerced by the parameter the form fills', () => {
    const schema = { properties: { qty: { type: 'integer' }, gift: { type: 'boolean' }, tags: { type: 'array', items: { type: 'number' } } } }

    expect(formArgs([form([['qty', '3'], ['tags', '1'], ['name', 'x']])], [schema])).toEqual([
      { qty: 3, tags: [1], name: 'x', gift: false },
    ])
  })

  test('a bound argument stays in front, and the form fills the one after it', () => {
    expect(formArgs(['team-1', form([['qty', '2']])], [null, { properties: { qty: { type: 'integer' } } }])).toEqual(['team-1', { qty: 2 }])
  })

  test('undescribed, a repeated name is a list, and React\'s own fields are dropped', () => {
    expect(formArgs([form([['a', '1'], ['a', '2'], ['$ACTION_ID_x', '']])], [])).toEqual([{ a: ['1', '2'] }])
  })
})
