# View transitions

> What React's ViewTransition animates in an app built with this, and what it does not.

React 19.3 ships [`<ViewTransition>`](https://react.dev/reference/react/ViewTransition),
which animates a change by handing it to the browser's View Transition API.
You can use it here. There is nothing to turn on, and no wrapper this package
provides — it is React's component, used directly.

It has one boundary worth knowing before you reach for it, because the failure
is silence: a transition that does not run looks exactly like one you styled
badly.

| the change comes from | animates |
| --- | --- |
| your own `useState`, inside `startTransition` | yes |
| a server action's result, put into state | yes |
| `<Form>` — errors, success, optimistic updates | yes |
| a streamed `<Suspense>` boundary arriving | yes, React does this on its own |
| navigating to another page | yes, behind a flag |

## What works

Ordinary React. Give the changing element a `key` so React sees a replacement
rather than an edit, and commit inside `startTransition`:

```tsx
'use client';

import { useState, startTransition, ViewTransition } from 'react';
import { addToTotal } from '../actions';

export function Total() {
  const [total, setTotal] = useState<number | null>(null);

  return (
    <>
      <ViewTransition>
        <p key={String(total)}>{total ?? '—'}</p>
      </ViewTransition>

      <button
        onClick={() =>
          startTransition(async () => {
            const next = await addToTotal(1);

            startTransition(() => setTotal(next));
          })
        }
      >
        add
      </button>
    </>
  );
}
```

A server action is in the working column for a reason worth stating: its result
comes back as an ordinary return value, and what you do with it is `useState`.
That makes it a transition like any other. `<Form>` is built on `useState`
throughout, so everything it drives animates the same way.

## Navigating between pages

Off by default, because it changes how every navigation commits:

```ts title="vite.config.ts"
rscKit({ viewTransitions: true })
```

A build-time constant rather than a runtime setting, so an app that does not
ask for it does not carry the boundary at all. What it animates is the segment
a navigation replaces; what a page does inside itself needs no flag.

## Coming back to a page you were just on

A navigation to a page still being held reveals it rather than refetching it,
so the form you were filling in is still filled in. That applies to a link, not
only the back button — having one keep your work and the other throw it away is
a distinction nobody makes while using an app.

It is bounded, because the two halves pull against each other: what comes back
is the tree from when you left, so its data is from then. Thirty seconds by
default, which covers leaving a form to check something and coming straight
back. Past that a link refetches.

```ts
import { setRevealWindow } from '@rsc-kit/core/navigate';

setRevealWindow(0); // never reveal — every link is a fresh request
```

The back button is not bounded. It names a moment, and the page from that
moment is the right answer however old it is.

<Aside type="caution" title="It can hide a server that is down">
  Revealing a held page fetches nothing, so those navigations keep working
  when the backend does not. Measured with the process killed: a page visited
  moments ago still navigates, one never visited does not. That is a reveal
  window rather than offline support, and it means a dead server can go
  unnoticed for as long as the window lasts — [`useOffline`](/guides/offline)
  is what surfaces it. Actually surviving with no network is
  [`offline: true`](/guides/offline#surviving-without-one), which is a service
  worker and a different thing entirely.
</Aside>

## Requirements

`react` and `react-dom` at **19.3 or newer**. A scaffolded app pins `^19.2`, so
this is an upgrade:

```bash
npm install react@^19.3 react-dom@^19.3
```

React also documents a [`browser`](https://react.dev/reference/react-dom/browser)
api for rendering a component only in the browser — the right tool for a value
the server cannot know. It is not in 19.3 yet; see
[static generation](/guides/static-generation#a-value-that-must-not-be-frozen)
for what to do meanwhile.
