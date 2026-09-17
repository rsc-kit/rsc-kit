# Asking once per request

> cache() — one lookup, however many places need it.

Middleware checks who you are. The layout wants their name. The page wants their
permissions. That is three calls and one answer.

Wrap the lookup:

```ts
import { cache } from '@rsc-kit/core/cache'

export const currentUser = cache(async () => db.user(await sessionId()))
```

Now call it wherever you need it. The first call runs; the rest get the same
answer:

```tsx
export async function middleware() {
  if (!(await currentUser())) redirect('/login')
}

export default async function Page() {
  const user = await currentUser()   // already resolved

  return <h1>Hello {user.name}</h1>
}
```

## One request, and no further

Two requests in flight never see each other's answers, and nothing survives into
the next one. The scope opens when the request arrives and is torn down with it.

That is the whole safety story: a table that outlived its request would not be a
stale cache, it would be one visitor seeing another's data.

## Arguments

Compared the way React compares them — primitives by value, objects by identity:

```ts
const post = cache(async (id: string) => db.post(id))

post('a')   // runs
post('a')   // reuses the first
post('b')   // runs
```

Two objects that look the same are two different calls, so pass an id rather
than an object when you want the reuse.

<Aside type="note" title="Not React's cache()">
  Same idea, wider scope. Middleware runs before any component does, which is
  exactly where the duplicate lookups start — and React has no scope open yet.
</Aside>
