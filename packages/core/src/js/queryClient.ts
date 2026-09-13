// The browser half of `query()`: send a read as a GET.
//
// That is the whole of it. There is no cache here, no batching and no
// deduplication, because TanStack Query and SWR already do those and do them
// better — this owns the transport and they own everything above it.
//
// The awkward fact it is built around: a server function's id is not readable
// from the client. React keeps it in a module-private WeakMap and exposes no
// getter, so there is no `ref.$$id` to build a url from. What the client *can*
// do is call the reference and be handed the id by React itself — the stub's
// whole body is `callServer(id, args)`, and this package already owns
// `callServer`.
//
// So a read opens a one-shot slot and calls the reference; the transport claims
// the slot and sends a GET instead of posting. The slot is also what says this
// is a read at all: calling `getListings(kind)` directly is still a POST, and
// `fetchQuery(getListings, [kind])` is the same call as a GET. Nothing has to
// know a list of query ids, on either side of the build.

/** Where reads are answered. Must match HEADER.queryPath on the server. */
const QUERY_PATH = '/_rsc/query'

/**
 * Sent on every read, and required by the endpoint.
 *
 * Not decoration. A GET with no unusual header is a *simple* request, so any
 * page anywhere can trigger one with `<img src="…/_rsc/query?…">` and it goes
 * out with the visitor's cookies — CORS stops the attacker reading the answer,
 * but the read still runs. This header is not CORS-safelisted, so the browser
 * preflights it, and nothing here answers a preflight.
 *
 * That restores exactly the protection a POST had: a `POST` carrying
 * `X-RSC-Action` is non-simple for the same reason.
 */
const QUERY_HEADER = 'X-RSC-Query'

/**
 * How long a url may get before the read goes as a POST instead.
 *
 * Conservative. Proxies and CDNs start refusing somewhere between 8k and 16k,
 * and the failure is a 414 from a machine that is not ours.
 */
const MAX_URL = 6_000

type Reader = (...args: unknown[]) => Promise<unknown>

/**
 * The slot a read opens before calling the reference.
 *
 * One-shot and synchronous: React's stub calls `callServer` in its own body
 * with nothing awaited in between, so exactly one transport call can claim it.
 */
let slot: { claimed: boolean; promise: Promise<unknown> | null } | null = null

/**
 * Claim the open slot, if a read opened one.
 *
 * Called from the app's `callServer` before it posts. Returns null when this is
 * an ordinary action, which is every call that did not come through
 * `fetchQuery`.
 */
export function claimRead(id: string, args: unknown[]): Promise<unknown> | null {
  if (!slot || slot.claimed) return null

  slot.claimed = true
  slot.promise = send(id, args)

  return slot.promise
}

/**
 * Read a query, over GET.
 *
 * Hand this to a cache library and let it decide everything else:
 *
 *     queryFn: () => fetchQuery(getListings, [kind])
 *     useSWR(['listings', kind], () => fetchQuery(getListings, [kind]))
 *
 * Every call goes to the server, which is what a fetcher needs — staleness,
 * revalidation, retries, polling and deduplication all belong to the library
 * holding the answer, not to the thing that fetches it.
 */
export function fetchQuery<Data>(
  reference: (...args: never[]) => Promise<Data>,
  args: unknown[] = [],
): Promise<Data> {
  if (typeof window === 'undefined') {
    // React's SSR runtime refuses a server-function call during the initial
    // render, and reaching a query's id means calling its reference — so this
    // cannot work here. Raised with the fix in it rather than left to surface
    // as React's more general message about fetch waterfalls.
    //
    // A cache library runs its fetcher in an effect, so the server render never
    // reaches this; a server component that wants the data during render should
    // await the query directly, which needs none of this.
    throw new Error(
      'A query was read during server rendering. Read it in a server component with await, or through a cache library, whose fetcher runs after hydration.',
    )
  }

  const opened = { claimed: false, promise: null as Promise<unknown> | null }

  slot = opened

  try {
    // React's stub reaches callServer synchronously, so the slot is claimed by
    // the time this returns. The stub's own promise is discarded: the one the
    // transport made is the one that settles with the answer.
    ;(reference as unknown as Reader)(...(args as unknown[]))
  } finally {
    // Cleared here and nowhere else, so a reference that throws on the way in
    // does not leave the slot open for the next read to claim by accident.
    // Nothing is returned from this block: a `return` in `finally` discards
    // whatever the `try` was throwing, which would turn a reference that threw
    // synchronously into the misleading bound-reference error below.
    slot = null
  }

  if (!opened.claimed || !opened.promise) {
    // The only way here is a reference whose call path is asynchronous, which
    // today means one that was `.bind()`-ed. Loud, because the quiet version is
    // a read that silently went out as a POST.
    throw new Error(
      'A query was called through a bound reference. Pass the exported query itself, unbound.',
    )
  }

  return opened.promise as Promise<Data>
}

async function send(id: string, args: unknown[]): Promise<unknown> {
  const encoded = await encode(args)

  // encodeReply answers with FormData the moment an argument holds a File, and
  // a url cannot carry one. Rather than refuse a call that would have worked as
  // an action, the read falls back to a POST: it stops being cacheable, which
  // is the only thing it loses.
  if (typeof encoded !== 'string') return await post(id, args, 'an argument contained a File')

  const url = `${QUERY_PATH}?id=${encodeURIComponent(id)}&args=${encodeURIComponent(encoded)}`

  if (url.length > MAX_URL) return await post(id, args, 'the arguments are too large for a url')

  const res = await fetch(url, {
    headers: {
      [QUERY_HEADER]: '1',
      Accept: 'text/x-component',
      // Where the read came from. Same reason an action sends it: a host that
      // guards by route needs to know which page is asking.
      'X-RSC-Referer': window.location.pathname + window.location.search,
    },
  })

  if (!res.ok || !res.body) {
    throw new Error((await res.text().catch(() => '')) || `Query failed: ${res.status}`)
  }

  return await deserialize(res.body)
}

/**
 * The same read, as an action.
 *
 * Reached only when the arguments cannot ride in a url. Warned about in
 * development rather than silently tolerated, because the read still works and
 * the thing that changed — it is no longer a GET, so nothing can cache it — is
 * otherwise invisible.
 */
async function post(id: string, args: unknown[], why: string): Promise<unknown> {
  if (import.meta.env?.DEV) {
    console.warn(`[rsc-kit] A query was sent as a POST because ${why}. It will not be cached.`)
  }

  return await asAction(id, args)
}

/**
 * The Flight codec and the action transport, installed by the app bootstrap.
 *
 * Injected rather than imported, and not for testing: this module is reached
 * from client components, so importing the browser runtime here would pull a
 * second copy of it into that graph — two client-reference registries, where
 * components resolve to undefined with nothing logged. The bootstrap already
 * holds the one true copy.
 */
let deserialize: (stream: ReadableStream) => Promise<unknown> = () => {
  throw new Error('No Flight decoder installed. createViteRscApp() sets one up.')
}

let encode: (args: unknown[]) => Promise<string | FormData> = () => {
  throw new Error('No Flight encoder installed. createViteRscApp() sets one up.')
}

let asAction: (id: string, args: unknown[]) => Promise<unknown> = () => {
  throw new Error('No action transport installed. createViteRscApp() sets one up.')
}

export function setQueryCodec(codec: {
  deserialize: (stream: ReadableStream) => Promise<unknown>
  encode: (args: unknown[]) => Promise<string | FormData>
  asAction: (id: string, args: unknown[]) => Promise<unknown>
}): void {
  deserialize = codec.deserialize
  encode = codec.encode
  asAction = codec.asAction
}
