/**
 * `fields` names what error() may be asked for, and is a claim about types only:
 * it must not reach the <form> as an attribute, and it changes nothing the form does.
 */

import './domBeforeImports'

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, test } from 'bun:test'
import Form from '../../src/js/Form'

test('is not passed on to the form element', async () => {
  const host = document.createElement('div')

  document.body.append(host)

  await act(async () => {
    createRoot(host).render(
      <Form action={async () => ({})} fields={['size', 'copies']}>
        {({ error }) => <input name="size" defaultValue={error('size') ?? 'ok'} />}
      </Form>,
    )
  })

  const form = host.querySelector('form')!

  expect(form.hasAttribute('fields')).toBe(false)
  expect(host.querySelector('input')!.value).toBe('ok')
})
