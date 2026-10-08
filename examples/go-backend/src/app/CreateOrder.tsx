'use client'
import { useState } from 'react'
import { isRedirected } from '@rsc-kit/core/errors'
// Written by the build from rsc-host.json, which the Go process
// writes from the actions it registered. A stub per action, "use server".
import { ordersCreate } from '../server-actions.generated'

export function CreateOrder() {
  const [created, setCreated] = useState<string | null>(null)

  return (
    <form
      action={async (data) => {
        // The form itself: the stub sends its fields as Go's NewOrder, and
        // the answer is typed as Go's Created.
        // A redirect (an expired session, a guard) resolves too, with where
        // the visitor is going: the page is already on its way, nothing to show.
        const result = await ordersCreate(data)
        if (isRedirected(result)) return
        setCreated(result.created)
      }}
    >
      <input name="name" placeholder="A new order" required />
      <button>Create in Go</button>
      {created && <p>Created {created}.</p>}
    </form>
  )
}
