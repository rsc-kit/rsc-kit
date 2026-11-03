'use server'

import { fieldErrors } from '@rsc-kit/core/action'
import { redirect } from '@rsc-kit/core/redirect'
import { parse } from '../resource.js'
import { formNamed } from './registry.js'
import { HONEYPOT } from './honeypot.js'

/**
 * One submit for every form, bound by its component:
 * submitForm.bind(null, 'contact'). The form's own schema is the check, on
 * the server, every time - the browser's checks are a courtesy to the
 * visitor, and anyone can post without them.
 */
export async function submitForm(name: string, form: FormData) {
  const definition = formNamed(name)

  // Filled in, so not a person. Answered as a success, so a bot learns
  // nothing from the reply, and dropped.
  if (String(form.get(HONEYPOT) ?? '') !== '') return

  const parsed = await parse(definition, form)

  if (!parsed.ok) return fieldErrors(parsed.errors)

  await definition.handle(parsed.values)

  if (definition.redirect) redirect(definition.redirect as never)
}
