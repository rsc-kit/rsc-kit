import type { ReactNode } from 'react'
import { fieldsOf } from '../resource.js'
import type { Field, FieldOverride, FormSchema, ValuesOf } from '../resource.js'
import { submitForm } from './actions.js'
import { BLUEPRINT } from './brand.js'
import type { BlueprintParts } from './brand.js'
import { hostSchema, requireDrawable } from './host.js'
import type { HostAction, HostFields } from './host.js'
import { HONEYPOT } from './honeypot.js'
import { registerForm } from './registry.js'
import type { FormsTheme } from './theme.js'

interface BlueprintOptions {
  /** Unique in the app: the form is found by it when it is sent. Lowercase letters, digits and dashes. */
  name: string
  /** What draws `<blueprint.Form />`: import { shadcn } from '@rsc-kit/press/shadcn'. A blueprint only a panel draws needs none. */
  theme?: FormsTheme
  /** The submit button's words. Send to create and Save to update, unless said. */
  submit?: string
  /** What the visitor reads in place of the form once it is sent. */
  done?: string
  /** Where the visitor goes once it is sent, instead of `done`. */
  redirect?: string
  /**
   * A field people never see and bots fill in, for a form anyone may send.
   * On unless said; a form only signed-in people reach can turn it off.
   */
  honeypot?: boolean
}

export interface SchemaBlueprintDefinition<Schema extends FormSchema> extends BlueprintOptions {
  /** Any Standard Schema of an object: z.object(), v.object(), type({...}). It checks every submission, on the server. */
  form: Schema
  /** Labels, descriptions and controls the schema cannot say - or every field, for a schema that does not describe itself as JSON Schema. */
  fields?: Partial<Record<keyof ValuesOf<Schema> & string, FieldOverride>>
  /**
   * What a new submission that passed the schema does: store it, send it,
   * call a backend. Throw an ActionValidationError - or let a backend's 422
   * through - and its messages land under the fields.
   */
  handle?: (values: ValuesOf<Schema>) => unknown
  /** What a submission of `<blueprint.Form id={...} />` does, with that key. */
  update?: (values: ValuesOf<Schema>, key: string) => unknown
}

export interface HostBlueprintDefinition<Create extends HostAction, Update extends HostAction> extends BlueprintOptions {
  /**
   * The backend actions it saves with, as the build generated them:
   * `import { productsStore, productsUpdate } from '../server-actions.generated'`.
   * The create form is drawn from what `create` takes and the edit form from
   * what `update` takes, and they do all the checking: a Laravel FormRequest,
   * a Go struct. `update` is called with the key after the values.
   */
  actions: { create?: Create; update?: Update }
  /** Labels, descriptions and controls the backend's types cannot say. */
  fields?: Partial<Record<HostFields<Create> | HostFields<Update>, FieldOverride>>
}

export interface BlueprintFormProps {
  /** The record's current values, for an edit. Only the blueprint's fields reach the browser. */
  values?: object
  /** The record's key: the form then updates it rather than creating one. */
  id?: string | number
}

/**
 * A form's fields and what saving it does, defined once and drawn anywhere:
 * as `<product.Form />` in a page, and as a panel's create and edit pages
 * with `defineResource({ form: product })`.
 */
export interface Blueprint extends BlueprintParts {
  /**
   * The form, in any page. Without `id` it creates; with it, it updates that
   * record, starting from `values`:
   *
   *     <profile.Form id={user.id} values={user} />
   *
   * The key comes back from the browser like any field, so the update must
   * check it may touch that record: a FormRequest's authorize(), a Go
   * handler's own check.
   */
  Form: (props: BlueprintFormProps) => ReactNode
}

/**
 * A form defined once - its fields, its checks, what saving it does - and
 * drawn wherever it is needed: a page, a panel, or both. Either from a
 * Standard Schema with `handle` and `update`, or from the backend's own
 * actions, which draw the fields and do the checking:
 *
 *     export const product = defineBlueprint({
 *       name: 'product',
 *       theme: shadcn,
 *       actions: { create: productsStore, update: productsUpdate },
 *     })
 *
 *     <product.Form />                              // creates
 *     <product.Form id={p.id} values={p} />         // updates
 *     defineResource<Product>()({ ..., form: product })
 */
