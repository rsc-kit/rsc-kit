/**
 * A form posted to a backend action. React hands the action a FormData; on
 * the wire to the backend it is JSON, and JSON.stringify of a FormData is {} -
 * so a form posting straight to a backend action used to send nothing. Its
 * fields become one object, typed by the first parameter where the backend
 * described it: numbers and booleans coerced, a repeated name a list.
 *
 * One copy, imported by every module the build writes under server-actions/.
 */
export function formArgs(args: unknown[], schemas: (Record<string, any> | null)[]): unknown[] {
  // The form is the last argument, and it fills the parameter it lands on: the
  // first when the action takes nothing before it, the one after the team when
  // that was bound with stub.bind(null, team).
  const at = args.length - 1

  if (at < 0 || !(args[at] instanceof FormData)) return args

  const form = args[at] as FormData
  const schema = schemas[at] ?? null
  const props: Record<string, any> = schema?.properties ?? {}
  const coerce = (type: unknown, v: string): unknown =>
    type === 'integer' || type === 'number' ? (v === '' ? null : Number(v))
      : type === 'boolean' ? v === 'on' || v === 'true' || v === '1'
      : v
  const out: Record<string, unknown> = {}

  for (const key of new Set(form.keys())) {
    // React's own fields for a form action, not the form's.
    if (key.startsWith('$ACTION_')) continue

    const values = form.getAll(key).filter((v): v is string => typeof v === 'string')
    const prop = props[key]

    out[key] = prop?.type === 'array' || (!prop && values.length > 1)
      ? values.map((v) => coerce(prop?.items?.type, v))
      : coerce(prop?.type, values[0] ?? '')
  }

  // An unchecked checkbox sends nothing: false, not missing.
  for (const [key, prop] of Object.entries(props)) {
    if (!(key in out) && prop?.type === 'boolean') out[key] = false
  }

  return [...args.slice(0, at), out]
}
