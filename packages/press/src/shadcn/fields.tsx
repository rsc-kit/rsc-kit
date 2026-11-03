'use client'

import { useEffect, useId, useState } from 'react'
import { ArrowDown, ArrowUp, FileIcon, Plus, Trash2 } from 'lucide-react'
import type { BlockSpec, Field as FieldSpec } from '../resource.js'
import { sizeOf } from '../uploads.js'
import { Button } from './components/ui/button.js'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './components/ui/dropdown-menu.js'
import { Field, FieldContent, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet } from './components/ui/field.js'
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

    if (field.type === 'blocks') {
      return <BlocksField key={field.name} field={field} value={values[field.name]} error={error} />
    }

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
        {field.type === 'file' || field.type === 'image' ? (
          <FileControl key={String(values[field.name] ?? '')} id={id} field={field} value={values[field.name]} invalid={invalid} />
        ) : (
          <Control id={id} field={field} value={values[field.name]} invalid={invalid} />
        )}
        {(field.description ?? limitOf(field)) && <FieldDescription>{field.description ?? limitOf(field)}</FieldDescription>}
        {invalid && <FieldError>{error(field.name)}</FieldError>}
      </Field>
    )
  })
}

interface Item {
  key: string
  type: string
  data: Record<string, unknown>
}

/**
 * A list of blocks an editor adds, orders and removes, each with its own
 * fields. Every control stays an ordinary named input - block i's heading is
 * `content.i.heading` - so it submits with the form, is checked by the
 * browser like any other, and shows the server's refusal under itself. Each
 * block keeps a key of its own, so moving one moves what was typed into it.
 */
function BlocksField({ field, value, error }: { field: FieldSpec; value: unknown; error: (name: string) => string | undefined }) {
  const kinds = field.blocks ?? []
  const prefix = useId()
  const saved = Array.isArray(value) ? (value as { type: string; data?: Record<string, unknown> }[]) : []
  // A kind the app no longer offers has no fields to draw; it is left out,
  // and saving drops it.
  const retired = saved.filter((item) => !kinds.some((kind) => kind.name === item.type)).length
  const [items, setItems] = useState<Item[]>(() =>
    saved
      .filter((item) => kinds.some((kind) => kind.name === item.type))
      .map((item, index) => ({ key: `${prefix}-${index}`, type: item.type, data: item.data ?? {} })),
  )
  const [made, setMade] = useState(0)

  const add = (kind: BlockSpec) => {
    setItems((current) => [...current, { key: `${prefix}-new-${made}`, type: kind.name, data: {} }])
    setMade((count) => count + 1)
  }

  const move = (from: number, to: number) =>
    setItems((current) => {
      const next = [...current]
      const [item] = next.splice(from, 1)

      next.splice(to, 0, item!)

      return next
    })

  const remove = (at: number) => setItems((current) => current.filter((_, index) => index !== at))

  return (
    <FieldSet>
      <FieldLegend variant="label">{field.label}</FieldLegend>
      {field.description && <FieldDescription>{field.description}</FieldDescription>}
      {items.length === 0 && <p className="text-sm text-muted-foreground">No blocks yet.</p>}
      {retired > 0 && (
        <p className="text-sm text-muted-foreground">
          {retired === 1 ? 'One block is' : `${retired} blocks are`} of a kind no longer offered, and saving removes {retired === 1 ? 'it' : 'them'}.
        </p>
      )}
      {items.map((item, index) => {
        const kind = kinds.find((candidate) => candidate.name === item.type)!
        const base = `${field.name}.${index}.`

        return (
          <div key={item.key} className="rounded-lg border">
            <div className="flex items-center gap-1 border-b px-3 py-2">
              <span className="text-sm font-medium">{kind.label}</span>
              <input type="hidden" name={`${base}type`} value={item.type} />
              <div className="ml-auto flex gap-1">
                <Button type="button" variant="ghost" size="icon-sm" aria-label="Move up" disabled={index === 0} onClick={() => move(index, index - 1)}>
                  <ArrowUp />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Move down"
                  disabled={index === items.length - 1}
                  onClick={() => move(index, index + 1)}
                >
                  <ArrowDown />
                </Button>
                <Button type="button" variant="ghost" size="icon-sm" aria-label="Remove" onClick={() => remove(index)}>
                  <Trash2 />
                </Button>
              </div>
            </div>
            <div className="p-3">
              <FieldGroup>
                <FieldList
                  fields={kind.fields.map((inner) => ({ ...inner, name: base + inner.name }))}
                  values={Object.fromEntries(Object.entries(item.data).map(([name, data]) => [base + name, data]))}
                  error={error}
                />
              </FieldGroup>
            </div>
            {error(`${field.name}.${index}`) && <FieldError className="px-3 pb-3">{error(`${field.name}.${index}`)}</FieldError>}
          </div>
        )
      })}
      <div>
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button type="button" variant="outline" />}>
            <Plus />
            Add block
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {kinds.map((kind) => (
              <DropdownMenuItem key={kind.name} onClick={() => add(kind)}>
                {kind.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </FieldSet>
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

/** A file field's size limit, said under it when the app said nothing else. */
function limitOf(field: FieldSpec): string | undefined {
  return (field.type === 'file' || field.type === 'image') && field.maxSize !== undefined ? `Up to ${sizeOf(field.maxSize)}.` : undefined
}

/**
 * A file or image field: what it holds now, and a file input to replace it.
 * The value it holds goes back with the form in a hidden input under the
 * same name, so a save that chooses nothing keeps it; the server keeps it
 * only if the record already had it. A file over the size limit is refused
 * as it is chosen, through the input's own validity, so it shows as any
 * other field's message and never makes the trip.
 */
function FileControl({ id, field, value, invalid }: { id: string; field: FieldSpec; value: unknown; invalid: boolean }) {
  const [kept, setKept] = useState(typeof value === 'string' ? value : '')
  const [preview, setPreview] = useState<string | null>(null)

  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview)
  }, [preview])

  const choose = (event: React.ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget
    const file = input.files?.[0]

    input.setCustomValidity(file && field.maxSize !== undefined && file.size > field.maxSize ? `Choose a file of ${sizeOf(field.maxSize)} or less.` : '')
    setPreview(file && field.type === 'image' && input.validity.valid ? URL.createObjectURL(file) : null)
  }

  const shown = preview ?? (kept || null)

  return (
    <div className="flex flex-col gap-3">
      {shown && field.type === 'image' && <img src={shown} alt="" className="h-32 w-fit max-w-full rounded-md border object-cover" />}
      {kept && !preview && field.type === 'file' && (
        <a href={kept} target="_blank" rel="noreferrer" className="flex w-fit items-center gap-2 text-sm underline-offset-4 hover:underline">
          <FileIcon className="size-4" />
          {decodeURIComponent(kept.split(/[/?#]/).filter(Boolean).pop() ?? kept)}
        </a>
      )}
      <div className="flex items-center gap-2">
        <Input
          id={id}
          name={field.name}
          type="file"
          accept={field.accept}
          required={field.required && !kept}
          aria-invalid={invalid || undefined}
          onChange={choose}
        />
        {kept && field.nullable && (
          <Button type="button" variant="outline" onClick={() => setKept('')}>
            Remove
          </Button>
        )}
      </div>
      <input type="hidden" name={field.name} value={kept} />
    </div>
  )
}
