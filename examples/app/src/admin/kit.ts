/**
 * A resource, described once: what its table shows, what its form takes, and
 * where its rows come from. The admin routes under src/app/admin render every
 * resource from this - nothing per resource is written as a page.
 *
 * The form is a schema, not a list of widgets: the same object validates the
 * save on the server and is read here for the fields it has, so a field cannot
 * be on the form and missing from the check, or the other way round.
 */
import * as z from 'zod'

export type Format = 'text' | 'money' | 'badge' | 'boolean'

export interface Column {
  key: string
  label: string
  format: Format
  sortable: boolean
  searchable: boolean
}

/** A column, chained the way Filament's are: text('name').searchable().sortable(). */
export class ColumnBuilder {
  constructor(private readonly column: Column) {}

  sortable(): this {
    this.column.sortable = true
    return this
  }

  searchable(): this {
    this.column.searchable = true
    return this
  }

  label(label: string): this {
    this.column.label = label
    return this
  }

  build(): Column {
    return { ...this.column }
  }
}

/** The column helpers, typed to the row so a misspelt key fails the typecheck. */
export interface Columns<Row> {
  text(key: keyof Row & string): ColumnBuilder
  money(key: keyof Row & string): ColumnBuilder
  badge(key: keyof Row & string): ColumnBuilder
  boolean(key: keyof Row & string): ColumnBuilder
}

function columns<Row>(): Columns<Row> {
  const make = (format: Format) => (key: string) =>
    new ColumnBuilder({ key, label: humanize(key), format, sortable: false, searchable: false })

  return { text: make('text'), money: make('money'), badge: make('badge'), boolean: make('boolean') }
}

export type FieldType = 'text' | 'textarea' | 'number' | 'select' | 'toggle'

/** What the form renders. Plain data: it crosses to the client component. */
export interface Field {
  name: string
  label: string
  type: FieldType
  required: boolean
  options?: string[]
}

export interface Filter {
  key: string
  label: string
  options: string[]
}

export interface ListQuery {
  q?: string
  sort?: string
  dir: 'asc' | 'desc'
  page: number
  perPage: number
  filters: Record<string, string>
  searchable: string[]
}

/** Where a resource's rows live. memorySource below; a database adapter is the same five functions. */
export interface DataSource<Row, Values> {
  list(query: ListQuery): Promise<{ rows: Row[]; total: number }>
  find(id: string): Promise<Row | null>
  create(values: Values): Promise<Row>
  update(id: string, values: Values): Promise<Row>
  delete(id: string): Promise<void>
}

export interface Resource<Row = any, Schema extends z.ZodObject = z.ZodObject> {
  name: string
  label: string
  singular: string
  key: keyof Row & string
  title: keyof Row & string
  source: DataSource<Row, z.infer<Schema>>
  columns: Column[]
  filters: Filter[]
  schema: Schema
  fields: Field[]
  perPage: number
}

interface Definition<Row, Schema extends z.ZodObject> {
  name: string
  label?: string
  singular?: string
  key: keyof Row & string
  title: keyof Row & string
  source: DataSource<Row, z.infer<Schema>>
  table: (col: Columns<Row>) => ColumnBuilder[]
  filters?: (keyof Row & string)[]
  form: Schema
  /** Only what the schema cannot say: a long string is a textarea. */
  fields?: Partial<Record<keyof z.infer<Schema> & string, Partial<Pick<Field, 'type' | 'label'>>>>
  perPage?: number
}

/**
 * Two calls so the row is named and the schema is inferred:
 * defineResource<Product>()({ ... }).
 */
export function defineResource<Row>() {
  return <Schema extends z.ZodObject>(definition: Definition<Row, Schema>): Resource<Row, Schema> => {
    const fields = fieldsOf(definition.form, definition.fields ?? {})

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
    }
  }
}

/** The fields a schema describes, unwrapping optional and default to find the type. */
function fieldsOf(schema: z.ZodObject, overrides: Record<string, Partial<Pick<Field, 'type' | 'label'>> | undefined>): Field[] {
  return Object.entries(schema.shape).map(([name, outer]) => {
    let inner = outer as z.ZodType
    let required = true

    while (['optional', 'default', 'nullable'].includes(inner.def.type)) {
      required = false
      inner = (inner.def as unknown as { innerType: z.ZodType }).innerType
    }

    const type: FieldType =
      inner.def.type === 'number' ? 'number'
        : inner.def.type === 'enum' ? 'select'
          : inner.def.type === 'boolean' ? 'toggle'
            : 'text'

    return {
      name,
      label: humanize(name),
      type,
      required,
      ...(type === 'select' ? { options: (inner as z.ZodEnum).options.map(String) } : {}),
      ...overrides[name],
    }
  })
}

/**
 * A form's values as the schema expects them. A checkbox that is off is not
 * in FormData at all, so a toggle is whether its name arrived.
 */
export function valuesFrom(resource: Resource, form: FormData): Record<string, unknown> {
  return Object.fromEntries(
    resource.fields.map((field) => [field.name, field.type === 'toggle' ? form.has(field.name) : (form.get(field.name) ?? undefined)]),
  )
}

/** Rows held in memory: searched, filtered, sorted and paged the way a database adapter would. */
export function memorySource<Row extends object, Values>(
  rows: Row[],
  key: keyof Row & string,
  make: (id: number, values: Values) => Row,
): DataSource<Row, Values> {
  let next = rows.length + 1
  const get = (row: Row, name: string) => (row as Record<string, unknown>)[name]

  return {
    async list({ q, sort, dir, page, perPage, filters, searchable }) {
      let found = rows.filter((row) => Object.entries(filters).every(([name, value]) => !value || String(get(row, name)) === value))

      if (q) {
        const needle = q.toLowerCase()
        found = found.filter((row) => searchable.some((name) => String(get(row, name)).toLowerCase().includes(needle)))
      }

      if (sort) {
        found = [...found].sort((a, b) => {
          const [x, y] = [get(a, sort) as number, get(b, sort) as number]
          const order = x > y ? 1 : x < y ? -1 : 0
          return dir === 'desc' ? -order : order
        })
      }

      return { rows: found.slice((page - 1) * perPage, page * perPage), total: found.length }
    },
    async find(id) {
      return rows.find((row) => String(get(row, key)) === id) ?? null
    },
    async create(values) {
      const row = make(next++, values)
      rows.push(row)
      return row
    },
    async update(id, values) {
      const at = rows.findIndex((row) => String(get(row, key)) === id)
      rows[at] = { ...rows[at]!, ...values }
      return rows[at]!
    },
    async delete(id) {
      const at = rows.findIndex((row) => String(get(row, key)) === id)
      if (at !== -1) rows.splice(at, 1)
    },
  }
}

function humanize(key: string): string {
  const words = key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ')
  return words.charAt(0).toUpperCase() + words.slice(1).toLowerCase()
}
