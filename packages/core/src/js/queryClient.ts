// The browser half of `query()`: one request per distinct read, and one
// round trip for the reads that happen together.
//
// The awkward fact this is built around: a server function's id is not
// readable from the client. React keeps it in a module-private WeakMap
// (`knownServerReferences`) and exposes no getter, so there is no
// `ref.$$id` to build a url from. What the client *can* do is call the
// reference and be handed the id by React itself — the stub's whole body is
// `callServer(id, args)`, and this package already owns `callServer`.
//
// So a read calls the reference with a slot open, and the transport claims the
// slot instead of posting. The id arrives from React, the request never goes
// out as a POST, and no build-time transform was needed to get either.

/** Where reads are answered. Must match HEADER.queryPath on the server. */
const QUERY_PATH = '/_rsc/query'

/**
 * How long a batch url may get before it is split.
 *
 * Conservative. Proxies and CDNs start refusing somewhere between 8k and 16k,
 * and the failure is a 414 from a machine that is not ours, so the margin is
 * deliberately wide.
 */
const MAX_URL = 6_000

type Reader = (...args: unknown[]) => Promise<unknown>

interface Pending {
  id: string
  args: unknown[]
  /** Filled at flush, when the args are encoded. */
  encoded?: string
  resolve: (value: unknown) => void
  reject: (error: unknown) => void
}

interface Entry {
  promise: Promise<unknown>
}

/**
 * The slot a read opens before calling the reference.
 *
 * One-shot and synchronous: React's stub calls `callServer` in its own body
 * with nothing awaited in between, so exactly one transport call can claim it.
 */
let slot: { claimed: boolean; promise: Promise<unknown> | null } | null = null

let pending: Pending[] = []
let flushing = false

// Keyed on the reference itself, so a query's identity is its module export
// rather than a name anyone has to keep unique. WeakMap, so a reference from a
// module that gets replaced during dev HMR does not pin its results forever.
let cached = new WeakMap<object, Map<string, Entry>>()

/**
 * The arguments, as one comparable string.
 *
 * Object keys are sorted, because `{ city, type }` and `{ type, city }` are the
 * same read and must not be two cache entries — a component that builds its
 * filter object in a different order would otherwise miss every time.
 */
export function queryKey(value: unknown): string {
  return JSON.stringify(value, (_key, raw: unknown) => {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return raw

    const sorted: Record<string, unknown> = {}

    for (const key of Object.keys(raw as Record<string, unknown>).sort()) {
      sorted[key] = (raw as Record<string, unknown>)[key]
    }

    return sorted
  })
}

/**
 * Claim the open slot, if a read opened one.
 *
 * Called from the app's `callServer` before it posts. Returns null when this
 * is an ordinary action, which is every call that did not come through
 * `readQuery`.
 */
export function claimRead(id: string, args: unknown[]): Promise<unknown> | null {
  if (!slot || slot.claimed) return null

  slot.claimed = true

  const promise = new Promise<unknown>((resolve, reject) => {
    pending.push({ id, args, resolve, reject })
  })

  slot.promise = promise
  schedule()

  return promise
}

/**
 * Read a query, reusing anything already asked for.
 *
 * Returns the SAME promise for the same `(reference, args)` until something
 * invalidates it, and that permanence is the feature rather than an
 * optimisation. `use(readQuery(getTodos))` is safe precisely because of it: a
 * promise made fresh during render suspends again on every re-render, which is
 * why `use(getTodos())` — calling the reference directly — refetches forever.
 *
 * So there is deliberately no time-based expiry here. An entry that expired
 * while a component was mounted would hand that component a new promise on its
 * next render, flashing the fallback and refetching, which is the exact bug
 * this is here to prevent. Staleness is handled by invalidating, not by
 * forgetting.
 */
