import type { PageProps } from '../../../../../../src/routeSchema'

// A hand-written Standard Schema, so the fixture needs no validation library.
// The contract is the whole interface: a validate() that answers with a value
// or with issues.
const schema = <T,>(check: (value: any) => { value: T } | { issues: { message: string; path: string[] }[] }) => ({
  '~standard': { version: 1 as const, vendor: 'fixture', validate: check },
})

export const params = schema<{ id: number }>((value) => {
  const id = Number(value.id)

  return Number.isInteger(id) && id > 0
    ? { value: { id } }
    : { issues: [{ message: 'must be a positive integer', path: ['id'] }] }
})

export const searchParams = schema<{ page: number }>((value) => {
  const page = value.page === undefined ? 1 : Number(value.page)

  return Number.isInteger(page) && page > 0
    ? { value: { page } }
    : { issues: [{ message: 'must be a positive integer', path: ['page'] }] }
})

export default async function TypedPage({ params: p, searchParams: s }: PageProps<typeof params, typeof searchParams>) {
  const { id } = await p
  const { page } = await s

  // Rendered as numbers on purpose: a string would still print the same, so
  // the test asserts on arithmetic the schema had to have done.
  return (
    <main>
      <p id="typed">{`id+1=${id + 1} page+1=${page + 1}`}</p>
    </main>
  )
}
