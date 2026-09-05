// Whether a redirect destination is a url a browser should be sent to.
//
// A destination is routinely computed rather than written — redirect()'s own
// documentation describes reading one from a cookie as the usual case — and it
// reaches location.href, location.replace and an inline script. A scheme other
// than http(s) in any of those is script execution rather than navigation.
//
// Parsed rather than pattern-matched. javascript: can be written with mixed
// case, with a newline inside it, or behind leading control characters, and
// each of those is a different regex to get wrong. The URL parser normalises
// all of it already, so asking it for the protocol is shorter and correct.

/** A base that cannot collide with a real origin, for resolving relative urls. */
const NOWHERE = 'https://rsc-kit.invalid/'

export function isSafeRedirect(value: string): boolean {
  try {
    const { protocol } = new URL(value, NOWHERE)

    // http and https only. Not data:, not blob:, not javascript:, and not a
    // custom app scheme — a browser handing one of those to another program is
    // not something a render should be able to trigger.
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * The same check, as a refusal.
 *
 * Says the value back, deliberately. A destination that fails this is far more
 * often a bug in what the app computed than an attack, and a message that does
 * not name the value leaves nothing to go on.
 */
export function assertSafeRedirect(value: string): void {
  if (isSafeRedirect(value)) return

  throw new Error(
    'Not a url a redirect may go to: ' + JSON.stringify(value) + '. ' +
      'A destination has to be a path or an http(s) url — any other scheme is ' +
      'handed to the browser as something to run rather than somewhere to go.',
  )
}
