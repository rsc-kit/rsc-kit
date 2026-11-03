import { fieldsOf } from '../resource.js'
import type { FieldOverride, FormSchema, ValuesOf } from '../resource.js'
import { submitForm } from './actions.js'
import { HONEYPOT } from './honeypot.js'
import { registerForm } from './registry.js'
import type { FormsTheme } from './theme.js'

export interface FormDefinition<Schema extends FormSchema> {
  /** Unique in the app: the form is found by it when it is sent. Lowercase letters, digits and dashes. */
  name: string
  /** Any Standard Schema of an object: z.object(), v.object(), type({...}). It checks every submission, on the server. */
  form: Schema
  /** Labels, descriptions and controls the schema cannot say - or every field, for a schema that does not describe itself as JSON Schema. */
  fields?: Partial<Record<keyof ValuesOf<Schema> & string, FieldOverride>>
  /** What draws it: import { shadcn } from '@rsc-kit/press/shadcn'. */
  theme: FormsTheme
  /**
   * What a submission that passed the schema does: store it, send it, call a
   * backend. Throw an ActionValidationError - or let a backend's 422 through -
   * and its messages land under the fields.
   */
  handle: (values: ValuesOf<Schema>) => void | Promise<void>
  /** The submit button's words. Send by default. */
  submit?: string
  /** What the visitor reads in place of the form once it is sent. */
  done?: string
  /** Where the visitor goes once it is sent, instead of `done`. */
  redirect?: string
}

/**
 * A form anyone may fill in - a contact form, a sign-up, a survey - from a
 * Standard Schema, checked by the browser first and by the schema on the
 * server always. Place it in any page:
 *
 *     export default function Contact() {
 *       return <main><h1>Contact us</h1><contact.Form /></main>
 *     }
 *
 * The form reads nothing from the request, so the page around it can still
 * be stored by the build.
 */
export function defineForm<Schema extends FormSchema>(definition: FormDefinition<Schema>) {
  if (!/^[a-z0-9-]+$/.test(definition.name)) {
    throw new Error(`[forms] a form's name is lowercase letters, digits and dashes: ${JSON.stringify(definition.name)}`)
  }

  if (definition.done !== undefined && definition.redirect !== undefined) {
    throw new Error(`[forms] the form ${definition.name} has both done and redirect; a sent form shows one or goes to the other`)
  }

  const fields = fieldsOf(definition.form, definition.fields ?? {})

  if (fields.some((field) => field.name === HONEYPOT)) {
    throw new Error(`[forms] the form ${definition.name} has a field named ${HONEYPOT}, which is the name its bot trap uses`)
  }

  registerForm({
    name: definition.name,
    schema: definition.form,
    fields,
    handle: definition.handle as (values: Record<string, unknown>) => void | Promise<void>,
    redirect: definition.redirect ?? null,
  })

  const theme = definition.theme
  const submit = definition.submit ?? 'Send'
  const done = definition.redirect === undefined ? (definition.done ?? 'Thank you. It was sent.') : undefined

  function Form() {
    return (
      <theme.PublicForm
        action={submitForm.bind(null, definition.name)}
        fields={fields}
        submit={submit}
        {...(done === undefined ? {} : { done })}
        honeypot={HONEYPOT}
      />
    )
  }

  return { name: definition.name, fields, Form }
}

export type PublicForm = ReturnType<typeof defineForm>
