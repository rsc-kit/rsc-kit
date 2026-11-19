/**
 * Checking a form's fields against the server before it is submitted.
 *
 * Laravel calls this Precognition: the request runs the route's middleware
 * and its form request - authorization, then the rules for the fields named -
 * and stops before the controller. Here it is the same idea for any backend.
 * `<Form>` asks on blur and when its `validate()` is called, and the action's
 * guards and validation run while its body never does.
 *
 * Two kinds of action can be asked:
 *
 * - A generated stub for a backend function the backend lists in
 *   `validates` (rsc-host.json). The stub's one host call goes out with
 *   `validate: [fields]` - empty for every field - and the backend answers
 *   as it would the call: a 422 with `validationErrors`, or a null result
 *   when the fields pass.
 *   A function the backend does not list is never sent one: a backend that
 *   has never heard of `validate` would run the call.
 * - An action built by createActionClient with an input schema. Its schema
 *   and middleware run, and the handler is skipped.
 *
 * Anything else answers `unsupported`, and the form stops asking.
 */

import { checksEarly, isActionRefusal, isActionValidationError, turnedAwayStatus } from './action.js'
import { isRedirectSignal } from './redirectDigest.js'
import { CHECK_FIELD, errorsFor } from './js/checkField.js'
import { beginCheck, endCheck } from './request.js'

export { CHECK_FIELD }

/** What a check answers with: the fields' errors, or nothing to say. */
export interface Checked {
  /** Errors for the fields that were asked about, and only those. Absent when they pass. */
  errors?: Record<string, string[]>
  /** The action cannot be checked without running it. */
  unsupported?: true
}

/**
 * The fields a call asks to check, when it is a check - an empty list is
 * every field. The mark is taken out of the form, so what the action sees is
 * the form as it was sent.
 *
 * A mark that cannot be read is still a mark: 'malformed', answered with
 * nothing and never run, because whatever sent it meant a check.
 */
export function checkOf(args: unknown[]): string[] | 'malformed' | null {
  const form = args[args.length - 1]
  let raw: unknown

  if (form instanceof FormData) {
    if (!form.has(CHECK_FIELD)) return null

    raw = form.get(CHECK_FIELD)
    form.delete(CHECK_FIELD)
  } else if (typeof form === 'object' && form !== null && Object.hasOwn(form, CHECK_FIELD)) {
    // A FormData the encoder did not recognise as one arrives as its fields,
    // an object - and the mark with them. Missed here, the check is a submit.
    raw = (form as Record<string, unknown>)[CHECK_FIELD]
    delete (form as Record<string, unknown>)[CHECK_FIELD]
  } else {
    return null
  }

  try {
    const fields = JSON.parse(String(raw)) as unknown

    if (Array.isArray(fields) && fields.every((field) => typeof field === 'string')) return fields
  } catch {
    // Malformed, below.
  }

  return 'malformed'
}

function only(errors: Record<string, string[]>, fields: string[]): Record<string, string[]> | undefined {
  const kept = errorsFor(errors, fields)

  return Object.keys(kept).length > 0 ? kept : undefined
}

interface HostForms {
  actions?: Map<unknown, string>
  validates?: Set<string>
}

/**
 * Run `action` as a check of `fields`.
 *
 * Errors are kept to the fields asked about, whatever the backend sent: a
 * schema has no notion of one field, and a backend may answer for the whole
 * form. Anything that is not about the fields - a refusal, a redirect, a
 * guard turning the visitor away - is no verdict on them, and is left for the
 * submit to say.
 */
export async function checkOnly(action: unknown, args: unknown[], fields: string[] | 'malformed'): Promise<Checked> {
  const forms = (globalThis as Record<symbol, unknown>)[Symbol.for('rsc-kit.host-forms')] as HostForms | undefined
  const target = forms?.actions?.get(action)
  const checks = target !== undefined ? forms?.validates?.has(target) === true : checksEarly(action)

  if (!checks || typeof action !== 'function') return { unsupported: true }

  if (fields === 'malformed') return {}

  if (!beginCheck(fields, target ?? null)) return { unsupported: true }

  try {
    const result = (await (action as (...a: unknown[]) => unknown)(...args)) as { validationErrors?: Record<string, string[]> } | null

    // A client-built action returns its refusal rather than throwing it.
    const errors = result?.validationErrors ? only(result.validationErrors, fields) : undefined

    return errors ? { errors } : {}
  } catch (error) {
    if (isActionValidationError(error)) {
      const errors = only(error.errors, fields)

      return errors ? { errors } : {}
    }

    // Not the visitor's to see on a blur, and not silent either: the submit
    // that follows will most likely fail the same way, and this is earlier.
    if (!isAnswer(error)) console.error('[rsc-kit] Checking an action\'s fields failed:', error)

    return {}
  } finally {
    endCheck()
  }
}

/** A refusal, a redirect or a turn-away: the backend answering, not failing. */
function isAnswer(error: unknown): boolean {
  return isActionRefusal(error) || isRedirectSignal(error) || turnedAwayStatus(error) !== null
}