export function defineBlueprint<Schema extends FormSchema>(definition: SchemaBlueprintDefinition<Schema>): Blueprint
export function defineBlueprint<Create extends HostAction, Update extends HostAction>(definition: HostBlueprintDefinition<Create, Update>): Blueprint
export function defineBlueprint(
  definition: (SchemaBlueprintDefinition<FormSchema> | HostBlueprintDefinition<HostAction, HostAction>) & {
    form?: FormSchema
    actions?: { create?: unknown; update?: unknown }
  },
): Blueprint {
  const { name } = definition

  if (!/^[a-z0-9-]+$/.test(name)) {
    throw new Error(`[forms] a blueprint's name is lowercase letters, digits and dashes: ${JSON.stringify(name)}`)
  }

  if (definition.done !== undefined && definition.redirect !== undefined) {
    throw new Error(`[forms] the blueprint ${name} has both done and redirect; a sent form shows one or goes to the other`)
  }

  const { actions } = definition

  if ((actions === undefined) === (definition.form === undefined)) {
    throw new Error(`[forms] the blueprint ${name} needs a form schema, or the backend's actions, and not both`)
  }

  if (actions !== undefined) {
    const given = [actions.create, actions.update].filter((action) => action !== undefined)

    if (given.length === 0 || given.some((action) => typeof action !== 'function')) {
      throw new Error(
        `[forms] the blueprint ${name}'s actions are { create, update }, either or both, each the action the build generated: ` +
          "import { productsStore, productsUpdate } from '../server-actions.generated'",
      )
    }
  }

  const overrides = (definition.fields ?? {}) as Record<string, FieldOverride | undefined>
  const host = actions as { create?: HostAction; update?: HostAction } | undefined
  const schemaDefinition = definition as SchemaBlueprintDefinition<FormSchema>

  // A backend's create may be missing - a blueprint that only edits - so the
  // edit form's description stands in for the create's schema, never used.
  const schema = host ? hostSchema((host.create ?? host.update)!) : definition.form!
  const editSchema = host ? hostSchema((host.update ?? host.create)!) : schema

  const create: BlueprintParts['create'] = host
    ? host.create
      ? (values) => (host.create as (values: unknown) => Promise<unknown>)(values)
      : null
    : schemaDefinition.handle
      ? async (values) => schemaDefinition.handle!(values as never)
      : null
  const update: BlueprintParts['update'] = host
    ? host.update
      ? (values, key) => (host.update as (values: unknown, key: string) => Promise<unknown>)(values, key)
      : null
    : schemaDefinition.update
      ? async (values, key) => schemaDefinition.update!(values as never, key)
      : null

  const drawn: { create?: Field[]; edit?: Field[] } = {}

  const trapped = (fields: Field[]): Field[] => {
    if (definition.honeypot !== false && fields.some((field) => field.name === HONEYPOT)) {
      throw new Error(`[forms] the blueprint ${name} has a field named ${HONEYPOT}, which is the name its bot trap uses; rename it, or honeypot: false`)
    }

    return fields
  }

  function createFields(): Field[] {
    if (drawn.create) return drawn.create

    if (host) {
      if (!host.create) throw new Error(`[forms] the blueprint ${name} has no create action, so it cannot draw a form that creates; pass an id to edit`)

      requireDrawable({ name: `[forms] the blueprint ${name}'s create`, key: false }, host.create, overrides)
    }

    return (drawn.create = trapped(fieldsOf(schema, overrides)))
  }

  function editFields(): Field[] {
    if (drawn.edit) return drawn.edit
    if (!host) return (drawn.edit = createFields())

    if (!host.update) throw new Error(`[forms] the blueprint ${name} has no update action, so it cannot draw a form that edits`)

    requireDrawable({ name: `[forms] the blueprint ${name}'s update`, key: true }, host.update, overrides)

    return (drawn.edit = trapped(fieldsOf(editSchema, overrides)))
  }

  // A backend's types arrive with the server entry, which runs after this
  // module: those fields wait for the first render. A schema's fail here.
  if (!host) createFields()

  const relations = Object.values(overrides).flatMap((override) => (override?.relation ? [override.relation] : []))

  if (!host) for (const field of createFields()) if (field.relation && !relations.includes(field.relation)) relations.push(field.relation)

  registerForm({
    name,
    schema,
    editSchema,
    get fields() {
      return createFields()
    },
    get editFields() {
      return editFields()
    },
    create,
    update,
    redirect: definition.redirect ?? null,
    honeypot: definition.honeypot !== false,
  })

  const { theme } = definition

  function Form({ values, id }: BlueprintFormProps) {
    if (!theme) {
      throw new Error(`[forms] the blueprint ${name} has no theme to draw <${name}.Form /> with: theme: shadcn, from '@rsc-kit/press/shadcn'`)
    }

    const editing = id !== undefined && id !== null

    if (editing && !update) throw new Error(`[forms] <${name}.Form id={...} /> edits, and the blueprint ${name} has no update to save it with`)
    if (!editing && !create) throw new Error(`[forms] <${name}.Form /> creates, and the blueprint ${name} has no create to save it with; pass the record's id to edit`)

    const fields = editing ? editFields() : createFields()
    const Draw = 'BlueprintForm' in theme ? theme.BlueprintForm : theme.PublicForm
    const done = definition.redirect === undefined ? (definition.done ?? (editing ? 'Saved.' : 'Thank you. It was sent.')) : undefined

    return (
      <Draw
        action={submitForm.bind(null, name, editing ? String(id) : null)}
        fields={fields}
        values={valuesFor(fields, values)}
        submit={definition.submit ?? (editing ? 'Save' : 'Send')}
        {...(done === undefined ? {} : { done })}
        {...(definition.honeypot === false ? {} : { honeypot: HONEYPOT })}
      />
    )
  }

  return {
    [BLUEPRINT]: true,
    name,
    schema,
    editSchema,
    get fields() {
      return createFields()
    },
    get editFields() {
      return editFields()
    },
    relations,
    create,
    update,
    Form,
  }
}

/**
 * Only the form's own fields go to the browser: a record handed over whole
 * would carry every column it has - a password's hash, a token - into the page.
 */
export function valuesFor(fields: Field[], values: object | undefined): Record<string, unknown> {
  if (!values) return {}

  const record = values as Record<string, unknown>

  return Object.fromEntries(fields.flatMap((field) => (field.name in record ? [[field.name, record[field.name]]] : [])))
}
