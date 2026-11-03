/**
 * A resource, described once: what its table shows, what its form takes, and
 * where its rows come from. The panel renders every page from this - nothing
 * per resource is written as a page.
 *
 * The form is a schema, not a list of widgets: the same object validates the
 * save on the server and is read for the fields it has, so a field cannot be
 * on the form and missing from the check, or the other way round. Any
 * Standard Schema validates; one that also describes itself as JSON Schema
 * (Standard JSON Schema - zod 4.2+, and others as they add it) gives its
 * fields too, and any other says them in `fields`.
 */
import type { ComponentType, ReactNode } from 'react'
import { issuesToErrors } from '@rsc-kit/core/standardSchema'
import type { StandardSchemaV1 } from '@rsc-kit/core/standardSchema'
import { accepts, IMAGE_TYPES, sizeOf } from './uploads.js'
import type { Storage } from './uploads.js'

/** What the form validates with: any Standard Schema - zod, valibot, arktype, effect. */
export type FormSchema = StandardSchemaV1<any, Record<string, unknown>>

/** What a schema's save hands the data source. */
export type ValuesOf<Schema extends FormSchema> = NonNullable<Schema['~standard']['types']>['output']

export type Format = 'text' | 'money' | 'badge' | 'boolean' | 'date' | 'relation'

export interface Column {
  key: string
  label: string
  format: Format
  sortable: boolean
  searchable: boolean
  /** Shown until the visitor hides it from the Columns menu. */
  visible: boolean
  /** Draws the cell instead of the format. Runs on the server, so it may be async and read anything. */
  cell?: (value: any, row: any) => ReactNode | Promise<ReactNode>
  /** For a relation column: the resource whose row the value names, shown by its title. */
  relation?: string
}

/** A column, chained: text('name').searchable().sortable(). */
export class ColumnBuilder {
  readonly #column: Column

  constructor(column: Column) {
    this.#column = column
  }

  sortable(): this {
    this.#column.sortable = true
    return this
  }

  searchable(): this {
    this.#column.searchable = true
    return this
  }

  label(label: string): this {
    this.#column.label = label
    return this
  }

  /** In the Columns menu, unticked until the visitor shows it. */
  hidden(): this {
    this.#column.visible = false
    return this
  }

  /** Draw the cell yourself: .cell((value, row) => <Avatar src={row.photo} />). */
  cell(render: NonNullable<Column['cell']>): this {
    this.#column.cell = render
    return this
  }

