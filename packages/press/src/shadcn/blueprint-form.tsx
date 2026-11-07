'use client'

import { useRef } from 'react'
import Form from '@rsc-kit/core/form'
import { CircleCheck } from 'lucide-react'
import type { FormProps } from '../forms/theme.js'
import { Button } from './components/ui/button.js'
import { FieldGroup } from './components/ui/field.js'
import { FieldList, useBrowserErrors } from './fields.js'

/**
 * A blueprint's form in a page, drawn with the same fields as the panel's:
 * the browser checks each one first, and the server's refusals land under the
 * same fields. Once sent it says so in its place - or the action redirects.
 * No card around it: it sits in the app's own page, which decides that.
 */
export function BlueprintForm({ action, fields, values, submit, done, honeypot }: FormProps) {
  const form = useRef<HTMLFormElement>(null)
  const browser = useBrowserErrors(form)

  return (
    <Form action={action} ref={form}>
      {({ pending, error: server, formError, succeeded }) => {
        if (succeeded && done !== undefined) {
          return (
            <p role="status" className="flex items-center gap-2 text-sm">
              <CircleCheck className="size-4 text-muted-foreground" />
              {done}
            </p>
          )
        }

        const error = (name: string) => browser[name] ?? server(name)

        return (
          <FieldGroup>
            <FieldList fields={fields} values={values} error={error} />
            {/* For bots: out of sight, out of the tab order, and not read out. */}
            {honeypot !== undefined && (
              <div aria-hidden="true" className="absolute -left-[9999px] size-px overflow-hidden">
                <input type="text" name={honeypot} tabIndex={-1} autoComplete="off" defaultValue="" />
              </div>
            )}
            {formError && (
              <p role="alert" className="text-sm text-destructive">
                {formError}
              </p>
            )}
            <div>
              <Button type="submit" disabled={pending}>
                {pending ? 'Sending…' : submit}
              </Button>
            </div>
          </FieldGroup>
        )
      }}
    </Form>
  )
}
