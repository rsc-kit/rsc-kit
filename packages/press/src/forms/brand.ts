import type { Field, FormSchema } from '../resource.js'

/**
 * What marks a blueprint, so a resource handed one in `form` can tell it from
 * a Standard Schema without importing the module that draws it.
 */
export const BLUEPRINT = Symbol.for('@rsc-kit/press.blueprint')

/** What a resource reads from a blueprint: the fields and the saves, nothing it draws. */
export interface BlueprintParts {
  readonly [BLUEPRINT]: true
  name: string
  /** What a create is checked against. */
  schema: FormSchema
  /** What an update is checked against: a backend's update may take other fields than its create. */
  editSchema: FormSchema
  /** The create form's fields. Throws for a blueprint that cannot create. */
  readonly fields: Field[]
  /** The edit form's fields. Throws for a blueprint that cannot update. */
  readonly editFields: Field[]
  /** The resources its relation fields name. */
  relations: string[]
  /** Saves a new record, answering what was saved. Null when the blueprint only updates, or leaves saving to a resource's source. */
  create: ((values: Record<string, unknown>) => Promise<unknown>) | null
  /** Saves the record with this key. Null when the blueprint only creates, or leaves saving to a resource's source. */
  update: ((values: Record<string, unknown>, key: string) => Promise<unknown>) | null
}

export function isBlueprint(value: unknown): value is BlueprintParts {
  return typeof value === 'object' && value !== null && (value as Record<symbol, unknown>)[BLUEPRINT] === true
}
