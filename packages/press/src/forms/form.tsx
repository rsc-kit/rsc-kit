import type { FieldOverride, FormSchema, ValuesOf } from '../resource.js'
import { defineBlueprint } from './blueprint.js'
import type { Blueprint } from './blueprint.js'
import type { HostAction, HostFields } from './host.js'
import type { FormsTheme } from './theme.js'

interface FormOptions {
  name: string
  theme: FormsTheme
  submit?: string
  done?: string
  redirect?: string
}

/** @deprecated defineBlueprint, whose `handle` is the same. */
export interface FormDefinition<Schema extends FormSchema> extends FormOptions {
  form: Schema
  fields?: Partial<Record<keyof ValuesOf<Schema> & string, FieldOverride>>
  handle: (values: ValuesOf<Schema>) => void | Promise<void>
}

/** @deprecated defineBlueprint({ actions: { create: action } }). */
export interface HostFormDefinition<Action extends HostAction> extends FormOptions {
  action: Action
  fields?: Partial<Record<HostFields<Action>, FieldOverride>>
}

/**
 * @deprecated defineBlueprint, which draws the same form, can also edit a
 * record, and is what a panel's resource takes. `action: contactSend` is
 * `actions: { create: contactSend }` there.
 */
export function defineForm<Schema extends FormSchema>(definition: FormDefinition<Schema>): Blueprint
export function defineForm<Action extends HostAction>(definition: HostFormDefinition<Action>): Blueprint
export function defineForm(definition: (FormDefinition<FormSchema> | HostFormDefinition<HostAction>) & { form?: FormSchema; action?: HostAction; handle?: unknown }): Blueprint {
  const { action, form, fields, handle, ...options } = definition as typeof definition & { handle?: (values: Record<string, unknown>) => void }

  if (typeof action === 'string') {
    throw new Error(
      `[forms] the form ${definition.name}'s action is the generated action now, not its name: ` +
        `import { contactSend } from '../server-actions.generated', then action: contactSend, for ${JSON.stringify(action)}`,
    )
  }

  if ((action === undefined) === (form === undefined) || (form !== undefined && typeof handle !== 'function')) {
    throw new Error(`[forms] the form ${definition.name} needs a form schema with handle, or an action, and not both`)
  }

  return action === undefined
    ? defineBlueprint({ ...options, form: form!, handle: handle!, ...(fields ? { fields } : {}) } as never)
    : defineBlueprint({ ...options, actions: { create: action }, ...(fields ? { fields } : {}) } as never)
}

/** @deprecated Blueprint. */
export type PublicFormHandle = Blueprint
/** @deprecated Blueprint. */
export type PublicForm = Blueprint