export function readQuery<Data>(
  reference: (...args: never[]) => Promise<Data>,
  args: unknown[] = [],
): Promise<Data> {
  if (typeof window === 'undefined') {
    // React's SSR runtime refuses a server-function call during the initial
    // render, and reaching a query's id means calling its reference — so this
    // cannot work here, and the refusal is raised with the fix in it rather
    // than left to surface as React's more general message about waterfalls.
    //
    // Suspending on a promise that never settles would be worse, not better: a
    // Suspense boundary left unfinished holds the HTML stream open, so the
    // page hangs instead of erroring.
    throw new Error(
      'A query was read during server rendering. Use useQuery() in a client component, or read it in a server component with await.',
    )
  }

  const key = queryKey(args)

  let entries = cached.get(reference as object)

  if (!entries) {
    entries = new Map()
    cached.set(reference as object, entries)
  }

  const existing = entries.get(key)

  if (existing) return existing.promise as Promise<Data>

  const opened = { claimed: false, promise: null as Promise<unknown> | null }

  slot = opened

  try {
    // React's stub reaches callServer synchronously, so the slot is claimed by
    // the time this returns. The stub's own promise is discarded: the one the
    // transport made is the one that settles with the batched answer.
    ;(reference as unknown as Reader)(...(args as unknown[]))
  } finally {
    // Cleared here and nowhere else, so a reference that throws on the way in
    // does not leave the slot open for the next read to claim by accident.
    // Nothing is returned from this block: a `return` in `finally` discards
    // whatever the `try` was throwing, which would turn a reference that threw
    // synchronously into the misleading bound-reference error below.
    slot = null
  }

  const promise = opened.promise

  if (!opened.claimed || !promise) {
    // The only way here is a reference whose call path is asynchronous, which
    // today means one that was `.bind()`-ed. Loud, because the quiet version is
    // a read that silently went out as a POST and can never be cached,
    // prefetched, or served offline.
    throw new Error(
      'A query was called through a bound reference. Pass the exported query itself, unbound.',
    )
  }

  entries.set(key, { promise })

  // A failure must not be remembered as an answer. Dropped rather than
  // negatively cached, so a retry after a dropped connection actually retries
  // instead of being handed the same rejection for two seconds.
  promise.catch(() => {
    if (entries.get(key)?.promise === promise) entries.delete(key)
  })

  return promise as Promise<Data>
}

/**
 * Forget what a query answered, so the next read asks again.
 *
 * With no args, forgets every argument set for that query — which is what a
 * mutation usually means: the list changed, not one page of it.
 */
export function invalidateQuery(reference: (...args: never[]) => unknown, args?: unknown[]): void {
  const entries = cached.get(reference as object)

  if (!entries) return

  if (args === undefined) entries.clear()
  else entries.delete(queryKey(args))
}

function schedule(): void {
  if (flushing) return

  flushing = true

  // A microtask, not a timer. Everything a render kicks off lands in the same
  // one, and nothing pays a frame for it.
  queueMicrotask(() => {
    flushing = false

    const batch = pending

    pending = []

    if (batch.length > 0) void flush(batch)
  })
}

async function flush(batch: Pending[]): Promise<void> {
  // Encoded here rather than at call time because it is async, and doing it in
  // readQuery would put an await between opening the slot and claiming it.
  await Promise.all(
    batch.map(async (item) => {
      const encoded = await encode(item.args)

      if (typeof encoded !== 'string') {
        // encodeReply answers with FormData the moment an argument holds a
        // File. A file is not something a url can carry, and a read that takes
        // one is a POST wearing the wrong hat.
        throw new Error('A query argument contained a File. Queries travel in the url; use an action.')
      }

      item.encoded = encoded
    }),
  ).catch((error: unknown) => {
    for (const item of batch) item.reject(error)

    batch.length = 0
  })

  if (batch.length === 0) return

  // Sorted, so the same set of reads produces the same url whichever order the
  // components happened to render in. A batch url that varies by render order
  // is a cache entry that is never hit twice.
  const sorted = [...batch].sort(
    (a, b) => a.id.localeCompare(b.id) || (a.encoded ?? '').localeCompare(b.encoded ?? ''),
  )

  for (const group of split(sorted)) await send(group)
}

