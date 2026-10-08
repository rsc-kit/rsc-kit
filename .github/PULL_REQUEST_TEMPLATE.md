## What changed

<!-- One or two lines. -->

## Security

Tick what applies, or delete the section if none do.

- [ ] Reads a request header, or changes how one is used
- [ ] Changes what the server renders, or how much of the layout chain runs
- [ ] Touches `_rsc/action`, `revalidate`, interception, or the prerendered/asset readers
- [ ] Adds or changes per-request state (`AsyncLocalStorage`, a module-level cache)

If any are ticked: a client-supplied header may narrow what is **sent**, never
what is **run** (`PROTOCOL.md`, Part 3b). Add the negative test —
`tests/js/protocolAbuse.test.ts` — that fails without the change.

## What agents are told

Tick what applies, or delete the section if the change is not visible to an app.

- [ ] A guide in `docs/` says it
- [ ] `how_to` (`packages/mcp/src/recipes.ts`) says it, and `FACTS` in `packages/mcp/tests/coverage.test.ts` has a line for it
- [ ] The new-project `AGENTS.md` or lint config says it (`packages/create`)
- [ ] The Boost skill and the Go README have a PR open, to merge after the release

## Checks

- [ ] `bun run check`
- [ ] `bun run verify:package` (if the published surface changed)
