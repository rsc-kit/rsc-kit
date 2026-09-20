// Turning an object into FormData, and FormData back into an object.
//
// The one place the encoding decisions live, so a value sent through `<Form>`'s
// `transform` is encoded exactly as one sent any other way, and - the part
// that mattered - the object an ACTION decodes is the same object the FORM
// validated. The decoder lived in Form.tsx and understood nested names;
// the action had a flat one of its own. A form with `items[0].name` passed
// validation in the browser and failed the same schema on the server, and
// nothing said why. Both sides call this now.

/**
 * Serialize form state into FormData for a server action.
 *
 * The contract between a form and the action it calls: booleans become "1"/"0"
 * so PHP sees something truthy, Files pass through untouched for native
 * uploads, null/undefined are dropped rather than sent as the string "null",
 * and a nested value nests - `{ items: [{ name }] }` is `items[0][name]`,
 * `{ address: { city } }` is `address[city]`, a list of scalars repeats under
 * `key[]`. Every one of those decodes back to what was given.
 */
export function buildFormData(data: Record<string, unknown>): FormData {
  const formData = new FormData();

  for (const [key, val] of Object.entries(data)) appendValue(formData, key, val);

  return formData;
}

function appendValue(formData: FormData, key: string, val: unknown): void {
  if (val === null || val === undefined) return;

  if (val instanceof File || val instanceof Blob) {
    formData.append(key, val);
  } else if (typeof val === "boolean") {
    formData.append(key, val ? "1" : "0");
  } else if (Array.isArray(val)) {
    // Scalars repeat under key[]; objects and nested lists take an index, so
    // each element's fields stay together on the way back.
    val.forEach((item, i) => {
      if (item !== null && typeof item === "object" && !(item instanceof File) && !(item instanceof Blob)) {
        appendValue(formData, `${key}[${i}]`, item);
      } else {
        appendValue(formData, `${key}[]`, item);
      }
    });
  } else if (typeof val === "object" && !(val instanceof Date)) {
    for (const [prop, inner] of Object.entries(val as Record<string, unknown>)) {
      appendValue(formData, `${key}[${prop}]`, inner);
    }
  } else if (val instanceof Date) {
    formData.append(key, val.toISOString());
  } else {
    formData.append(key, String(val));
  }
}

/**
 * The pieces of a field name: `items[0].name` is items, 0, name.
 *
 * Both spellings, because both are in use and a form should not care which one
 * a person reached for: `items[0].name` and `items[0][name]` are the same
 * field. A trailing `[]` is a piece of its own - see below.
 */
function pathOf(name: string): string[] {
  return name
    .replace(/\[(\w*)\]/g, ".$1")
    .split(".")
    .filter((piece, index, all) => piece !== "" || index === all.length - 1);
}

/** Whether a piece names an array index rather than a property. */
const isIndex = (piece: string): boolean => /^\d+$/.test(piece);

/**
 * Put one value at one path, making the containers it passes through.
 *
 * Whether a container is an array or an object is decided by the NEXT piece, so
 * `items[0].name` makes an array holding an object without being told which is
 * which.
 */
function place(
  root: Record<string, unknown>,
  path: string[],
  value: unknown,
): void {
  let node: Record<string, unknown> | unknown[] = root;

  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i];
    const container = node as Record<string, unknown>;

    if (container[key] === undefined || typeof container[key] !== "object") {
      // An index makes an array, and so does the empty piece a trailing `[]`
      // leaves - `tags[]` has to reach an array to be pushed into, and building
      // an object there is how this first went wrong.
      const next = path[i + 1];

      container[key] = isIndex(next) || next === "" ? [] : {};
    }

    node = container[key] as Record<string, unknown> | unknown[];
  }

  const last = path[path.length - 1];

  // The empty piece a trailing `[]` leaves: push rather than assign, so
  // `tags[]` twice is two entries rather than one overwriting the other.
  if (last === "") (node as unknown[]).push(value);
  else (node as Record<string, unknown>)[last] = value;
}

