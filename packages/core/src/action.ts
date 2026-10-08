// Server actions with a schema, middleware, and types that follow from both.
//
//     export const action = createActionClient({ onError: report })
//
//     export const createPost = action
//       .use(async ({ next }) => next({ ctx: { user: await currentUser() } }))
//       .input(z.object({ title: z.string().min(3) }))
//       .handler(async ({ input, ctx }) => savePost(ctx.user.id, input.title))
//
// `input` is typed from the schema and `ctx` from every middleware that ran, so
// the handler is checked against both without either being written down twice.
//
// The built action RETURNS its failures rather than throwing them, and that is
// not a style choice. React serialises a rejected server action opaquely —
// production strips the message and leaves a digest — so a thrown validation
// error reaches the browser as "an error occurred" and the fields it named are
// gone. A returned object crosses the boundary intact.
//
// Distinct from `middleware.ts` in a route directory, which decides whether a
// page may render. This wraps one action. They are different questions: an
// action is reachable without any page, which is why it defends itself.

import { validateWith, type StandardSchemaV1 } from './js/standardSchema.js'
import { decodeFormData } from './js/formEncoding.js'
import { markQuery, QueryValidationError, type QueryOptions } from './query.js'
import { isRedirectSignal } from './redirectDigest.js'
import { isNotFoundSignal } from './notFound.js'
import { ServerAuthenticationError, ServerAuthorizationError, type Redirected } from './js/errors.js'

/**
 * What an action answers with. One of `data`, `validationErrors`,
 * `serverError` and `redirected` is set; `refusal` only ever beside
 * `serverError`.
 */
export interface ActionResult<Data, Refusal = never> {
  /** What the handler returned. */
  data?: Data
  /** Field name to messages, in the shape a form already renders. */
  validationErrors?: Record<string, string[]>
  /**
   * The action did not happen, as a message the browser may see: a refusal's
   * own message - see `refuse()` - or something unexpected, reduced by
   * `onError` to one that says nothing a stranger should not see.
   */
  serverError?: string
  /**
   * What a refusal said beside its message - the things blocking a delete,
   * say - checked against the schema the action declared with `.refusal()`
   * and typed from it. Set only by `refuse()`, here or on the backend.
   */
  refusal?: Refusal
  /**
   * Where the action sent the visitor. Set by the client, which has already
   * started the navigation: the page is on its way there, and there is
   * nothing for the caller to do. Never set on the server side of the call.
   */
  redirected?: string
}

/**
 * A middleware that neither continued nor refused.
 *
 * Never reported through `onError`: that reduces an error to a message for the
 * browser, and this one is for whoever wrote the middleware. A check that
 * forgot to call `next()` would otherwise look exactly like a check that
 * passed.
 */
export class ActionMisuse extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ActionMisuse'
  }
}

/** Refuse from inside a handler, naming the fields. */
/**
 * Marks a refusal so it survives a bundle seam.
 *
 * A property rather than `instanceof`, for the reason this project keeps
 * running into: an app's actions are bundled separately from the engine, so
 * each gets its own copy of this module and its own copy of the class.
 * `instanceof` compares identity across that seam and is simply false — and
 * the refusal is then reported as a server error, so the form shows "Something
 * went wrong" instead of naming the fields. Everything works; nothing logs.
 *
 * Symbol.for, so the two copies agree on the key as well as the value.
 */
const VALIDATION_MARK = Symbol.for('@rsc-kit/core.action-validation')

/**
 * Set on every function a client builds, so the build can tell them from a
 * bare "use server" export. The difference is the middleware: a bare export
 * runs with nothing checking who called it, and nothing else in the app
 * would ever say so. Symbol.for, because the build reads the mark from the
 * bundled copy of this module and the app's actions were built by another.
 */
const CLIENT_MARK = Symbol.for('@rsc-kit/core.action-client')

/** Whether a server action was built by createActionClient, and so ran its chain. */
export function isClientBuilt(fn: unknown): boolean {
  return typeof fn === 'function' && (fn as unknown as Record<symbol, unknown>)[CLIENT_MARK] === true
}

function markClientBuilt<F extends Function>(fn: F): F {
  Object.defineProperty(fn, CLIENT_MARK, { value: true })

  return fn
}

