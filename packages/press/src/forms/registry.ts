import type { Field, FormSchema } from '../resource.js'

export interface FormHandle {
  name: string
  schema: FormSchema
  editSchema: FormSchema
  fields: Field[]
  editFields: Field[]
  create: ((values: Record<string, unknown>) => Promise<unknown>) | null
  update: ((values: Record<string, unknown>, key: string) => Promise<unknown>) | null
  redirect: string | null
  /** Whether a filled bot trap drops the submission. */
  honeypot: boolean
}

/**
 * Forms by name. An action receives a name, not a form - only what can be
 * serialised crosses to the browser and back - so the form is looked up here.
 * On globalThis because a dev server can evaluate this module more than once.
 */
const KEY = Symbol.for('@rsc-kit/press.forms')
const forms: Map<string, FormHandle> = ((globalThis as Record<symbol, unknown>)[KEY] ??= new Map()) as Map<string, FormHandle>

export function registerForm(form: FormHandle): void {
  forms.set(form.name, form)
}

export function formNamed(name: string): FormHandle {
  const form = forms.get(name)

  if (!form) throw new Error(`[forms] no form named ${name}; defineBlueprint({ name: ${JSON.stringify(name)} }) has not run`)

  return form
}
