# Typed routes

> Links that fail the typecheck instead of the browser.

Every build writes the urls it found to `.rsc-kit/rsc-routes.d.ts`.
`Link`, `visit`, `prefetch` and `Form` accept only those.

```tsx
import Link from '@rsc-kit/core/Link'

<Link href="/about">About</Link>       // ✅
<Link href="/abuot">About</Link>       // ❌ typecheck fails
```

Dynamic segments work through ordinary template literals:

```tsx
<Link href={`/posts/${post.slug}`}>{post.title}</Link>   // ✅
<Link href={`/postz/${post.slug}`}>{post.title}</Link>   // ❌
```

## There is no `route()` helper

Deliberately. A template literal is already checked the same way a builder
would check it, so a builder would only wrap what the language does for free.
One existed and was removed.

The one thing to watch is that a value you interpolate is url-safe.
`` `/posts/${'a / b'}` `` type-checks and means three path segments — use
`encodeURIComponent` when the value is not yours:

```tsx
<Link href={`/posts/${encodeURIComponent(slug)}`}>…</Link>
```

## Two limits

**A dynamic segment widens.** `/posts/[slug]` becomes `` `/posts/${string}` ``,
so `/posts/a/b` type-checks even though it does not match at runtime.

**A list widens to `string`** unless you say what it is:

```tsx
const nav = [
  { href: '/', label: 'Home' },
  { href: '/about', label: 'About' },
] satisfies { href: Href; label: string }[]
```

Without `satisfies`, TypeScript infers `string` for `href` and you lose the
check.

## If you never run the generator

`.rsc-kit/rsc-routes.d.ts` is written by the build. Without it — or with a
tsconfig whose `include` does not cover `.rsc-kit` — nothing is registered,
every url-taking prop stays exactly as permissive as a plain `string`, and
nothing breaks. There is no flag to turn this on.

## `redirect()` is not typed

Its destination is usually computed — read from a cookie, handed over by
middleware — so typing it would make the common case a cast.

## Api routes

Every build writes the `route.ts` files it found as well, in their own union —
so a `fetch` to an endpoint that no longer exists stops compiling:

```ts
import { apiUrl } from '@rsc-kit/core/routes'

await fetch(apiUrl(`/api/orders/${id}`))
await fetch(apiUrl('/api/ordrs'))          // does not compile
```

`apiUrl` returns what it was given. It exists because `fetch` takes any
`string`, so without somewhere to put the type there is nothing to check
against — the function is the place.

**Pages and api routes are separate unions on purpose.** `<Link href="/api/health">`
does not compile, because linking to an api route navigates the browser away to
a json document; and `apiUrl('/orders')` does not compile either, because
fetching a page gets html where json was expected. Each refuses the other's
urls, which is the pair of mistakes worth catching.

:::note[Paths, not response types]
This checks the **url**. It does not infer what the endpoint returns — that
would mean a typed `json()` helper of our own in place of `Response.json()`, and
api routes are deliberately web standards with nothing of ours required in them.

For end-to-end types without a fetch at all, a [server action or
query](/guides/queries/) is already typed across the boundary: the return type
is the function's, because it is the same function.
:::