export class ActionValidationError extends Error {
  public readonly errors: Record<string, string[]>

  constructor(errors: Record<string, string[]>) {
    super('Validation failed')
    this.name = 'ActionValidationError'
    this.errors = errors
    ;(this as unknown as Record<symbol, boolean>)[VALIDATION_MARK] = true
  }
}

/** Whether this is a refusal, whichever copy of the class built it. */
export function isActionValidationError(error: unknown): error is ActionValidationError {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as Record<symbol, unknown>)[VALIDATION_MARK] === true
  )
}

/**
 * The field errors a handler may report, keyed by its own input's fields.
 *
 * `''` is the whole submission — for a refusal that is about no field in
 * particular, which is where the form already looks for one.
 */
export type FieldErrorsFor<Input> = Partial<
  Record<(Input extends object ? keyof Input & string : string) | '', string | string[]>
>

const REFUSAL_MARK = Symbol.for('@rsc-kit/core.action-refusal')

/**
 * What a handler's data is, without the redirect a generated stub's type adds.
 *
 * A stub is typed `Promise<T | Redirected>` for the browser, where a redirected
 * call resolves with `{ redirected }`. Called from a handler it runs on the
 * server, where the redirect is thrown and travels as one, so its result is
 * only ever `T` - and `data` would say `T | Redirected`, a case the client
 * reports beside `data` and never inside it. Only a member that is exactly
 * `Redirected` goes: data that merely has a `redirected` field stays.
 */
export type Delivered<T> = T extends Redirected ? (Redirected extends T ? never : T) : T

/**
 * An action declining to do what it was asked, on purpose, with a message for
 * the person who asked and - optionally - data the page can act on: the
 * records blocking a delete, the plan a quota belongs to.
 *
 * Not a validation error: the input was fine, the state of things says no.
 * And not a failure: its message is meant to be seen, so it is never
 * replaced by `onError`'s "Something went wrong.". It arrives as the result's
 * `serverError`, which is where a form's `formError` already reads, and its
 * data as `refusal`.
 */
export class ActionRefusal extends Error {
  public readonly data: unknown
  /** The status a request that is not an action - a page, a form posted without javascript - answers with. */
  public readonly refusalStatus: number

  constructor(message: string, data?: unknown, status = 409) {
    super(message)
    this.name = 'ActionRefusal'
    this.data = data
    this.refusalStatus = status
    ;(this as unknown as Record<symbol, boolean>)[REFUSAL_MARK] = true
  }
}

/** Whether this is a refusal, whichever copy of the class built it. */
export function isActionRefusal(error: unknown): error is ActionRefusal {
  return typeof error === 'object' && error !== null && (error as Record<symbol, unknown>)[REFUSAL_MARK] === true
}

/**
 * Decline, with a message to show and optional data to act on. Throws.
 *
 *     if (attached.length) refuse('Still in use', { blockers: attached })
 *
 * From a handler, a middleware or anything they call. The data reaches the
 * page only when the action declares its shape with `.refusal(schema)`, and
 * only once it matches - see ActionResult.refusal. Inside a handler, the
 * `refuse` it is given is typed to that schema; this one takes anything.
 */
export function refuse(message: string, data?: unknown, options: { status?: number } = {}): never {
  throw new ActionRefusal(message, data, options.status)
}

/**
 * What a handler is given.
 *
 * `fieldErrors` is here as well as exported on its own, and the one here is
 * the one to use: it is typed to this handler's input, so a field the schema
 * does not have is a type error rather than an error the form never shows.
 * The bare export takes any string, for the rare check that runs outside a
 * handler.
 */
export interface HandlerArgs<Input, Ctx, Refusal = never> {
  input: Input
  ctx: Ctx
  /**
   * Decline, with a message and the data the action declared with
   * `.refusal(schema)`. Throws; write `return refuse(...)`, as with
   * fieldErrors.
   */
  refuse: [Refusal] extends [never]
    ? (message: string) => never
    : (message: string, data: Refusal, options?: { status?: number }) => never
  /**
   * Fail with errors on this input's fields. Throws; nothing after it runs.
   *
   * Write `return fieldErrors(...)`. It throws either way, but TypeScript does
   * not treat a never-return as terminating when the callee is a destructured
   * binding — only a declaration or an explicitly annotated variable — so
   * without the return, a value checked on the line above is still possibly
   * undefined on the line below. The return is what lets the type narrow.
   */
  fieldErrors: (errors: FieldErrorsFor<Input>) => never
}