/**
 * A FormData as the object a schema expects.
 *
 * Four things beyond copying entries across, and each of them was a bug or a
 * gap someone would meet on their first non-trivial form:
 *
 * A repeated name is an array. Three checkboxes sharing a name, a multiple
 * select, a list of tags - this used to keep the LAST one and drop the rest
 * silently, so a schema validated an object the person had not submitted.
 *
 * A name ending in `[]` is always an array, even with one value selected.
 * Otherwise a list of checkboxes is a string when one is ticked and an array
 * when two are, and no schema can describe both. It is also what `useForm`
 * writes when it serialises an array, so the two round-trip.
 *
 * Nested names nest. `address.city` and `items[0].name` build the object they
 * describe, which is the shape the schema was written against - and the shape
 * whose validation errors come back keyed the same way, because Standard
 * Schema issue paths are joined with dots too.
 *
 * Files are kept. They were dropped for being non-strings, which meant a schema
 * checking an upload was handed undefined and refused a file that was there.
 */
export function formDataToObject<T extends Record<string, unknown> = Record<string, unknown>>(
  formData: FormData,
): T {
  const obj: Record<string, unknown> = {};

  for (const name of new Set(formData.keys())) {
    const all = formData.getAll(name);
    const path = pathOf(name);

    // A plain name used more than once is the array case, and it has no
    // brackets to say so - `tags` twice is `['a', 'b']`.
    if (path.length === 1 && path[0] !== "" && all.length > 1) {
      obj[path[0]] = all;
      continue;
    }

    for (const value of all) place(obj, path, value);
  }

  return obj as T;
}

// ── Coercing what a form posts to what a schema means ─────────────────────

type JsonSchema = {
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema | JsonSchema[];
  required?: string[];
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  const?: unknown;
  enum?: unknown[];
};

type WithJsonSchema = {
  "~standard"?: {
    jsonSchema?: {
      input?: (options: { target: string; libraryOptions?: Record<string, unknown> }) => unknown;
    };
  };
};

/**
 * What a schema is asked for. A leaf JSON Schema cannot say - a Date, a
 * Map, a custom check - is `{}` rather than a refusal of the whole schema:
 * Zod reads `unrepresentable` from here, and a form whose schema has one
 * `z.date()` beside twenty fields still reads the twenty the way they mean.
 * A library that does not know the option ignores it.
 */
const JSON_SCHEMA_OPTIONS = { target: "draft-2020-12", libraryOptions: { unrepresentable: "any" } };

const jsonSchemas = new WeakMap<object, JsonSchema | null>();

/**
 * The JSON Schema a Standard Schema describes itself with, if it can.
 *
 * Zod 4 and ArkType can; Valibot needs its separate converter and answers
 * nothing here, in which case the form's values are handed to the schema as
 * posted and the schema has to read strings.
 */
function jsonSchemaOf(schema: unknown): JsonSchema | null {
  if (schema === null || typeof schema !== "object") return null;

  const cached = jsonSchemas.get(schema);

  if (cached !== undefined) return cached;

  let json: JsonSchema | null = null;

  const produce = (schema as WithJsonSchema)["~standard"]?.jsonSchema?.input;

  try {
    if (typeof produce === "function") {
      json = produce(JSON_SCHEMA_OPTIONS) as JsonSchema;
    }
  } catch (error) {
    json = null;

    // A schema that has the method and still refused: every field of this
    // form now arrives as the string it was posted, and a z.boolean() in it
    // fails on "on" - which looks like the form's fault. Said once, in
    // development, with the library's own reason.
    if (typeof produce === "function" && import.meta.env?.DEV) {
      console.warn(
        "[rsc-kit] this form's schema cannot describe itself as JSON Schema, so its values are " +
          "validated as the strings the form posted: " +
          (error instanceof Error ? error.message : String(error)),
      );
    }
  }

  jsonSchemas.set(schema, json);

  return json;
}

const hasType = (schema: JsonSchema, type: string): boolean =>
  Array.isArray(schema.type) ? schema.type.includes(type) : schema.type === type;

/**
 * Which branch of a union the value is for.
 *
 * A discriminated union says so with a `const` on the discriminator, which
 * is what a form posts as a string and can be matched before coercion.
 * Otherwise the first branch whose type the value could be.
 */
