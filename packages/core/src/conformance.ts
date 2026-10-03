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
//     rsc-kit-conformance --endpoint http://127.0.0.1:8080/__rsc/host-call \
//       --secret test-secret --manifest rsc-host.json
//
// The test host's hostReply passes the same suite (conformance.test.ts), so
// a page test faking the backend fakes what a real adapter does.

import { readFileSync } from 'node:fs'
import { argv, exit, stderr, stdout } from 'node:process'
import { pathToFileURL } from 'node:url'
import { httpHostCalls } from './hostCalls.js'
import { isNotFoundSignal } from './notFound.js'
import { withRedirect } from './redirect.js'
import { withRequest } from './request.js'
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
  manifest?: string | { functions?: string[]; types?: Record<string, { result?: Schema }>; defs?: Record<string, Schema> }
  /** For a test: the fetch the client uses. */
  fetch?: typeof fetch
}

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
  'Conformance.invalid': 'Refuse the input: a validation error on the field "name".',
  'Conformance.redirect': 'Send the visitor to /login.',
  'Conformance.revalidate': 'Mark the region "orders" stale, and return "ok".',
  'Conformance.fail': 'Fail unexpectedly: an ordinary error, not a refusal.',
  'Conformance.authorization': "Return the request's Authorization header, as the renderer forwarded it.",
  '__rsc.middleware': 'Guards: "conformance-allow" passes; "conformance-deny" refuses; a name with no guard refuses.',
  'Conformance.change': 'Say the tag "conformance:changed" changed, the way the adapter does from a webhook, and return "ok".',
  '__rsc.tags':
    'Given { since: { tag: version }, wait }: answer { versions } with every tag whose version differs from since now. ' +
    'A tag never changed is at 0. May hold the call up to wait ms for one to differ; may answer at once.',
} as const

const INSTANT = Date.parse('2026-01-02T03:04:05Z')

const ECHOES: unknown[] = [null, 0, -1.5, 'héllo ✓ "quoted"', [1, 'a', null], { a: { b: [true, false] }, c: '' }]

/**
 * Run the suite against a client. Every case runs; none stops another.
 *
 * `revalidated` is where the client records what each call marked stale -
 * its onRevalidate - so the revalidation case can read it.
 */
export async function conformance(
  call: ConformanceCall,
  options: { revalidated: string[][]; manifest?: ConformanceOptions['manifest']; wrongSecret?: ConformanceCall },
): Promise<ConformanceResult[]> {
  const { revalidated, manifest, wrongSecret } = options
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

    expect(error.refusalStatus === 429, 'status ' + String(error.refusalStatus))
    expect(String(error.message).includes('Slow down.'), 'message ' + JSON.stringify(error.message))
  })

  await check('refused input names its field', async () => {
    const error = (await rejection(() => call('Conformance.invalid'))) as { errors?: Record<string, string[]> }

    expect(Array.isArray(error.errors?.name) && error.errors.name.length > 0, 'errors ' + JSON.stringify(error.errors))
  })

  await check('a redirect is the engine\'s redirect, to where it said', async () => {
    const taken = await withRedirect(async (seen) => {
      await rejection(() => call('Conformance.redirect'))

      return seen()
    })

    expect(taken?.location === '/login', 'redirect ' + JSON.stringify(taken))
    expect(taken!.status >= 300 && taken!.status < 400, 'status ' + taken?.status)
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

  await check('a guard that passes answers true', async () => {
    const value = await call('__rsc.middleware', ['conformance-allow'])

    expect(value === true, 'got ' + JSON.stringify(value))
  })

  await check('a guard that refuses refuses', async () => {
    const value = await call('__rsc.middleware', ['conformance-deny']).catch((e: unknown) => e)

    expect(value !== true, 'it answered true')
  })

  await check('a guard nobody registered refuses: fail closed', async () => {
    const value = await call('__rsc.middleware', ['conformance-nobody-registered-this']).catch((e: unknown) => e)

    expect(value !== true, 'it answered true')
  })

  const versionsOf = async (query: { since: Record<string, number>; wait?: number }) => {
    const answer = (await call('__rsc.tags', query)) as { versions?: Record<string, number> } | null

    expect(typeof answer?.versions === 'object' && answer.versions !== null, 'got ' + JSON.stringify(answer))

    return answer!.versions!
  }

  await check('a tag nobody changed is at version 0, and unchanged from 0', async () => {
    const all = await versionsOf({ since: { 'conformance:never': -1 } })

    expect(all['conformance:never'] === 0, 'from -1: ' + JSON.stringify(all))

    const none = await versionsOf({ since: { 'conformance:never': 0 } })

    expect(Object.keys(none).length === 0, 'from 0: ' + JSON.stringify(none))
  })

  await check('saying a tag changed moves its version', async () => {
    const before = (await versionsOf({ since: { 'conformance:changed': -1 } }))['conformance:changed'] ?? 0
    const value = await call('Conformance.change')

    expect(value === 'ok', 'got ' + JSON.stringify(value))

    const moved = await versionsOf({ since: { 'conformance:changed': before } })

    expect(typeof moved['conformance:changed'] === 'number' && moved['conformance:changed'] !== before, 'from ' + before + ': ' + JSON.stringify(moved))
  })

  await check('waiting for a tag to change is bounded by wait', async () => {
    const started = Date.now()
    const none = await versionsOf({ since: { 'conformance:never': 0 }, wait: 300 })
    const took = Date.now() - started

    expect(Object.keys(none).length === 0, 'got ' + JSON.stringify(none))
    expect(took < 3_000, 'took ' + took + 'ms')
  })

  if (wrongSecret) {
    await check('a call with the wrong secret is refused', async () => {
      const value = await wrongSecret('Conformance.echo', 'should not run').catch((e: unknown) => e)

      expect(value !== 'should not run', 'it ran')
    })
  }

  return results
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

  return await conformance(client(options.secret), {
    revalidated,
    manifest: options.manifest,
    wrongSecret: client(options.secret + '-wrong'),
  })
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
    stderr.write('usage: rsc-kit-conformance --endpoint <url> --secret <secret> [--manifest rsc-host.json]\n')
    exit(2)
  }

  runConformance({ endpoint, secret, manifest: flag('manifest') })
    .then((results) => exit(report(results) ? 0 : 1))
    .catch((error: unknown) => {
      stderr.write('rsc-kit-conformance: ' + (error instanceof Error ? error.message : String(error)) + '\n')
      exit(1)
    })
}