  build(): Column {
    return { ...this.#column }
  }
}

/** The column helpers, typed to the row so a misspelt key fails the typecheck. */
export interface Columns<Row> {
  text(key: keyof Row & string): ColumnBuilder
  money(key: keyof Row & string): ColumnBuilder
  badge(key: keyof Row & string): ColumnBuilder
  boolean(key: keyof Row & string): ColumnBuilder
  date(key: keyof Row & string): ColumnBuilder
  /**
   * A belongsTo: the value is another resource's key, shown as that row's
   * title - col.relation('categoryId', 'categories') shows "Lighting", not 3.
   */
  relation(key: keyof Row & string, resource: string): ColumnBuilder
}

function columns<Row>(): Columns<Row> {
  const make = (format: Format) => (key: string) =>
    new ColumnBuilder({ key, label: humanize(key), format, sortable: false, searchable: false, visible: true })

  return {
    text: make('text'),
    money: make('money'),
    badge: make('badge'),
    boolean: make('boolean'),
    date: make('date'),
    relation: (key, resource) =>
      new ColumnBuilder({ key, label: humanize(key.replace(/_?[iI]d$/, '')), format: 'relation', relation: resource, sortable: false, searchable: false, visible: true }),
  }
}

export type FieldType = 'text' | 'textarea' | 'number' | 'select' | 'toggle' | 'email' | 'date' | 'blocks' | 'file' | 'image'

/** A kind of block a blocks field offers, as the form needs it: plain data. */
export interface BlockSpec {
  name: string
  label: string
  fields: Field[]
}

/** One choice of a select: what is saved, and what the visitor reads. */
export interface Option {
  value: string
  label: string
}

/** What the form renders. Plain data: it crosses to the client component. */
export interface Field {
  name: string
  label: string
  type: FieldType
  required: boolean
  options?: Option[]
  /**
   * A belongsTo: the options are another resource's rows, its key saved and
   * its title shown, read when the form is drawn and scoped to the tenant.
   */
  relation?: string
  /** A select whose schema wants a number: its value is converted, as a number field's is. */
  numeric?: boolean
  /** Help under the control. */
  description?: string
  /**
   * What the browser checks before a submit, from the schema: the native
   * constraints, so a mistake is caught without a round trip and without the
   * schema in the browser. A courtesy only - the server validates every save.
   */
  min?: number
  max?: number
  minLength?: number
  maxLength?: number
  /** Whole-value, as the pattern attribute matches. */
  pattern?: string
  step?: number | 'any'
  /**
   * A blocks field's kinds of block. Its value is a list of { type, data },
   * each block's data checked by its own schema; in a form, block i's field
   * is named `name.i.field`, which is also where its errors are.
   */
  blocks?: BlockSpec[]
  /**
   * A file or image field's types, as the accept attribute says them:
   * `image/*`, `application/pdf`, `.csv`. Checked by the browser when the
   * file is chosen and by the server when it arrives.
   */
  accept?: string
  /** A file or image field's largest file, in bytes. */
  maxSize?: number
  /** The schema allows null: a file field that is emptied saves null, so the source clears it. */
  nullable?: boolean
}

export interface Filter {
  key: string
  label: string
  options: Option[]
}

export interface ListQuery {
  q?: string
  sort?: string
  dir: 'asc' | 'desc'
  page: number
  /**
   * Null asks for every row: a resource whose table works in the browser
   * (mode: 'client') is loaded whole, and searched, sorted and paged there.
   */
  perPage: number | null
  /** Only the resource's declared filters, each with a value. */
  filters: Record<string, string>
  /** The columns marked searchable: what q is matched against. */
  searchable: string[]
}

/** Whoever's records these are, in a panel with tenants. */
export interface Tenant {
  id: string
  name: string
  /** A second line under the name in the switcher: a plan, a role. */
  description?: string
  /** An image url for the switcher. Without one the first letter is shown. */
  avatar?: string
}

/** What every call to a data source is told besides its arguments. */
export interface SourceContext {
  /** The tenant the visitor is working in, or null in a panel without tenants. */
  tenant: Tenant | null
}

/**
 * Where a resource's rows live: five functions, and nothing about how. A
 * database (Drizzle, Prisma, SQL), a REST or GraphQL API, a Laravel app through
 * rpc(), a file, memory - the panel calls these and never anything else.
 *
 * In a panel with tenants, a source answers only for context.tenant. find()
 * returning null for another tenant's record is what makes its url a 404.
 */
export interface DataSource<Row, Values> {
  list(query: ListQuery, context: SourceContext): Promise<{ rows: Row[]; total: number }>
  find(id: string, context: SourceContext): Promise<Row | null>
  create(values: Values, context: SourceContext): Promise<Row>
  update(id: string, values: Values, context: SourceContext): Promise<Row>
  delete(id: string, context: SourceContext): Promise<void>
}

/**
 * Where a table's search, filters, sort and paging happen.
 *
 *   'server'  each change is a request; the source is asked for one page.
 *             For a table that grows: orders, users, an API with millions.
 *   'client'  the source is asked once for every row (perPage: null) and the
 *             browser does the rest, with no request per keystroke. For a
 *             table that stays small: categories, settings, team members.
 */
export type TableMode = 'server' | 'client'

/**
 * Something done to the rows ticked in the table: publish, archive, export.
 * `run` is given the rows themselves, each found by the source as the
 * visitor - an id the browser sent that is not theirs never reaches it.
 */
export interface BulkAction<Row = any> {
  /** Identifies it in the call; 'delete' is the panel's own. */
  name: string
  label: string
  /** Asked about first, as a delete is. */
  destructive?: boolean
  /** What happened to the rows, for the toast: 'published' says "3 products published.", as Delete says "deleted". */
  done?: string
  /** Returns its own words for the toast, or leaves them to `done`. */
  run: (rows: Row[], context: SourceContext) => void | string | Promise<void | string>
}

export interface Resource<Row = any, Schema extends FormSchema = FormSchema> {
  name: string
  label: string
  singular: string
  key: keyof Row & string
  title: keyof Row & string
  source: DataSource<Row, ValuesOf<Schema>>
  columns: Column[]
  filters: Filter[]
  schema: Schema
  fields: Field[]
  perPage: number
  mode: TableMode
  /** Listed and searched, never created, edited or deleted from the panel. */
  readOnly: boolean
  bulkActions: BulkAction<Row>[]
  /** The sidebar's icon: a lucide icon, or any component. */
  icon?: ComponentType<{ className?: string }>
  description?: string
}

export interface ResourceDefinition<Row, Schema extends FormSchema> {
  /** The url segment: /admin/products. */
  name: string
  label?: string
  singular?: string
  /** The field that identifies a row in the url. */
  key: keyof Row & string
  /** The field an edit page's heading shows. */
  title: keyof Row & string
  source: DataSource<Row, ValuesOf<Schema>>
  table: (col: Columns<Row>) => ColumnBuilder[]
  /** Enum fields of the form, offered as a select above the table. */
  filters?: (keyof Row & string)[]
  /** Any Standard Schema of an object: z.object(), v.object(), type({...}). */
  form: Schema
  /**
   * What the schema cannot say: a long string is a textarea, a label, help.
   * The whole list, for a schema that does not describe itself as JSON
   * Schema - a field missing here is then missing from the form.
   */
  fields?: Partial<Record<keyof ValuesOf<Schema> & string, FieldOverride>>
  perPage?: number
  /** Where search, filters, sort and paging happen. 'server' unless said. */
  mode?: TableMode
  /** Listed and searched, never created, edited or deleted from the panel: a log, a feed, a plugin's own records. */
  readOnly?: boolean
  /** Offered when rows are ticked, beside the panel's own Delete. */
  bulkActions?: BulkAction<Row>[]
  /** The sidebar's icon: import { Package } from 'lucide-react'. */
  icon?: ComponentType<{ className?: string }>
  /** Under the page's heading. */
  description?: string
}

/**
 * Two calls so the row is named and the schema is inferred:
 * defineResource<Product>()({ ... }).
 */
export function defineResource<Row>() {
  return <Schema extends FormSchema>(definition: ResourceDefinition<Row, Schema>): Resource<Row, Schema> => {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(definition.name)) {
      throw new Error(`[admin] a resource's name is its url segment, lowercase letters, digits and dashes: ${JSON.stringify(definition.name)}`)
    }

    const fields = fieldsOf(definition.form, definition.fields ?? {})
    const bulkActions = definition.bulkActions ?? []
    const bulkNames = bulkActions.map((action) => action.name)

    if (bulkActions.length > 0 && definition.readOnly) {
      throw new Error(`[admin] ${definition.name} is read-only, so it has no bulk actions`)
    }

    for (const [index, name] of bulkNames.entries()) {
      if (name === 'delete') throw new Error(`[admin] ${definition.name}: 'delete' is the panel's own bulk action`)
      if (bulkNames.indexOf(name) !== index) throw new Error(`[admin] ${definition.name}: two bulk actions are named ${name}`)
    }

    return {
      name: definition.name,
      label: definition.label ?? humanize(definition.name),
      singular: definition.singular ?? humanize(definition.name).replace(/s$/, ''),
      key: definition.key,
      title: definition.title,
      source: definition.source,
      columns: definition.table(columns<Row>()).map((column) => column.build()),
      filters: (definition.filters ?? []).map((key) => {
        const field = fields.find((candidate) => candidate.name === key)

        if (!field?.options) throw new Error(`[admin] ${definition.name}: the filter ${key} needs an enum field in the form`)

        return { key, label: field.label, options: field.options }
      }),
      schema: definition.form,
      fields,
      perPage: definition.perPage ?? 10,
      mode: definition.mode ?? 'server',
      readOnly: definition.readOnly ?? false,
      bulkActions,
      ...(definition.icon ? { icon: definition.icon } : {}),
      ...(definition.description ? { description: definition.description } : {}),
    }
  }
}

