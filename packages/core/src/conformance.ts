#!/usr/bin/env node
// The contract every backend adapter keeps, as a suite it runs against itself.
//
// A backend answers rpc(), actions and guards over one endpoint, and every
// difference between how it and the engine read that wire is a bug in an
// app that nobody wrote: a nil slice arriving as null where the type said a
// list, a timestamp the type called unknown, a refusal that did not come out
// as the error a page checks for. Each was found by an app, one at a time.
// This finds them before an adapter ships.
//
// The adapter registers the Conformance.* functions described in CASES, in
// its own language, the way an app would write them; this calls them through
// the real client and checks what arrives. Where the adapter's manifest types
// a function, every value it sends is checked against that type too.
//
//     HOMEPORT_PURGE_URL=http://127.0.0.1:8790/ <start the adapter>
//     rsc-kit-conformance --endpoint http://127.0.0.1:8080/__rsc/host-call \
//       --secret test-secret --manifest rsc-host.json --purge-port 8790
//
// --purge-port is where the suite listens for the adapter's purges: a change
// a backend makes never passes through the engine, so the backend tells a
// CDN keeping its pages itself. Start the adapter with HOMEPORT_PURGE_URL
// pointing at that port.
//
// The test host's hostReply passes the same suite (conformance.test.ts), so
// a page test faking the backend fakes what a real adapter does.

import { readFileSync } from 'node:fs'
import { argv, exit, stderr, stdout } from 'node:process'
import { pathToFileURL } from 'node:url'
import { httpHostCalls } from './hostCalls.js'
import { formInputs } from './hostInputs.js'
import { isNotFoundSignal } from './notFound.js'
import { isActionRefusal } from './action.js'
import { withRedirect } from './redirect.js'
import { withRequest, withResponseDraft } from './request.js'
import { FLASH_COOKIE, readFlash } from './flashCookie.js'
import { ServerAuthenticationError, ServerAuthorizationError } from './js/errors.js'

type Schema = Record<string, unknown>

/** A host-call client: the real one in a run, the test host's in core's own test. */
export type ConformanceCall = (name: string, ...args: unknown[]) => Promise<unknown>

export interface ConformanceOptions {
  /** The adapter's host-call endpoint, e.g. http://127.0.0.1:8080/__rsc/host-call. */
  endpoint: string
  /** The secret the adapter checks. */
  secret: string
  /** The adapter's rsc-host.json, parsed or as a path: its types are checked against what arrives. */
  manifest?:
    | string
    | { actions?: unknown; functions?: string[]; types?: Record<string, { params?: Schema[]; result?: Schema }>; defs?: Record<string, Schema> }
  /** For a test: the fetch the client uses. */
  fetch?: typeof fetch
  /** The port to hear the adapter's purges on: it was started with HOMEPORT_PURGE_URL=http://127.0.0.1:<port>/. */
  purgePort?: number
}

/** A purge as it arrived: what an adapter posted to HOMEPORT_PURGE_URL. */
export interface ArrivedPurge {
  method: string
  contentType: string | null
  body: string
}

/**
 * Where the suite hears purges. The suite hands it a handler, called for every
 * purge before it is answered - so the suite can look at the versions while the
 * adapter is still waiting, and see whether the purge followed the change.
 */
export type PurgeInbox = (handler: (purge: ArrivedPurge) => Promise<void>) => void

export interface ConformanceResult {
  case: string
  ok: boolean
  /** What went wrong, when it did. */
  detail?: string
}

/**
 * What the adapter registers, and what each must do. Names are fixed; how
 * they are written is the adapter's - the point is that they are written the
 * way an app's would be, with the adapter's ordinary API.
 */
