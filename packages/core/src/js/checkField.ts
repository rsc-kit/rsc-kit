/**
 * The FormData entry that marks an action call as a check of its fields
 * rather than a run, holding the fields as a JSON array - every field when it
 * is empty. Shared by `<Form>`, which sets it, and the action endpoint, which
 * takes it out before the action sees the form. See precognition.ts.
 */
export const CHECK_FIELD = "$rsc:validate";

/**
 * Laravel's matching for Precognition-Validate-Only: a field named exactly,
 * or by a pattern whose `*` stands for one segment - `items.*.name`. No
 * patterns is every field.
 */
export function fieldMatches(field: string, patterns: readonly string[]): boolean {
  if (patterns.length === 0) return true;

  return patterns.some((pattern) =>
    pattern.includes("*")
      ? new RegExp(
          "^" + pattern.split("*").map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join("[^.]+") + "$",
        ).test(field)
      : pattern === field,
  );
}

/** The errors about the fields named, and none of the others. */
export function errorsFor(
  errors: Record<string, string[]>,
  patterns: readonly string[],
): Record<string, string[]> {
  return Object.fromEntries(Object.entries(errors).filter(([field]) => fieldMatches(field, patterns)));
}
