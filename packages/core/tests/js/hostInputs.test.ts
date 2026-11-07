import { describe, expect, test } from 'bun:test'
import { formInputs } from '../../src/hostInputs'

const contact = { type: 'object', properties: { email: { type: 'string', format: 'email' } }, required: ['email'] }

describe('formInputs', () => {
  test('keeps a function taking one object with fields', () => {
    expect(formInputs({ 'Contact.send': { params: [contact] } }, {})).toEqual({ 'Contact.send': contact })
  })

  test('resolves a struct or class the manifest names, and a field that is one', () => {
    const defs = {
      Input: { type: 'object', properties: { status: { $ref: '#/defs/Status' }, plan: { anyOf: [{ $ref: '#/defs/Status' }, { type: 'null' }] } } },
      Status: { type: 'string', enum: ['open', 'shut'] },
    }

    expect(formInputs({ 'Tickets.open': { params: [{ $ref: '#/defs/Input' }] } }, defs)['Tickets.open']).toEqual({
      type: 'object',
      properties: { status: defs.Status, plan: { anyOf: [defs.Status, { type: 'null' }] } },
    })
  })

  test('keeps the order a backend says its fields are in', () => {
    const input = { type: 'object', 'x-order': ['name', 'email'], properties: { email: { type: 'string' }, name: { type: 'string' } } }

    expect(Object.keys(formInputs({ 'Contact.send': { params: [input] } }, {})['Contact.send']!.properties as object)).toEqual(['name', 'email'])
  })

  test('leaves out what cannot be a form', () => {
    expect(
      formInputs(
        {
          'Posts.find': { params: [{ type: 'string' }] },
          'Posts.page': { params: [contact, { type: 'integer' }] },
          'Open.request': { params: [{ type: 'object', additionalProperties: {} }] },
          '__rsc.middleware': { params: [contact] },
        },
        {},
      ),
    ).toEqual({})
  })
})