export const CASES = {
  'Conformance.echo': 'Return its one argument unchanged: any JSON value, nested.',
  'Conformance.emptyList': 'Return an empty list of objects, the way the language makes "no rows" (Go: a nil slice).',
  'Conformance.time': "Return the instant 2026-01-02T03:04:05Z as the language's own time value.",
  'Conformance.noTime': "Return an absent time: a nil pointer, a null Carbon, typed as a time or nothing.",
  'Conformance.unauthenticated': 'Refuse as not signed in, the way the framework does.',
  'Conformance.unauthorized': 'Refuse as signed in but not allowed.',
  'Conformance.notFound': "Refuse as not found (404), the way the framework does: Go's Refuse(404), Laravel's abort(404).",
  'Conformance.refuse': 'Refuse with status 429 and the message "Slow down."',
  'Conformance.refuseWithData':
    'Refuse with status 409, the message "Still in use", and the data { blockers: [{ id: 7, href: "/orders/7" }] } - ' +
    "the adapter's own refuse, carrying data for the page to act on.",
  'Conformance.invalid': 'Refuse the input: a validation error on the field "name".',
  'Conformance.form':
    'Take one object, described the way an app describes a form (a FormRequest, a struct with validate tags), of these ' +
    'fields in this order: name, required, at least 2 characters; email, required, an email address; topic, required, ' +
    'one of sales or support. Refuse the email taken@example.com on the field "email", and otherwise return its name.',
  'Conformance.redirect': 'Send the visitor to /login.',
  'Conformance.revalidate': 'Mark the region "orders" stale, and return "ok".',
  'Conformance.fail': 'Fail unexpectedly: an ordinary error, not a refusal.',
  'Conformance.authorization': "Return the request's Authorization header, as the renderer forwarded it.",
  'Conformance.cookie': "Return the request's Cookie header, as the renderer forwarded it.",
  'Conformance.login': 'Set a cookie named "conformance_login" on the response, the way a login sets its session cookie, and return "ok".',
  'Conformance.flash':
    'Leave the one-time message "Saved." of kind "success" for the next page - the adapter\'s flash, which @rsc-kit/core/useFlash shows - and return "ok".',
  'Conformance.double': 'Take one integer and return it doubled. Arguments that do not fit - a string, none - fail it: a 500, not a refusal.',
  'Conformance.invalidNested': 'Refuse the input with errors on the nested field "address.city" and on the form itself, under "".',
  '__rsc.middleware':
    'Guards, run in the order named, stopping at the first that does not pass - none at all passes: "conformance-allow" passes; ' +
    '"conformance-deny" refuses; "conformance-redirect" sends the visitor to /conformance-login; a name with no guard refuses.',
  'Conformance.change': 'Say the name "conformance:changed" changed, the way the adapter does from a webhook, and return "ok".',
  '__rsc.changed':
    'Given { since: { name: version }, wait }: answer { versions } with every name whose version differs from since now, ' +
    'and no other. A name never changed is at 0. A change moves a version to the larger of one past it and the time in ' +
    'ms - never + 1 alone. May hold the call up to wait ms for one to differ; may answer at once.',
} as const

const INSTANT = Date.parse('2026-01-02T03:04:05Z')

/** Two JSON values alike, whatever order an object's keys were written in. */
function sameValue(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((item, i) => sameValue(item, b[i]))
  }

  if (typeof a === 'object' && a !== null && typeof b === 'object' && b !== null) {
    const keys = Object.keys(a)

    return (
      keys.length === Object.keys(b).length &&
      keys.every((key) => sameValue((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]))
    )
  }

  return a === b
}

const ECHOES: unknown[] = [null, 0, -1.5, 'héllo ✓ "quoted"', [1, 'a', null], { a: { b: [true, false] }, c: '' }]

/**
 * Run the suite against a client. Every case runs; none stops another.
 *
 * `revalidated` is where the client records what each call marked stale -
 * its onRevalidate - so the revalidation case can read it.
 */
