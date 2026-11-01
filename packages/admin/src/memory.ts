import type { DataSource } from './resource.js'

/**
 * Rows held in memory, searched, filtered, sorted and paged the way a database
 * adapter would. For a prototype, a demo or a test: the rows last as long as
 * the process.
 */
export function memorySource<Row extends object, Values>(
  rows: Row[],
  key: keyof Row & string,
  make: (id: number, values: Values) => Row,
): DataSource<Row, Values> {
  let next = rows.length + 1
  const get = (row: Row, name: string) => (row as Record<string, unknown>)[name]
  const at = (id: string) => rows.findIndex((row) => String(get(row, key)) === id)

  return {
    async list({ q, sort, dir, page, perPage, filters, searchable }) {
      let found = rows.filter((row) => Object.entries(filters).every(([name, value]) => String(get(row, name)) === value))

      if (q) {
        const needle = q.toLowerCase()

        found = found.filter((row) => searchable.some((name) => String(get(row, name) ?? '').toLowerCase().includes(needle)))
      }

      if (sort) {
        found = [...found].sort((a, b) => {
          const [x, y] = [get(a, sort), get(b, sort)]
          const order = typeof x === 'number' && typeof y === 'number' ? x - y : String(x ?? '').localeCompare(String(y ?? ''))

          return dir === 'desc' ? -order : order
        })
      }

      if (perPage === null) return { rows: found, total: found.length }

      return { rows: found.slice((page - 1) * perPage, page * perPage), total: found.length }
    },
    async find(id) {
      return rows[at(id)] ?? null
    },
    async create(values) {
      const row = make(next++, values)

      rows.push(row)

      return row
    },
    async update(id, values) {
      const index = at(id)

      if (index === -1) throw new Error(`[admin] no row ${id} to update`)

      rows[index] = { ...rows[index]!, ...values }

      return rows[index]!
    },
    async delete(id) {
      const index = at(id)

      if (index !== -1) rows.splice(index, 1)
    },
  }
}
