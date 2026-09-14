// Hand-written Standard Schemas, so the fixture needs no validation library.
const schema = <T,>(check: (v: any) => { value: T } | { issues: { message: string; path: string[] }[] }) => ({
  '~standard': { version: 1 as const, vendor: 'fixture', validate: check },
})

export const params = schema<{ id: number }>((v) => {
  const id = Number(v.id)

  return Number.isInteger(id) && id > 0
    ? { value: { id } }
    : { issues: [{ message: 'must be a positive integer', path: ['id'] }] }
})

export const searchParams = schema<{ limit: number }>((v) => {
  const limit = v.limit === undefined ? 20 : Number(v.limit)

  return Number.isInteger(limit) && limit > 0
    ? { value: { limit } }
    : { issues: [{ message: 'must be a positive integer', path: ['limit'] }] }
})

export const body = schema<{ title: string }>((v) =>
  typeof v?.title === 'string' && v.title.length > 0
    ? { value: { title: v.title } }
    : { issues: [{ message: 'is required', path: ['title'] }] },
)

export async function GET(_request: Request, { params, searchParams }: any) {
  // Arithmetic, so a string that merely printed the same would not pass.
  return Response.json({ id: params.id + 1, limit: searchParams.limit + 1 })
}

export async function POST(_request: Request, { params, body }: any) {
  return Response.json({ id: params.id, title: body.title.toUpperCase() }, { status: 201 })
}
