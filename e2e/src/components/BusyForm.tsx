'use client'

import { useState } from 'react'
import { Form } from '@rsc-kit/core/form'
import { ActionRefusedError } from '@rsc-kit/core/errors'
import { busy } from '../actions'

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
