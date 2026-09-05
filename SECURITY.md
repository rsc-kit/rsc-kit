# Security policy

## Reporting a vulnerability

**Please do not open a public issue.**

Use GitHub's private vulnerability reporting: the **Security** tab on this
repository → **Report a vulnerability**. It is private to the maintainers and
gives us somewhere to discuss a fix before it is public.

> Enable it once, per repository: Settings → Code security → Private
> vulnerability reporting. Until it is on, the Security tab shows no report
> button and a reporter's only option is a public issue.

What helps, roughly in order:

- The request that demonstrates it — a `curl` line is ideal, since most of the surface here is HTTP headers.
- What you expected the server to refuse, and what it did instead.
- Which host you ran (`createRscHandler` on Bun/Node/Workers, or the Laravel adapter), and the version.

You will get an acknowledgement within a few days. If a report is valid we will
agree a disclosure date with you and credit you in the advisory unless you would
rather we did not.

## Supported versions

Pre-1.0. Only the latest published version of `@rsc-kit/core` receives fixes;
there are no backports yet.

## What is in scope

Anything that lets a request do something the application did not intend:

- Reaching content or an action past a check the app wrote.
- Making the server run code the app did not ask it to run.
- Reading files outside the directories a host handed to `assets` or `prerendered`.
- Making one user's response reachable by another — through a cache, a shared
  scope, or state that outlives a request.
- Crashing or hanging a server from an unauthenticated request.

The protocol headers (`X-RSC-*`) are the largest surface and the most
interesting place to look. They are all attacker-controlled and none of them is
verifiable — see **Part 3b: the trust boundary** in
[`PROTOCOL.md`](./PROTOCOL.md) for the rule they are supposed to obey, and
`packages/core/tests/js/protocolAbuse.test.ts` for the cases already covered.

## What is not

- An application's own bugs — an app that puts a secret in a client component ships it to the browser, and that is the app's decision, not this package's.
- Server actions being callable without a session. That is what a server action *is*: a public endpoint whose id is not a secret. The check belongs inside the action, and [the docs say so](https://rsc-kit.dev/guides/authorization).
- Anything requiring the attacker to already control the server, the build, or a dependency.
- Denial of service by volume.

## Known, documented, unfixed

Kept here so a reporter does not spend time on something we already know:

- **A check written in a layout is skippable.** A navigation says which layouts it holds and the server trusts it. Checks belong in `middleware.ts`, which is never skipped; a layout is chrome and may be skipped by design. The docs say so, but nothing stops an app writing one in the wrong place.
- **No `Cache-Control` on rendered responses.** `Vary: X-RSC` is set, so a shared cache will not serve a payload as a document, but the absence of an explicit directive leaves heuristic caching to the intermediary. Not audited.
- **`X-RSC-Redirect` is followed without an origin check.** An app that redirects to a value it took from user input has an open redirect; the client does not second-guess the destination.
