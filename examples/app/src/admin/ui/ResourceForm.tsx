'use client'

import Form from '@rsc-kit/core/form'
import type { Field } from '../kit'

/**
 * Every resource's create and edit form, drawn from its fields. Uncontrolled:
 * a value starts as defaultValue, and a refused save keeps what was typed.
 */
export function ResourceForm({
  action,
  fields,
  values,
  submit,
}: {
  action: (form: FormData) => Promise<unknown>
  fields: Field[]
  values: Record<string, unknown>
  submit: string
}) {
  return (
    <Form action={action} className="admin-form">
      {({ pending, error, formError }) => (
        <>
          {fields.map((field) => (
            <label key={field.name} className={field.type === 'toggle' ? 'admin-toggle' : undefined}>
              <span>
                {field.label}
                {field.required && field.type !== 'toggle' ? ' *' : ''}
              </span>
              <Control field={field} value={values[field.name]} invalid={!!error(field.name)} />
              {error(field.name) && <small role="alert">{error(field.name)}</small>}
            </label>
          ))}
          {formError && <p role="alert">{formError}</p>}
          <button disabled={pending}>{pending ? 'Saving…' : submit}</button>
        </>
      )}
    </Form>
  )
}

function Control({ field, value, invalid }: { field: Field; value: unknown; invalid: boolean }) {
  const shared = { name: field.name, 'aria-invalid': invalid || undefined }

  switch (field.type) {
    case 'textarea':
      return <textarea {...shared} rows={4} defaultValue={String(value ?? '')} />
    case 'select':
      return (
        <select {...shared} defaultValue={String(value ?? field.options?.[0] ?? '')}>
          {field.options?.map((option) => <option key={option}>{option}</option>)}
        </select>
      )
    case 'toggle':
      return <input {...shared} type="checkbox" defaultChecked={Boolean(value)} />
    case 'number':
      return <input {...shared} type="number" step="any" defaultValue={value === undefined ? '' : String(value)} />
    default:
      return <input {...shared} defaultValue={String(value ?? '')} />
  }
}
