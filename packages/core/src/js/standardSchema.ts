"use client";

/**
 * Validating a form before it is submitted, with whatever library you use.
 *
 * Not with an adapter per library: Standard Schema is the contract Zod,
 * Valibot, ArkType and others already implement, so this speaks to the schema
 * itself and never imports one. The types below are the spec, restated here
 * rather than depended on — it is an interface, and a package for it would be
 * a dependency that ships nothing.
 *
 * Validation on the client is a courtesy, never a control. The server still
 * has to check: a form is one way to reach an action, and the action is a
 * public endpoint reachable without it.
 */

export interface StandardSchemaV1<Input = unknown, Output = Input> {
  readonly '~standard': {
    readonly version: 1
    readonly vendor: string
    readonly validate: (
      value: unknown,
    ) => StandardSchemaResult<Output> | Promise<StandardSchemaResult<Output>>
    readonly types?: { readonly input: Input; readonly output: Output }
  }
}

interface StandardSchemaResult<Output> {
  readonly value?: Output
  readonly issues?: ReadonlyArray<{
    readonly message: string
    readonly path?: ReadonlyArray<PropertyKey | { readonly key: PropertyKey }>
  }>
}

/**
 * The field an issue belongs to.
 *
 * Segments are joined with dots so a nested field reads the way it was named —
 * `address.city`, not `address`. An issue with no path is about the form
 * rather than any field, and goes under the empty string, which is where a
 * component that wants to render it can look.
 */
function fieldOf(path: StandardSchemaResult<unknown>['issues'] extends undefined ? never : NonNullable<StandardSchemaResult<unknown>['issues']>[number]['path']): string {
  if (!path || path.length === 0) return ''

  return path
    .map((segment) => (typeof segment === 'object' && segment !== null ? segment.key : segment))
    .join('.')
}

/** Issues grouped by field, in the shape the form already reports. */
export function issuesToErrors(
  issues: NonNullable<StandardSchemaResult<unknown>['issues']>,
): Record<string, string[]> {
  const errors: Record<string, string[]> = {}

  for (const issue of issues) {
    const field = fieldOf(issue.path)

    ;(errors[field] ??= []).push(issue.message)
  }

  return errors
}

/**
 * Run a schema, or nothing if there is not one.
 *
 * Returns the errors to show, or null when the value is acceptable. The parsed
 * value is deliberately discarded: what gets submitted is the FormData the
 * browser built, and quietly sending something else — a coerced number, a
 * trimmed string — would mean the action receives what the schema decided
 * rather than what the field said.
 */
export async function validateWith(
  schema: StandardSchemaV1 | undefined,
  value: unknown,
): Promise<Record<string, string[]> | null> {
  if (!schema) return null

  const result = await schema['~standard'].validate(value)

  return result.issues && result.issues.length > 0 ? issuesToErrors(result.issues) : null
}