/**
 * Fail with field errors the form can show.
 *
 * For what a schema cannot know — a name already taken, a balance too low.
 * Throws, so the handler stops where it is; the action turns it into a
 * returned result on the way out.
 *
 * Untyped by field, because it has no handler to take the input from. Inside
 * one, use the `fieldErrors` the handler is given instead.
 */
export function fieldErrors(errors: Record<string, string[] | string>): never {
  const normalised: Record<string, string[]> = {}

  for (const [field, message] of Object.entries(errors)) {
    normalised[field] = Array.isArray(message) ? message : [message]
  }

  throw new ActionValidationError(normalised)
}

/**
 * What `next()` hands back, carrying what the step added.
 *
 * The context a middleware contributes cannot be inferred from the arguments
 * it passes to `next` — TypeScript infers from a function's return, not from a
 * call inside it. So `next` returns this, the middleware returns it, and the
 * addition is read off the middleware's own return type.
 */
export interface MiddlewareResult<Extra> {
  readonly ctx: Extra
  readonly value: unknown
}

/**
 * A step that runs before the handler.
 *
 * It calls `next` to continue, optionally adding to the context, and what it
 * adds shows up in the handler's types. Returning without calling `next` — or
 * throwing — stops the action, which is how a check refuses.
 */
export type ActionMiddleware<Ctx, Extra extends Record<string, unknown>> = (args: {
  ctx: Ctx
  next: <E extends Record<string, unknown> = Record<string, never>>(
    opts?: { ctx?: E },
  ) => Promise<MiddlewareResult<E>>
}) => Promise<MiddlewareResult<Extra>>

type Output<S> = S extends StandardSchemaV1<unknown, infer O> ? O : never

/** What a caller may pass, before the schema parses it. */
type InputOf<S> = S extends StandardSchemaV1<infer I, unknown> ? I : unknown

/**
 * A built action, as its callers see it.
 *
 * Typed from the schema's input when there is one, so a call with the wrong
 * shape fails the typecheck rather than the validation - and FormData beside
 * it, which is how a form calls the same action. Without a schema, anything.
 */
export type Action<Raw, Data, Refusal = never> = unknown extends Raw
  ? (input?: unknown) => Promise<ActionResult<Data, Refusal>>
  : undefined extends Raw
    ? (input?: Raw | FormData) => Promise<ActionResult<Data, Refusal>>
    : (input: Raw | FormData) => Promise<ActionResult<Data, Refusal>>

export interface ActionBuilder<Ctx extends Record<string, unknown>, Input, Raw = unknown, Refusal = never> {
  /** Add a step, and whatever context it contributes. */
  use<Extra extends Record<string, unknown> = Record<string, never>>(
    middleware: (args: {
      ctx: Ctx
      next: <E extends Record<string, unknown> = Record<string, never>>(
        opts?: { ctx?: E },
      ) => Promise<MiddlewareResult<E>>
    }) => Promise<MiddlewareResult<Extra>>,
  ): ActionBuilder<Ctx & Extra, Input, Raw, Refusal>
  /** Parse and check what the caller sent. The handler's `input` follows. */
  input<S extends StandardSchemaV1>(schema: S): ActionBuilder<Ctx, Output<S>, InputOf<S>, Refusal>
  /**
   * The shape of what a refusal may carry - see `refuse()`. The page gets
   * `result.refusal` typed from it, and only data that matches it: data that
   * does not is a bug in the server, answered as one.
   */
  refusal<S extends StandardSchemaV1>(schema: S): ActionBuilder<Ctx, Input, Raw, Output<S>>
  /**
   * The body.
   *
   * What the caller gets is always the result object: `data`, or a
   * refusal, or - when the action redirected - `redirected`, set by the
   * client once the navigation is under way. Always an object, so a caller
   * reading `result.validationErrors` after a redirect reads undefined and
   * not a TypeError inside a transition, which unmounts the root.
   */
  handler<Data>(
    fn: (args: HandlerArgs<Input, Ctx, Refusal>) => Promise<Data> | Data,
  ): Action<Raw, Delivered<Data>, Refusal>
  /**
   * The body of a READ, sharing this client's middleware and schema.
   *
   *     export const getPosts = client.input(filter).query(async ({ input, ctx }) =>
   *       db.posts(ctx.user.id, input))
   *
   * The same builder as `handler`, and deliberately so: an app configures its
   * auth check and its error reporting once, and both a mutation and a read go
   * through them.
   *
   * It fails differently, though, and that is not an oversight. An action
   * RETURNS its failures because React serialises a rejection opaquely. A query
   * is handed to a cache library as a fetcher, and every one of them reports
   * failure by rejection — so this returns the data directly and throws, and
   * the endpoint carries the message across for it.
   */
  query<Data>(
    fn: (args: { input: Input; ctx: Ctx }) => Promise<Data> | Data,
    options?: QueryOptions,
  ): (input?: unknown) => Promise<Delivered<Data>>
}

