// How to build the things this framework has, in the shape that works.
//
// The other half of this server, and the more useful one. Introspection answers
// "what did my build do"; this answers "how do I do X here", which is the
// question an agent actually has — and the one it otherwise answers from Next
// and React habits that produce code which looks right and is not.
//
// Long-form on purpose. AGENTS.md has to be short enough to sit in context for
// every turn, so it can only say the rule. These are fetched when the topic
// comes up, so they can afford the working example and the caveat under it.
//
// Every snippet here is the recommended spelling from the guides, not a
// paraphrase. When a guide changes, this changes with it — a recipe that has
// drifted is worse than no recipe, because it is followed with confidence.

export interface Recipe {
  topic: string
  summary: string
  body: string
}

const RECIPES: Recipe[] = [
  {
    topic: 'forms',
    summary: 'Submitting to a server action, with pending state and field errors',
    body: `Use <Form>. It takes the server action itself, not a url.

\`\`\`tsx
'use client'
import Form from '@rsc-kit/core/Form'
import { createPost } from '../actions'

export function NewPost() {
  return (
    <Form action={createPost} schema={schema}>
      {({ pending, errors }) => (
        <>
          <input name="title" />
          {errors.title?.[0] && <p>{errors.title[0]}</p>}
          <button disabled={pending}>Save</button>
        </>
      )}
    </Form>
  )
}
\`\`\`

Passing \`schema\` validates in the browser BEFORE the action is called, so a
mistake costs no round trip. It is a courtesy, never a control: the action is a
public endpoint reachable without your form, so the server must check too.

A schema on the server (\`client.input(schema)\`) does NOT give you client-side
validation. Pass it to the form as well — the same schema is fine.

Values are uncontrolled, so an initial one is React's own \`defaultValue\`. A
refused submit keeps what was typed, because the DOM kept it.

A repeated name is an array. With one selected it is a string, which no
z.array() accepts - so for anything that is a list by nature end the name in
\`[]\` and it is always an array, brackets dropped from the key:

\`\`\`tsx
<input type="checkbox" name="tags[]" value="react" />   // -> { tags: ['react'] }
\`\`\`

Names that describe a shape build it: \`address.city\` nests, and
\`items[0].name\` (or \`items[0][name]\`) makes an array of objects. That is
the shape the schema was written against, and errors come back keyed the same
way because Standard Schema issue paths join with dots too.

For a control with no native element behind it - a rich editor, a Radix select -
or a value read as it is typed, bind it with \`field()\`. It is the same four
props react-hook-form's Controller gives:

\`\`\`tsx
<Form action={save} defaultValues={{ body: '' }}>
  {({ field }) => (
    <>
      <Editor {...field('body')} />
      <span>{field('body').value.length}/100</span>
    </>
  )}
</Form>
\`\`\`

onChange takes a DOM event OR a bare value, so native inputs and Radix
components both work. A bound field is still an ordinary named input, so it
arrives in FormData with the rest - nothing merges.

\`fieldState(name)\` is the other half: { touched, invalid, errors }. Two
objects rather than one because touched and invalid are not DOM attributes and
spreading them would warn on every field.

\`\`\`tsx
const title = fieldState('title')
<Field data-invalid={title.invalid}>
  <Input {...field('title')} aria-invalid={title.invalid} />
  <FieldError errors={title.errors.map((message) => ({ message }))} />
</Field>
\`\`\`

A field is checked when it is LEFT, not as it is typed, and it works on
uncontrolled fields too - the form listens for focusout rather than each field
listening for blur.

There is no per-field render prop component here, and that is deliberate.
TanStack Form is controlled-first, so it needs one - without per-field
subscriptions a keystroke re-renders every field. react-hook-form is
uncontrolled-first like this, and its Controller scopes the re-render of a
controlled field to itself.

field() is a function call instead, which keeps the markup flat and means a
bound field re-renders the form rather than only itself. Right for the one or
two controlled fields a form usually has.

When it is not, put the field in its own component and use \`useField\` there -
it re-renders that component and nothing else, which is what Controller achieves
with a render prop:

\`\`\`tsx
function Title() {
  const { invalid, errors, ...bound } = useField('title')

  return <Input {...bound} aria-invalid={invalid} />
}
\`\`\`

\`useFormValues()\` reads every bound value from anywhere inside the form - a
preview, a summary. Only BOUND values: an uncontrolled input's value is the
DOM's and nothing can know it changed.

Both read a context, so they work below <Form> and not beside it. If a value is
needed outside the form entirely, keep your own state and update it from
onChange.

A submit from outside the form is html, not a second api:

\`\`\`tsx
<Form id="bug-report" action={reportBug}>…</Form>
<Button type="submit" form="bug-report">Submit</Button>
\`\`\`

There is no useForm hook. <Form> is the whole surface.

Fields are real \`name\` attributes rather than controlled state, so the form
reads a native FormData and any component rendering a real control works.

It works before hydration. The action is on the form element as well as in the
submit handler, so the markup is submittable on its own - the handler calls
preventDefault() first and React does not run a form action for a cancelled
submit, so exactly one path runs.

**shadcn/ui works as-is.** Input, Textarea, Button and Label are styled native
elements, so \`name\` does what it always does. Select, Checkbox, Switch and
RadioGroup are Radix underneath and render a hidden native control whenever
given a \`name\` - omit it and they are invisible to the form, which is the
only thing to remember.

Do NOT use shadcn's own Form/FormField/FormControl with this. Those wrap
react-hook-form, a different system for the same job. One or the other.`,
  },
  {
    topic: 'prefetch',
    summary: 'Making a navigation feel instant',
    body: `\`<Link>\` prefetches on hover by default. Usually there is nothing to do.

\`\`\`tsx
import Link from '@rsc-kit/core/Link'

<Link href="/orders">Orders</Link>
<Link href="/orders" prefetch={false}>Orders</Link>   // opt out
<Link href="/orders" cacheFor={30_000}>Orders</Link>  // hold the payload longer
\`\`\`

\`href\` is typed to the routes the build found, so a link to a page that no
longer exists stops compiling. Cast with \`as Href\` only when the destination
is genuinely computed.

To prefetch from code — a row about to be clicked, a wizard's next step:

\`\`\`ts
import { prefetch } from '@rsc-kit/core/navigate'

prefetch('/orders/42')
\`\`\`

What is prefetched is the RSC payload, not the html, so it is small and it warms
the same cache the navigation will read.`,
  },
  {
    topic: 'validation',
    summary: 'Checking input — forms, actions, urls and request bodies',
    body: `One contract everywhere: any Standard Schema (Zod, Valibot, ArkType).

**Actions** validate on arrival and RETURN their failures, because React strips
a thrown message in production:

\`\`\`ts
export const createPost = client.input(schema).handler(async ({ input, ctx }) => …)
\`\`\`

**Urls** validate by exporting a schema beside the page or route:

\`\`\`ts
export const params = z.object({ slug: z.string().min(1) })
export const searchParams = z.object({ page: z.coerce.number().int().min(1).default(1) })
\`\`\`

Values arrive parsed and typed — \`?page=3\` is the number 3, a missing one is
the default. Never hand-parse \`Number(searchParams.get('page'))\`.

**Api route bodies** the same way:

\`\`\`ts
export const body = z.object({ title: z.string().min(1) })

export async function POST(request: Request, { body }) {
  const { title } = await body
}
\`\`\`

The failures answer differently on purpose:

  bad params        404 — the url does not describe a page
  bad searchParams  the error boundary (400 for an api route)
  bad body          422, the status an action already uses

A bad query is deliberately NOT a 404, or one bad link makes a real page look
deleted.`,
  },
  {
    topic: 'action-client',
    summary: 'Middleware for server actions, so a check cannot be forgotten',
    body: `\`\`\`ts title="src/server/client.ts"
'use server'
import { createActionClient } from '@rsc-kit/core/action'

export const client = createActionClient({ onError: report })
  .use(async ({ next }) => {
    const user = await currentUser()

    if (!user) throw new ServerAuthenticationError()

    return next({ ctx: { user } })
  })
\`\`\`

\`\`\`ts title="src/server/posts.ts"
'use server'
import { client } from './client'

export const createPost = client.input(schema).handler(async ({ input, ctx }) => …)
export const getPosts   = client.query(async ({ ctx }) => …)
\`\`\`

\`.handler()\` is a mutation (POST). \`.query()\` is a read (GET). Both run the
chain, so \`ctx.user\` is typed and non-null inside them.

The point is not convenience. An action cannot be added without the check,
because there is no other constructor to reach for.

Stack clients for a narrower rule:

\`\`\`ts
export const admin = client.use(async ({ ctx, next }) => {
  if (!ctx.user.isAdmin) throw new ServerAuthorizationError()
  return next({ ctx })
})
\`\`\`

Route \`middleware.ts\` does NOT run for actions — an action renders no route.
That is why the check goes here.`,
  },
  {
    topic: 'data',
    summary: 'Loading data, streaming it, and when the browser needs to refetch',
    body: `**In a server component, just await it.** No loader, no getServerSideProps.

\`\`\`tsx
export default async function Page() {
  const posts = await db.posts.all()
}
\`\`\`

**Better: do not await.** Pass the promise down and let a client component
resolve it — the shell paints at once and the rows stream into the same
response, with no request from the browser:

\`\`\`tsx
export default function Page() {
  const posts = getPosts()            // not awaited

  return (
    <Suspense fallback={<Skeleton />}>
      <List posts={posts} />          {/* 'use client': use(posts) */}
    </Suspense>
  )
}
\`\`\`

Reach for this first. It is the thing RSC is for.

**When the BROWSER decides to refetch** — a filter, a poll, a refresh — that is
a cache library's job and this package does not ship one:

\`\`\`tsx
useQuery({ queryKey: ['posts', kind], queryFn: () => fetchQuery(getPosts, [kind]) })
useSWR(['posts', kind], () => fetchQuery(getPosts, [kind]))
\`\`\`

\`fetchQuery\` sends the read as a GET and goes to the server every time, which
is what a fetcher needs — staleness and revalidation belong to the library
holding the answer. Do not add a cache on top of it.

Keep the arrow: TanStack calls a bare \`queryFn\` with its own context, and a
server function serialises whatever it is handed.`,
  },
  {
    topic: 'suspense',
    summary: 'Where boundaries go, and why the build cares',
    body: `A boundary is what lets a page be stored with a hole in it rather than not
stored at all.

\`\`\`tsx
<Suspense fallback={<Skeleton />}>
  <Slow />
</Suspense>
\`\`\`

Or a \`loading.tsx\` beside the page, which is the same thing for the whole
route.

The build renders every page. Whatever has not resolved when the budget expires
becomes the hole; everything above it is stored and served instantly. So a page
with no boundary above its slow part cannot be stored at all — the build says
so:

    ƒ  /orders
       blocks before anything can paint. Add a loading.tsx beside it, or put a
       <Suspense> above the waiting, and it has a skeleton to store.

A boundary does NOT fix a frozen \`Date.now()\`. Prerendering renders straight
through a component that never awaits, so the value is captured exactly as
before. A boundary becomes a hole only when something inside it waits.`,
  },
  {
    topic: 'offline',
    summary: 'Service worker, and what it does and does not cache',
    body: `\`\`\`ts title="vite.config.ts"
rscKit({ offline: true })
\`\`\`

The build writes a service worker that precaches the client bundle and caches
pages at runtime — a document fetch warms its payload, a payload fetch warms its
document, so a page reached by a link still works when reloaded offline.

Pages the build stored whole are served from the cache FIRST, because they
cannot change until a deploy and a deploy sweeps the cache. Everything else is
network-first with the cache as fallback.

Nothing marked \`no-store\` is ever kept — which is how a guarded page and a
session-reading query stay out of a cache that has no notion of who asked.

In a component:

\`\`\`tsx
import { useOnline } from '@rsc-kit/core/useOnline'

const online = useOnline()
\`\`\`

There is no push and no background sync. Push needs a subscription endpoint and
a sender; background sync needs idempotent replay. Both are the app's decisions.`,
  },
  {
    topic: 'pwa',
    summary: 'Making the app installable',
    body: `A manifest file beside the routes:

\`\`\`ts title="src/app/manifest.ts"
import type { WebManifest } from '@rsc-kit/core/manifest-file'

export default {
  name: 'Orders',
  shortName: 'Orders',
  themeColor: '#0b0b0c',
  backgroundColor: '#ffffff',
} satisfies WebManifest
\`\`\`

Read at build time, so it must be an object literal — not computed, not
imported from elsewhere.

**Icons need no listing.** Put them in \`src/app/\` and the build finds them:

    favicon.ico          served at /favicon.ico
    icon-192.png         <link rel="icon">, and the manifest's icons
    icon-512.png
    apple-icon.png       <link rel="apple-touch-icon">
    opengraph-image.png  <meta property="og:image">
    twitter-image.png    <meta name="twitter:image">

Sizes are read from the filename. The build says whether it worked:

    [rsc-kit] manifest: Orders is installable
    [rsc-kit] manifest: no icons, so no browser will offer to install this.

There is no layout to edit — React hoists the tags into <head>.

Pair it with \`offline: true\`. They are separate options because they are
separate decisions.

**Push and background sync** need listeners the generated worker does not have,
so it imports yours from \`src/app/sw.js\` — plain javascript, evaluated by the
browser with no build step in front of it:

\`\`\`js
self.addEventListener('push', (event) => {
  const payload = event.data ? event.data.json() : {}

  event.waitUntil(self.registration.showNotification(payload.title, { body: payload.body }))
})
\`\`\`

The rest is the web api and \`web-push\`, not this package: VAPID keys, a
subscribe call behind a button, the subscription stored by a server action
against a USER rather than a session, and a sender that deletes an endpoint on
404 or 410 rather than retrying a dead one forever.

For background sync, make the endpoint idempotent. The browser decides when a
sync runs and may run it more than once — a request that reached the server
whose response did not arrive is retried, and if that posts a message twice the
person sent it twice.`,
  },
  {
    topic: 'no-javascript',
    summary: 'Shipping a route with no client runtime at all',
    body: `\`\`\`ts title="src/app/about/page.tsx"
export const clientJs = false
\`\`\`

The route ships no bootstrap and no client runtime. The build REFUSES it if the
tree renders a client component, and names the component — they usually come
from a shared layout rather than the page itself.

Links still work; they are ordinary anchors, so navigation is a full page load.

Most pages do not need this. A page with nothing interactive already ships only
the shared runtime, and the size column in the build output tells you what each
one actually costs.`,
  },
  {
    topic: 'api-routes',
    summary: 'HTTP endpoints beside the pages',
    body: `\`src/app/**/route.ts\`, one export per method:

\`\`\`ts title="src/app/api/posts/[id]/route.ts"
export const params = z.object({ id: z.coerce.number().int() })
export const body = z.object({ title: z.string().min(1) })

export async function GET(request: Request, { params }) {
  const { id } = await params

  return Response.json(await findPost(id))
}

export async function POST(request: Request, { params, body }) {
  const { title } = await body

  return Response.json(await createPost(title), { status: 201 })
}
\`\`\`

A real \`Request\` in, a real \`Response\` out. \`params\`, \`searchParams\` and
\`body\` are awaited, the same way a page's props are.

Fetch one through \`apiUrl\` and the path is checked against the routes the
build found:

    import { apiUrl } from '@rsc-kit/core/routes'
    await fetch(apiUrl('/api/posts/' + id))

Pages and api routes are separate unions: Link refuses an api url, apiUrl
refuses a page. It checks the PATH, not the response type - for types across
the boundary use a server action or a query, where the return type is the
function's because it is the same function.

They run their directory's \`middleware.ts\`, so an endpoint under a guarded
path is guarded.

A \`GET\` that reads nothing from the request is answered from disk. Awaiting
\`searchParams\` says the answer depends on the query; never touching it means
the stored answer is served for any query at all.

Exporting a \`body\` schema consumes the stream, so \`request.json()\` inside the
handler will find it already read. Use the parsed value.`,
  },
  {
    topic: 'authorization',
    summary: 'Guarding pages, actions, api routes and queries',
    body: `Each entry point defends itself. There is no single place that covers all of
them, and believing otherwise is how a hole is left.

**A page or an api route**: \`middleware.ts\` in its directory guards everything
at or below it.

\`\`\`ts title="src/app/admin/middleware.ts"
import { redirect } from '@rsc-kit/core/redirect'

export default async function guard() {
  if (!(await currentUser())) redirect('/login')
}
\`\`\`

**An action or a query**: middleware does NOT run — they render no route. Build
them from an action client so the check cannot be forgotten. See the
\`action-client\` topic.

**Authorise on identity, not arguments.** \`deletePost(id)\` that trusts the id
is the whole of an IDOR: the caller chooses the id, so check the row belongs to
\`ctx.user\`.

A guarded page can still be frozen at build time — the guard is a serving
decision, not a build one. Its response is marked private so no cache keeps it.`,
  },
  {
    topic: 'dynamic',
    summary: 'Why a page is not static, and how to choose',
    body: `A page is stored at build time unless it reads the request. Reading it is what
opts out, and the accessors are async:

\`\`\`ts
import { cookies, headers, searchParams, connection } from '@rsc-kit/core/request'

const theme = (await cookies()).get('theme')
await connection()   // "render this per visitor", said deliberately
\`\`\`

A page's \`params\` and \`searchParams\` props are promises for the same reason.

The build says which call did it, per route:

    ◐  /locale     85 kB
       dynamic — called cookies(), headers()

That is usually correct — a page whose content depends on who is asking cannot
be one stored file. Change it only when the read was accidental.

For a parameterised route, \`generateStaticParams\` turns one shell into a page
per url:

\`\`\`ts
export async function generateStaticParams() {
  return (await db.posts.all()).map((p) => ({ slug: p.slug }))
}
\`\`\`

A value that must differ per visitor but needs no server — a clock,
localStorage, a map — belongs in the browser only:

\`\`\`tsx
'use client'
import { browser } from 'react-dom'

function Clock() {
  use(browser('the time is the visitor\\'s, not the build machine\\'s'))
}
\`\`\`

It needs a Suspense boundary, and the page stays frozen.`,
  },
]

/** Every topic, with one line each — what a caller reads before choosing. */
export function listTopics(): string {
  return [
    'Topics. Ask for one with how_to({ topic }).',
    '',
    ...RECIPES.map((r) => `${r.topic.padEnd(16)} ${r.summary}`),
  ].join('\n')
}

/** One recipe, or the list plus a nudge when the topic is not one. */
export function howTo(topic: string): string {
  const wanted = topic.trim().toLowerCase().replace(/[\s_]+/g, '-')
  const found =
    RECIPES.find((r) => r.topic === wanted) ??
    // A near miss is common and worth answering rather than refusing: someone
    // asks for "form" or "queries" and means the obvious thing.
    RECIPES.find((r) => r.topic.startsWith(wanted) || wanted.startsWith(r.topic)) ??
    RECIPES.find((r) => r.summary.toLowerCase().includes(wanted))

  if (!found) return `No topic "${topic}".\n\n${listTopics()}`

  return `# ${found.topic} — ${found.summary}\n\n${found.body}`
}

/** For tests, so a recipe cannot be added without being reachable. */
export const TOPICS = RECIPES.map((r) => r.topic)
