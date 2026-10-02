# @rsc-kit/mcp

An MCP server over an [rsc-kit](https://rsc-kit.dev) app: what the build
decided, and how to build things the way this framework expects.

A scaffolded project already has it in `.mcp.json`. To add it by hand:

```sh
claude mcp add rsc-kit -- bunx @rsc-kit/mcp      # or: npx -y @rsc-kit/mcp
```

Point it at a project other than the working directory by passing the path:

```sh
claude mcp add rsc-kit -- bunx @rsc-kit/mcp /path/to/app
```

Any other MCP client takes the same stdio entry: command `bunx` (or `npx`),
argument `@rsc-kit/mcp`. Run by hand, it waits on stdin for a client, so
printing nothing is it working.

## What it answers

**From the last build** — `build-report.json`, which every build writes:

- `list_routes` — every route, what happened to it, what it ships
- `explain_route` — why one url is stored or rendered per request
- `what_is_dynamic` — the routes that are not stored, with reasons
- `heaviest_routes` — what costs the browser most

**From the guides** — the patterns that differ from Next and plain React in
ways that compile either way:

- `list_topics` / `how_to` — the short answer: forms, prefetching, validation,
  the action client, data loading with TanStack Query or SWR, Suspense,
  offline, PWA, no-javascript, api routes, authorization, and why a page is
  dynamic
- `list_guides` / `read_guide` / `search_guides` — the full docs guides,
  bundled into the package at build time, so they match the installed version

## Notes

Everything is read-only. There is no tool here that edits, builds or deploys —
an agent already has a shell for those, and a server that can change a project
is one that can change it while answering a question about it.

Answers come from the last build, and every one of them says how old it is. If
there has been no build, it says so rather than reporting that there are no
routes.

bunx caches the copy it downloaded first. To pick up a newer release, clear
that cache:

```sh
rm -rf "$TMPDIR"bunx-*-@rsc-kit
```

Docs: https://docs.rsc-kit.dev/guides/mcp
