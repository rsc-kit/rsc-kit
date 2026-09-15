# @rsc-kit/mcp

An MCP server over an [rsc-kit](https://rsc-kit.dev) app: what the build
decided, and how to build things the way this framework expects.

```sh
claude mcp add rsc-kit -- npx -y @rsc-kit/mcp
```

Point it at a project other than the working directory by passing the path:

```sh
claude mcp add rsc-kit -- npx -y @rsc-kit/mcp /path/to/app
```

## What it answers

**From the last build** — `build-report.json`, which every build writes:

- `list_routes` — every route, what happened to it, what it ships
- `explain_route` — why one url is stored or rendered per request
- `what_is_dynamic` — the routes that are not stored, with reasons
- `heaviest_routes` — what costs the browser most

**From the guides** — the patterns that differ from Next and plain React in
ways that compile either way:

- `list_topics` / `how_to` — forms, prefetching, validation, the action
  client, data loading with TanStack Query or SWR, Suspense, offline, PWA,
  api routes, authorization, and why a page is dynamic

## Notes

Everything is read-only. There is no tool here that edits, builds or deploys —
an agent already has a shell for those, and a server that can change a project
is one that can change it while answering a question about it.

Answers come from the last build, and every one of them says how old it is. If
there has been no build, it says so rather than reporting that there are no
routes.
