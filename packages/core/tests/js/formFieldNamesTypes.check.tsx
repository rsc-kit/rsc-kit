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
import Form, { type FieldNamesOf, type FormFields } from '../../src/js/Form'

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

// A struct first, and the optional parameters Go lets a caller leave out.
declare namespace RscHost2 {
  interface NewApp { name: string; region: string }
  interface Options { dryRun: boolean }
}
declare function appsCreate(arg1: RscHost2.NewApp, arg2?: RscHost2.Options | null): Promise<{ id: string } | { redirected: string }>
declare function appsCreate(form: FormData): Promise<{ id: string } | { redirected: string }>

export const trailing = (
  <Form action={appsCreate}>
    {({ error }) => {
      // @ts-expect-error a typo, with an optional parameter after the struct
      error('regoin')

      return error('region')
    }}
  </Form>
)

// A wrapper the app writes, around a stub whose parameters are plain strings.
// It declares its fields on its own parameter, where the code that reads them is.
declare function appsRename(id: string, name: string): Promise<void>

async function renameApp(form: FormFields<'id' | 'name'>) {
  await appsRename(String(form.get('id')), String(form.get('name')))
}

export const wrapper = (
  <Form action={renameApp}>
    {({ error, clearErrors }) => {
      // @ts-expect-error the wrapper declared id and name
      error('nmae')
      clearErrors('id')
      // @ts-expect-error closed for clearErrors too
      clearErrors('namee')

      return error('name') ?? error('id')
    }}
  </Form>
)

// The form's own declared values are names too, beside the wrapper's.
export const wrapperAndDefaults = (
  <Form action={renameApp} defaultValues={{ note: '' }}>
    {({ error }) => {
      // @ts-expect-error neither declared nor defaulted
      error('nope')

      return error('note') ?? error('name')
    }}
  </Form>
)

// A wrapper that says nothing - a plain FormData - is open, as it always was.
async function untypedWrapper(form: FormData) {
  await appsRename(String(form.get('id')), String(form.get('name')))
}

export const stillOpen = <Form action={untypedWrapper}>{({ error }) => error('any.name')}</Form>

// The same names, for a component below the form.
export const declaredNames: FieldNamesOf<typeof renameApp> = 'name'
// @ts-expect-error not one the wrapper declared
export const wrongDeclared: FieldNamesOf<typeof renameApp> = 'nmae'

// A FormFields is still a FormData: the wrapper reads it like one.
export const readsLikeFormData = async (form: FormFields<'a'>) => form.get('a')

// A team-scoped action: `func(ctx, team string, in NewApp)`. The generated stub
// ends with the overload a bound form uses, so `stub.bind(null, team)` keeps the
// struct's field names - the form lands on the parameter after the team.
declare namespace RscHost3 {
  interface NewApp { name: string; replicas: number; repo: { url: string } }
}
declare function teamAppsCreate(arg1: string, arg2: RscHost3.NewApp): Promise<string | { redirected: string }>
declare function teamAppsCreate(
  arg1: string,
  form: FormFields<'name' | 'replicas' | 'repo' | 'repo.url'>,
): Promise<string | { redirected: string }>

const boundCreate = teamAppsCreate.bind(null, 'team-1')

export const bound = (
  <Form action={boundCreate}>
    {({ error, clearErrors }) => {
      // @ts-expect-error a typo, through a stub with a team bound
      error('nmae')
      clearErrors('replicas')

      return error('repo.url') ?? error('name')
    }}
  </Form>
)

// Bound where it is used, TypeScript reads `bind`'s result before the form's
// render function is known and the names are not carried: the form compiles and
// is open, as it always was. Bind once, as above, to have them closed.
export const boundInline = (
  <Form action={teamAppsCreate.bind(null, 'team-1')}>{({ error }) => error('anything')}</Form>
)

// A form that posts nothing - its values live in React state - has no FormData to
// declare names on. They are named on the form.
const resize = async (_: FormData) => {}

export const nothingPosted = (
  <Form action={resize} fields={['size', 'copies']}>
    {({ error, clearErrors }) => {
      // @ts-expect-error neither named nor defaulted
      error('sise')
      clearErrors('copies')

      return error('size')
    }}
  </Form>
)

// Beside defaultValues and the action's own names, not instead of them.
export const fieldsAndDefaults = (
  <Form action={signUp} defaultValues={{ note: '' }} fields={['coupon']}>
    {({ error }) => {
      // @ts-expect-error not named anywhere
      error('emial')

      return error('coupon') ?? error('note') ?? error('email')
    }}
  </Form>
)
