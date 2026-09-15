// Turning an object back into FormData.
//
// The one place the encoding decisions live, so a value sent through `<Form>`'s
// `transform` is encoded exactly as one sent any other way. It used to exist
// twice — here and inline in Form.tsx — which is two places for a boolean to
// start meaning something different.

/**
 * Serialize form state into FormData for a server action.
 *
 * The contract between a form and the action it calls — booleans become "1"/"0" so PHP sees something truthy, arrays repeat under
 * `key[]`, Files pass through untouched for native uploads, and null/undefined
 * are dropped rather than sent as the string "null".
 */
export function buildFormData(data: Record<string, unknown>): FormData {
  const formData = new FormData();

  for (const [key, val] of Object.entries(data)) {
    if (val === null || val === undefined) {
      continue;
    }
    if (val instanceof File) {
      formData.append(key, val);
    } else if (typeof val === "boolean") {
      formData.append(key, val ? "1" : "0");
    } else if (Array.isArray(val)) {
      for (const item of val) {
        formData.append(`${key}[]`, String(item));
      }
    } else {
      formData.append(key, String(val));
    }
  }

  return formData;
}
