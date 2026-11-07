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
          'Posts.merge': { params: [contact, contact] },
          'Open.request': { params: [{ type: 'object', additionalProperties: {} }] },
          '__rsc.middleware': { params: [contact] },
        },
        {},
      ),
    ).toEqual({})
  })

  test('a function taking a record\'s key after its object is a form too, marked', () => {
    const product = { type: 'object', properties: { name: { type: 'string' } } }
    const inputs = formInputs(
      {
        'Products.update': { params: [product, { type: 'string' }] },
        'Products.move': { params: [product, { type: 'object' }] },
        'Products.three': { params: [product, { type: 'string' }, { type: 'string' }] },
      },
      {},
    )

    expect(inputs['Products.update']).toEqual({ ...product, 'x-key': true })
    expect(Object.keys(inputs)).toEqual(['Products.update'])
  })
})
