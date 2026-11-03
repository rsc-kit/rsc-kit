'use client'

import { useEffect, useState } from 'react'
import type { Field as FieldSpec } from '../resource.js'
import { Field, FieldContent, FieldDescription, FieldError, FieldLabel } from './components/ui/field.js'
import { Input } from './components/ui/input.js'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './components/ui/select.js'
import { Switch } from './components/ui/switch.js'
import { Textarea } from './components/ui/textarea.js'

/**
 * Each field as its shadcn control, labelled, with its message under it: the
 * browser's while the value is still wrong, else the server's. Shared by the
 * panel's forms and the public ones, so a field looks and checks the same in
 * both.
 */
export function FieldList({ fields, values, error }: { fields: FieldSpec[]; values: Record<string, unknown>; error: (name: string) => string | undefined }) {
  return fields.map((field) => {
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
  })
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
export function useBrowserErrors(form: React.RefObject<HTMLFormElement | null>): Record<string, string> {
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
      // An optional select can be left empty: its first choice is "None",
      // which arrives as "" and is left out of the values, as any empty
      // optional field is. A required one starts on its first real choice.
      const options = field.required ? (field.options ?? []) : [{ value: '', label: 'None' }, ...(field.options ?? [])]

      return (
        <Select name={field.name} items={options} defaultValue={value === null || value === undefined ? (options[0]?.value ?? '') : String(value)}>
          <SelectTrigger id={id} aria-invalid={invalid || undefined} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
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
