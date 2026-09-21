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
    summary: 'Submitting to a server action, with pending state and field errors. Uncontrolled by default - no useState per field',
    body: `THE RULE: forms are UNCONTROLLED. Inputs keep their value in the DOM,
an initial value is defaultValue, the action reads FormData. Do NOT write
useState + value/onChange per input, and do NOT reach for TanStack Form.
Control ONE field only when the UI must react as the user types (a character
count, a live preview, a dependent select) - bind it with useField, which
scopes the re-render to that field. Everything else stays uncontrolled.

Use <Form>. It takes the server action itself, not a url.

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

Both read a context, so they work below <Form>. For something that is NOT a
descendant - a top bar, a sidebar preview - create the store above both and
hand it in:

\`\`\`tsx
const store = useFormStore({ title: '' })

<TopBar store={store} />                      // outside the form
<Form action={save} store={store}>…</Form>
\`\`\`

useFormStore is the values and nothing else - no submit, no errors. Creating it
does not subscribe to it, so the holder does not re-render per keystroke and
take the subtree with it. useField(name, store) and useFormValues(store) take
one explicitly; without one they read the context.

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
    body: `\`<Link>\` fetches its payload as it comes into view, on EVERY device
(desktop too), when the browser is idle, once per link, as Next does - the
bytes only, held 30 s (per-visitor page) or 5 min (a page the build made,
marked public), and the eager <img>s the payload names are preloaded at low
priority as it lands (up to 24 a page; not loading="lazy"; nothing under
Save-Data), so a product picture is decoded before the tap. Do NOT write an
image-prefetch route or an effect per card in the app. It is decoded - which
loads the page's client chunks - on intent: a pointer settled 100 ms on the link, a mousedown, a touchstart,
each 60-300 ms before the click. A click then finds a decoded tree and
nothing on the network is between the click and the page: the SPA feel,
on a slow network too. A link to a guarded page (Sign in -> /agent ->
/login) prefetches the redirect's destination too, so the tap asks for
nothing. Save-Data turns the viewport prefetch off. To MEASURE a navigation
(the number "slow on my phone" needs): every navigation leaves User Timing
marks rsc-kit:navigate:start / :decoded / :applied and a measure
rsc-kit:navigate (click to the commit) - in the Performance panel, or
performance.getEntriesByName('rsc-kit:navigate') in a console; a gap
before :decoded is network or chunks (the link was not on screen, or
prefetch={false}), after :applied is the render. A tap BEFORE the runtime has
hydrated is held by the bootstrap script and navigated to once the router
is wired (a document load after 4 s if the runtime never comes) - so a slow
phone's first tap is not a full reload. A form posting a server action
submitted in that window is held and submitted again after hydration, so
"Add to cart" tapped early is an action, not a full-page POST. Usually there is nothing to do; do
NOT add a viewport observer, touch handler or pre-hydration click shim in
the app. A tag manager on the main thread (Facebook Pixel, Clarity) is the
usual reason hydration is late: load those after the page is interactive.
A <ViewTransition> around the page is the usual reason a navigation is
slow on an iPhone (every iOS browser is WebKit): WebKit snapshots the
outgoing page at its FULL height, a 12,000 px landing page is 44 megapixels
at 3x, ~600-900 ms frozen per navigation and enough memory for iOS to
discard the tab (which returns as a reload). A navigation here is an
instant swap, like Next - do NOT add a page fade in a port; a port that
has one should remove it. The transition worth having is a shared element
(<ViewTransition name=...> on one image). If a page fade is wanted anyway,
<PageTransition className=...> from @rsc-kit/core/PageTransition is the
one that skips WebKit (and reduced motion), and ships its own CSS - a
120 ms cross-fade with pointer-events off on the overlay; nothing to add to
the stylesheet. Props: duration (ms, 0 = instant swap), webkit="run" for a
one-screen page that measured fine. See read_guide view-transitions.

\`\`\`tsx
import Link from '@rsc-kit/core/Link'

<Link href="/orders">Orders</Link>
<Link href="/orders" prefetch={false}>Orders</Link>   // opt out
<Link href="/orders" cacheFor={30_000}>Orders</Link>  // hold the payload longer
\`\`\`

\`href\` is typed to the routes the build found, so a link to a page that no
longer exists stops compiling. Cast with \`as Route\` only when the destination
is genuinely computed.

To prefetch from code — a row about to be clicked, a wizard's next step:

\`\`\`ts
import { prefetch } from '@rsc-kit/core/router'

prefetch('/orders/42')
prefetch('/orders/42', undefined, { intent: true })  // and decode it now: the chunks too
\`\`\`

What is prefetched is the RSC payload, not the html, so it is small and it warms
the same cache the navigation will read. Never the page on screen, and never a
page still held behind it (the page just left): a navigation to that reveals
it. After an action that revalidated, and after refresh(), every prefetched
payload and every held page is dropped - they are from before the write - so
visit() to a list after creating a row fetches the list with the row in it.`,
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

The same schema types every LINK to that page. Write search params as an
object, never as a string:

\`\`\`tsx
<Link href="/search" search={{ q: 'shoes', page: 2 }}>…</Link>   // typed by the page's schema
visit(href('/search', { q: 'shoes' }))                              // same check, as a string
\`\`\`

A key the page never reads, or a number written as text, does not compile;
a key the page requires is required on the link. A page with no schema takes
any scalars. Do NOT build \`?q=\${q}\` by hand when the page has a schema.

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

For a failure the schema cannot know - an account not found, a slug taken -
the handler is given \`fieldErrors\`, typed to its own input so a field the
schema does not have is a compile error:

\`\`\`ts
.handler(async ({ input, fieldErrors }) => {
  if (!account) return fieldErrors({ email: 'Account not found' })
})
\`\`\`

WRITE return fieldErrors(...). It throws either way, but TypeScript cannot see
a never-return through a destructured argument, so without the return the
value you checked stays possibly-undefined on the next line. It lands in
validationErrors on that field, the same place a schema refusal does. This is
next-safe-action's returnValidationErrors with no schema argument and no
_errors nesting.

A plain "use server" function with no action client imports the same thing,
untyped, from '@rsc-kit/core/action' - the engine converts the throw into the
returned { validationErrors } on the way out. Same rule: return fieldErrors(...).

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
That is why the check goes here.

An action body - arguments and any uploaded files, read whole - is capped at
8 MB; over it the answer is 413 before a byte is kept. rscKit({ maxActionBody })
raises it. For large files, mint a pre-signed url and upload straight to storage.`,
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

**When the BROWSER decides to refetch** — a filter, another page, a refresh —
call fetchQuery. It is a plain async function that returns the typed answer;
NO library is needed:

\`\`\`tsx
const [listings, setListings] = useState(initial)      // the server-rendered value
const [pending, start] = useTransition()
const show = (kind) => start(async () => setListings(await fetchQuery(getListings, [kind])))
\`\`\`
Works in an onClick, onSubmit, useEffect - anywhere in the browser.

**When you want CACHING** (stale-while-revalidate, dedupe, offline), hand the
same call to the library that holds the answer; this package ships none:
\`\`\`tsx
useQuery({ queryKey: ['posts', kind], queryFn: () => fetchQuery(getPosts, [kind]) })
useSWR(['posts', kind], () => fetchQuery(getPosts, [kind]))
\`\`\`
fetchQuery sends the read as a GET and goes to the server every time, which
is what a fetcher needs. It will never cache, dedupe or batch: a client
cache is the library's job, and a batch would lose the per-read cache key a
GET has. The ladder, most reads stopping on the first rung:
  1. the value now: fetchQuery + setState
  2. survive a reload / let a CDN serve it: query(fn, { cache: 'public', maxAge })
     - HTTP caching, no code in the page
  3. staleness, background refresh, optimistic updates, shared across
     components: TanStack or SWR with fetchQuery as the fetcher
Do not add a cache on top of it, and do not install TanStack for a single
button that reads once.

Keep the arrow: TanStack calls a bare \`queryFn\` with its own context, and a
server function serialises whatever it is handed.

A value that keeps CHANGING while someone watches - polling, SSE, realtime -
is how_to live-data, not this.`,
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
before. A boundary becomes a hole only when something inside it waits.

