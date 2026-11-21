import { TRAP_FIELD } from "./js/honeypotField.js";

export { TRAP_FIELD };

/**
 * Whether a call's form sprang a `<Honeypot />`: its trap field arrived
 * filled in. The marker and the trap are taken out either way, so what the
 * action sees is the form its own fields made.
 *
 * Every argument is looked at, not only the last: a `<Form>` with no runtime
 * posts (previousState, formData), and an action may be bound to arguments of
 * its own ahead of the form.
 */
export function sprung(args: unknown[]): boolean {
  let caught = false

  for (const arg of args) {
    if (arg instanceof FormData) {
      if (sprungForm(arg)) caught = true
    } else if (typeof arg === "object" && arg !== null && Object.hasOwn(arg, TRAP_FIELD)) {
      // A FormData the encoder did not recognise as one arrives as its fields,
      // an object - and the marker with them, as precognition's mark does.
      const fields = arg as Record<string, unknown>
      const trap = String(fields[TRAP_FIELD] ?? "")

      delete fields[TRAP_FIELD]

      if (trap !== "") {
        if (filled(fields[trap])) caught = true
        delete fields[trap]
      }
    }
  }

  return caught
}

/** The same, for one form: the body of a post made before the runtime loaded. */
export function sprungForm(form: FormData): boolean {
  if (!form.has(TRAP_FIELD)) return false

  const trap = String(form.get(TRAP_FIELD) ?? "")

  form.delete(TRAP_FIELD)

  if (trap === "") return false

  const caught = form.getAll(trap).some(filled)

  form.delete(trap)

  return caught
}

function filled(value: unknown): boolean {
  if (value === undefined || value === null) return false
  if (typeof value === "string") return value !== ""
  if (Array.isArray(value)) return value.some(filled)

  // A File: a bot that fills every input attaches to a file one too.
  return true
}