function branchFor(branches: JsonSchema[], value: unknown): JsonSchema | null {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    const byDiscriminator = branches.find((branch) =>
      Object.entries(branch.properties ?? {}).some(
        ([key, prop]) => prop.const !== undefined && record[key] === String(prop.const),
      ),
    );

    if (byDiscriminator) return byDiscriminator;
  }

  return (
    branches.find((branch) =>
      typeof value === "string"
        ? hasType(branch, "string") || hasType(branch, "number") || hasType(branch, "integer") || hasType(branch, "boolean")
        : Array.isArray(value)
          ? hasType(branch, "array")
          : hasType(branch, "object"),
    ) ?? null
  );
}

/**
 * A form's values as the types its schema means.
 *
 * Everything a form posts is a string or a file, and a control that is off
 * is not there at all - so a schema written for the shape it wants, `boolean`
 * or `number`, refused a form that was perfectly filled in, and the guide
 * asked for `z.enum(['on', '1']).optional().transform(...)` per checkbox. The
 * schema knows what it means; this reads the form the way the schema does:
 *
 * - a `boolean` that is absent is `false` (an unchecked box posts nothing);
 *   `"on"`, `"1"`, `"true"` are true, `"0"`, `"off"`, `"false"` are false
 * - a `number` or `integer` given as a numeric string is the number; an
 *   empty string for one that is not required is absent
 * - an `array` given one value is that value in a list, and one given
 *   nothing - no checkbox ticked - is the empty list
 * - an object nests, a list of objects nests per item, and a union takes the
 *   branch its discriminator names
 *
 * Nothing else is touched: a string stays the string it was, a file stays a
 * file, and a value the schema does not describe is passed through as posted.
 */
export function coerceToSchema(value: unknown, schema: JsonSchema | null | undefined): unknown {
  if (!schema) return value;

  const branches = schema.anyOf ?? schema.oneOf;

  if (branches) {
    const branch = branchFor(branches, value);

    return branch ? coerceToSchema(value, branch) : value;
  }

  if (hasType(schema, "boolean")) {
    if (value === undefined) return false;
    if (typeof value === "string") {
      const v = value.trim().toLowerCase();

      if (v === "on" || v === "1" || v === "true") return true;
      if (v === "" || v === "0" || v === "off" || v === "false") return false;
    }

    return value;
  }

  if (hasType(schema, "number") || hasType(schema, "integer")) {
    if (typeof value === "string") {
      const v = value.trim();

      if (v === "") return undefined;
      if (/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(v)) return Number(v);
    }

    return value;
  }

  if (hasType(schema, "array")) {
    // A list with nothing in it posts nothing at all: no checkbox ticked, a
    // list the person emptied. That is an empty list, not a missing field.
    if (value === undefined) return [];

    const list = Array.isArray(value) ? value : [value];
    const items = Array.isArray(schema.items) ? null : schema.items;

    return items ? list.map((item) => coerceToSchema(item, items)) : list;
  }

  if (hasType(schema, "object") || schema.properties) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return value;

    const record = { ...(value as Record<string, unknown>) };
    const required = schema.required ?? [];

    for (const [key, prop] of Object.entries(schema.properties ?? {})) {
      let coerced = coerceToSchema(record[key], prop);

      // A text input left blank posts "", and a string the schema does not
      // require is absent rather than empty - z.email().optional() would
      // refuse "" and the person typed nothing. A required string keeps its
      // "" so the schema can say it is required.
      if (coerced === "" && !required.includes(key) && hasType(prop, "string")) coerced = undefined;

      if (coerced === undefined) delete record[key];
      else record[key] = coerced;
    }

    return record;
  }

  return value;
}

/**
 * A FormData as the object a schema expects, typed the way the schema means.
 *
 * What `<Form>` validates and what an action decodes: the same call, so a
 * form that passes in the browser passes on the server. Without a schema, or
 * with one that cannot describe itself, the values are the strings the form
 * posted.
 */
export function decodeFormData<T extends Record<string, unknown> = Record<string, unknown>>(
  formData: FormData,
  schema?: unknown,
): T {
  const values = formDataToObject(formData);

  return coerceToSchema(values, jsonSchemaOf(schema)) as T;
}