export async function conformance(
  call: ConformanceCall,
  options: {
    revalidated: string[][]
    manifest?: ConformanceOptions['manifest']
    wrongSecret?: ConformanceCall
    /**
     * A POST straight to the endpoint, for what the client never sends:
     * malformed bodies, an oversized batch, no secret at all. `secret: false`
     * leaves the header off.
     */
    raw?: (body: string, options?: { secret?: boolean }) => Promise<Response>
    /** Where the adapter's purges arrive. Without one, the purge cases fail: every adapter purges. */
    purges?: PurgeInbox
  },
): Promise<ConformanceResult[]> {
  const { revalidated, manifest, wrongSecret, raw, purges } = options
  const results: ConformanceResult[] = []
  const types = typeof manifest === 'string' ? JSON.parse(readFileSync(manifest, 'utf-8')) : manifest

  const check = async (name: string, run: () => Promise<void>) => {
    try {
      await run()
      results.push({ case: name, ok: true })
    } catch (error) {
      results.push({ case: name, ok: false, detail: error instanceof Error ? error.message : String(error) })
    }
  }

  const expect = (ok: boolean, detail: string) => {
    if (!ok) throw new Error(detail)
  }

  const rejection = async (run: () => Promise<unknown>): Promise<unknown> => {
    try {
      const value = await run()

      throw new Error('answered ' + JSON.stringify(value) + ' instead of refusing')
    } catch (error) {
      return error
    }
  }

  /** The value against the type the adapter's manifest declares, when it declares one. */
  const typed = (name: string, value: unknown) => {
    const schema = types?.types?.[name]?.result

    if (!schema) return

    const problem = conformsTo(value, schema, types?.defs ?? {}, 'result')

    expect(problem === null, `the manifest types ${name}'s result, and what arrived does not fit it: ${problem}`)
  }

  await check('the manifest lists every Conformance function', async () => {
    if (!types) return

    const missing = Object.keys(CASES).filter((n) => !n.startsWith('__') && !types.functions?.includes(n))

    expect(missing.length === 0, 'not in functions: ' + missing.join(', '))
  })

  await check('the manifest\'s actions is an object, even with none', async () => {
    if (!types) return

    expect(
      typeof types.actions === 'object' && types.actions !== null && !Array.isArray(types.actions),
      'actions is ' + JSON.stringify(types.actions),
    )
  })

  await check('a value of any JSON shape comes back unchanged', async () => {
    for (const value of ECHOES) {
      const back = await call('Conformance.echo', value)

      expect(JSON.stringify(back) === JSON.stringify(value), `sent ${JSON.stringify(value)}, got ${JSON.stringify(back)}`)
    }
  })

  await check('"no rows" is an empty list, never null', async () => {
    const value = await call('Conformance.emptyList')

    expect(Array.isArray(value) && value.length === 0, 'got ' + JSON.stringify(value))
    typed('Conformance.emptyList', value)
  })

  await check('a time is an ISO 8601 string of the same instant', async () => {
    const value = await call('Conformance.time')

    expect(typeof value === 'string' && Date.parse(value) === INSTANT, 'got ' + JSON.stringify(value))
    typed('Conformance.time', value)
  })

  await check('an absent time is null', async () => {
    const value = await call('Conformance.noTime')

    expect(value === null, 'got ' + JSON.stringify(value))
    typed('Conformance.noTime', value)
  })

  await check('not signed in is the engine\'s ServerAuthenticationError', async () => {
    const error = await rejection(() => call('Conformance.unauthenticated'))

    expect(error instanceof ServerAuthenticationError, 'got ' + String(error))
  })

  await check('not allowed is the engine\'s ServerAuthorizationError', async () => {
    const error = await rejection(() => call('Conformance.unauthorized'))

    expect(error instanceof ServerAuthorizationError, 'got ' + String(error))
  })

  await check('not found is the engine\'s notFound()', async () => {
    const error = await rejection(() => call('Conformance.notFound'))

    expect(isNotFoundSignal(error), 'got ' + String(error))
  })

  await check('a refusal keeps its status and its message', async () => {
    const error = (await rejection(() => call('Conformance.refuse'))) as Error & { refusalStatus?: number }

    // A refusal, not a failure: an action shows its message rather than
    // onError's, data or no data.
    expect(isActionRefusal(error), 'raised as ' + String(error) + ', not as a refusal - is refusalStatus in the reply?')
    expect(error.refusalStatus === 429, 'status ' + String(error.refusalStatus))
    expect(String(error.message).includes('Slow down.'), 'message ' + JSON.stringify(error.message))
  })

  await check('a refusal carries its data, its message and its status', async () => {
    const error = (await rejection(() => call('Conformance.refuseWithData'))) as Error & {
      refusalStatus?: number
      data?: unknown
    }

    expect(isActionRefusal(error), 'raised as ' + String(error) + ', not as a refusal - is refusalData in the reply?')
    expect(error.message === 'Still in use', 'message ' + JSON.stringify(error.message))
    expect(error.refusalStatus === 409, 'status ' + String(error.refusalStatus))
    // Compared as values, not as text: an object's keys have no order, and
    // Go writes a map's sorted.
    expect(
      sameValue(error.data, { blockers: [{ id: 7, href: '/orders/7' }] }),
      'data ' + JSON.stringify(error.data),
    )
  })

  await check('refused input names its field', async () => {
    const error = (await rejection(() => call('Conformance.invalid'))) as { errors?: Record<string, string[]> }

    expect(Array.isArray(error.errors?.name) && error.errors.name.length > 0, 'errors ' + JSON.stringify(error.errors))
  })

  await check('a form function arrives as one object, and a refusal lands on its field', async () => {
    const values = { name: 'Ada', email: 'ada@example.com', topic: 'sales' }

    expect((await call('Conformance.form', values)) === 'Ada', 'the values did not arrive as one object')

    const error = (await rejection(() => call('Conformance.form', { ...values, email: 'taken@example.com' }))) as {
      errors?: Record<string, string[]>
    }

    expect(Array.isArray(error.errors?.email) && error.errors.email.length > 0, 'errors ' + JSON.stringify(error.errors))
  })

  // Through what the build uses, so a form draws what this passed.
  await check('the manifest describes a form function so a form can be drawn from it', async () => {
    if (!types) return

    const signatures = Object.fromEntries(Object.entries((types.types ?? {}) as Record<string, { params?: Schema[] }>).map(([name, sig]) => [name, { params: sig.params ?? [] }]))
    const input = formInputs(signatures, (types.defs ?? {}) as Record<string, Schema>)['Conformance.form']

    expect(input !== undefined, 'Conformance.form is not typed as one object with named fields')

    const fields = input!.properties as Record<string, Schema>
    const named = Object.keys(fields).join(', ')

    // A language whose schemas are maps writes them sorted: x-order says the order.
    expect(named === 'name, email, topic', 'the fields are in the order ' + named)
    expect(fields.name?.minLength === 2, 'name has no minLength of 2: ' + JSON.stringify(fields.name))
    expect(fields.email?.format === 'email', 'email has no format: ' + JSON.stringify(fields.email))
    expect(
      JSON.stringify(fields.topic?.enum) === '["sales","support"]',
      'topic has no enum of sales and support: ' + JSON.stringify(fields.topic),
    )
    expect(
      ['email', 'name', 'topic'].every((field) => (input!.required as string[] | undefined)?.includes(field)),
      'required is ' + JSON.stringify(input!.required),
    )
  })

  await check('a redirect is the engine\'s redirect, to where it said', async () => {
    const taken = await withRedirect(async (seen) => {
      await rejection(() => call('Conformance.redirect'))

      return seen()
    })

    expect(taken?.location === '/login', 'redirect ' + JSON.stringify(taken))
    expect(taken!.status >= 300 && taken!.status < 400, 'status ' + taken?.status)
  })

  await check('in a batch, a revalidation stays with its own call', async () => {
    const before = revalidated.length

    await Promise.all([call('Conformance.revalidate'), call('Conformance.echo', 1), call('Conformance.echo', 2)])

    expect(revalidated.length - before === 1, 'revalidated ' + JSON.stringify(revalidated.slice(before)))
  })

  await check('a revalidation rides with the result', async () => {
    const value = await call('Conformance.revalidate')

    expect(value === 'ok', 'got ' + JSON.stringify(value))
    expect(revalidated.some((r) => r.includes('orders')), 'revalidated ' + JSON.stringify(revalidated))
  })

  await check('an unexpected failure is an error, not a refusal', async () => {
    const error = (await rejection(() => call('Conformance.fail'))) as Error & { refusalStatus?: number }

    expect(
      error instanceof Error && !(error instanceof ServerAuthenticationError) && !(error instanceof ServerAuthorizationError) && !error.refusalStatus && !isNotFoundSignal(error),
      'got ' + String(error),
    )
  })

  await check('the visitor\'s Authorization header is forwarded', async () => {
    const value = await withRequest(new Request('https://app.test/', { headers: { authorization: 'Bearer conformance' } }), () =>
      call('Conformance.authorization'),
    )

    expect(value === 'Bearer conformance', 'got ' + JSON.stringify(value))
  })

  await check('the visitor\'s Cookie header is forwarded', async () => {
    const value = await withRequest(new Request('https://app.test/', { headers: { cookie: 'conformance=1; other=2' } }), () =>
      call('Conformance.cookie'),
    )

    expect(typeof value === 'string' && value.includes('conformance=1') && value.includes('other=2'), 'got ' + JSON.stringify(value))
  })

  await check('a cookie set during a call - a login - reaches the page\'s response', async () => {
    const cookies = await withRequest(new Request('https://app.test/'), () =>
      withResponseDraft(async ({ taken }) => {
        const value = await call('Conformance.login')

        expect(value === 'ok', 'got ' + JSON.stringify(value))

        return taken().getSetCookie()
      }),
    )

    expect(cookies.some((c) => c.startsWith('conformance_login=')), 'Set-Cookie ' + JSON.stringify(cookies))
  })

  await check('a flash is a cookie the browser reads, kept after one the visitor still carries', async () => {
    // A message from the page before, not yet shown, is in the visitor's
    // cookie; the new one goes after it rather than over it.
    const carried = encodeURIComponent(JSON.stringify([{ message: 'Earlier.', kind: 'info' }]))
    const cookies = await withRequest(new Request('https://app.test/', { headers: { Cookie: `${FLASH_COOKIE}=${carried}` } }), () =>
      withResponseDraft(async ({ taken }) => {
        const value = await call('Conformance.flash')

        expect(value === 'ok', 'got ' + JSON.stringify(value))

        return taken().getSetCookie()
      }),
    )
    const cookie = cookies.find((c) => c.startsWith(`${FLASH_COOKIE}=`))

    expect(cookie !== undefined, 'Set-Cookie ' + JSON.stringify(cookies))
    // useFlash reads it with document.cookie: an HttpOnly cookie is never seen.
    expect(!/;\s*httponly/i.test(cookie!), 'HttpOnly, so useFlash cannot read it: ' + cookie)

    // Read as useFlash reads it. An encrypted value is not JSON, and reads as nothing.
    let raw: string | undefined

    try {
      raw = decodeURIComponent(cookie!.slice(FLASH_COOKIE.length + 1).split(';')[0]!)
    } catch {}

    const messages = readFlash(raw)

    expect(
      sameValue(messages, [
        { message: 'Earlier.', kind: 'info' },
        { message: 'Saved.', kind: 'success' },
      ]),
      'read as ' + JSON.stringify(messages) + ' from ' + cookie,
    )
  })

  await check('arguments are decoded to their types', async () => {
    const value = await call('Conformance.double', 21)

    expect(value === 42, 'got ' + JSON.stringify(value))
  })

  await check('arguments that do not fit fail the call, not refuse it', async () => {
    for (const args of [['twenty-one'], []]) {
      const error: unknown = await rejection(() => call('Conformance.double', ...args))
      const fields = error as { refusalStatus?: number; errors?: unknown }

      expect(
        error instanceof Error && !(error instanceof ServerAuthenticationError) && !(error instanceof ServerAuthorizationError) &&
          !fields.refusalStatus && fields.errors === undefined && !isNotFoundSignal(error),
        `with ${JSON.stringify(args)}: got ` + String(error),
      )
    }
  })

  await check('refused input names nested fields with dots, and the form under ""', async () => {
    const error = (await rejection(() => call('Conformance.invalidNested'))) as { errors?: Record<string, string[]> }

    expect(Array.isArray(error.errors?.['address.city']) && error.errors['address.city'].length > 0, 'errors ' + JSON.stringify(error.errors))
    expect(Array.isArray(error.errors?.['']) && error.errors[''].length > 0, 'errors ' + JSON.stringify(error.errors))
  })

  await check('calls in one batch are each answered, a refusal only its own', async () => {
    const [a, b, c] = await Promise.allSettled([
      call('Conformance.echo', 1),
      call('Conformance.unauthenticated'),
      call('Conformance.echo', 2),
    ])

    expect(a.status === 'fulfilled' && a.value === 1, 'first ' + JSON.stringify(a))
    expect(b.status === 'rejected' && b.reason instanceof ServerAuthenticationError, 'second ' + String((b as PromiseRejectedResult).reason))
    expect(c.status === 'fulfilled' && c.value === 2, 'third ' + JSON.stringify(c))
  })

  await check('no guards at all passes: what a health check asks', async () => {
    // The renderer's /_rsc/health asks with an empty list: it runs no app
    // code, and still proves the address, the secret and the adapter.
    const value = await call('__rsc.middleware', [])

    expect(value === true, 'got ' + JSON.stringify(value))
  })

  await check('a guard that passes answers true', async () => {
    const value = await call('__rsc.middleware', ['conformance-allow'])

    expect(value === true, 'got ' + JSON.stringify(value))
  })

  await check('a guard that refuses refuses', async () => {
    const value = await call('__rsc.middleware', ['conformance-deny']).catch((e: unknown) => e)

    expect(value !== true, 'it answered true')
  })

  await check('a guard can send the visitor somewhere else', async () => {
    const taken = await withRedirect(async (seen) => {
      await call('__rsc.middleware', ['conformance-redirect']).catch(() => {})

      return seen()
    })

    expect(taken?.location === '/conformance-login', 'redirect ' + JSON.stringify(taken))
  })

  await check('guards run in order and stop at the first that does not pass', async () => {
    const after = await call('__rsc.middleware', ['conformance-allow', 'conformance-deny']).catch((e: unknown) => e)

    expect(after !== true, 'allow then deny answered true')

    // Deny first: the redirect after it must never be asked.
    const taken = await withRedirect(async (seen) => {
      const value = await call('__rsc.middleware', ['conformance-deny', 'conformance-redirect']).catch((e: unknown) => e)

      expect(value !== true, 'deny then redirect answered true')

      return seen()
    })

    expect(taken === null, 'the guard after a refusal ran: redirected to ' + JSON.stringify(taken))
  })

  await check('a guard nobody registered refuses: fail closed', async () => {
    const value = await call('__rsc.middleware', ['conformance-nobody-registered-this']).catch((e: unknown) => e)

    expect(value !== true, 'it answered true')
  })

  const versionsOf = async (query: { since: Record<string, number>; wait?: number }) => {
    const answer = (await call('__rsc.changed', query)) as { versions?: Record<string, number> } | null

    expect(typeof answer?.versions === 'object' && answer.versions !== null, 'got ' + JSON.stringify(answer))

    return answer!.versions!
  }

  await check('a name nobody changed is at version 0, and unchanged from 0', async () => {
    const all = await versionsOf({ since: { 'conformance:never': -1 } })

    expect(all['conformance:never'] === 0, 'from -1: ' + JSON.stringify(all))

    const none = await versionsOf({ since: { 'conformance:never': 0 } })

    expect(Object.keys(none).length === 0, 'from 0: ' + JSON.stringify(none))
  })

  await check('saying a name changed moves its version', async () => {
    const before = (await versionsOf({ since: { 'conformance:changed': -1 } }))['conformance:changed'] ?? 0
    const value = await call('Conformance.change')

    expect(value === 'ok', 'got ' + JSON.stringify(value))

    const moved = await versionsOf({ since: { 'conformance:changed': before } })

    expect(typeof moved['conformance:changed'] === 'number' && moved['conformance:changed'] !== before, 'from ' + before + ': ' + JSON.stringify(moved))
  })

  await check('a version is the time of the change, and never comes round again', async () => {
    // The larger of one past the old version and the time in ms: a counter
    // repeats once a pruned name starts again from 0, and a tab holding the
    // old value misses the next change. A minute's leeway for clock skew.
    const started = Date.now()

    await call('Conformance.change')

    const first = (await versionsOf({ since: { 'conformance:changed': -1 } }))['conformance:changed'] ?? 0

    expect(first >= started - 60_000, `a change at ${started} moved the version to ${first}: not a time in ms`)

    await call('Conformance.change')

    const second = (await versionsOf({ since: { 'conformance:changed': -1 } }))['conformance:changed'] ?? 0

    expect(second > first, `a second change moved ${first} to ${second}`)
  })

  // A purge, and the version of conformance:changed the moment it arrived.
  const arrived: { purge: ArrivedPurge; version: number | null }[] = []

  purges?.(async (purge) => {
    const version = await versionsOf({ since: { 'conformance:changed': -1 } })
      .then((v) => v['conformance:changed'] ?? 0)
      .catch(() => null)

    arrived.push({ purge, version })
  })

  await check('a change is purged: its name is posted to HOMEPORT_PURGE_URL as a tag', async () => {
    expect(
      purges !== undefined,
      'no purge was heard: start the adapter with HOMEPORT_PURGE_URL=http://127.0.0.1:<port>/ and run the suite with --purge-port <port>',
    )

    const before = (await versionsOf({ since: { 'conformance:changed': -1 } }))['conformance:changed'] ?? 0
    const from = arrived.length

    await call('Conformance.change')

    // After the answer is allowed: a purge may wait until the call has
    // answered, as the engine's own does.
    const deadline = Date.now() + 5_000
    let mine: (typeof arrived)[number] | undefined

    while (!mine && Date.now() < deadline) {
      mine = arrived.slice(from).find(({ purge }) => tagsOf(purge).includes('conformance:changed'))

      if (!mine) await new Promise((resolve) => setTimeout(resolve, 25))
    }

    expect(mine !== undefined, `nothing was posted naming conformance:changed within 5s (got ${JSON.stringify(arrived.slice(from).map((a) => a.purge.body))})`)

    const { purge, version } = mine!

    expect(purge.method === 'POST', 'sent with ' + purge.method)
    expect((purge.contentType ?? '').startsWith('application/json'), 'Content-Type ' + purge.contentType)
    // After the version moved: a purge that arrives first lets a CDN fetch the
    // page again from a backend still answering the old data, and keep it.
    expect(version !== null && version !== before, `the purge arrived before the change was made: conformance:changed was still ${version}`)
  })

  await check('a purge is { tags: [...] } and nothing a CDN would refuse', async () => {
    const mine = arrived.find(({ purge }) => tagsOf(purge).includes('conformance:changed'))

    expect(mine !== undefined, 'no purge arrived to check')

    const body = JSON.parse(mine!.purge.body) as Record<string, unknown>
    const unknown = Object.keys(body).filter((key) => !['tags', 'paths', 'all'].includes(key))

    expect(unknown.length === 0, 'unknown keys: ' + unknown.join(', '))
    expect(Array.isArray(body.tags) && body.tags.every((t) => typeof t === 'string'), 'tags is ' + JSON.stringify(body.tags))
    expect((body.tags as string[]).length <= 100, 'more than 100 tags in one call')
  })

  await check('only the names that differ are answered', async () => {
    const current = (await versionsOf({ since: { 'conformance:changed': -1 } }))['conformance:changed'] ?? 0
    const answer = await versionsOf({ since: { 'conformance:changed': current, 'conformance:never': 5 } })

    expect(JSON.stringify(answer) === JSON.stringify({ 'conformance:never': 0 }), 'got ' + JSON.stringify(answer))
  })

  await check('waiting for a name to change is bounded by wait', async () => {
    const started = Date.now()
    const none = await versionsOf({ since: { 'conformance:never': 0 }, wait: 300 })
    const took = Date.now() - started

    expect(Object.keys(none).length === 0, 'got ' + JSON.stringify(none))
    expect(took < 3_000, 'took ' + took + 'ms')
  })

  if (raw) {
    const statusOf = async (body: string, secret = true) => (await raw(body, { secret })).status

    await check('a call with no secret at all is refused, 403', async () => {
      const status = await statusOf(JSON.stringify({ function: 'Conformance.echo', args: [1] }), false)

      expect(status === 403, 'answered ' + status)
    })

    await check('a function nobody registered is a 404', async () => {
      const status = await statusOf(JSON.stringify({ function: 'Conformance.nobodyRegisteredThis', args: [] }))

      expect(status === 404, 'answered ' + status)
    })

    await check('a malformed call is a 400: not JSON, no function, args not a list', async () => {
      for (const body of ['not json', JSON.stringify({ args: [] }), JSON.stringify({ function: 'Conformance.echo', args: 'x' })]) {
        const status = await statusOf(body)

        expect(status === 400, `${body} answered ${status}`)
      }
    })

    await check('a batch of more than 50 is refused, 413, before any call runs', async () => {
      const before = (await versionsOf({ since: { 'conformance:changed': -1 } }))['conformance:changed'] ?? 0
      const calls = Array.from({ length: 51 }, () => ({ function: 'Conformance.change', args: [] }))
      const status = await statusOf(JSON.stringify({ calls }))
      const after = (await versionsOf({ since: { 'conformance:changed': -1 } }))['conformance:changed'] ?? 0

      expect(status === 413, 'answered ' + status)
      expect(after === before, 'calls ran: conformance:changed moved from ' + before + ' to ' + after)
    })
  }

  if (wrongSecret) {
    await check('a call with the wrong secret is refused', async () => {
      const value = await wrongSecret('Conformance.echo', 'should not run').catch((e: unknown) => e)

      expect(value !== 'should not run', 'it ran')
    })
  }

  return results
}

