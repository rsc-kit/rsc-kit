/**
 * <Form>'s error() and clearErrors(), typed from the action's input - checked by
 * the typechecker, not at runtime. `bun run typecheck` runs it.
 *
 * `error('nmae')` compiled and showed nothing, ever. The names are read off the
 * action: a generated stub's typed overload (the manifest already carries the
 * backend's field names, so no adapter writes anything more), or the input of an
 * action built on the client. Open, as before, when the action says nothing.
 */
import { z } from 'zod'
import { createActionClient } from '../../src/action'
import Form, { type FieldNamesOf } from '../../src/js/Form'

// What the build writes for `func CreateOrder(in NewOrder) (Created, error)`.
declare namespace RscHost {
  interface NewOrder {
    name: string
    qty: number
    address: { city: string; tags: string[] }
    items: { sku: string }[]
  }
}
declare function ordersCreate(arg1: RscHost.NewOrder): Promise<{ created: string } | { redirected: string }>
declare function ordersCreate(form: FormData): Promise<{ created: string } | { redirected: string }>

export const stub = (
  <Form action={ordersCreate}>
    {({ error, clearErrors }) => {
      const names = [error('name'), error('qty'), error('address.city'), error('address.tags.0'), error('items.0.sku')]

      // @ts-expect-error a typo: nothing is named that
      error('nmae')
      // @ts-expect-error a nested typo
      error('address.cty')
      // @ts-expect-error a path through a list wants an index
      error('items.sku')

      clearErrors('name', 'items.2.sku')
      // @ts-expect-error clearErrors is closed too
      clearErrors('nmae')

      return String(names.length)
    }}
  </Form>
)

const action = createActionClient()
const signUp = action.input(z.object({ email: z.string(), plan: z.enum(['free', 'pro']) })).handler(async () => 'ok')

export const client = (
  <Form action={signUp}>
    {({ error }) => {
      // @ts-expect-error not an input of signUp
      error('emial')

      return error('email') ?? error('plan')
    }}
  </Form>
)

// A field the form itself declares is a name too, even if the action does not take it.
export const declared = (
  <Form action={signUp} defaultValues={{ email: '', confirm: '' }}>
    {({ error }) => error('confirm') ?? error('email')}
  </Form>
)

// Nothing is claimed when the action says nothing: a function of a FormData, or a url.
const untyped = async (_: FormData) => {}

export const plain = (
  <Form action={untyped}>{({ error }) => error('anything.at.all')}</Form>
)

export const url = <Form action="/search">{({ error }) => error('q')}</Form>

// For a component below the form to type its own props.
export const names: FieldNamesOf<typeof ordersCreate> = 'address.city'
// @ts-expect-error not an input of ordersCreate
export const wrongName: FieldNamesOf<typeof ordersCreate> = 'nmae'
export const anyName: FieldNamesOf<typeof untyped> = 'whatever'

// A cast to get past a mismatched action type says nothing about the input.
declare const cast: never
declare const anything: any

export const casted = <Form action={cast}>{({ error }) => error('whatever')}</Form>
export const anyAction = <Form action={anything}>{({ error }) => error('whatever')}</Form>