/**
 * Break a batch into url-sized groups.
 *
 * A single read that cannot fit is its own group, and fails with its own
 * message when sent — splitting cannot help it, and silently dropping it would
 * leave one component loading forever.
 */
function split(batch: Pending[]): Pending[][] {
  const groups: Pending[][] = []

  let group: Pending[] = []
  let size = QUERY_PATH.length

  for (const item of batch) {
    const cost = (item.encoded ?? '').length + item.id.length + 16

    if (group.length > 0 && size + cost > MAX_URL) {
      groups.push(group)
      group = []
      size = QUERY_PATH.length
    }

    group.push(item)
    size += cost
  }

  if (group.length > 0) groups.push(group)

  return groups
}

async function send(group: Pending[]): Promise<void> {
  const url = urlFor(group)

  if (url.length > MAX_URL && group.length === 1) {
    group[0].reject(
      new Error(
        'A query’s arguments are too large for a url. Narrow them, or read it through an action.',
      ),
    )

    return
  }

  try {
    const res = await fetch(url, {
      headers: {
        Accept: 'text/x-component',
        // Where the read came from. Same reason an action sends it: a host
        // that guards by route needs to know which page is asking.
        'X-RSC-Referer': window.location.pathname + window.location.search,
      },
    })

    if (!res.ok || !res.body) {
      throw new Error(`Query failed: ${res.status} ${res.statusText}`)
    }

    const decoded = (await deserialize(res.body)) as { results?: unknown[] }
    const results = decoded?.results ?? []

    group.forEach((item, index) => {
      // Each entry is a promise inside the payload, so one slow read does not
      // hold up the rest of the batch and one failed read does not take them
      // down. Resolving with it hands the caller that same streaming promise.
      const value = results[index]

      if (value === undefined) {
        item.reject(new Error('The server answered this batch with fewer results than it was sent.'))

        return
      }

      item.resolve(unwrap(value))
    })
  } catch (error) {
    for (const item of group) item.reject(error)
  }
}

function urlFor(group: Pending[]): string {
  const batch = group.map((item) => [item.id, item.encoded ?? ''])

  return `${QUERY_PATH}?q=${encodeURIComponent(JSON.stringify(batch))}`
}

/** A failure the server rendered into the payload becomes a rejection here. */
async function unwrap(value: unknown): Promise<unknown> {
  const settled = await value

  if (settled !== null && typeof settled === 'object' && '__rscQueryError' in settled) {
    throw new Error(String((settled as { message?: unknown }).message ?? 'Query failed'))
  }

  return settled
}

/**
 * The Flight codec, installed by the app bootstrap.
 *
 * Injected rather than imported, and not for testing: this module is reached
 * from client components, so importing the browser runtime here would pull a
 * second copy of it into that graph — two client-reference registries, where
 * components resolve to undefined with nothing logged. The bootstrap already
 * holds the one true copy, so it hands both halves over.
 */
let deserialize: (stream: ReadableStream) => Promise<unknown> = () => {
  throw new Error('No Flight decoder installed. createViteRscApp() sets one up.')
}

let encode: (args: unknown[]) => Promise<string | FormData> = () => {
  throw new Error('No Flight encoder installed. createViteRscApp() sets one up.')
}

export function setQueryCodec(codec: {
  deserialize: (stream: ReadableStream) => Promise<unknown>
  encode: (args: unknown[]) => Promise<string | FormData>
}): void {
  deserialize = codec.deserialize
  encode = codec.encode
}

/** Drop every cached read. For tests, and for a sign-out that must not leak. */
export function clearQueries(): void {
  cached = new WeakMap()
}
