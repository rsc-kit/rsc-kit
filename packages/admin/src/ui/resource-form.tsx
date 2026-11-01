'use client'

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
  return (
    <Form action={action}>
      {({ pending, error, formError }) => (
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
      )}
    </Form>
  )
}

function Control({ id, field, value, invalid }: { id: string; field: FieldSpec; value: unknown; invalid: boolean }) {
  const shared = { id, name: field.name, 'aria-invalid': invalid || undefined }

  switch (field.type) {
    case 'textarea':
      return <Textarea {...shared} rows={4} defaultValue={String(value ?? '')} />
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
      return <Input {...shared} type="number" step="any" defaultValue={value === undefined || value === null ? '' : String(value)} />
    case 'email':
      return <Input {...shared} type="email" defaultValue={String(value ?? '')} />
    case 'date':
      return <Input {...shared} type="date" defaultValue={String(value ?? '').slice(0, 10)} />
    default:
      return <Input {...shared} defaultValue={String(value ?? '')} />
  }
}
