'use client'

import { Form } from '@rsc-kit/core/form'

// A search on the page it is on: a GET form whose action is this very route.
export function LookupForm({ q, action = '/lookup' }: { q: string; action?: '/lookup' | '/lookup-skeleton' }) {
  return (
    <Form action={action}>
      {({ pending }) => (
        <>
          <input name="q" id="q" defaultValue={q} />
          <button type="submit" id="search" data-busy={pending ? '' : undefined}>
            {pending ? 'Searching…' : 'Search'}
          </button>
        </>
      )}
    </Form>
  )
}
