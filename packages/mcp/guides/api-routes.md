# API routes

> Web-standard endpoints, colocated with your pages, with no configuration.

Server actions and [queries](/guides/queries/) cover your own client. An API
route is for everyone else: a webhook, an OAuth callback, a health check, a
mobile app, a third party.

`src/app/api/health/route.ts` answers `/api/health`:

```ts title="src/app/api/health/route.ts"
export function GET(request: Request): Response {
  return Response.json({ ok: true, at: new Date().toISOString() })
}
```

The export name is the method. The argument is an ordinary `Request` and a
`Response` goes back — no event object, no adapter, no handler wrapper.

Nothing to configure. `route.ts` lives in the same `src/app` tree as your
pages, and the url comes from the directory the same way a page's does.

It also runs everywhere the pages do. A route is answered by the same handler
that answers a page, not by a separate server, so a Worker, a Node process and a
Bun binary all get the identical behaviour from the identical code — verified on
Cloudflare Workers, which is the one with no Node apis to fall back on.

## One export per method

```ts title="src/app/api/echo/route.ts"
export async function POST(request: Request): Promise<Response> {
  const body = (await request.json()) as { name?: string }

  if (!body.name) return Response.json({ error: 'name is required' }, { status: 422 })

  return Response.json({ greeting: `Hello, ${body.name}` }, { status: 201 })
}

export function GET(): Response {
  return Response.json({ usage: 'POST { "name": "…" }' })
}
```

```
POST /api/echo  {"name":"Ada"} → 201 {"greeting":"Hello, Ada"}
POST /api/echo  {}               → 422 {"error":"name is required"}
GET  /api/echo                   → 200 {"usage":"POST { \"name\": \"…\" }"}
PUT  /api/echo                   → 405  Allow: GET, POST, HEAD
```

`GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD` and `OPTIONS`. Two you do not
have to write:

- **The 405.** A method you did not export is refused, with an `Allow` header
  naming the ones you did — without which a client cannot tell what would have
  worked.
- **`HEAD`.** Answered by your `GET`, with the body stripped, which is what the
  spec says `HEAD` is. Refusing it breaks link checkers and anything that probes
  before it fetches.

Reading a body is the web api: `request.json()`, `.formData()`, `.text()`.

A route that exports no method at all fails the build rather than becoming a url
that answers 405 to everything.

## Dynamic segments

`[name]` and `[...rest]` work as they do for pages, and bind into the second
argument:

```ts title="src/app/api/greet/[name]/route.ts"
export function GET(request: Request, { params }: { params: { name: string } }): Response {
  return Response.json({ greeting: `Hello, ${params.name}` })
}
```

```
GET /api/greet/ada → {"greeting":"Hello, ada"}
```

It is the same router pages use, so a static segment beats a dynamic one —
`/api/user/me` is answered by `me/route.ts` rather than `[id]/route.ts`,
whichever was declared first.

## Guarding one

A route runs whatever `middleware.ts` files sit above it, exactly as a page in
that directory would — so an endpoint under a guarded path is guarded without
writing the check twice. A refusal is a `401` or `403` rather than a redirect,
because a `fetch` would follow the redirect and hand back a login page as
though it were your data.

See [Authorization](/guides/authorization/#protect-an-api-route).

## The build answers what it can

A route is frozen by default, exactly the way a page is, and for the same
reason — so there is one model to learn rather than two.

At build time every `GET` is called once with no request behind it. A route
that answers without reading anything is stored, headers and status and all,
and served from disk afterwards:

```text
  ○  /api/health
  ○  /api/pricing
  ƒ  /api/me
     reads the request — headers
  ƒ  /api/posts/_id_
     one url per param value, and none are listed
```

Nothing to configure and nothing to opt into. Read the request and the route
opts itself out, because with no request to read the accessors never resolve:

```ts
export async function GET(request: Request) {
  const who = request.headers.get('Authorization')  // ƒ — per request
}
```

`cookies()`, `headers()` and `await connection()` do the same, and
`connection()` is how you say it deliberately when nothing else in the route
happens to give it away.

A route is left to run per request when it:

- **reads the request** — headers, the body, the signal
- **takes a parameter**, since the build does not know which values exist
- **sits under a `middleware.ts`**, because a guarded route answers differently
  per caller and one stored answer served to everyone is how a guard disappears
- **answers with bytes rather than text**, which is a file and wants serving as
  one
- **does not finish**, which with no request behind it usually means it was
  waiting on one

### What is never stored

Only `GET`. A `POST`, `PUT`, `PATCH` or `DELETE` is something meant to happen,
and an answer kept on disk is an answer to something that already did.

A request carrying a **query string** runs the route only when the route reads
one. `searchParams` is awaited rather than handed over resolved, so a route that
never reaches for it provably does not vary by the query — and its stored answer
is served for `?utm_source=anything`, which is most of the links people actually
follow. Await it, or export a `searchParams` schema, and the stored answer is
kept for the bare url alone.

## What to use when

| | |
| --- | --- |
| your client reads data | a [query](/guides/queries/) — typed, no endpoint to write |
| your client writes data | a [server action](/guides/server-actions/) |
| something that is not your client | an API route |

Reach for an API route when the caller cannot import your functions. If it can,
the typed call is better than a url both sides have to agree on.

:::note[Not prerendered]
An api route runs per request. A page that is the same for everyone is
[frozen at build time](/guides/static-generation/); a route is not, because the
build has no request to give it — no method, no body, no headers.

For data that never changes and is read by outsiders, a
[query](/guides/queries/) with `cache: "public"` gets you a cacheable answer
without giving up the type.
:::
