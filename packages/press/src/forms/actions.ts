'use server'

import { fieldErrors } from '@rsc-kit/core/action'
import { redirect } from '@rsc-kit/core/redirect'
import { parse } from '../resource.js'
import { formNamed } from './registry.js'
import { HONEYPOT } from './honeypot.js'

/**
 * One submit for every blueprint's form, bound by its component:
 * submitForm.bind(null, 'contact', null) to create, or with the record's key
 * to update it. The blueprint's own schema - or the backend - is the check,
 * on the server, every time: the browser's checks are a courtesy to the
 * visitor, and anyone can post without them, with any key.
 */
export async function submitForm(name: string, key: string | null, form: FormData) {
  const definition = formNamed(name)

  // Filled in, so not a person. Answered as a success, so a bot learns
  // nothing from the reply, and dropped.
  if (definition.honeypot && String(form.get(HONEYPOT) ?? '') !== '') return

  const save = key === null ? definition.create : definition.update

  if (!save) throw new Error(`[forms] the blueprint ${name} has no ${key === null ? 'create' : 'update'}`)

  const target = key === null ? definition : { schema: definition.editSchema, fields: definition.editFields }
  const parsed = await parse(target, form)

  if (!parsed.ok) return fieldErrors(parsed.errors)

  await save(parsed.values as Record<string, unknown>, key!)

  if (definition.redirect) redirect(definition.redirect as never)
}
