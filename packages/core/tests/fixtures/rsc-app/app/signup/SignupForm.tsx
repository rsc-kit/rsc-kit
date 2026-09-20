'use client'

import Form from '../../../../../src/js/Form'
import { signup } from '../../actions'

// The guide's form: a server action, uncontrolled fields, the error read
// from the render props. What a visitor without javascript posts and sees.
export function SignupForm() {
  return (
    <Form action={signup as never}>
      {({ error }) => (
        <>
          <input name="email" />
          <p id="email-error">{error('email') ?? ''}</p>
          <button type="submit">Sign up</button>
        </>
      )}
    </Form>
  )
}