/** A field as the app says it, over what the schema said. */
export type FieldOverride = Partial<Pick<Field, 'type' | 'label' | 'description' | 'required' | 'relation'>> & {
  /** A bare value is labelled by humanizing it: 'in_stock' reads "In stock". */
  options?: (string | Option)[]
  /** The kinds a blocks field offers: { type: 'blocks', blocks: [hero, features] }. */
  blocks?: BlockLike[]
  /** Where a file or image field keeps what is uploaded. Required for one. */
  storage?: Storage
  /** A file or image field's types. An image field takes PNG, JPEG, WebP, GIF and AVIF unless it says. */
  accept?: string
  /** A file or image field's largest file, in bytes. */
  maxSize?: number
}

/** What a blocks field needs of a block: its name, label, fields and schema. */
interface BlockLike {
  name: string
  label: string
  fields: Field[]
  schema: FormSchema
}

/**
 * A blocks field's schemas, by field. Kept beside the field rather than on
 * it, because a field crosses to the browser and a schema cannot.
 */
const schemasOf = new WeakMap<Field, Map<string, FormSchema>>()

/** A file field's storage, kept beside it for the same reason. */
const storageOf = new WeakMap<Field, Storage>()

/** A bare option labelled for reading, or one the app labelled itself. */
function optionOf(option: string | Option): Option {
  return typeof option === 'string' ? { value: option, label: humanize(option) } : option
}

