'use client'

import { Form } from '@rsc-kit/core/form'
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
