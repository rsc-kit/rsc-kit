'use client'

import { useEffect, useRef, useState } from 'react'
import Form from '@rsc-kit/core/form'
import Link from '@rsc-kit/core/Link'
import type { Field as FieldSpec } from '../resource'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardFooter } from '../components/ui/card'
import { Field, FieldContent, FieldDescription, FieldError, FieldGroup, FieldLabel } from '../components/ui/field'
import { Input } from '../components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select'
import { Switch } from '../components/ui/switch'
import { Textarea } from '../components/ui/textarea'

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

  return (
    <Form action={action} ref={form}>
      {({ pending, error: server, formError }) => {
        // The browser's message while the field is still wrong, else the server's.
        const error = (name: string) => browser[name] ?? server(name)

        return (
          <Card className="max-w-2xl">
            <CardContent>
              <FieldGroup>
                {fields.map((field) => {
                  const id = `field-${field.name}`
                  const invalid = !!error(field.name)

                  if (field.type === 'toggle') {
                    return (
                      <Field key={field.name} orientation="horizontal" data-invalid={invalid || undefined}>
                        <FieldContent>
                          <FieldLabel htmlFor={id}>{field.label}</FieldLabel>
                          {field.description && <FieldDescription>{field.description}</FieldDescription>}
                          {invalid && <FieldError>{error(field.name)}</FieldError>}
                        </FieldContent>
                        <Switch id={id} name={field.name} defaultChecked={Boolean(values[field.name])} aria-invalid={invalid || undefined} />
                      </Field>
                    )
                  }

                  return (
                    <Field key={field.name} data-invalid={invalid || undefined}>
                      <FieldLabel htmlFor={id}>
                        {field.label}
                        {field.required && <span className="text-destructive">*</span>}
                      </FieldLabel>
                      <Control id={id} field={field} value={values[field.name]} invalid={invalid} />
                      {field.description && <FieldDescription>{field.description}</FieldDescription>}
                      {invalid && <FieldError>{error(field.name)}</FieldError>}
                    </Field>
                  )
                })}
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

type Control = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement

const isControl = (target: EventTarget | null): target is Control =>
  target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement

/**
 * The browser's own validation, shown the shadcn way. A submit fires
 * 'invalid' at each control that fails its constraints; that is cancelled -
 * no bubble - and its validationMessage, in the visitor's language, is kept
 * under its name. Fixing the value clears it. 'invalid' does not bubble, so
 * the form listens in the capture phase.
 */
function useBrowserErrors(form: React.RefObject<HTMLFormElement | null>): Record<string, string> {
  const [errors, setErrors] = useState<Record<string, string>>({})

  useEffect(() => {
    const element = form.current

    if (!element) return

    let focusing = false

    const onInvalid = (event: Event) => {
      if (!isControl(event.target) || !event.target.name) return

      const { name, validationMessage } = event.target

      event.preventDefault()
      setErrors((current) => (current[name] === validationMessage ? current : { ...current, [name]: validationMessage }))

      // Cancelling the bubble also cancels the browser's focus on the first
      // wrong field. Every control's 'invalid' fires before the next task, so
      // give focus back once, to the first one, after they all have.
      if (!focusing) {
        focusing = true
        setTimeout(() => {
          focusing = false
          element.querySelector<Control>(':invalid')?.focus()
        })
      }
    }

    const onEdit = (event: Event) => {
      if (!isControl(event.target) || !event.target.name) return

      const { name, validity, validationMessage } = event.target

      setErrors((current) => {
        if (!(name in current)) return current
        if (!validity.valid) return { ...current, [name]: validationMessage }

        const { [name]: _, ...rest } = current

        return rest
      })
    }

    element.addEventListener('invalid', onInvalid, true)
    element.addEventListener('input', onEdit)
    element.addEventListener('change', onEdit)

    return () => {
      element.removeEventListener('invalid', onInvalid, true)
      element.removeEventListener('input', onEdit)
      element.removeEventListener('change', onEdit)
    }
  }, [form])

  return errors
}

function Control({ id, field, value, invalid }: { id: string; field: FieldSpec; value: unknown; invalid: boolean }) {
  const shared = {
    id,
    name: field.name,
    required: field.required,
    'aria-invalid': invalid || undefined,
  }
  const lengths = { minLength: field.minLength, maxLength: field.maxLength }

  switch (field.type) {
    case 'textarea':
      return <Textarea {...shared} {...lengths} rows={4} defaultValue={String(value ?? '')} />
    case 'select': {
      const options = field.options ?? []

      return (
        <Select name={field.name} items={options.map((option) => ({ value: option, label: option }))} defaultValue={String(value ?? options[0] ?? '')}>
          <SelectTrigger id={id} aria-invalid={invalid || undefined} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {options.map((option) => (
              <SelectItem key={option} value={option}>
                {option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )
    }
    case 'number':
      return (
        <Input
          {...shared}
          type="number"
          min={field.min}
          max={field.max}
          step={field.step ?? 'any'}
          defaultValue={value === undefined || value === null ? '' : String(value)}
        />
      )
    case 'email':
      return <Input {...shared} {...lengths} type="email" defaultValue={String(value ?? '')} />
    case 'date':
      return <Input {...shared} type="date" defaultValue={String(value ?? '').slice(0, 10)} />
    default:
      return <Input {...shared} {...lengths} pattern={field.pattern} defaultValue={String(value ?? '')} />
  }
}
