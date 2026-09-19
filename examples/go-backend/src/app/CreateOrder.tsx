'use client'
import { useState } from 'react'
// Written by the build from rsc-host-actions.json, which the Go process
// writes from the actions it registered. A stub per action, "use server".
import { ordersCreate } from '../server-actions.generated'

export function CreateOrder() {
  const [created, setCreated] = useState<string | null>(null)

  return (
    <form
      action={async (data) => {
        const result = (await ordersCreate(data.get('name'))) as { created: string }
        setCreated(result.created)
      }}
    >
      <input name="name" placeholder="A new order" required />
      <button>Create in Go</button>
      {created && <p>Created {created}.</p>}
    </form>
  )
}
