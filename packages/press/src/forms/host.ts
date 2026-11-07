import type { FormFields } from '@rsc-kit/core/form'
import type { FieldOverride, FormSchema } from '../resource.js'

/**
 * A form with no schema of its own: defineForm({ action: contactSend }), with
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
  inputs: Record<string, { properties?: Record<string, Record<string, unknown>> }>
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

/** A form must be able to draw what it was given, or say so rather than draw a text box. */
export function requireDrawable(form: string, action: HostAction, overrides: Record<string, FieldOverride>): void {
  const target = targetOf(action)

  if (target === null) {
    throw new Error(
      `[forms] the form ${form}'s action ${action.name || 'function'} is not one the build generated for the backend. ` +
        "Import it from the generated server-actions module: import { contactSend } from '../server-actions.generated'.",
    )
  }

  const input = hostForms().inputs[target]

  if (!input) {
    if (Object.keys(overrides).length > 0) return

    throw new Error(
      `[forms] the form ${form} calls ${target}, and the backend does not say it takes one object with named fields. ` +
        'Take a FormRequest in Laravel or a struct in Go, or list every field in fields.',
    )
  }

  for (const [field, schema] of Object.entries(input.properties ?? {})) {
    if (!schema.type && !schema.enum && !schema.anyOf && !overrides[field]?.type) {
      throw new Error(`[forms] the form ${form} cannot tell what ${target}'s ${field} is, which a file or an open type would be. Say it in fields.`)
    }
  }
}
