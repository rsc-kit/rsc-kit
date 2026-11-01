'use client'

import Form from '@rsc-kit/core/form'

/** A form of one button, so it deletes without javascript too. */
export function DeleteButton({ action }: { action: () => Promise<unknown> }) {
  return (
    <Form action={action} className="admin-inline">
      {({ pending }) => <button className="admin-danger" disabled={pending}>{pending ? '…' : 'Delete'}</button>}
    </Form>
  )
}