/** The tags a purge names; none when its body is not one. */
function tagsOf(purge: ArrivedPurge): string[] {
  try {
    const tags = (JSON.parse(purge.body) as { tags?: unknown }).tags

    return Array.isArray(tags) ? tags.filter((t): t is string => typeof t === 'string') : []
  } catch {
    return []
  }
}

/** Hear purges on 127.0.0.1:port, answering each 202 once the suite has looked. */
async function listenForPurges(port: number): Promise<{ inbox: PurgeInbox; close: () => Promise<void> }> {
  const { createServer } = await import('node:http')
  let handler: ((purge: ArrivedPurge) => Promise<void>) | undefined

  const server = createServer((request, response) => {
    let body = ''

    request.setEncoding('utf8')
    request.on('data', (chunk: string) => (body += chunk))
    request.on('end', () => {
      const purge = { method: request.method ?? '', contentType: request.headers['content-type'] ?? null, body }

      void (handler ? handler(purge) : Promise.resolve()).finally(() => {
        response.writeHead(202).end()
      })
    })
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', resolve)
  })

  return {
    inbox: (next) => {
      handler = next
    },
    close: () => new Promise((resolve) => server.close(() => resolve())),
  }
}

/** Run the suite against an adapter's endpoint. */
export async function runConformance(options: ConformanceOptions): Promise<ConformanceResult[]> {
  const revalidated: string[][] = []
  const client = (secret: string) =>
    httpHostCalls({
      endpoint: options.endpoint,
      secret,
      fetch: options.fetch,
      onRevalidate: (targets) => revalidated.push(targets),
    })

  const doFetch = options.fetch ?? globalThis.fetch
  const listening = options.purgePort ? await listenForPurges(options.purgePort) : null

  try {
    return await suite()
  } finally {
    await listening?.close()
  }

  async function suite() {
  return await conformance(client(options.secret), {
    purges: listening?.inbox,
    revalidated,
    manifest: options.manifest,
    wrongSecret: client(options.secret + '-wrong'),
    raw: (body, { secret = true } = {}) =>
      doFetch(options.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(secret ? { 'x-rsc-host-secret': options.secret } : {}) },
        body,
      }),
  })
  }
}