/** An override as a field: options made whole, and a relation drawn as a select. */
function applied(override: FieldOverride | undefined): Partial<Field> {
  if (!override) return {}

  // storage never goes on the field: a field crosses to the browser.
  const { options, blocks, storage: _, ...rest } = override

  return {
    ...(override.relation ? { type: 'select' as FieldType } : {}),
    ...rest,
    ...(options ? { options: options.map(optionOf) } : {}),
    ...(blocks ? { type: 'blocks' as FieldType, blocks: blocks.map(({ name, label, fields }) => ({ name, label, fields })) } : {}),
  }
}

/** Keeps a blocks field's schemas, and a file field's storage, where parse() finds them. */
function withSchemas(field: Field, override: FieldOverride | undefined): Field {
  if (field.type === 'file' || field.type === 'image') {
    if (!override?.storage) throw new Error(`[press] the ${field.type} field ${field.name} needs storage: where an upload is kept`)

    storageOf.set(field, override.storage)
    if (field.type === 'image' && field.accept === undefined) field.accept = IMAGE_TYPES

    return field
  }

  if (field.type !== 'blocks') return field

  if (!override?.blocks?.length) throw new Error(`[press] the blocks field ${field.name} needs blocks: [...] - the kinds it offers`)

  schemasOf.set(field, new Map(override.blocks.map((block) => [block.name, block.schema])))

  return field
}

type Overrides = Record<string, FieldOverride | undefined>

type JsonSchema = {
  type?: string | string[]
  format?: string
  enum?: unknown[]
  const?: unknown
  anyOf?: JsonSchema[]
  oneOf?: JsonSchema[]
  properties?: Record<string, JsonSchema>
  required?: string[]
  minimum?: number
  maximum?: number
  minLength?: number
  maxLength?: number
  pattern?: string
}

/**
 * A JSON Schema pattern as the pattern attribute, or nothing. The attribute
 * matches the whole value and compiles with the v flag; a JSON Schema pattern
 * matches anywhere. So only an anchored one carries over, and only one the v
 * flag accepts - an attribute the browser cannot compile is ignored, and one
 * that meant "contains" would refuse what the server accepts.
 */
function patternOf(pattern: string | undefined): string | undefined {
  if (!pattern?.startsWith('^') || !pattern.endsWith('$') || pattern.endsWith('\\$')) return undefined

  try {
    new RegExp(pattern, 'v')

    return pattern
  } catch {
    return undefined
  }
}

