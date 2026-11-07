/**
 * What each backend function takes as its one argument, for a form to draw:
 * `defineBlueprint({ actions: { create: contactSend } })` has no schema of its own, so the
 * fields come from the type the backend wrote to rsc-host.json.
 *
 * Worked out by the build and written into the server entry, because a Worker
 * has no file to read. References are resolved here, so what a form reads is
 * plain JSON Schema: a Go struct or a PHP class is a `$ref` in the manifest.
 */
type JsonSchema = Record<string, unknown>

interface Signature {
  params: JsonSchema[]
}

const isMap = (value: unknown): value is JsonSchema => typeof value === 'object' && value !== null && !Array.isArray(value)

function resolved(schema: JsonSchema, defs: Record<string, JsonSchema>): JsonSchema {
  const ref = schema.$ref

  if (typeof ref === 'string' && ref.startsWith('#/defs/')) return defs[ref.slice(7)] ?? schema

  return Array.isArray(schema.anyOf) ? { ...schema, anyOf: (schema.anyOf as JsonSchema[]).map((option) => resolved(option, defs)) } : schema
}

const KEY_TYPES = ['string', 'integer', 'number']

/**
 * Every function taking one object with named fields, and after it at most a
 * record's key: a panel's update is told which record as its second argument,
 * update(values, id). Nothing else can be a form. `x-key` marks the second.
 */
export function formInputs(types: Record<string, Signature>, defs: Record<string, JsonSchema>): Record<string, JsonSchema> {
  const inputs: Record<string, JsonSchema> = {}

  for (const [name, signature] of Object.entries(types)) {
    if (name.startsWith('__rsc.') || signature.params.length < 1 || signature.params.length > 2) continue

    const key = signature.params[1]

    if (key && !KEY_TYPES.includes(String(resolved(key, defs).type))) continue

    const input = resolved(signature.params[0]!, defs)

    if (input.type !== 'object' || !isMap(input.properties)) continue

    const properties = input.properties

    // Go's schemas are maps, written sorted, so it says the struct's order.
    const fields = Array.isArray(input['x-order']) ? (input['x-order'] as string[]) : Object.keys(properties)

    inputs[name] = {
      ...input,
      ...(key ? { 'x-key': true } : {}),
      properties: Object.fromEntries(fields.map((field) => [field, resolved(properties[field] as JsonSchema, defs)])),
    }
  }

  return inputs
}
