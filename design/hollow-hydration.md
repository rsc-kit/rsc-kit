# Hydrating only what is interactive

Status: **design, spike first.** Nothing here is built. The first step is a
measurement, and the design is only worth building if the measurement says so.

## The problem

Every document visit renders the page twice. The document's render produces
the HTML; then the browser fetches the page's payload to hydrate, and that
request renders the whole page again - every server component, every query.
React's hydration rebuilds the *entire* tree in the browser and matches it
against the HTML, the product description and the footer included, so it asks
for the entire tree, and only a render can describe it.

Two fixes were tried and are not shipped:

- **Holding the document render's payload for the browser's request** (#303,
  reverted in #304). Correct with several replicas, not seamless: the request
  reaches the instance that rendered only as often as the load balancer
  happens to route it there.
- **Streaming the payload inside the document** (branch
  `spike-inline-payload`). One render, nothing held anywhere - and worse at
  24x CPU: blocking time median 0 -> 99 ms, then 134 -> 243 ms with idle
  hydration. The whole tree, decoded and hydrated while the browser is still
  building the page. The same root cause as #231.

The second failed on *how much* the browser has to process, not on where the
payload comes from. So: send the browser only what it needs.

## The idea

The browser needs to hydrate what is interactive. Everything a server
component rendered that is not interactive is already in the HTML and never
changes in the browser. In the payload the document carries for itself, each
such subtree is replaced by a **hollow** element: the same tag, no attributes,
no children.

```
server HTML:     <a href="/p/1"><img src=… srcset=…><span class="t">Drawing Glove</span></a>
payload, today:  ["$",Link,{href:"/p/1",children:[["$","img",{src,srcSet,alt,loading}],["$","span",{className,children:"Drawing Glove"}]]}]
payload, hollow: ["$",Link,{href:"/p/1",children:[["$","img",{suppressHydrationWarning}],["$","span",{suppressHydrationWarning,dangerouslySetInnerHTML:{__html:""}}]]}]
```

React adopts the server's DOM under a hollow element and does not touch it:
it does not hydrate its children (`dangerouslySetInnerHTML`), and it does not
rewrite attributes it hydrates over. Later re-renders compare the hollow props
with the same hollow props and write nothing.

**Proven** in the engine's test environment, against both React's production
and development builds (React 19.3): server HTML kept byte for byte, the
interactive part hydrated and clickable, no recoverable errors, and a later
re-render elsewhere leaves the hollow elements' attributes and text as they
were.

This keeps **one React root**. Shared context from a provider in a layout,
client navigation, pages kept alive behind back and forward, actions,
`refreshOn` - none of it changes, because the tree is the same tree with less
inside it. That is what makes this different from islands in the Astro sense,
where every interactive component is its own root and context between them
is lost.

Combined with streaming the payload in the document: one render per visit, no
second request, nothing held on any instance - and the browser decodes and
hydrates a fraction of what it did.

## What it is worth, measured

Live payloads from faster.rsc-kit.dev, the share that hollowing removes:

| Page | Payload | Removed |
| --- | --- | --- |
| a product | 41 kB | 19 kB, 47% |
| a category | 142 kB | 59 kB, 41% |
| a subcategory | 50 kB | 22 kB, 45% |
| home | 420 kB | 255 kB, 61% |

The home page is 549 product images whose `srcSet` alone is 271 kB of
payload, for elements the browser already has. Measured with streamed regions
placed where they render, with rsc-kit's own `Link` and routing boundaries
counted as pass-through (below). Without `Link` it is 35-37% on the catalogue
pages and nothing on the home page, where every image is inside a link.

Bytes are a proxy. What decides it is blocking time at 24x, measured as
before.

## The one way it goes wrong

A hollow element is an empty element *if React ever creates it fresh*. It is
only correct while React keeps the DOM the server sent. Proven too: a client
component that unmounts server-rendered children and mounts them again - a
toggle closing and reopening - brings them back empty.

So the rule for what may be hollowed is about where an element sits, not what
it is:

1. **Static**: a host element whose whole subtree has no references - no
   client component, no server action, no lazy row, no promise.
2. **Not hoistable**: never `title`, `meta`, `link`, `style`, `script`,
   `base`. React 19 matches those by their props to dedupe and hoist them.
3. **Rendered unconditionally**: its parent is a host element, or a client
   component known to render its children as given, in place, every time. An
   app's own client component is not known to: an accordion, a tab panel, a
   dialog may render its children conditionally, and children it did not
   render on the server were never in the DOM to adopt. Everything inside an
   app's client component's props is left whole.

The components known to pass children through are rsc-kit's own, recognised
by their client reference at build time, never by name at runtime:
`Link`, `SegmentBoundary`, `SlotBoundary`, `PathnameProvider`,
`LoadingBoundary`, `RedirectBoundary`, `RouteErrorBoundary`.

Two of those can render their children again:

- **`RouteErrorBoundary`** shows `error.tsx` and, on `reset()`, renders its
  children again - fresh, so hollow children would come back empty. Its reset
  must refresh the segment, which returns a full payload, instead of
  re-rendering what it held. (Worth doing regardless: a retry should ask the
  server again.)
- **`LoadingBoundary`** is a Suspense boundary. A boundary that suspends again
  hides its content rather than unmounting it, so the DOM survives; to be
  pinned by a test.

Everything that replaces a page's tree - a navigation, a refresh,
`revalidate`, a `refreshOn` section - brings a full payload, so a hollow
element never outlives the document it came with.

An app could later declare its own client components pass-through (a card
that always renders its children). Not in the first version.

## Where it is done

On the server, in the stream, once per document render:

1. The render's Flight stream is teed, as it already is. One copy becomes the
   HTML, untouched.
2. The other passes through a **row rewriter**: each model row is parsed,
   walked, and its static subtrees replaced by hollow elements, then written
   back. Rows are complete JSON lines, so this is per-row, not a parser over
   the whole stream. References to later rows (`$L…`) are not static, which
   is conservative and correct: a region that streams later is rewritten
   when its own row arrives.
3. The rewritten payload is streamed into the document, as in the
   `spike-inline-payload` branch, whose interleaving (never between two pieces
   of one React flush) and doctype placement carry over.

Navigations, refreshes and actions are unchanged: they render on the client,
with nothing to adopt, so they get the full payload as today.

The rewriter reads React's Flight row format, which is internal to React. The
engine already reads it (`clientReferenceNames`, `hasServerReference`), so
this is not a new kind of dependency, but it is a larger one: a React upgrade
that changes the element encoding must fail a test here, not a page. Pinned by
round-trip tests on real render output: the rewritten payload decodes, and
hydrates against the HTML with no recoverable error.

## Order of work

1. **Spike, measure, decide.** The rewriter, on the inline-payload branch,
   behind no flag. Measure nextfaster's product, category and home pages at
   24x CPU, 12 alternating runs each against the live 0.29.10 build, as
   before. The bar is the one #231 set: score and blocking time no worse, and
   the double render gone. If it does not clear it, it is not built, and the
   numbers are recorded here.
2. **Hardening.** `RouteErrorBoundary` reset refreshes; Suspense re-suspend
   keeps hollow DOM (test); hoistables never hollowed (test); a React upgrade
   check on the encoding.
3. **The pass-through set** resolved at build from rsc-kit's own client
   references.
4. **Docs**: what it does, and the one rule an app's own component can break
   (rendering server children conditionally is fine; they are just not
   hollowed).

## Open questions

- **Text in hollow elements.** A hollow element that held text keeps it in
  the DOM. Nothing on the client reads it - but a client component that reads
  a server child's props (`React.Children.map`, `cloneElement`) would see
  hollow props. That is why nothing inside an app's client component is
  hollowed; it is the same reason the pass-through set is closed.
- **`Link` itself.** 572 links on the home page still hydrate, each with its
  props. Hydrating fewer of them is a separate question.
- **The stored shell.** A pattern shell's resume streams the holes' payload
  the same way, and the shell's own static structure could be hollowed at
  build. The same rewriter, applied when the shell is frozen.