/** The constraints the browser can check for a field of this type. */
function constraintsOf(type: FieldType, json: JsonSchema, integer: boolean): Partial<Field> {
  const out: Partial<Field> = {}

  if (type === 'number') {
    // zod's int() writes the safe-integer range as bounds: not a constraint anyone wrote.
    if (json.minimum !== undefined && json.minimum > Number.MIN_SAFE_INTEGER) out.min = json.minimum
    if (json.maximum !== undefined && json.maximum < Number.MAX_SAFE_INTEGER) out.max = json.maximum
    // Without step a number input refuses 12.5: 'any' unless the schema says integer.
    out.step = integer ? 1 : 'any'
  }

  if (type === 'text' || type === 'textarea' || type === 'email') {
    if (json.minLength !== undefined) out.minLength = json.minLength
    if (json.maxLength !== undefined) out.maxLength = json.maxLength
  }

  // Only plain text: an email's or a date's pattern is the library's own
  // spelling of the format, which type="email" and type="date" already check.
  if (type === 'text') {
    const pattern = patternOf(json.pattern)

    if (pattern) out.pattern = pattern
  }

  return out
}

/**
 * The schema as JSON Schema, if it can say: the Standard JSON Schema
 * interface, which zod (4.2+) implements and other libraries are adding. Of
 * the input - what the form is filled with - not the output it parses to.
 */
function describe(schema: FormSchema): JsonSchema | null {
  const converter = (schema['~standard'] as { jsonSchema?: { input?: (options: { target: string }) => unknown } }).jsonSchema

  if (!converter?.input) return null

  try {
    return converter.input({ target: 'draft-2020-12' }) as JsonSchema
  } catch {
    return null
  }
}

/** The one type a property is, looking through a nullable union. */
function typeOf(property: JsonSchema): JsonSchema {
  const options = property.anyOf ?? property.oneOf

  if (options) return options.find((option) => option.type !== 'null') ?? property

  return property
}

/**
 * The fields a schema describes: the type of each property, whether it is
 * required, an enum's options. From its JSON Schema when it has one; from
 * `overrides` alone when it does not, which must then list every field.
 */
export function fieldsOf(schema: FormSchema, overrides: Overrides = {}): Field[] {
  const json = describe(schema)

  if (!json?.properties) {
    if (Object.keys(overrides).length === 0) {
      throw new Error(
        `[admin] this ${schema['~standard'].vendor} schema does not describe its fields as JSON Schema; list them in fields: { name: { type: 'text' }, ... }`,
      )
    }

    return Object.entries(overrides).map(([name, override]) =>
      withSchemas({ name, label: humanize(name), type: 'text' as FieldType, required: true, ...applied(override) }, override),
    )
  }

  const required = new Set(json.required ?? [])

  return Object.entries(json.properties).map(([name, property]) => {
    const inner = typeOf(property)
    const types = ([] as string[]).concat(inner.type ?? [])
    const options = inner.enum?.filter((option) => option !== null).map((option) => optionOf(String(option)))
    // zod writes a nullable string as type: ['string', 'null'], and a nullable url as anyOf: [{ format: 'uri' }, { type: 'null' }].
    const nullable = ([] as string[]).concat(property.type ?? []).includes('null') || ((property.anyOf ?? property.oneOf)?.some((option) => option.type === 'null') ?? false)
    const type: FieldType =
      options ? 'select'
      : types.includes('boolean') ? 'toggle'
      : types.includes('number') || types.includes('integer') ? 'number'
      : inner.format === 'email' ? 'email'
      : inner.format === 'date' || inner.format === 'date-time' ? 'date'
      : 'text'

    const override = overrides[name]
    const numeric = types.includes('number') || types.includes('integer')
    const final = override?.relation ? 'select' : (override?.type ?? type)

    return withSchemas({
      name,
      // categoryId is a Category to whoever picks it.
      label: humanize(override?.relation ? name.replace(/_?[iI]d$/, '') : name),
      type,
      required: required.has(name) && !nullable,
      ...(nullable ? { nullable: true } : {}),
      ...(options ? { options } : {}),
      ...(numeric && final === 'select' ? { numeric: true } : {}),
      // Checked for the type the field ends up as: a string made a textarea keeps its lengths, loses its pattern.
      ...constraintsOf(final, inner, types.includes('integer')),
      ...applied(override),
    }, override)
  })
}

/**
 * A submitted form's values as the schema expects them, by its fields: a
 * resource's, a public form's, a block's. A checkbox that is off is not in
 * FormData at all, so a toggle is whether its name arrived; an empty optional
 * field is left out rather than sent as "".
 */
