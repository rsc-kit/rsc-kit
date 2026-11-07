import type { FormFields } from '@rsc-kit/core/form'
import type { FieldOverride, FormSchema } from '../resource.js'

/**
 * A form with no schema of its own: defineBlueprint({ actions: { create: contactSend } }), with
 * the action the build generated for the backend's Contact.send. The backend
 * said what the function takes when it wrote rsc-host.json, and the build put
 * that in the server entry, so the fields come from there and every check is
 * the backend's.
 */

/** A backend action the build generated: import { contactSend } from '../server-actions.generated'. */
export type HostAction = (...args: never[]) => Promise<unknown>

/** The names of the fields an action's form has, as its generated stub declares them. */
export type HostFields<Action> = Action extends (form: FormFields<infer Name>) => Promise<unknown>
  ? string extends Name
    ? string
    : Name
  : string

interface HostForms {
  /** Each generated action, and the backend function it calls. */
  actions: Map<unknown, string>
  /** What each backend function takes, by its name. */
  inputs: Record<string, { properties?: Record<string, Record<string, unknown>>; 'x-key'?: boolean }>
}

function hostForms(): HostForms {
  const forms = (globalThis as Record<symbol, unknown>)[Symbol.for('rsc-kit.host-forms')] as HostForms | undefined

  if (!forms) throw new Error('[forms] a form with an action needs the rsc-kit server entry, which says what the backend takes')

  return forms
}

/** The backend function a generated action calls, or null for any other function. */
export function targetOf(action: HostAction): string | null {
  return hostForms().actions.get(action) ?? null
}

/**
 * A Standard Schema that describes the backend's input and refuses nothing:
 * the rest of the form is the same as for any schema, and the checking is the
 * function's. The browser's checks come from the same description. Read when
 * the form first draws, by which time the server entry has run.
 */
export function hostSchema(action: HostAction): FormSchema {
  return {
    '~standard': {
      version: 1,
      vendor: 'rsc-kit',
      validate: (value: unknown) => ({ value: value as Record<string, unknown> }),
      jsonSchema: { input: () => hostForms().inputs[targetOf(action) ?? ''] },
    },
  } as unknown as FormSchema
}

/**
 * What calls an action: a public form or a panel's create, with the values
 * alone, or a panel's update, with the record's key after them.
 */
export interface Caller {
  /** How errors name it: "[forms] the form contact", "[admin] products' update". */
  name: string
  /** Called as update(values, id), so the backend must take the key second. */
  key: boolean
}

/** A form must be able to draw what it was given, or say so rather than draw a text box. */
export function requireDrawable(caller: string | Caller, action: HostAction, overrides: Record<string, FieldOverride | undefined>): void {
  const { name, key } = typeof caller === 'string' ? { name: `[forms] the form ${caller}`, key: false } : caller
  const target = targetOf(action)

  if (target === null) {
    throw new Error(
      `${name}'s action ${action.name || 'function'} is not one the build generated for the backend. ` +
        "Import it from the generated server-actions module: import { contactSend } from '../server-actions.generated'.",
    )
  }

  const input = hostForms().inputs[target] as { properties?: Record<string, Record<string, unknown>>; 'x-key'?: boolean } | undefined

  if (!input) {
    if (Object.keys(overrides).length > 0 && !key) return

    throw new Error(
      `${name} calls ${target}, and the backend does not say it takes one object with named fields` +
        (key ? " and the record's key after it" : '') +
        '. Take a FormRequest in Laravel or a struct in Go' +
        (key ? ', then the key: update(UpdateProductRequest $request, string $product).' : ', or list every field in fields.'),
    )
  }

  if (key && !input['x-key']) {
    throw new Error(
      `${name} calls ${target} with the record's key after the values, and it takes only the values. ` +
        'Take the key second: update(UpdateProductRequest $request, string $product) in Laravel, func(ctx, in ProductInput, id string) in Go.',
    )
  }

  if (!key && input['x-key']) {
    throw new Error(`${name} calls ${target} with the values alone, and it takes a record's key after them. Use it as a panel's update.`)
  }

  for (const [field, schema] of Object.entries(input.properties ?? {})) {
    if (!schema.type && !schema.enum && !schema.anyOf && !overrides[field]?.type) {
      throw new Error(`${name} cannot tell what ${target}'s ${field} is, which a file or an open type would be. Say it in fields.`)
    }
  }
}