/**
 * Whether a value fits the JSON Schema subset the manifest uses. Null when it
 * does; otherwise where and why it does not.
 */
export function conformsTo(value: unknown, schema: Schema, defs: Record<string, Schema>, at: string): string | null {
  if (!schema || Object.keys(schema).length === 0) return null

  const ref = schema.$ref

  if (typeof ref === 'string' && ref.startsWith('#/defs/')) {
    const target = defs[ref.slice(7)]

    return target ? conformsTo(value, target, defs, at) : `${at}: ${ref} is not in defs`
  }

  if (Array.isArray(schema.anyOf)) {
    const fits = (schema.anyOf as Schema[]).some((s) => conformsTo(value, s, defs, at) === null)

    return fits ? null : `${at}: ${JSON.stringify(value)} is none of ${JSON.stringify(schema.anyOf)}`
  }

  if (Array.isArray(schema.enum)) {
    return (schema.enum as unknown[]).includes(value) ? null : `${at}: ${JSON.stringify(value)} is not one of ${JSON.stringify(schema.enum)}`
  }

  const kind = Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value

  switch (schema.type) {
    case 'string':
      if (kind !== 'string') return `${at}: expected a string, got ${JSON.stringify(value)}`
      if (schema.format === 'date-time' && Number.isNaN(Date.parse(value as string))) return `${at}: ${JSON.stringify(value)} is not a date-time`
      return null
    case 'integer':
      return Number.isInteger(value) ? null : `${at}: expected an integer, got ${JSON.stringify(value)}`
    case 'number':
      return kind === 'number' ? null : `${at}: expected a number, got ${JSON.stringify(value)}`
    case 'boolean':
      return kind === 'boolean' ? null : `${at}: expected a boolean, got ${JSON.stringify(value)}`
    case 'null':
      return value === null ? null : `${at}: expected null, got ${JSON.stringify(value)}`
    case 'array': {
      if (kind !== 'array') return `${at}: expected an array, got ${JSON.stringify(value)}`
      for (const [i, item] of (value as unknown[]).entries()) {
        const problem = conformsTo(item, schema.items as Schema, defs, `${at}[${i}]`)
        if (problem) return problem
      }
      return null
    }
    case 'object': {
      if (kind !== 'object') return `${at}: expected an object, got ${JSON.stringify(value)}`
      const object = value as Record<string, unknown>
      const properties = (schema.properties ?? {}) as Record<string, Schema>
      for (const name of (schema.required as string[] | undefined) ?? []) {
        if (!(name in object)) return `${at}.${name}: required, and missing`
      }
      for (const [name, s] of Object.entries(properties)) {
        if (name in object) {
          const problem = conformsTo(object[name], s, defs, `${at}.${name}`)
          if (problem) return problem
        }
      }
      const extra = schema.additionalProperties as Schema | undefined
      if (extra && !schema.properties) {
        for (const [name, item] of Object.entries(object)) {
          const problem = conformsTo(item, extra, defs, `${at}.${name}`)
          if (problem) return problem
        }
      }
      return null
    }
    default:
      return null
  }
}

