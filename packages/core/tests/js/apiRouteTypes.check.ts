/**
 * An api route's context, checked by the typechecker.
 *
 * What it pins: `params` is a promise however it is typed, so the sync read
 * that shipped a route answering 404 to everything is a compile error; a
 * named route types its params from its segments and refuses a pattern the
 * build did not find; a schema types them from its output.
 *
 * `bun run typecheck` is what runs it, in the program routeTypes.tsconfig
 * defines, where RegisterApi is augmented with two routes.
 */
import { z } from 'zod'
import type { RouteContext, RouteHandler } from '../../src/routeSchema'

export async function fromThePattern(_request: Request, { params }: RouteContext<'/api/orders/[id]'>) {
  const { id } = await params
  const asString: string = id

  // @ts-expect-error a segment the pattern does not bind
  const { slug } = await params

  // @ts-expect-error not awaited: params is a promise, not the record
  const sync: string = params.id

  return Response.json({ asString, slug, sync })
}

// @ts-expect-error a route the build did not find
export const typo: RouteHandler<'/api/order/[id]'> = async () => new Response()

export const catchAll = async (_r: Request, { params }: RouteContext<'/docs/[...path]'>) => {
  // A catch-all is one string, slashes kept.
  const { path } = await params
  const p: string = path

  return new Response(p)
}

const idSchema = z.object({ id: z.coerce.number() })

export async function fromASchema(_request: Request, { params, searchParams, body }: RouteContext<typeof idSchema, typeof idSchema, typeof idSchema>) {
  const n: number = (await params).id
  const q: number = (await searchParams).id
  const b: number = (await body).id

  return Response.json({ n, q, b })
}

export async function bare(_request: Request, { params, searchParams, body }: RouteContext) {
  const raw: Record<string, string> = await params
  const query: URLSearchParams = await searchParams
  // A GET has no body; the type says it may be absent.
  const maybe: unknown = body === undefined ? undefined : await body

  return Response.json({ raw, query: query.toString(), maybe })
}

export const asAHandler: RouteHandler<'/api/orders/[id]'> = async (_request, { params }) => {
  const { id } = await params

  return Response.json({ id })
}