export function valuesFrom(target: { fields: Field[] }, form: FormData): Record<string, unknown> {
  return Object.fromEntries(
    target.fields.flatMap((field): [string, unknown][] => {
      if (field.type === 'toggle') return [[field.name, form.has(field.name)]]
      if (field.type === 'blocks') return [[field.name, blocksFrom(field, form)]]
      if (field.type === 'file' || field.type === 'image') return fileFrom(field, form)

      const value = form.get(field.name)

      if (value === null || (value === '' && !field.required)) return []

      // A number field arrives as text. Converted here, so the schema says
      // z.number() and not z.coerce.number() - the same schema an API would
      // use - and a field that is not a number stays text for it to refuse.
      if ((field.type === 'number' || field.numeric) && typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
        return [[field.name, Number(value)]]
      }

      return [[field.name, value]]
    }),
  )
}

/**
 * A file field's value: the file chosen, else the value it already had
 * (sent back by the form beside the file input), else nothing - or null
 * when it was emptied and may be. A kept value is the browser's word, so
 * parse() takes it only if the record already had it.
 */
function fileFrom(field: Field, form: FormData): [string, unknown][] {
  const sent = form.getAll(field.name)
  const chosen = sent.find((entry): entry is File => typeof entry !== 'string' && entry.size > 0)

  if (chosen) return [[field.name, chosen]]

  const kept = sent.find((entry) => typeof entry === 'string' && entry !== '')

  if (kept !== undefined) return [[field.name, kept]]

  return field.nullable && sent.length > 0 ? [[field.name, null]] : []
}

/** A blocks field's list, read from `name.0.type`, `name.0.heading`, ... until an index is missing. */
function blocksFrom(field: Field, form: FormData): { type: string; data: Record<string, unknown> }[] {
  const out: { type: string; data: Record<string, unknown> }[] = []

  for (let index = 0; form.has(`${field.name}.${index}.type`); index++) {
    const prefix = `${field.name}.${index}.`
    const type = String(form.get(`${prefix}type`))
    const spec = field.blocks?.find((candidate) => candidate.name === type)

    if (!spec) {
      out.push({ type, data: {} })
      continue
    }

    const data = valuesFrom({ fields: spec.fields.map((inner) => ({ ...inner, name: prefix + inner.name })) }, form)

    out.push({ type, data: Object.fromEntries(Object.entries(data).map(([name, value]) => [name.slice(prefix.length), value])) })
  }

  return out
}

/**
 * Each block of each blocks field checked by its own schema, its data
 * replaced by what the schema parsed it to. A refusal is keyed
 * `name.index.field`, where the form shows it.
 */
async function checkBlocks(fields: Field[], values: Record<string, unknown>, apply: boolean): Promise<Record<string, string[]>> {
  const errors: Record<string, string[]> = {}

  for (const field of fields) {
    const schemas = schemasOf.get(field)
    const list = values[field.name]

    if (!schemas || !Array.isArray(list)) continue

    for (const [index, item] of (list as { type: string; data: Record<string, unknown> }[]).entries()) {
      const schema = schemas.get(item.type)

      if (!schema) {
        errors[`${field.name}.${index}`] = [`There is no ${item.type} block.`]
        continue
      }

      const result = await schema['~standard'].validate(item.data)

      if (!result.issues) {
        if (apply) item.data = result.value as Record<string, unknown>
        continue
      }

      for (const [path, messages] of Object.entries(issuesToErrors(result.issues))) {
        errors[`${field.name}.${index}${path ? `.${path}` : ''}`] = messages
      }
    }
  }

  return errors
}

export type Parsed<Values> = { ok: true; values: Values } | { ok: false; errors: Record<string, string[]> }

/** An upload waiting for the rest of the form to pass. */
interface Upload {
  path: string
  file: File
  storage: Storage
  keep: (value: string) => void
}

/**
 * Finds each file field's upload, here and inside blocks. A file the field
 * does not accept, or too large, is refused under it. A kept value the
 * record did not have is dropped: anyone can post a string, and it would
 * otherwise save a url of their choosing as though it had been uploaded.
 */
