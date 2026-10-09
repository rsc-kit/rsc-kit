'use client'

import { useState } from 'react'
import { Form } from '@rsc-kit/core/form'
import { useAction } from '@rsc-kit/core/useAction'
import { ActionRefusedError, ServerValidationError } from '@rsc-kit/core/errors'
import { busy, invalid } from '../actions'

// A form posting to an action the backend turns down.
export function BusyForm() {
  return (
    <Form action={busy}>
      {({ formError }) => (
        <>
          <button type="submit" id="submit">submit</button>
          {formError && <p id="form-error" role="alert">{formError}</p>}
        </>
      )}
    </Form>
  )
}

// The same stub awaited directly, as a button's handler does. What follows the
// await must not run for a write the backend turned down.
export function BusyDirect() {
  const [said, setSaid] = useState('idle')

  return (
    <button
      id="direct"
      onClick={async () => {
        try {
          await busy()
          setSaid('success')
        } catch (error) {
          setSaid(error instanceof ActionRefusedError ? `refused ${error.status}: ${error.message}` : 'something else')
        }
      }}
    >
      {said}
    </button>
  )
}

// The same for an input the backend refused: in a form, awaited directly, and
// through useAction. Each must see the fields, and the direct await must not
// take it for the result it is typed as.
export function InvalidForm() {
  return (
    <Form action={invalid}>
      {({ error, formError }) => (
        <>
          <input name="name" />
          <button type="submit" id="invalid-submit">submit</button>
          {error('name') && <p id="invalid-field">{error('name')}</p>}
          {formError && <p id="invalid-form">{formError}</p>}
        </>
      )}
    </Form>
  )
}

export function InvalidDirect() {
  const [said, setSaid] = useState('idle')

  return (
    <button
      id="invalid-direct"
      onClick={async () => {
        try {
          await invalid()
          setSaid('success')
        } catch (error) {
          setSaid(
            error instanceof ServerValidationError
              ? `invalid: ${error.fieldErrors.name?.[0]} / ${error.formErrors[0]}`
              : 'something else',
          )
        }
      }}
    >
      {said}
    </button>
  )
}

export function InvalidAction() {
  const { execute, result } = useAction(invalid as never)

  return (
    <button id="invalid-action" onClick={() => (execute as () => void)()}>
      {(result as { validationErrors?: Record<string, string[]> }).validationErrors?.name?.[0] ?? 'idle'}
    </button>
  )
}
