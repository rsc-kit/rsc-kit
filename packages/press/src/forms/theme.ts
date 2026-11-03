import type { ComponentType } from 'react'
import type { Field } from '../resource.js'

/**
 * What a theme draws for a public form. As with a panel, every prop is data,
 * a bound server action or a string - never a component - so the form may be
 * a client component, and it is: it shows the browser's checks and the
 * server's refusals under their fields.
 */
export interface FormsTheme {
  PublicForm: ComponentType<PublicFormProps>
}

export interface PublicFormProps {
  /** Checks and sends the form. A refusal is a 422 whose messages belong under their fields. */
  action: (form: FormData) => Promise<unknown>
  fields: Field[]
  /** The submit button's words: Send message. */
  submit: string
  /**
   * What the visitor reads once it is sent, in place of the form. Absent when
   * the form redirects instead.
   */
  done?: string
  /**
   * The name of a field people never see and bots fill in. The theme renders
   * it hidden from sight, from screen readers and from the tab order, with
   * autocomplete off; a submission with it filled is thanked and dropped.
   */
  honeypot: string
}