redirect() and notFound() inside a boundary still work: the shell has gone
out, so the redirect travels in the row's error digest and the browser
performs it as a navigation, layouts kept. An error.tsx on the route never
sees it - a redirect is the page's answer, not a failure - and the same holds
for a component under its own <Suspense> and for a parallel route slot. Only
an authorization check should NOT be there: the layouts above already
rendered. See the redirects guide.`,
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
a sender; background sync needs idempotent replay. Both are the app's decisions.

Every document carries a Link header naming its stylesheet, client entry
and preloaded fonts (stored documents included); Cloudflare sends it as 103
Early Hints. Nothing to configure; do NOT add rel=preload headers or a
_headers file for these in the app.

Across a deploy: the worker serves the previous build's document first, so a
returning visitor's first navigation reaches the new server from the old
client. Handled: every document carries its build (<meta name="rsc-kit:build">),
the client sends it as X-RSC-Version, the server answers 409 to another
build and the client loads the document; once the worker has announced a
new build (useAppUpdate), the next navigation is a document load; a payload
naming a client reference the page lacks reloads like a missing chunk. Do
NOT add prefetch={false} or reload logic in the app for "client reference
not found" - it is the package's, and fixed.`,
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
    summary: 'The default is none; "use client" is how a page asks for it',
    body: `There is NO JavaScript on a stored page until something on it needs some.
A route that freezes whole, renders none of the app's client components, and
has no server action in its tree ships nothing - no React, no router. The
build says so:

  ○  /about    no js
     no client components, so ships no javascript; stylesheet inlined

"use client" IS the opt-in. Put a client component on the page - a counter, a
<Link>, an update prompt - and it has the runtime, because there is now
something for the runtime to do. There is NO switch in either direction:
nothing can need the runtime without a client component or an action in the
tree, and a page that must stay this way is an assertion on build-report.json
(its clientJs is null), not a setting.

The check reads the rendered tree, so a <Link> in a shared layout counts -
pages under a layout with a nav keep the runtime; a route group with its own
plain layout drops it. Navigation into such a page from a Link elsewhere
still works: its flight payload is written with the wrappers.

A page without the runtime also gets its stylesheet inlined when small
(rscKit({ inlineStylesheets }) to change), and still registers the service
worker with one inlined line.

Do NOT restructure an app to chase this, and do NOT look for export const
clientJs - it does not exist. The size column says what each route costs; a
page that is 82 kB because of one <Link> is fine.`,
  },
  {
    topic: 'api-routes',
    summary: 'HTTP endpoints beside the pages',
    body: `\`src/app/**/route.ts\`, one export per method:

\`\`\`ts title="src/app/api/posts/[id]/route.ts"
import type { RouteContext } from '@rsc-kit/core/route-schema'

export const params = z.object({ id: z.coerce.number().int() })
export const body = z.object({ title: z.string().min(1) })

export async function GET(request: Request, { params }: RouteContext<typeof params>) {
  const { id } = await params

  return Response.json(await findPost(id))
}

export async function POST(request: Request, { params, body }: RouteContext<typeof params, never, typeof body>) {
  const { title } = await body

  return Response.json(await createPost(title), { status: 201 })
}
\`\`\`

TYPE THE CONTEXT: RouteContext<'/api/items/[id]'> types params from the
route's segments (the pattern is checked against the routes the build found);
RouteContext<typeof params> from a schema. Every field is a PROMISE - a sync
params.id is a compile error, never a route that 404s. Do NOT hand-write
{ params: { id: string } }.

A real \`Request\` in, a real \`Response\` out. \`params\`, \`searchParams\` and
\`body\` are awaited, the same way a page's props are.

Fetch one through \`apiUrl\` and the path is checked against the routes the
build found:

    import { apiUrl } from '@rsc-kit/core/routes'
    await fetch(apiUrl('/api/posts/' + id))

A route.ts is a Route too (type Route from '@rsc-kit/core/routes' covers pages
AND route.ts files, as Next's does): Link, visit and redirect accept it. The
client treats a link to a route as an anchor - never prefetched, a full
navigation, not a payload fetch. ApiRoute is the narrower union for apiUrl:
apiUrl refuses a page, because fetching one gets html. It checks the PATH, not
the response type - for types across the boundary use a server action or a
query, where the return type is the function's because it is the same function.

They run their directory's \`middleware.ts\`, so an endpoint under a guarded
path is guarded.

A \`GET\` that reads nothing from the request is answered from disk. Awaiting
\`searchParams\` says the answer depends on the query; never touching it means
the stored answer is served for any query at all. NEVER read the query with
new URL(request.url).searchParams (the Next way): the build cannot see that
read, and reading request.url at all makes the route dynamic (the table says
"reads the request - url"). A webhook verification handshake (hub.mode,
hub.challenge) reads the awaited searchParams. A GET that answers 4xx/5xx to
the build is never stored either (the table says "answered 403 to the build").

redirect() thrown from a handler is the route's answer: a real 3xx Location
for whoever asked (a signed-url export, a moved endpoint); notFound() is its
404. A guard's redirect above a route.ts is a refusal: a browser that
navigated there gets the Location, code that fetched it gets 401 +
X-RSC-Redirect (fetch would follow a Location and hand back the login page).

Exporting a \`body\` schema consumes the stream, so \`request.json()\` inside the
handler will find it already read. Use the parsed value.

A GET that reads nothing is stored - and two more things keep one per request:
a Set-Cookie on its Response (an answer for one visitor; classified dynamic,
whatever it read), and a body it froze from Date.now() or Math.random() is
stored WITH a warning on the route's line. Read the request (await
connection()) to run it on demand.`,
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

Several checks in one directory: export default [signedIn, verified, admin] -
run in order, stopping at the first refusal; reuse a check by importing it
from one place. Directories still compose outermost first.

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
opts out, and the accessors are async. usePathname() in a client component on
a route that lists no urls ([id] with no generateStaticParams) answers "" in
that route's shell - one shell serves every url, so no link is active and a
breadcrumb is empty until hydration, when the hook moves to the browser's url
by itself; the boot payload agrees with the shell, so nothing mismatches.
Nothing to wrap, nothing to do.

\`\`\`ts
import { cookies, headers, searchParams, connection } from '@rsc-kit/core/request'

const theme = (await cookies()).get('theme')?.value   // { name, value } | undefined, as in Next
await connection()   // "render this per visitor", said deliberately
\`\`\`

A page's \`params\` and \`searchParams\` props are promises for the same reason.

The build says which call did it, per route:

    ◐  /locale     85 kB
       cookies(), headers() stream per request; the rest is stored

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

It needs a Suspense boundary, and the page stays frozen.

There is NO app-wide switch to turn prerendering off (no rscKit({ prerender })
and no export const dynamic). A page that must render per request says
await connection() in the page; the build names any page it could not render
at build time, and that is the page to mark. "All of it per request" is
await connection() in the root layout with a root loading.tsx - every page a
stored fallback with the rest streamed, five times slower on a page that could
have been stored (bench/ in the repo). Do not reach for it.`,
  },
  {
    topic: 'metadata',
    summary: 'Titles, share cards, and the one setting production needs',
    body: `\`\`\`tsx
export const metadata: Metadata = {
  title: 'Orders',
  openGraph: { title: 'Orders', description: '…', images: '/cover.png' },
}
\`\`\`

A layout takes a title TEMPLATE - { template: '%s · Site', default: 'Site' } -
and layouts merge outward-in, so site-wide values go on the root layout once.

**Set metadataBase on the root layout. It is not optional in production.**

\`\`\`tsx
metadataBase: new URL('https://example.com')
\`\`\`

A share-card scraper needs an ABSOLUTE image url and Facebook, Slack and
LinkedIn refuse a relative one silently - the link unfurls with no image and
nothing says why. metadataBase makes every relative url, image and icon
absolute. Same name as Next, so a port carries it across.

Use the structured objects, not the flat 'og:title' spellings: openGraph and
twitter are typed, an image can be { url, width, height, alt }, and it is the
shape a Next app already has. og: renders as property=, twitter: as name= -
what each scraper reads.

An opengraph-image.png in app/ is found by name and needs no listing; it still
needs metadataBase to go out absolute.

Charset and viewport: every document gets <meta charSet="utf-8"> and
<meta name="viewport" content="width=device-width, initial-scale=1"> as Next
wrote them - do NOT add them to a ported layout to fix a desktop layout on a
phone; a layout that renders either itself is left alone. To change it:
export const viewport: Viewport (from @rsc-kit/core/metadata) on a layout or
page, Next's shape - width, initialScale, maximumScale, userScalable,
viewportFit, themeColor (string or [{ media, color }]), colorScheme - merged
outer to inner then the page.

generateMetadata that reads params on a route that lists no urls: the PPR
shell is one file for the whole pattern, so the build leaves that metadata
out of it (no placeholder title baked in) and the host writes the real
title and description into the head when it serves the shell for a url;
the client sets the title again after hydration. Nothing to do in the app.`,
  },
  {
    topic: 'fonts',
    summary: 'Self-hosted fonts from npm, and porting next/font',
    body: `There is no font loader. Install the font from Fontsource, import its
css, name it in a variable:

\`\`\`css
@import '@fontsource-variable/fraunces/full.css';
@import '@fontsource-variable/geist';

:root {
  --font-display: 'Fraunces Variable', ui-serif, Georgia, serif;
  --font-sans: 'Geist Variable', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto,
    'Helvetica Neue', Arial, sans-serif,
    'Apple Color Emoji', 'Segoe UI Emoji', 'Segoe UI Symbol', 'Noto Color Emoji';
}
\`\`\`

Put the font in FRONT of a full stack, not in place of one. A bare
'Geist Variable', sans-serif drops the emoji fonts - Geist has no emoji glyphs,
and with nothing named after it some systems draw a box - and drops the
metrics-matched fallback that makes the swap moment smaller. Those are
Tailwind's own defaults; shadcn's generated line loses both.

Vite hashes the woff2 files and serves them with the other assets. Nothing is
fetched from Google at runtime and nothing is downloaded at build - the files
are in node_modules.

Porting next/font: every option was something Fontsource already did.
subsets -> every subset ships behind a unicode-range and the browser fetches
only what the page uses. style: ['italic'] -> full-italic.css. axes -> full.css
has every axis; standard.css is weight only. display: 'swap' -> already in
every rule. className={font.variable} -> nothing, the variable is on :root.

The one line next/font added that you add yourself is the preload:

\`\`\`tsx
import fraunces from '@fontsource-variable/fraunces/files/fraunces-latin-full-normal.woff2?url'
<link rel="preload" href={fraunces} as="font" type="font/woff2" crossOrigin="anonymous" />
\`\`\`

?url is Vite's and gives the hashed path. Preload the one file the first paint
needs; preloading all of them defeats the subsetting.

Do NOT reach for next/font, @next/font or a Google Fonts link tag.

GETTING TO 100 ON A PHONE (do it last, once the design is settled). Fontsource's
stylesheet declares every subset of every weight with font-display: swap; a
throttled phone audit sees the largest text repaint when the font lands, and
scores 99. Three moves:
1. Own the @font-face rules, latin only: import the files with ?url, declare
   them yourself with the latin unicode-range.
2. font-display: optional for the body faces - the text paints once, in the
   fallback on a cold slow load, in the web font when cached. Keep swap for the
   headline face, which is preloaded and arrives with the document.
3. One weight per family; variable only where the axes are used. Declare the
   range you ask for (font-weight: 400 500) so nothing requests a missing file.
Put the preloads before the <style> with the faces. Measured on rsc-kit.dev:
Speed Index 1.7s to 0.9s, 99 to a steady 100, fonts 114 kB to 74 kB.
THE RULE: a font never blocks the page - text paints in the fallback before
the web font arrives. Three ways to break it, all avoided: a fonts.googleapis
<link> (render-blocking CSS from a cold origin - self-host via Fontsource
instead), font-display: block or unset (invisible text for up to 3s - every
rule says swap or optional), preloading every file (preload only what the
first paint needs).

AFTER THE ANSWER: after(() => sendEmail(user)) from @rsc-kit/core/request
queues work to run once the response is on its way - from an action, a
component, middleware or an api route. Do NOT use a detached promise: on a
Worker the isolate dies with the response unless work is handed to
waitUntil, which after() does; on a process it runs detached. Rejections
are logged, never surfaced.

WRITE THE SCHEMA FOR THE SHAPE IT WANTS. The form is read the way the schema
means it, on both sides (Zod 4 / ArkType describe themselves as JSON Schema;
Valibot not yet - its values arrive as strings):
  notify: z.boolean()             // unchecked posts nothing -> false; "on" -> true
  limit:  z.number().int()        // "5" -> 5. NOT z.coerce.number()
  tags:   z.array(z.string())     // one -> ['a'], none ticked -> []
  policy: z.string().optional()   // hidden behind a switch -> absent when off
  + .refine((s) => !s.notify || s.policy) for "required when the switch is on"
Nested names nest: fields[0][name] / fields[0].name -> { fields: [{ name }] };
auth[kind] picks a discriminated union's branch. No per-checkbox transform,
no checkbox() helper. The action decodes the same object the form validated.
Offline (rscKit({ offline: true })): the precache is what boots the app - js,
css, fonts, manifest, icons, / and /offline with their boot payloads; images,
wasm and the share card are cached on first use. A frozen page never visited
falls back to /offline like any other navigation. Do not add a second service
worker or a precache list; app/sw.js is importScripts'd into this one.

An action that redirect()s RESOLVES with { redirected: '/where' } on the
client once the navigation starts - it does not throw, so a plain
startTransition(async () => await logOut()) needs no catch (a rejection
there unmounts the root). The result is always an object (exactly one of
data / validationErrors / serverError / redirected is set), so reading any
field of it is safe. Do NOT wrap actions in a hook to catch
ServerRedirectError; nothing throws.

Before hydration a submit is a native POST to the page's url (React's hidden
$ACTION_ fields); the host runs the action and re-renders the page with the
result seated in the <Form> that posted - a refusal shows on its fields
without javascript; a redirect() is followed, a cookie lands. Nothing to
configure; <Form> uses useActionState under a wrapper so the action keeps
its (formData) signature.
A blank control is absent for any optional field (z.email().optional()
accepts it; an optional union is not read as its first branch) and "" for a
required one (z.string().min(1) refuses it). A leaf
with no JSON Schema (z.date()) arrives as posted; its siblings still coerce.
<Form ref={...}> is fine: the caller's ref is filled beside the form's own.
Render props also carry dirty (anything differs from mount, uncontrolled
fields included; baseline moves on a successful submit; reset() clears it):
{({ dirty, reset }) => <Button disabled={!dirty}>Save</Button>} - the RHF
isDirty gate for Save/Discard.

Full guide: read_guide({ slug: 'fonts' }).`,
  },
  {
    topic: 'from-next',
    summary: 'Porting a Next.js app - what carries over, what to rename, what is different on purpose',
    body: `The app/ conventions are the same: layout, page, loading, error, not-found,
route.ts, [slug], [...path], (group), @slot, (.)intercept. "use client" and
"use server" are React's. Copy src/app first, fix imports second.

IMPORTS
  next/link                    -> @rsc-kit/core/Link (href typed; search typed by the page's schema)
  useRouter().push / .replace  -> visit(url) / visit(url, { replace: true }) from @rsc-kit/core/router
  useRouter().refresh()        -> refresh() from @rsc-kit/core/router, or revalidate() in the action
  usePathname / useSearchParams-> @rsc-kit/core/usePathname, @rsc-kit/core/useSearchParams (nuqs: @rsc-kit/core/nuqs)
  useParams()                  -> the page's params prop, passed down
  cookies(), headers()         -> same names, from @rsc-kit/core/request. A cookie set in an action is what
                                  get()/has()/getAll() answer for the rest of that request, the sections it
                                  revalidates included - set('agent', id) then revalidate('all') is a whole switcher
  redirect() / notFound()      -> @rsc-kit/core/redirect / @rsc-kit/core/not-found
  revalidatePath/Tag           -> revalidate('name') on a section() - targeted, rides back with the action; the
                                  name is typed to the sections and slots the build found
  Metadata, Viewport           -> @rsc-kit/core/metadata (metadataBase, openGraph, twitter, icons as-is;
                                  export const viewport as-is; charset + viewport tags are written for you)
  app/robots.ts, app/sitemap.ts -> the same files and shapes; app/llms.ts beside them (how_to seo-files)
  middleware.ts subdomain rewrite -> nothing: a host is a route segment (how_to domains)
  flags/next (Vercel Flags SDK) -> unchanged: the build aliases next/headers to @rsc-kit/core/request
                                  (how_to feature-flags); precompute() does not carry over
  next/font                    -> Fontsource (how_to fonts)
  next/image                   -> unpic or vite-imagetools (how_to images)
  next/script                  -> a <script> tag (how_to scripts)
  NEXT_PUBLIC_*                -> PUBLIC_* in src/env.ts (how_to env); server vars typed there too
  import 'server-only'         -> keep it (the build honours it). Under bun test the real package throws on
                                  import, so the scaffold's tests/preload.ts stubs it: bunfig.toml
                                  [test] preload = ["./tests/preload.ts"], mock.module('server-only', () => ({})).
                                  A project without those two files adds them before unit-testing an action.
  next-safe-action             -> createActionClient() (how_to action-client); returnValidationErrors -> return fieldErrors({...})
  cache from 'react'           -> cache from @rsc-kit/core/cache: React's dedupes only inside a render; this one
                                  spans the request (guards, actions, api routes). The build names files still on React's
  @react-email/render, renderToString in an action -> the same call, in a module that starts with "use ssr"
                                  (the build warns naming the app file and the package; the stub throws when called)
                                  (how_to emails). Next gets away with it only for externalised packages; here it is explicit
  import type { Route } from 'next' -> import type { Route } from '@rsc-kit/core/routes' (pages AND route.ts; a link to a route.ts is an anchor, never prefetched)

DIFFERENT ON PURPOSE
- No export const dynamic / revalidate = 60. A page is frozen unless it READS
  the request; await connection() is the explicit mark. No time-based ISR.
- middleware.ts is per directory, on the server, full API; not one edge file.
  It does not run for actions - the check goes in the action.
- Actions return failures ({ validationErrors }, { serverError }), not throw.
- No image optimizer, no opengraph-image.tsx - put opengraph-image.png in src/app.
- Tests need no browser: createTestApp() is the deployed handler. It builds
  with the project's own build script on the runtime the tests run under, and
  answers files the build wrote to .output/public (assets, sw.js, the
  manifest, icons) as production does - app.fetch('/sw.js') is a real test.
- A component library (base-ui, Radix) imports as it did, from server
  components too. A shadcn-style components/ui/ folder keeps "use client" at
  the top of each file, as shipped; without it the server evaluates the
  library's internals for nothing.

SCAFFOLD FLAGS: --host=bun|node|worker --validation=zod|valibot|arktype|none
--env/--no-env (typed env vars via @t3-oss/env-core in src/env.ts, in the
chosen library; server vars never reach the browser, PUBLIC_ prefix for ones
that may). Pick the library the Next app already uses.

ORDER: scaffold -> copy src/app -> fix imports -> build (it typechecks first,
so a Link to a route that does not exist fails here) and READ the output: a
route that is not ○ names what streams and from which component (a cookies()
in a layout reaches every page; the build says so) -> decide each action the
build lists as running no middleware -> check.

CONVERT THE FORMS AND ACTIONS - do not carry them. useActionState +
useFormStatus, react-hook-form, TanStack Form and useState-per-input all
still COMPILE here, which is why a port leaves them. Each becomes
<Form action={…} schema={…}> (how_to forms) and a createActionClient()
handler (how_to action-client). Remove the form library when the last form
is converted. A port that keeps two form systems has ported nothing.

Full guide: read_guide({ slug: 'coming-from-next' }).`,
  },
  {
    topic: 'from-inertia',
    summary: 'Porting a Laravel + Inertia React app - what stays in Laravel, what the pages become, what goes',
    body: `Laravel stays, all of it: models, policies, form requests, middleware, jobs,
the session. What changes is who renders the page: Inertia rendered it in
the browser from props a controller assembled; here the page is a server
component rendered in front of Laravel that reads by name with rpc().
Install: composer require rsc-kit/laravel && php artisan rsc:install
(runs rsc-kit init; one vite.config.ts, laravel-vite-plugin moved aside;
route tree is resources/js/app). See how_to backend for rpc(), attributes,
make:rsc-action and the manifest.

WHAT EACH PIECE BECOMES
  resources/js/Pages/Orders/Index.jsx     -> resources/js/app/orders/page.tsx (the file is the route)
  Route::get + Inertia::render(...props)  -> nothing: the controller body moves to app/Rsc/Orders.php::recent(),
                                             the page does await rpc<Order[]>('Orders.recent', 20). Delete the route.
  usePage().props.auth.user, share()      -> a read in the layout that shows it: rpc('Shared.auth'), passed as props.
                                             No global props bag. Deepest layout that needs it - a read in the root
                                             layout makes every page render per request (the build says so).
  usePage().props.flash                   -> the action's return value, back on the form that submitted
  <Link href={route('x', id)}> (Ziggy)    -> <Link href="/orders/1"> from @rsc-kit/core/Link, typed to the tree. Drop Ziggy.
  router.visit / router.get               -> visit(url) from @rsc-kit/core/router
  router.reload({ only })                 -> Rsc::revalidate('orders') in the action re-renders that section with the answer
  router.post, useForm().post('/orders')  -> a server action: php artisan make:rsc-action Orders --method=create --auth
                                             --revalidate=orders, then <Form action={ordersCreate}> from @rsc-kit/core/form
                                             (import ordersCreate from the generated actions module)
  useForm errors/processing               -> <Form>'s errors (a FormRequest's ValidationException lands on the fields)
                                             and pending
  ->middleware(['auth','verified'])       -> export const middleware = ['auth', 'verified'] in middleware.ts beside the page
  Inertia::defer, <WhenVisible>, lazy()   -> <Suspense> around the component that awaits; the shell streams first
  <Head title>                            -> export const metadata = { title }
  Page.layout = ... (persistent layouts)  -> layout.tsx in the directory
  app.blade.php @inertia @vite            -> resources/js/app/layout.tsx with <html><body>; no Blade root view
  createInertiaApp(), ssr.jsx, start-ssr  -> nothing; init writes the entry; every page renders on the server
  usePoll                                 -> usePolling (how_to live-data)
  <Link prefetch>                         -> the default (hover)
  Inertia::render('Error')                -> error.tsx, not-found.tsx
  RedirectResponse from a controller      -> redirect() from @rsc-kit/core/redirect in the page or guard;
                                             RscRedirectException from PHP is performed by the browser
  NProgress                               -> <PageTransition> from @rsc-kit/core/PageTransition, or nothing

Auth pages: Auth.login with a LoginRequest calling Auth::attempt() - a cookie
queued during the call lands on the response; redirect('/dashboard') in the
guard sends a signed-in visitor on. /login can also stay Laravel's (Fortify):
any url the tree does not have is forwarded.

DIFFERENT ON PURPOSE: no controller per page (a page reads three things,
calls three methods); no props bag and no partial reloads (sections
revalidate); / is the React tree's, welcome route or not; two processes
(php artisan serve needs PHP_CLI_SERVER_WORKERS=4 and --no-reload); the
build says what each page costs - most pages that read nothing per visitor
freeze, which Inertia never could.

ORDER: install -> move Pages/ into app/ one directory per url, layouts to
layout.tsx -> per page, controller body into app/Rsc, rpc() it, delete the
route -> npm run build and READ the output (a read in the root layout
reaches every page; move it down) -> CONVERT THE FORMS (each useForm is a
make:rsc-action + <Form>; useForm still compiles here, which is why a port
leaves it) -> replace route() with typed hrefs; tsc finds the rest -> build
again -> browser. Drop @inertiajs/react, laravel-vite-plugin and ziggy from
package.json when the last import is gone.

Full guide: read_guide({ slug: 'coming-from-inertia' }).`,
  },
  {
    topic: 'feature-flags',
    summary: "Vercel's Flags SDK (flags/next) runs unchanged: next/headers is answered by headers()/cookies() here",
    body: `bun add flags. Then flags/next as written for Next:

  import { flag, dedupe } from 'flags/next'
  const visitor = dedupe(async ({ cookies, headers }) => ({ id: cookies.get('visitor')?.value ?? 'anon' }))
  export const showBanner = flag<boolean, { id: string }>({ key: 'show-banner', identify: visitor, decide: ({ entities }) => entities?.id === 'ada' })

  // page.tsx (server component)
  const on = await showBanner()

The build aliases next/headers to @rsc-kit/core/request - same names, same
shapes (cookies().get(name)?.value), one object per request, which the SDK's
dedupe keys on. Nothing to configure, no shim to write.

A flag reads the request, so the page renders per visitor: put a <Suspense>
or loading.tsx above the read and the build stores the rest as a shell (the
table says "headers() in run, cookies() in run stream per request").

Discovery endpoint: a route.ts -
  export const GET = createFlagsDiscoveryEndpoint(async () => getProviderData(flags))
  export const openapi = false
precompute() does NOT carry over (it rewrites urls in Next middleware); read
the flag in the page.`,
  },
  {
    topic: 'emails',
    summary: 'Render React to HTML on the server - an email, a PDF, a feed - from an action or a route, with "use ssr"',
    body: `@react-email/render, renderToString, anything on react-dom/server, called from
a server action or a route, fails: "react-dom/server is not supported in React
Server Components". React means it: where server components render, react is
the server-only build - the renderer needs the client build's internals, and
the components it would render import that same react (no useState, no
useContext). No alias fixes it. The rendering has to run in the ssr
environment, the one that turns pages into HTML for the browser.

Put the rendering - the template AND the call that renders it - in a module
that starts with "use ssr". Everything else imports it normally:

\`\`\`tsx
// src/lib/email/render.tsx
"use ssr";
import { render } from '@react-email/render'
import { OtpEmail } from './otp-email'

export async function renderOtpEmail(code: string) {
  const email = <OtpEmail code={code} />
  const [html, text] = await Promise.all([render(email), render(email, { plainText: true })])
  return { html, text }
}
\`\`\`

\`\`\`ts
// src/lib/email/send-otp.ts - a plain server module, called from the action
import { renderOtpEmail } from './render'
export async function sendOtpEmail(to: string, code: string) {
  const { html, text } = await renderOtpEmail(code)
  await transporter.sendMail({ to, subject: 'Your code', html, text })
}
\`\`\`

Where server components render, the build replaces the module with async
proxies of its exports that call across - what "use client" does for a
component, in the other direction. Same process; dev and build; nothing to
configure.

RULES
- Exports are async functions. The call crosses environments, so the answer is
  a promise. A sync function, a value, a class, export { } or export * is
  refused at build with its name. Types are fine.
- Pass DATA across, not elements: renderOtpEmail(code), never
  render(<OtpEmail/>) from the caller. An element built on the calling side
  carries components from that side's react, and they render with no hooks.
- The module's imports are the ssr side's: @react-email/components,
  react-dom/server, a PDF or Markdown renderer. Keep the module to rendering;
  the database call belongs on the calling side.

Imported react-dom/server directly (through a library, usually)? It now throws
the fix in its message, naming the app file that pulled it in, and the build
warns once with the same. Do NOT alias react-dom/server, externalise react, or
move the action out of the app - the directive is the whole fix.

Full guide: read_guide({ slug: 'emails' }).`,
  },
  {
    topic: 'seo-files',
    summary: 'robots.txt, sitemap.xml and llms.txt from a file beside the root layout - the shapes Next uses, stored at build when they can be',
    body: `Files beside the root layout, named for what they answer:
  src/app/robots.ts    -> /robots.txt    default export returns MetadataRoute.Robots
  src/app/sitemap.ts   -> /sitemap.xml   default export returns MetadataRoute.Sitemap (an array)
  src/app/llms.ts      -> /llms.txt      default export returns MetadataRoute.Llms
  src/app/llms-full.ts -> /llms-full.txt default export returns a string
The types: import type { MetadataRoute } from '@rsc-kit/core/metadata'. The
same names and shapes as Next's app/robots.ts and app/sitemap.ts; copy them.

\`\`\`ts
// src/app/robots.ts
export default function robots(): MetadataRoute.Robots {
  return { rules: [{ userAgent: '*', allow: '/', disallow: ['/api/'] }], sitemap: '/sitemap.xml' }
}
// src/app/sitemap.ts
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const posts = await db.post.findMany()
  return [{ url: '/', priority: 1 }, ...posts.map((p) => ({ url: \`/blog/\${p.slug}\`, lastModified: p.updatedAt }))]
}
// src/app/llms.ts
export default function llms(): MetadataRoute.Llms {
  return { title: 'Acme', summary: 'What it is.', sections: [{ title: 'Pages', links: [{ title: 'Pricing', url: '/pricing' }] }] }
}
\`\`\`

A relative url is made absolute with the root layout's metadataBase; without
one it is a build error. Any of them may return a string, served as written.

NO sitemap.ts? The build writes /sitemap.xml itself: every stored page and
every generateStaticParams url, lastModified = the build, minus guarded
routes (middleware.ts above them), failed pages and not-found. Needs the root
layout's metadataBase. Write sitemap.ts only when you need urls the build
cannot see or per-url changeFrequency/priority.

HOW FRESH - the function decides, the same rule every route follows:
  write nothing                        -> the build's own sitemap, stored; fresh every deploy
  sitemap.ts that reads the database   -> stored at build (○); fresh every deploy
  sitemap.ts that awaits connection()  -> rendered per request (ƒ); fresh every crawl
\`\`\`ts
export default async function sitemap() {
  await connection()   // from '@rsc-kit/core/request' - per request, like a page
  return (await db.post.findMany()).map((p) => ({ url: \`/blog/\${p.slug}\`, lastModified: p.updatedAt }))
}
\`\`\`
Reading the database at build is fine; the REQUEST makes it dynamic, not the
data. Same for robots.ts and llms.ts. No middleware runs for
them - a root guard must not 401 the crawler. The url is typed
(route('/sitemap.xml')).

A file as written beside the root layout is served at the root as it is:
robots.txt, sitemap.xml, sitemap-*.xml, llms.txt, llms-full.txt, humans.txt,
security.txt, ads.txt. A file and a function for the same url is a build
error. Do NOT put these in public/ and do NOT write a middleware.ts for them.

Full guide: read_guide({ slug: 'seo-files' }).`,
  },
  {
    topic: 'domains',
    summary: 'Subdomains and custom domains as route segments - admin.example.com reaches app/admin, a tenant host binds [domain], no rewrite',
    body: `A request from a host that is not the site's own is matched with the host
in FRONT of the path. The site's own hosts: the root layout's metadataBase,
www. of it, and rscKit({ hosts: [...] }) - which is ONLY for a name that is
neither the apex nor a subdomain of it (a staging/internal name, a second
brand domain); a normal setup needs no config beyond metadataBase. localhost
and ips are always own.

  example.com/admin           -> /admin              app/admin/page.tsx
  admin.example.com/          -> /admin              the same file (subdomain of an own host = its label)
  acme.example.com/settings   -> /acme/settings      app/[domain]/settings/page.tsx, domain "acme"
  acme.com/settings           -> /acme.com/settings  the same file, domain "acme.com" (other host = whole host)

The visitor's url is untouched; only the match changes. Only a top-level
[domain] or [host] directory binds the host; app/[slug] or app/[collection] at
the top is a path parameter, as in Next. A top-level [domain]
binds ONLY from a host, never from a path: example.com/nope is a 404, not a
tenant called "nope". Otherwise [domain] is an ordinary dynamic segment: params.domain in every page/layout under it, typed
route('/[domain]/settings', { domain }), loading/error files as usual. A
directory named for a host (app/admin/) wins over [domain].

\`\`\`tsx
// src/app/[domain]/layout.tsx
export default async function TenantLayout({ params, children }) {
  const { domain } = await params
  const tenant = await tenantByDomain(domain)   // "acme" or "acme.com", as stored
  if (!tenant) notFound()
  return <TenantProvider tenant={tenant}>{children}</TenantProvider>
}
// src/app/[domain]/page.tsx - domains in a database: list them, they are stored at build
export async function generateStaticParams() {
  return (await db.tenant.findMany()).map((t) => ({ domain: t.domain }))
}
\`\`\`

Only when a route could answer it (a top-level [domain] directory, or one
named for the host); otherwise the host is the site's own. Keep metadataBase as
the production host: localhost and ips are always own, so dev routes by path.
To try a tenant locally: curl -H 'X-Forwarded-Host: acme.example.com'
http://localhost:3000/ (or /etc/hosts). Behind a proxy the
host is X-Forwarded-Host, then Host. Not for a static export (a file server
sees no host). Do NOT write a middleware rewrite, do NOT
read the host in every page - the segment already is the host. The root layout
needs metadataBase (or rscKit({ hosts })) or every host is the site's own.

Full guide: read_guide({ slug: 'domains' }).`,
  },
  {
    topic: 'identify',
    summary: 'What a response says about itself - X-RSC-Kit (how it was served, always) and X-Powered-By + a generator tag (what built it, off with identify: false)',
    body: `Every response carries X-RSC-Kit: stored | rendered | shell - a page from a
file the build wrote, rendered for this visitor, or a stored shell with its
holes rendered now. The header to read when a page is slower than expected
(like X-Nextjs-Cache); a CDN rule or health check can key on it. Names no
product; always sent.

By default a response also says what built it: X-Powered-By: rsc-kit and
<meta name="generator" content="rsc-kit"> in every document (BuiltWith,
Wappalyzer). The NAME only, never the version - a version in every response
is what a vulnerability scanner filters on.

rscKit({ identify: false }) turns off the name (header and tag) for a policy
that strips framework identifiers; X-RSC-Kit stays. Do not strip X-RSC-Kit
at the proxy - it is what tells you whether a stored page was served.

Full guide: read_guide({ slug: 'response-headers' }).`,
  },
  {
    topic: 'backend',
    summary: 'BAP (Backend-Answered Pages): a Laravel, Go or other backend behind the renderer - rpc() reaches it, middleware.ts names its middleware, app/Rsc/Actions are its server actions',
    body: `The model is a BAP - Backend-Answered Pages: a page rendered in front of
the backend rather than by it (MPA: backend renders; SPA: browser renders and
calls an API; BAP: a renderer on the server renders and calls the backend
over loopback). The backend is the part that is not a page - models, session,
auth, policies, jobs - answering one private endpoint, and it keeps every
route of its own. The whole model, and how to build for it:
read_guide({ slug: 'backend-answered-pages' }).

Go: in a Go module, rsc-kit init sees go.mod, writes the JS half and .env
(RSC_BACKEND + a generated secret) and prints the Go wiring; go get
github.com/rsc-kit/go. A new app: bun create rsc-kit --backend=<url>.

A backend in another language answers that ONE endpoint, POST /__rsc/host-call,
and the renderer wires itself from two variables in .env: RSC_BACKEND (a
Laravel app's APP_URL counts) and RSC_HOST_CALL_SECRET. Both or neither.

Laravel: composer require rsc-kit/laravel, then php artisan rsc:install. It
runs rsc-kit init, which writes ONE vite.config.ts (laravel-vite-plugin is
moved aside - the renderer owns the frontend). Source is resources/js (the route tree is resources/js/app).

rpc() is a global the renderer installs in its own process (never imported,
never in the browser bundle): one POST to the backend's host-call endpoint
with { function, args }, the secret and the visitor's cookie; the answer is
the return value as JSON, typed by rpc<T>(). Refusals arrive as their kind
(422/401/403/redirect), never a 500; sibling calls in one tick are batched
and each resolves the moment the backend answers it.
A BAP server bundle carries no database driver, ORM or auth library - the
backend owns those.

Reach PHP from a server component - rpc() is a global, typed in
.rsc-kit/rsc-env.d.ts, server render only:

  // app/Rsc/Orders.php: public function recent(int $limit): array
  const orders = await rpc<Order[]>('Orders.recent', 5)

The call runs AS THE VISITOR (their cookie is forwarded; auth()->user() is
them). Refuse with attributes: #[Authenticated], #[Can('update', Order::class)],
#[Middleware('throttle:60,1')]. A ValidationException lands on the form as
validationErrors; Authentication/Authorization exceptions answer 401/403.

Guard a route in Laravel's vocabulary, no route declared in PHP:

  // resources/js/app/admin/middleware.ts
  export const middleware = ['auth', 'verified', 'can:update,post']

Make one: php artisan make:rsc-action Orders --method=cancel --auth
--can=update,Order --middleware=throttle:60,1 --revalidate=orders (--rpc for
an rpc() class under app/Rsc; no --method = invokable; a slash nests,
Billing/Invoices). Do NOT hand-write the attributes from memory; the command
writes the ones the registry reads, and it writes the map
(rsc-host-actions.json) too - a running dev server restarts on its own when
the map changes, so the export is importable when the command returns.
Server actions are classes in app/Rsc/Actions, found by reflection in PHP;
\`php artisan rsc:action-manifest\` writes the map and MUST run before
Vite - the dev and build scripts rsc:install wrote do (\`php artisan
rsc:action-manifest && vite\`), so a class written by hand is picked up by
the next \`npm run dev\` or \`npm run build\`, never by Vite alone. The
build writes the "use server" stubs from the map - import ordersCancel from
the generated actions module in a client component. Rsc::revalidate('orders')
in the action returns the re-rendered region with the answer.

Per url: if the React tree has it, React renders it, otherwise Laravel does
- including / : the welcome route in routes/web.php answers nothing while
resources/js/app/page.tsx exists (the package registers the tree's urls from
bootstrap/rsc/vite/routes.json after routes/web.php). Do NOT tell the user
to delete the welcome route to make the page show; do not add Laravel routes
for React pages.

php artisan serve is one worker, which deadlocks the proxy - unless
PHP_CLI_SERVER_WORKERS=4 in .env AND serve --no-reload (Laravel ignores
the variable otherwise). Herd, Valet, FPM, Octane are fine as they are. Production: put the renderer in front (bun
.output/server/index.mjs with the app's .env), restrict /__rsc/host-call at
the web server.

Any other language implements the same endpoint - request { function, args },
reply { result | validationErrors | unauthenticated | unauthorized | redirect
| error, revalidate }, answers '__rsc.middleware' with true or a refusal, and
a batch { calls: [...] } as application/x-ndjson - one line per call AS IT
FINISHES, { index, status, ...reply }, in any order, flushed each time
(X-Accel-Buffering: no) - or, less good, one JSON { replies: [...] } in
order (every call then waits for the slowest). Calls issued in the same
render tick travel as one batch, so parallel reads are one backend request
and a fast read still resolves while a slow sibling runs; the renderer falls
back to single calls for a backend without batches.

Full guides: read_guide({ slug: 'backend-answered-pages' }), read_guide({ slug: 'laravel' }), read_guide({ slug: 'go' }), read_guide({ slug: 'your-own-backend' }).`,
  },
  {
    topic: 'startup',
    summary: 'Once-per-process setup - src/instrumentation.ts is imported before any page and its register() awaited before the first request',
    body: `Setup that belongs to the process - validating env, configuring a shared
package, warming a connection - goes in src/instrumentation.ts. Do NOT import
a bootstrap module from pages to get the same effect; it depends on nobody
forgetting, and the failure is a page throwing "not configured" for whoever
reaches it first.

  // src/instrumentation.ts
  import './env'                       // refuses at import -> server fails at startup
  export async function register() {   // optional; the first render waits for it
    await db.connect()
  }

The generated entry imports this file FIRST, so a package configured here is
configured before any page module evaluates. register() is awaited by every
entry point (server, dev, prerender, middleware, actions, api routes), once
per process. On a server it runs at startup and a failure exits the process;
on a Worker it runs at the isolate's first request.

Worker rule: read bindings INSIDE register(), not at the top of the module -
process.env is empty until the first request arrives.

A scaffolded app with env validation already has this file importing ./env.
Build machines without production variables: SKIP_ENV_VALIDATION=1.

Never NODE_ENV in a .env: Vite sets it (development under vite, production
under vite build) and a .env line overrides it for the build, which then
compiles pages against React's dev JSX runtime (jsxDEV) and every route
fails with React's opaque "message omitted in production builds". The build
refuses this and names the file:line. A plugin cannot override it (Vite
applies the .env value after plugins run), so remove the line - other tools
that want it keep it in their own .env.

Full guide: read_guide({ slug: 'instrumentation' }).`,
  },
  {
    topic: 'workers',
    summary: 'Cloudflare Workers: bindings (D1, R2, KV) from cloudflare:workers',
    body: `A D1 database, an R2 bucket or a KV namespace named in wrangler.jsonc is
read from \`cloudflare:workers\`, the runtime's own module: the bundle leaves
it external, like bun:sqlite. \`vite dev\` under Bun or Node has no such module,
so import it lazily, behind a runtime check - never at the top of a module a
page imports, or dev and the build fail to resolve it.

\`\`\`ts
const onWorkers = typeof navigator !== 'undefined' && navigator.userAgent === 'Cloudflare-Workers'

export async function db() {
  if (onWorkers) {
    const { env } = await import('cloudflare:workers')
    return env.DB
  }
  const { Database } = await import('bun:sqlite')
  return new Database('data/local.sqlite')
}
\`\`\`

The build renders through the same module: a page that reads a table and
nothing from the request is frozen from the local database at build time,
and only pages that read the url or the request reach D1 per request. Do NOT
put env.DB on a global or read it at import time. wrangler.jsonc: the
d1_databases / r2_buckets entries wrangler printed at create time.`,
  },
  {
    topic: 'bun',
    summary: 'Running on Bun - Vite on Bun\'s runtime (bun --bun vite), native deps external (serverExternalPackages), and the gotchas that are Bun\'s not ours',
    body: `The vite bin has a node shebang: \`bun run dev\` alone starts Vite - dev
server, build, prerender - under NODE, and an app importing 'bun' or
'bun:sqlite' fails at first render with "Cannot find package 'bun'". Scripts
on a Bun app: dev "bun --bun vite", build "bun --bun vite build". createTestApp
runs the project's build script on the runtime the tests use.

Native dependencies (sharp, bcrypt, better-sqlite3, @prisma/client, puppeteer,
...) are external to the server bundles by default; Nitro traces them into
.output/server/node_modules with their binaries. Add one:
rscKit({ serverExternalPackages: ['@acme/native'] }). Same as Next's option.

The other direction: a dependency with "use client" files that does NOT
declare react as a peerDependency (generated wrappers, workspace packages
with react under dependencies) would be left external by plugin-rsc and its
directive never read - hooks then run on the server. The build detects direct
dependencies in that state and bundles them, printing
"[rsc-kit] bundling <pkg>: it has "use client" files but does not declare
react as a peer dependency". Nothing to configure; fix the package's
peerDependencies when it is yours.

Bun's, not the framework's: bun test loads the package .env (use
--env-file=/dev/null to isolate); Stripe's constructEvent throws on Bun
(no sync WebCrypto) - use constructEventAsync; Bun's pg puts SQLSTATE in
errno where Node's pg uses code.

Never NODE_ENV in a .env (the build refuses it, naming the line). Build
machines without secrets: SKIP_ENV_VALIDATION=1.

reflect-metadata (tsyringe, typeorm, inversify - often under
@simplewebauthn/server): nothing to import; when the graph has it the build
loads it in a Nitro plugin ahead of the app, so the "tsyringe requires a
reflect polyfill" boot error does not happen in a directory or a binary.

Build, then start - NEVER run vite build while bun/node .output/server/index.mjs
is serving from that .output: services load lazily and a failed import of a
half-written chunk is cached by the runtime (ENOENT 500s until restart).

Single binary (Bun): bun build --compile .output/server/compile.mjs
--outfile dist/app (the scaffold's "compile" script). compile.mjs is written
by the build and embeds the frozen pages; with serveStatic: 'inline' in the
Nitro plugin the assets (and their .br/.gz) are inside too. Ship dist/app
alone - a Dockerfile copies nothing else, not .output/public. --bytecode
compiles the JS ahead of time (cold boot 275 ms -> 72 ms measured, for an
image 81 MB -> 117 MB - on a pod the pull costs more than the boot saves).
Bytecode is CommonJS: a module using import.meta.env / .filename / .resolve
/ bare import.meta (a dependency, usually) fails it, and Bun names no file
and EXITS 0 - the binary dies at boot with "import.meta is only valid
inside modules". The build prints the file and line at the end of a bun
build when there is one; --bytecode --format=esm applies regardless. A production
app ported from Next measured the binary image at 50.12 MiB against the
Next image's 104.56 MiB, the docker build at 2m45s against 5m13s, and
Lighthouse at 99 mobile / 100 desktop - nothing tuned for the numbers.

Nothing is sent raw: a built bun/node server gzips what it answers
(documents, streams flushed per chunk, payloads, stored pages, api routes)
for a request that accepts it, and the build writes .br/.gz beside every
public asset, served by Nitro. Nothing to configure; a Worker leaves it to
the platform. Off: compress: false on the handler / compressPublicAssets:
false in Nitro config; Cache-Control: no-transform exempts one answer. Do
NOT add a compression middleware or precompress assets yourself.

Full guide: read_guide({ slug: 'bun' }).`,
  },
  {
    topic: 'openapi',
    summary: 'An OpenAPI document derived from route.ts files - rscKit({ openapi }) - and Scalar\'s page over it, mounted as a route',
    body: `Do NOT hand-write an OpenAPI spec. rscKit({ openapi: true }) in
vite.config.ts answers /openapi.json, derived from every route.ts: the
directory is the path ([id] -> {id}), each method export an operation,
params/searchParams/body schemas the parameters and request body (Zod 4 and
ArkType describe themselves as JSON Schema; Valibot not yet), a middleware.ts
above a route a security requirement + 401/403. Stored at build, no middleware.

Document-level parts go on the option:
  rscKit({ openapi: { info, servers, security, components: { securitySchemes } } })
What a route says about itself, beside its handler:
  export const openapi = { summary, tags, responses: { 200: {...} }, POST: { summary } }
  export const openapi = false   // leave this route out (the reference page, a webhook)
  export const openapi = { DELETE: false }  // one method out; HEAD/OPTIONS never documented
Webhook-heavy app: rscKit({ openapi: { include: 'declared' } }) documents only
routes that export openapi, so callbacks need no opt-out line.
Response bodies are declared in openapi.responses until a typed helper exists.

The page: Scalar's own package, one route, nothing shipped by the engine:
  // src/app/reference/route.ts
  import { ApiReference } from '@scalar/nextjs-api-reference'
  export const GET = ApiReference({ url: '/openapi.json' })
  export const openapi = false

Porting a spec file: delete its paths (they are the routes now, and body
validates at runtime), move info/servers/security to the option, move a
route's summary/tags/responses to its openapi export.

Full guide: read_guide({ slug: 'openapi' }).`,
  },
  {
    topic: 'env',
    summary: 'Typed environment variables - src/env.ts with @t3-oss/env-core in the app\'s validation library; refused at startup by name. Never NODE_ENV in .env',
    body: `A scaffolded app has src/env.ts when it said yes to typed environment
variables (create-rsc-kit --env, with --validation=zod|valibot|arktype). To
add it to an app without one: install @t3-oss/env-core and write the same file.

\`\`\`ts
// src/env.ts
import * as z from 'zod'   // or valibot / arktype - any Standard Schema library
import { createEnv } from '@t3-oss/env-core'

export const env = createEnv({
  server: {
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    DATABASE_URL: z.url(),
    SESSION_SECRET: z.string().min(1),
  },
  clientPrefix: 'PUBLIC_',
  client: { PUBLIC_SITE_URL: z.url() },
  // No bare process.env: a "use client" file importing this for a PUBLIC_
  // value has no process, and the spread throws before the first render.
  runtimeEnv: { ...(typeof process === 'undefined' ? {} : process.env), ...import.meta.env },
  emptyStringAsUndefined: true,
  skipValidation: typeof process !== 'undefined' && !!process.env.SKIP_ENV_VALIDATION,
})
\`\`\`

Read env.DATABASE_URL, never process.env.DATABASE_URL: the first is typed and
was checked at startup (a missing or malformed one fails then, with its name),
the second is string | undefined. A server variable never reaches the browser;
a browser-readable one MUST start with PUBLIC_ and is read from import.meta.env
(Vite; the engine registers PUBLIC_ beside VITE_ as a client prefix, nothing
to configure), which is why runtimeEnv merges both. Commit .env.example, not .env.

Next: NEXT_PUBLIC_* becomes PUBLIC_*; @t3-oss/env-nextjs becomes
@t3-oss/env-core with runtimeEnv as above (env-nextjs's experimental__runtimeEnv
is not needed).`,
  },
  {
    topic: 'live-data',
    summary: 'A value that keeps changing - realtime, live updates: usePolling over a query, or server-sent events (SSE, streaming from a middleware.ts generator) with useEvents - both feed TanStack, SWR or setState',
    body: `Neither is part of query() - a query answers once and is cacheable.

POLLING - start here when you have no change feed yet. Reuses the query,
goes through its Cache-Control (a CDN collapses many tabs into one origin
read per interval), pauses when the tab is hidden, never overlaps two reads.
\`\`\`tsx
import { usePolling } from '@rsc-kit/core/usePolling'
const { data, status, refresh } = usePolling(() => fetchQuery(getSeats), { every: 2_000 })
\`\`\`
UNTIL IT SETTLES - a job that ends. until(data) says the last read; onSettled
fires once on it. The result is the DATA; what to
do on settling is the page's choice:
  // a server-rendered list, some jobs still running: re-render through the server
  usePolling(() => fetchQuery(jobStatus, [id]), { every: 2_000, enabled: !isTerminal(job), until: isTerminal, onSettled: () => refresh('page') })
  // the page that owns the job's state machine: the value in hand
  const { data, status } = usePolling(read, { every: 1_500, until: isTerminal, onSettled: (f) => dispatch(f.status) })
Settled = stopped until refresh() or the inputs change. status: 'reading' |
'paused' | 'settled' | 'idle'.

SERVER-SENT EVENTS - when something can push. Better per update (bytes only
on change, instant), but holds a connection per open tab (fine on Bun/Node,
a limit on Workers or a small container), is uncacheable, and needs a source
of change to yield from - a generator that polls the DB itself just moved the
polling. An ordinary route.ts: beside its pages, runs middleware.ts above it.
\`\`\`ts
// src/app/api/orders/[id]/events/route.ts
import { events, named } from '@rsc-kit/core/events'
export const GET = events(async function* ({ params, signal }) {
  const { id } = await params
  for await (const status of orderStatus(id, { signal })) yield { status }
  // yield named('paid', order, { id: order.id }) names a message / gives an id
})
\`\`\`
\`\`\`tsx
import { useEvents } from '@rsc-kit/core/useEvents'
const { latest, all, status, close } = useEvents<Status>(\`/api/orders/\${id}/events\`)
// <Status> is the message type the route yields; a url infers nothing, so
// without it latest is unknown. Declare the type beside the route, import both sides.
\`\`\`
events() frames JSON, sends a keepalive, sets text/event-stream + no-store,
ends the generator on disconnect (signal). EventSource reconnects itself and
resumes with Last-Event-ID when you yielded ids.

NO LIBRARY NEEDED. Both hooks ARE state: read data (polling) or latest
(events) and render it. Neither needs TanStack or SWR.
  const { latest } = useEvents<Status>(url); const current = latest ?? initial   // the server value until the first message
WITH A STORE - when the value already lives somewhere, hand every value on so
that stays the truth: a useState, a reducer, or a cache library:
  useEvents<Order>(url, { onMessage: setOrder })                                            // useState
  useEvents<Order>(url, { onMessage: (m) => dispatch({ type: 'update', m }) })              // reducer
  useEvents<Order>(url, { onMessage: (m) => queryClient.setQueryData(['order', id], m) })  // TanStack
  useEvents<Order>(url, { onMessage: (m) => mutate(['order', id], m, false) })             // SWR
  usePolling(read, { every, onData: setSeats })
STABLE CALLBACKS: a callback a timer/subscription/listener calls that must see
the latest props is useEffectEvent from React (19.2+), never a ref assigned
each render, and never in a dependency array. Both hooks are built on it.

ERRORS: both hooks expose error as state AND fire onError - a failed poll read
(the next interval still reads) or a dropped stream (EventSource reconnects
itself). Use onError for a toast/log; do NOT watch error in a useEffect.
usePolling's onError gets (error, { failures }) - failed reads in a row, reset
by a success - so toast on the third, not the first.
fetchQuery(query, args) types args from the query: fetchQuery(getSeats) for a
query that takes nothing, fetchQuery(status, [{ id }]) refused if the query's
input has no id.
Do NOT put a stream on query() or on a server action, and do NOT poll from
inside an events() generator.

Full guides: read_guide({ slug: 'queries' }) for polling, read_guide({ slug:
'api-routes' }) for the streaming route.`,
  },
  {
    topic: 'images',
    summary: 'Responsive images with no optimizer - unpic for a CDN, imagetools for files in the repo',
    body: `There is NO image component and NO image server. Do not add next/image or
write an optimizer route. next/image is a srcset-writing component plus a
resize-on-request process; the first is a library, the second belongs to the
CDN.

An image on a CDN (Cloudinary, imgix, Cloudflare Images, Bunny, Vercel,
Netlify, ...): @unpic/react. Plain component, works in a server component,
ships no javascript, detects the CDN from the url:

\`\`\`tsx
import { Image } from '@unpic/react'

<Image src="https://res.cloudinary.com/demo/image/upload/sample.jpg" layout="constrained" width={800} height={600} alt="..." />
\`\`\`

A file in the repo, a handful of them: vite-imagetools, resized ONCE at build
time. Add imagetools() to the vite plugins, then:

\`\`\`tsx
import hero from '../hero.png?w=400;800;1200&format=webp&as=srcset'
import heroSrc from '../hero.png?w=800&format=webp'

<img srcSet={hero} src={heroSrc} sizes="(min-width: 800px) 800px, 100vw" width={800} height={600} alt="..." />
\`\`\`

Declare the query tails in src/images.d.ts, or the build's typecheck stops on
the imports (a pattern may hold ONE *, so '*?*' matches nothing):

  declare module '*&as=srcset' { const srcset: string; export default srcset }
  declare module '*&format=webp' { const url: string; export default url }

Hundreds of files in the repo: that is a CDN's job; move them and use unpic.
An icon or a logo: a plain <img>, or inline the svg.

Full guide: read_guide({ slug: 'images' }).`,
  },
  {
    topic: 'scripts',
    summary: 'Third-party scripts - analytics, tag managers - without a Script component',
    body: `Write the script tag. React 19 does what Next's Script component existed for.

An external script with async, rendered from a server component, is HOISTED
into head and DEDUPLICATED by React - the same src in three components is one
tag. That is afterInteractive:

\`\`\`tsx
<script async src="https://www.clarity.ms/tag/abc123" />
\`\`\`

An inline snippet renders where it is written and runs during parse, before
hydration - the earlier moment, which is what an analytics snippet wants:

\`\`\`tsx
<script id="ms-clarity" dangerouslySetInnerHTML={{ __html: '...' }} />
\`\`\`

Put site-wide scripts in the ROOT LAYOUT, which renders once and is kept
across navigations.

There is no Script component to import. The only case needing one - a script
that touches DOM React rendered, or an onLoad callback - is a client component
with useEffect that creates the tag. Ten lines of the user's own.`,
  },
  {
    topic: 'testing',
    summary: 'Unit-testing actions, queries and routes; the whole app without a port',
    body: `Almost everything is a function. Any test runner works.

**Actions, queries, api routes: import and call.** "use server" is a string in
a test file, so the function is importable. An action built on the action
client runs its whole middleware chain when called and RETURNS its failures:

\`\`\`ts
const result = await createPost({ title: '' })
expect(result.validationErrors).toEqual({ title: ['too short'] })
\`\`\`

An api route takes a Request and the context the engine gives it - params is a
PROMISE:

\`\`\`ts
const res = await GET(new Request('https://app.test/api/x'), { params: Promise.resolve({ id: '1' }) })
\`\`\`

**Anything reading cookies() or headers():** open the request scope yourself.

\`\`\`ts
import { withRequest } from '@rsc-kit/core/request'
await withRequest(new Request('https://app.test/', { headers: { Cookie: 'session=abc' } }), currentUser)
\`\`\`

**The whole app as Request -> Response, no port:**

\`\`\`ts
import { createTestApp } from '@rsc-kit/core/testing'
const app = await createTestApp()
const res = await app.fetch('/admin', { redirect: 'manual' })   // real router, real middleware
\`\`\`

It builds when the source is newer than the last build - the first run pays,
the rest do not. This is where a guard that never ran or a 404 that came back
200 shows up.

**What still needs a browser:** a server action called OVER THE WIRE (the id is
React's and private), hydration, navigation. Playwright against vite preview.
That limit is narrower than Next's: the action's logic is a unit test here.

**What to write when you add something.** Before running check, not after:

- A guarded route (middleware.ts, or a page reading the session): a stranger
  is turned away, and someone signed in gets 200.
  \`\`\`ts
  expect((await app.fetch('/admin', { redirect: 'manual' })).status).toBe(302)
  expect((await app.fetch('/admin', { headers: { Cookie: 'session=ada' } })).status).toBe(200)
  \`\`\`
- An action: its refusal, by calling it. Bad input answers validationErrors;
  a stranger answers serverError (or throws ServerAuthenticationError if you
  built it without the client).
  \`\`\`ts
  expect((await createPost({ title: '' })).validationErrors).toBeDefined()
  \`\`\`
- An action that takes an id: someone else's id is refused. This is the IDOR
  test and the one most often missing.
- A query: the shape of its answer, and what a filter changes.
- An api route: status, content-type, and the 4xx it answers to a bad body.
- A page that should stay static: assert on the build report - no test, a CI
  check that build-report.json still says frozen for it.

Do NOT start a dev server, spawn a process or pick a port in a test. Do NOT
add a second runner. The one in tests/ goes through the real build already.`,
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
    // The summary is prose, so a multi-word ask is matched with its spaces back.
    RECIPES.find((r) => r.summary.toLowerCase().replace(/[-\s]+/g, ' ').includes(wanted.replace(/-/g, ' ')))

  if (!found) return `No topic "${topic}".\n\n${listTopics()}`

  return `# ${found.topic} — ${found.summary}\n\n${found.body}`
}

/** For tests, so a recipe cannot be added without being reachable. */
export const TOPICS = RECIPES.map((r) => r.topic)