/** Print a result table, and say whether the adapter conforms. */
export function report(results: ConformanceResult[]): boolean {
  for (const r of results) {
    stdout.write(`  ${r.ok ? '✓' : '✗'}  ${r.case}${r.ok ? '' : '\n       ' + r.detail}\n`)
  }

  const failed = results.filter((r) => !r.ok).length

  stdout.write(failed === 0 ? `\n  conforms: ${results.length} cases\n` : `\n  ${failed} of ${results.length} cases failed\n`)

  return failed === 0
}

// Run as a command, not when imported.
if (import.meta.url === pathToFileURL(argv[1] ?? '').href || argv[1]?.endsWith('rsc-kit-conformance')) {
  const flag = (name: string) => {
    const at = argv.indexOf('--' + name)

    return at === -1 ? undefined : argv[at + 1]
  }

  const endpoint = flag('endpoint')
  const secret = flag('secret')

  if (!endpoint || !secret) {
    stderr.write('usage: rsc-kit-conformance --endpoint <url> --secret <secret> --purge-port <port> [--manifest rsc-host.json]\n')
    exit(2)
  }

  const purgePort = flag('purge-port')

  runConformance({ endpoint, secret, manifest: flag('manifest'), purgePort: purgePort ? Number(purgePort) : undefined })
    .then((results) => exit(report(results) ? 0 : 1))
    .catch((error: unknown) => {
      stderr.write('rsc-kit-conformance: ' + (error instanceof Error ? error.message : String(error)) + '\n')
      exit(1)
    })
}