function uploadsIn(fields: Field[], values: Record<string, unknown>, had: Record<string, unknown>[], at: string, uploads: Upload[], refused: Record<string, string[]>) {
  for (const field of fields) {
    const path = at + field.name
    const value = values[field.name]

    if (field.type === 'blocks') {
      const before = Array.isArray(had[0]?.[field.name]) ? (had[0]![field.name] as { type?: string; data?: Record<string, unknown> }[]) : []

      for (const [index, item] of (Array.isArray(value) ? (value as { type: string; data: Record<string, unknown> }[]) : []).entries()) {
        const spec = field.blocks?.find((candidate) => candidate.name === item.type)
        const same = before.filter((block) => block?.type === item.type && block.data).map((block) => block.data!)

        if (spec) uploadsIn(spec.fields, item.data, same, `${path}.${index}.`, uploads, refused)
      }

      continue
    }

    if (field.type !== 'file' && field.type !== 'image') continue

    if (typeof value === 'string' && !had.some((record) => record[field.name] === value)) {
      if (field.nullable) values[field.name] = null
      else delete values[field.name]
    }

    if (value instanceof Blob) {
      const file = value as File

      if (!accepts(field.accept, file)) refused[path] = [field.type === 'image' ? 'Choose a PNG, JPEG, WebP, GIF or AVIF image.' : 'That type of file is not accepted here.']
      else if (field.maxSize !== undefined && file.size > field.maxSize) refused[path] = [`Choose a file of ${sizeOf(field.maxSize)} or less.`]
      else uploads.push({ path, file, storage: storageOf.get(field)!, keep: (kept) => (values[field.name] = kept) })

      continue
    }

    if (field.required && (values[field.name] === undefined || values[field.name] === null)) refused[path] = ['Choose a file.']
  }
}

/** Blocks, then the whole form, each against its schema. */
async function check<Schema extends FormSchema>(target: { schema: Schema; fields: Field[] }, values: Record<string, unknown>, apply: boolean): Promise<Parsed<ValuesOf<Schema>>> {
  const blocks = await checkBlocks(target.fields, values, apply)
  const result = await target.schema['~standard'].validate(values)

  if (!result.issues && Object.keys(blocks).length === 0) return { ok: true, values: result.value as ValuesOf<Schema> }

  return { ok: false, errors: { ...(result.issues ? issuesToErrors(result.issues) : {}), ...blocks } }
}

export interface ParseOptions {
  /** The record being edited, as it was: the values a file field may keep without uploading again. */
  current?: Record<string, unknown> | null
  /** Handed to storage with each upload. */
  tenant?: Tenant | null
}

/**
 * A submitted form checked against its schema, with each refusal under its
 * field. Uploads are kept last: the form is checked with them still files,
 * and only when nothing else is wrong is each one stored and the form
 * checked again with what storage answered - so a refused save leaves no
 * file behind.
 */
export async function parse<Schema extends FormSchema>(
  target: { schema: Schema; fields: Field[] },
  form: FormData,
  options: ParseOptions = {},
): Promise<Parsed<ValuesOf<Schema>>> {
  const values = valuesFrom(target, form)
  const uploads: Upload[] = []
  const refused: Record<string, string[]> = {}

  uploadsIn(target.fields, values, options.current ? [options.current] : [], '', uploads, refused)

  if (uploads.length === 0 && Object.keys(refused).length === 0) return check(target, values, true)

  const waiting = new Set(uploads.map((upload) => upload.path))
  const first = await check(target, values, false)
  const others = first.ok ? {} : Object.fromEntries(Object.entries(first.errors).filter(([path]) => !waiting.has(path)))

  if (Object.keys(others).length > 0 || Object.keys(refused).length > 0) return { ok: false, errors: { ...others, ...refused } }

  for (const upload of uploads) upload.keep(await upload.storage.put(upload.file, { field: upload.path, tenant: options.tenant ?? null }))

  return check(target, values, true)
}

export function humanize(key: string): string {
  const words = key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ')

  return words.charAt(0).toUpperCase() + words.slice(1).toLowerCase()
}

/** What a bulk action's toast says: "3 products published." with `done`, else "Publish: 3 products.". */
export function bulkToast(bulk: Pick<BulkAction, 'label' | 'done'>, count: number, noun: string): string {
  return bulk.done ? `${count} ${noun} ${bulk.done}.` : `${bulk.label}: ${count} ${noun}.`
}
