'use client'

import { useRef } from 'react'
import Form from '@rsc-kit/core/form'
import Link from '@rsc-kit/core/Link'
import type { Field as FieldSpec } from '../resource.js'
import { Button } from './components/ui/button.js'
import { Card, CardContent, CardFooter } from './components/ui/card.js'
import { FieldGroup } from './components/ui/field.js'
import { FieldList, useBrowserErrors, useConditions } from './fields.js'

/**
 * Every resource's create and edit form, drawn from its fields. Uncontrolled:
 * a value starts as its default, and a refused save keeps what was typed.
 * The controls are shadcn's, and each submits under its field's name - a
 * Select and a Switch through the hidden input base-ui renders for them.
 *
 * The browser checks each control first, against the constraints read from
 * the schema (required, min, maxlength, pattern, type="email"). Its own
 * bubble is replaced by its message in the field's FieldError, where the
 * server's refusals show too; with JavaScript off the bubble is what shows.
 */
export function ResourceForm({
  action,
  fields,
  values,
  submit,
  cancel,
}: {
  action: (form: FormData) => Promise<unknown>
  fields: FieldSpec[]
  values: Record<string, unknown>
  submit: string
  cancel: string
}) {
  const form = useRef<HTMLFormElement>(null)
  const browser = useBrowserErrors(form)
  const hidden = useConditions(form, fields, values)

  return (
    <Form action={action} ref={form}>
      {({ pending, error: server, formError }) => {
        // The browser's message while the field is still wrong, else the server's.
        const error = (name: string) => browser[name] ?? server(name)

        return (
          <Card className="max-w-2xl">
            <CardContent>
              <FieldGroup>
                <FieldList fields={fields} values={values} error={error} hidden={hidden} />
                {formError && (
                  <p role="alert" className="text-sm text-destructive">
                    {formError}
                  </p>
                )}
              </FieldGroup>
            </CardContent>
            <CardFooter className="justify-end gap-2 border-t">
              <Button variant="outline" nativeButton={false} render={<Link href={cancel as never} />}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? 'Saving…' : submit}
              </Button>
            </CardFooter>
          </Card>
        )
      }}
    </Form>
  )
}
