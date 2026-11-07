import type { FieldOverride, FormSchema } from '../resource.js'

/**
 * A form with no schema of its own: defineForm({ action: 'Contact.send' }).
 * The backend said what the function takes when it wrote rsc-host.json, and
 * the build put that in the server entry, so the fields come from there and
 * every check is the backend's.
 */
declare global {
  interface RscHostFunctions {}
}

/** A function the backend has, once the build has typed them; any name before. */
export type HostFunction = [keyof RscHostFunctions] extends [never] ? string : keyof RscHostFunctions & string

/** What a function takes as its one argument. */
export type HostInput<Action extends string> = Action extends keyof RscHostFunctions
  ? RscHostFunctions[Action] extends { args: [infer Input, ...unknown[]] }
    ? Input
    : Record<string, unknown>
  : Record<string, unknown>

interface HostForms {
  /** The global that calls the backend: rpc, unless rscKit({ hostGlobal }) renamed it. */
  global: string
  inputs: Record<string, { properties?: Record<string, Record<string, unknown>> }>
}

function hostForms(): HostForms {
  const forms = (globalThis as Record<symbol, unknown>)[Symbol.for('rsc-kit.host-forms')] as HostForms | undefined

  if (!forms) throw new Error('[forms] a form with an action needs the rsc-kit server entry, which says what the backend takes')

  return forms
}

/**
 * A Standard Schema that describes the backend's input and refuses nothing:
 * the rest of the form is the same as for any schema, and the checking is the
 * function's. The browser's checks come from the same description.
 */
export function hostSchema(action: string): FormSchema {
  return {
    '~standard': {
      version: 1,
      vendor: 'rsc-kit',
      validate: (value: unknown) => ({ value: value as Record<string, unknown> }),
      jsonSchema: { input: () => hostForms().inputs[action] },
    },
  } as unknown as FormSchema
}

/** A form must be able to draw what it was given, or say so rather than draw a text box. */
export function requireDrawable(form: string, action: string, overrides: Record<string, FieldOverride>): void {
  const input = hostForms().inputs[action]

  if (!input) {
    if (Object.keys(overrides).length > 0) return

    throw new Error(
      `[forms] the form ${form} calls ${action}, and the backend does not say it takes one object with named fields. ` +
        'Check the name, or list every field in fields.',
    )
  }

  for (const [field, schema] of Object.entries(input.properties ?? {})) {
    if (!schema.type && !schema.enum && !schema.anyOf && !overrides[field]?.type) {
      throw new Error(`[forms] the form ${form} cannot tell what ${action}'s ${field} is, which a file or an open type would be. Say it in fields.`)
    }
  }
}

export function callHost(action: string, values: Record<string, unknown>): Promise<unknown> {
  const call = (globalThis as unknown as Record<string, unknown>)[hostForms().global] as (name: string, ...args: unknown[]) => Promise<unknown>

  return call(action, values)
}
