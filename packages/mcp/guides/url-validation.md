# Typed URLs

> Checking and typing params, query strings and request bodies with a schema you already write.

A url is input from a stranger. `params` arrive as strings, `searchParams` as
more strings, and `?page=banana` reaches your database as `NaN` unless
something stopped it.

Export a schema beside the page and it stops there instead:

```tsx title="src/app/posts/[slug]/page.tsx"
import { z } from 'zod'
import type { PageProps } from '@rsc-kit/core/route-schema'

export const params = z.object({ slug: z.string().min(1) })

export const searchParams = z.object({
  page: z.coerce.number().int().min(1).default(1),
  tag: z.array(z.string()).default([]),
})

export default async function PostPage({ params, searchParams }: PageProps<
  typeof params,
  typeof searchParams
>) {
  const { slug } = await params        // string
  const { page, tag } = await searchParams  // number, string[]
}
```

Both are ordinary exports, read by the build the same way `metadata` and
`generateStaticParams` are. Any [Standard Schema](https://standardschema.dev)
works — Zod, Valibot, ArkType — because the schema is asked to validate itself
and nothing here imports one.

Three things you get that types alone cannot give you:

- **`?page=3` arrives as `3`**, the number, not `"3"`.
- **A missing value arrives as its default**, so there is no `undefined` branch
  to write.
- **A bad value is refused once**, at the edge, instead of surviving as `NaN`
  into whatever the page does next.

Export neither and nothing changes: `params` is the record of strings it always
was, and `searchParams` is a `URLSearchParams`.

## They fail differently, on purpose

This is the part worth reading twice.

| what was wrong | answer | why |
| --- | --- | --- |
| `params` | **404**, `not-found.tsx` | the url does not describe a page |
| `searchParams` | nearest `error.tsx` | the page exists, the query was wrong |

`/posts/` with a slug your schema refuses is not a broken page, it is an
absent one — and a `500` tells a crawler to come back later while a `404` tells
it the thing is gone. Meanwhile refusing a bad `?page=` as a 404 would let one
bad link make a real page look deleted.

The error carries the fields, so a boundary can say which one:

```tsx title="src/app/posts/[slug]/error.tsx"
'use client'

import { isSearchParamsError } from '@rsc-kit/core/route-schema'

export default function Error({ error }) {
  if (isSearchParamsError(error)) {
    return <p>That link is not quite right: {Object.keys(error.errors).join(', ')}</p>
  }

  return <p>Something went wrong.</p>
}
```

## Repeated keys

`?tag=red&tag=blue` arrives as an array and `?q=shoes` as a string, without the
schema having to know which shape the url happened to take. So
`z.array(z.string())` and `z.string()` both work on the key you would expect.

## API routes take the same three

Plus the body, which is the one that matters for a `POST`:

```ts title="src/app/api/posts/[id]/route.ts"
import { z } from 'zod'

export const params = z.object({ id: z.coerce.number().int() })
export const searchParams = z.object({ fields: z.string().optional() })
export const body = z.object({ title: z.string().min(1), draft: z.boolean().default(false) })

export async function POST(request: Request, { params, body }) {
  const { id } = await params      // number
  const { title } = await body     // non-empty string

  return Response.json(await createPost(id, title), { status: 201 })
}
```

Awaited, the same way a page awaits its props. That is not only symmetry: a
route that never awaits `searchParams` provably does not vary by it, so the
build can store one answer and serve it for `?utm_source=anything`. Resolved
eagerly, that fact is unknowable and every tracking link misses the stored
answer.

The handler still takes a real `Request` and still returns a real `Response` —
the schemas add a second argument and take nothing away. A route that exports
none behaves exactly as it did before any of this existed.

Statuses follow the same reasoning as a page, plus one:

| what was wrong | answer |
| --- | --- |
| `params` | `404` |
| `searchParams` | `400` with `{ message, errors }` |
| `body` | `422` with `{ message, errors }` |

`422` because that is what a [server action](/guides/validation/) already
returns for a refused field, so a client has one shape to handle rather than
two.

JSON and form encodings both parse, since a url is posted to by `fetch` and by
`<form>` alike. A body that is not valid JSON is a `422` about the body as a
whole rather than a crash.

:::caution[Exporting `body` reads the request]
The schema consumes the stream, so `await request.json()` inside the handler
will find it already read. Use the parsed value — that is the point of it.

Only when you export a `body` schema, and only for `POST`, `PUT`, `PATCH` and
`DELETE`. A `GET` handler is never touched.
:::

## What this is not

A schema here checks the **shape** of a request, not whether the person making
it may. `params.id` being a number says nothing about whose row it is — the
caller chooses the id, and trusting it is the whole of an IDOR.

Authorise on identity, in the handler, after the shape is known good. See
[Authorization](/guides/authorization/).