export interface ActionClientOptions {
  /**
   * What the browser is told when something unexpected throws.
   *
   * Everything reaching here is a bug or an outage, and its message may say
   * more than a stranger should see — a query, a path, a host. Returning a
   * fixed string is the safe default; return the message only for errors you
   * raised deliberately.
   */
  onError?: (error: unknown) => string
}

const GENERIC = 'Something went wrong.'

/**
 * Whether the backend turned this caller away: not signed in, not allowed, or
 * nothing there for them. Each carries a message written for the person.
 */
function turnedAway(error: unknown): error is Error {
  return (
    error instanceof ServerAuthenticationError || error instanceof ServerAuthorizationError || isNotFoundSignal(error)
  )
}

/**
 * FormData in, a plain object out — what a schema expects to be handed.
 *
 * The form's own decoder, so the object validated here is the object the
 * browser validated. This had a flat decoder of its own: `items[0].name`
 * stayed a key spelled exactly that, `<Form>` had already parsed it into an
 * array, and a nested form passed in the browser and failed on the server
 * with the fields it named gone.
 */
const fromFormData = (body: FormData, schema: unknown): Record<string, unknown> => decodeFormData(body, schema)

export function createActionClient(
  options: ActionClientOptions = {},
): ActionBuilder<Record<never, never>, undefined> {
  const report = options.onError ?? (() => GENERIC)

  function build<Ctx extends Record<string, unknown>, Input>(
    middlewares: ActionMiddleware<never, never>[],
    schema: StandardSchemaV1 | null,
    refusalSchema: StandardSchemaV1 | null = null,
  ): ActionBuilder<Ctx, Input> {
      /**
       * Validate, run the chain, call the body.
       *
       * Shared by both terminals, which is the point of putting a read on this
       * builder at all: one set of middleware, one schema, one place the auth
       * check lives. Refusals leave by throwing, and each terminal decides what
       * that should look like from the outside.
       */
    const pipeline = async (
      raw: unknown,
      fn: (args: HandlerArgs<never, never>) => unknown,
    ): Promise<unknown> => {
      const value = raw instanceof FormData ? fromFormData(raw, schema) : raw

      if (schema) {
        const invalid = await validateWith(schema, value)

        if (invalid) throw new ActionValidationError(invalid)
      }

      const parsed = schema
        ? ((await schema['~standard'].validate(value)).value as Input)
        : (value as Input)

      // Composed inside-out so the first `use` is the outermost — it sees the
      // others run, which is what makes timing and cleanup possible rather
      // than only checks.
      let ctx = {} as Ctx
      let index = 0

      const run = async (): Promise<unknown> => {
        const middleware = middlewares[index++]

        if (!middleware) {
          return await fn({
            input: parsed as never,
            ctx: ctx as never,
            // The same function as the export; the type on the way in is what
            // is different, and the type is the handler's input.
            fieldErrors: fieldErrors as never,
            refuse: refuse as never,
          })
        }

        let continued = false

        const result = await (middleware as unknown as ActionMiddleware<Ctx, Record<string, unknown>>)({
          ctx,
          next: (async (opts?: { ctx?: Record<string, unknown> }) => {
            continued = true
            ctx = { ...ctx, ...(opts?.ctx ?? {}) } as Ctx

            return { ctx, value: await run() }
          }) as never,
        })

        // Silence is not refusal. A middleware that neither called next() nor
        // threw has done nothing, and guessing which it meant turns a
        // forgotten `return` into a check that quietly passes.
        if (!continued) {
          throw new ActionMisuse(
            'A middleware returned without calling next(). Call it to continue, or throw to refuse.',
          )
        }

        return (result as { value?: unknown })?.value
      }

      return await run()
    }

    /**
     * A refusal as the page gets it: its message, always - it was written to
     * be seen - and its data only once the declared schema has checked it.
     * Data with no schema to check it, or that fails the schema, never
     * reaches the browser: the first is said in the server's log, the second
     * is a bug in the server, returned as the error each terminal reports.
     */
    const refusalResult = async (error: ActionRefusal): Promise<ActionResult<never, unknown> | Error> => {
      if (error.data === undefined) return { serverError: error.message }

      if (!refusalSchema) {
        console.error(
          `[rsc-kit] An action refused with data, and declares no .refusal(schema) for it - the message was sent, the data was not: ${error.message}`,
        )

        return { serverError: error.message }
      }

      const checked = await refusalSchema['~standard'].validate(error.data)

      if (checked.issues) {
        return new Error(
          `An action refused with data its .refusal(schema) does not accept: ${checked.issues.map((issue) => issue.message).join('; ')}`,
        )
      }

      return { serverError: error.message, refusal: checked.value }
    }

    return {
      use(middleware) {
        return build([...middlewares, middleware as never], schema, refusalSchema) as never
      },
      input(next) {
        return build(middlewares, next, refusalSchema) as never
      },
      refusal(next) {
        return build(middlewares, schema, next) as never
      },
      handler(fn) {
        // Delivered is a type-only difference from what the body returns:
        // the value is passed through as it is.
        return markClientBuilt(async (raw?: unknown) => {
          try {
            return { data: (await pipeline(raw, fn)) as Awaited<ReturnType<typeof fn>> }
          } catch (error) {
            // Past onError deliberately — see ActionMisuse.
            if (error instanceof ActionMisuse) throw error

            // A redirect is an instruction, not a failure: it has to reach
            // the host, which answers the action with the destination. Caught
            // here it became { serverError: 'Something went wrong.' } - a
            // login that succeeded and then showed an error.
            if (isRedirectSignal(error)) throw error

            if (isActionValidationError(error)) {
              return { validationErrors: error.errors }
            }

            if (isActionRefusal(error)) {
              const refused = await refusalResult(error)

              return (refused instanceof Error ? { serverError: report(refused) } : refused) as ActionResult<never>
            }

            // Turned away by the backend - not signed in, not allowed, no such
            // record - is an answer too, and its message is meant to be seen.
            // Not rethrown as a redirect is: the action endpoint answers a
            // throw with a 500, and the form would show nothing at all.
            if (turnedAway(error)) return { serverError: error.message }

            return { serverError: report(error) }
          }
        }) as never
      },
      query(fn, options) {
        const read = async (raw?: unknown) => {
          try {
            return await pipeline(raw, fn)
          } catch (error) {
            if (error instanceof ActionMisuse) throw error
            if (isRedirectSignal(error)) throw error

            // Left as they are, as a redirect is. A page that reads through a
            // query answers 401, 403 or its not-found page, as it does calling
            // the backend directly; the read endpoint answers the same statuses.
            if (turnedAway(error)) throw error

            // Thrown, not returned. A cache library reports failure by
            // rejection, so a query that answered with an error-shaped object
            // would look like a successful read of something odd.
            if (isActionValidationError(error)) {
              throw new QueryValidationError(error.errors)
            }

            // Its own message, as an action's is, and its checked data on
            // the error for a fetcher that wants it.
            if (isActionRefusal(error)) {
              const refused = await refusalResult(error)

              if (refused instanceof Error) throw new Error(report(refused))

              throw Object.assign(new Error(refused.serverError), {
                refusal: refused.refusal,
                refusalStatus: error.refusalStatus,
              })
            }

            throw new Error(report(error))
          }
        }

        return markClientBuilt(markQuery(read, options)) as (input?: unknown) => Promise<never>
      },
    }
  }

  return build([], null)
}
