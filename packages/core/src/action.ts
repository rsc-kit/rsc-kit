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

/** What an action answers with. Exactly one of the three is set. */
export interface ActionResult<Data> {
  /** What the handler returned. */
  data?: Data
  /** Field name to messages, in the shape a form already renders. */
  validationErrors?: Record<string, string[]>
  /** Something else went wrong, reduced to a message the browser may see. */
  serverError?: string
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
 * Fail with field errors the form can show.
 *
 * For what a schema cannot know — a name already taken, a balance too low.
 * Throws, so the handler stops where it is; the action turns it into a
 * returned result on the way out.
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

export interface ActionBuilder<Ctx extends Record<string, unknown>, Input> {
  /** Add a step, and whatever context it contributes. */
  use<Extra extends Record<string, unknown> = Record<string, never>>(
    middleware: (args: {
      ctx: Ctx
      next: <E extends Record<string, unknown> = Record<string, never>>(
        opts?: { ctx?: E },
      ) => Promise<MiddlewareResult<E>>
    }) => Promise<MiddlewareResult<Extra>>,
  ): ActionBuilder<Ctx & Extra, Input>
  /** Parse and check what the caller sent. The handler's `input` follows. */
  input<S extends StandardSchemaV1>(schema: S): ActionBuilder<Ctx, Output<S>>
  /** The body. */
  handler<Data>(
    fn: (args: { input: Input; ctx: Ctx }) => Promise<Data> | Data,
  ): (input?: unknown) => Promise<ActionResult<Data>>
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

/** FormData in, a plain object out — what a schema expects to be handed. */
function fromFormData(body: FormData): Record<string, unknown> {
  const out: Record<string, unknown> = {}

  for (const key of new Set(body.keys())) {
    const values = body.getAll(key)

    // One value stays a value. Several stay several — a multi-select that
    // collapsed to its last entry would be a silent data loss.
    out[key] = values.length > 1 ? values : values[0]
  }

  return out
}

export function createActionClient(
  options: ActionClientOptions = {},
): ActionBuilder<Record<never, never>, undefined> {
  const report = options.onError ?? (() => GENERIC)

  function build<Ctx extends Record<string, unknown>, Input>(
    middlewares: ActionMiddleware<never, never>[],
    schema: StandardSchemaV1 | null,
  ): ActionBuilder<Ctx, Input> {
    return {
      use(middleware) {
        return build([...middlewares, middleware as never], schema) as never
      },
      input(next) {
        return build(middlewares, next) as never
      },
      handler(fn) {
        return async (raw?: unknown) => {
          try {
            const value = raw instanceof FormData ? fromFormData(raw) : raw

            if (schema) {
              const invalid = await validateWith(schema, value)

              if (invalid) return { validationErrors: invalid }
            }

            const parsed = schema
              ? ((await schema['~standard'].validate(value)).value as Input)
              : (value as Input)

            // Composed inside-out so the first `use` is the outermost — it
            // sees the others run, which is what makes timing and cleanup
            // possible rather than only checks.
            let ctx = {} as Ctx
            let index = 0

            const run = async (): Promise<unknown> => {
              const middleware = middlewares[index++]

              if (!middleware) return await fn({ input: parsed, ctx })

              let continued = false

              const result = await (middleware as unknown as ActionMiddleware<Ctx, Record<string, unknown>>)({
                ctx,
                next: (async (opts?: { ctx?: Record<string, unknown> }) => {
                  continued = true
                  ctx = { ...ctx, ...(opts?.ctx ?? {}) } as Ctx

                  return { ctx, value: await run() }
                }) as never,
              })

              // Silence is not refusal. A middleware that neither called
              // next() nor threw has done nothing, and guessing which it meant
              // turns a forgotten `return` into a check that quietly passes.
              if (!continued) {
                throw new ActionMisuse(
                  'A middleware returned without calling next(). Call it to continue, or throw to refuse.',
                )
              }

              return (result as { value?: unknown })?.value
            }

            return { data: (await run()) as Awaited<ReturnType<typeof fn>> }
          } catch (error) {
            // Past onError deliberately — see ActionMisuse.
            if (error instanceof ActionMisuse) throw error

            if (isActionValidationError(error)) {
              return { validationErrors: error.errors }
            }

            return { serverError: report(error) }
          }
        }
      },
    }
  }

  return build([], null)
}
