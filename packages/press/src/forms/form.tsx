import type { ReactNode } from 'react'
import { fieldsOf } from '../resource.js'
import type { Field, FieldOverride, FormSchema, ValuesOf } from '../resource.js'
import { submitForm } from './actions.js'
import { hostSchema, requireDrawable } from './host.js'
import type { HostAction, HostFields } from './host.js'
import { HONEYPOT } from './honeypot.js'
import { registerForm } from './registry.js'
import type { FormsTheme } from './theme.js'

interface FormOptions {
  /** Unique in the app: the form is found by it when it is sent. Lowercase letters, digits and dashes. */
  name: string
  /** What draws it: import { shadcn } from '@rsc-kit/press/shadcn'. */
  theme: FormsTheme
  /** The submit button's words. Send by default. */
  submit?: string
  /** What the visitor reads in place of the form once it is sent. */
  done?: string
  /** Where the visitor goes once it is sent, instead of `done`. */
  redirect?: string
}

export interface FormDefinition<Schema extends FormSchema> extends FormOptions {
  /** Any Standard Schema of an object: z.object(), v.object(), type({...}). It checks every submission, on the server. */
  form: Schema
  /** Labels, descriptions and controls the schema cannot say - or every field, for a schema that does not describe itself as JSON Schema. */
  fields?: Partial<Record<keyof ValuesOf<Schema> & string, FieldOverride>>
  /**
   * What a submission that passed the schema does: store it, send it, call a
   * backend. Throw an ActionValidationError - or let a backend's 422 through -
   * and its messages land under the fields.
   */
  handle: (values: ValuesOf<Schema>) => void | Promise<void>
}

export interface HostFormDefinition<Action extends HostAction> extends FormOptions {
  /**
   * The backend action the form calls, as the build generated it:
   * `import { contactSend } from '../server-actions.generated'`. Its fields are
   * drawn from what the backend says it takes, and it does all the checking:
   * a Laravel FormRequest, a Go struct. Its refusals land under the fields.
   */
  action: Action
  /** Labels, descriptions and controls the backend's type cannot say. */
  fields?: Partial<Record<HostFields<Action>, FieldOverride>>
}

/**
 * A form anyone may fill in - a contact form, a sign-up, a survey. Either from
 * a Standard Schema, checked by the browser first and by the schema on the
 * server always, or from a backend function, checked by the browser first and
 * by the backend always. Place it in any page:
 *
 *     export default function Contact() {
 *       return <main><h1>Contact us</h1><contact.Form /></main>
 *     }
 *
 * The form reads nothing from the request, so the page around it can still
 * be stored by the build.
 */
export function defineForm<Schema extends FormSchema>(definition: FormDefinition<Schema>): PublicFormHandle
export function defineForm<Action extends HostAction>(definition: HostFormDefinition<Action>): PublicFormHandle
export function defineForm(definition: (FormDefinition<FormSchema> | HostFormDefinition<HostAction>) & { form?: FormSchema; action?: HostAction }): PublicFormHandle {
  if (!/^[a-z0-9-]+$/.test(definition.name)) {
    throw new Error(`[forms] a form's name is lowercase letters, digits and dashes: ${JSON.stringify(definition.name)}`)
  }

  if (definition.done !== undefined && definition.redirect !== undefined) {
    throw new Error(`[forms] the form ${definition.name} has both done and redirect; a sent form shows one or goes to the other`)
  }

  const { action } = definition

  if (typeof action === 'string') {
    throw new Error(
      `[forms] the form ${definition.name}'s action is the generated action now, not its name: ` +
        `import { contactSend } from '../server-actions.generated', then action: contactSend, for ${JSON.stringify(action)}`,
    )
  }

  if ((action === undefined) === (definition.form === undefined)) {
    throw new Error(`[forms] the form ${definition.name} needs a form schema with handle, or an action, and not both`)
  }

  const overrides = (definition.fields ?? {}) as Record<string, FieldOverride>
  const schema = action === undefined ? definition.form! : hostSchema(action)
  let drawn: Field[] | null = null

  function fields(): Field[] {
    if (drawn) return drawn

    if (action !== undefined) requireDrawable(definition.name, action, overrides)

    const fields = fieldsOf(schema, overrides)

    if (fields.some((field) => field.name === HONEYPOT)) {
      throw new Error(`[forms] the form ${definition.name} has a field named ${HONEYPOT}, which is the name its bot trap uses`)
    }

    return (drawn = fields)
  }

  // A backend's types arrive with the server entry, which runs after this
  // module: those fields wait for the first render. A schema's fail here.
  if (action === undefined) fields()

  const handle = action === undefined
    ? ((definition as FormDefinition<FormSchema>).handle as (values: Record<string, unknown>) => void | Promise<void>)
    : async (values: Record<string, unknown>) => void (await (action as (values: Record<string, unknown>) => Promise<unknown>)(values))

  registerForm({
    name: definition.name,
    schema,
    get fields() {
      return fields()
    },
    handle,
    redirect: definition.redirect ?? null,
  })

  const theme = definition.theme
  const submit = definition.submit ?? 'Send'
  const done = definition.redirect === undefined ? (definition.done ?? 'Thank you. It was sent.') : undefined

  function Form() {
    return (
      <theme.PublicForm
        action={submitForm.bind(null, definition.name)}
        fields={fields()}
        submit={submit}
        {...(done === undefined ? {} : { done })}
        honeypot={HONEYPOT}
      />
    )
  }

  return {
    name: definition.name,
    get fields() {
      return fields()
    },
    Form,
  }
}

export interface PublicFormHandle {
  name: string
  fields: Field[]
  Form: () => ReactNode
}

export type PublicForm = PublicFormHandle
