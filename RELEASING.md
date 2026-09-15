# Releasing

Two long-lived branches and an explicit release.

```
feature branch ──PR──▶ staging ──PR──▶ main ──▶ cut a Release ──▶ staged ──▶ npm
                       (CI runs)      (CI runs)    tag vX.Y.Z              you approve
```

Merging to `main` publishes nothing. Publishing happens when you **push a
release** — the tag is the version, and cutting it is a deliberate act rather
than a side effect of a merge.

## Cutting a release

Make sure `main` is green, then:

```sh
gh release create v0.1.1 --generate-notes
```

The workflow takes the version from the tag, writes it into all four packages,
builds, verifies the packed shape, and **stages** them.

Staging is not publishing. Nothing is on the registry until you approve it:

```sh
npm stage list
npm stage approve <id>    # core, create, mcp, then rsc-kit
```

That second step is the whole point of the arrangement. It defers
proof-of-presence to a person, so a compromised workflow — or a compromised
dependency inside the build — can stage something and cannot ship it to
everyone running `npm i`.

It also makes the ordering below survivable. Publishing directly, a failure
part-way left `rsc-kit` on the registry pinning versions that did not exist.
Staged, a failure part-way leaves the registry untouched.

**The version is not committed.** `package.json` in the repository keeps
whatever it last had; the tag decides what ships. So the repo's own version
number lags the registry, which is expected here rather than a mistake.

`scripts/versions.mjs` applies the tag's version because a bump is never one
number: the four packages release in lockstep and `rsc-kit` pins two of them,
so setting versions without rewriting those ranges publishes a CLI that depends
on an engine version which does not exist. It installs for nobody and builds
fine for us. The same script runs locally:

```sh
bun run version:set 0.1.1    # set all four, and the cross-dependencies
bun run version:check        # verify they agree
```

Approve in the order they were staged: `@rsc-kit/core`, `create-rsc-kit`,
`@rsc-kit/mcp`, then `rsc-kit`. The CLI depends on the first two, so approving
it first leaves `bunx rsc-kit init` broken for anyone who tries it in the gap.
`@rsc-kit/mcp` depends on none of them and its place in the order is free.

The workflow confirms all four were staged before it finishes, because three of
four is the state that matters — approving a partial set is the one way back
into the problem staging solves.

## What CI actually guards

Most of it is ordinary — typecheck, unit tests, the example build, which
asserts `14 static, 5 partial prerender, 2 dynamic` rather than the exit code, because a
page that stops being prerendered still works and simply renders for every
visitor forever.

Two jobs exist for failures nothing else can see.

**`package`** packs and installs on both Node and Bun. In the workspace,
`node_modules/@rsc-kit/core` is a symlink resolving *outside* `node_modules`,
so Node strips types happily and shipping TypeScript looks fine — while every
real install dies with `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`. That bug
was live for every user while the monorepo was green. It runs again in the
publish workflow, because the cost of finding out afterwards is a burnt
version number.

**`scaffold`** installs the packed tarballs into a throwaway project and serves
it, because everything else tests the repository rather than the artifact. It
asserts three things a passing build cannot: that the page renders, that an
unmatched route returns `404` and is handed back to the host — the adapter must
give back what its manifest does not claim, or it cannot be mounted inside
someone else's app — and that React's debug rows are absent, since a
development bundle renders every page perfectly and hydrates none of them.

It installs all three tarballs together on purpose. `rsc-kit` depends on the
other two by semver range, and on a version bump that range names something not
yet on the registry; given the tarballs, npm satisfies the range from them.

## Requirements

There is **no npm token**. All four packages authenticate through npm trusted
publishing over OIDC, configured once per package on npmjs.com:

| Field | Value |
| --- | --- |
| Publisher | GitHub Actions |
| Organization or user | `rsc-kit` |
| Repository | `rsc-kit` |
| Workflow filename | `publish.yml` |
| Environment name | *(blank)* |
| Allow `npm publish` | **unchecked** |

Leave **Allow `npm publish`** off. It is off by default and it should stay off:
the connection then permits only `npm stage publish`, which is exactly what the
workflow runs. Ticking it would let a workflow run put code on the registry with
no person involved, which is the thing being avoided.

**Environment name** stays blank unless the job declares a matching
`environment:`. Fill one in without the other and npm refuses the token — at the
publish step, after the release tag already exists.

Each package needs its own connection. Miss one and a release stages three of
four, which the workflow now catches rather than leaving you to notice at
approval time.

This is why the workflow carries no secret and does not pass `--provenance`:
trusted publishing attests provenance on its own, and there is no long-lived
credential in the repository to leak or rotate. It does require the job to keep
`id-token: write`, and an npm new enough to speak OIDC — hence the explicit
upgrade step, whose absence shows up as an auth failure *after* the release tag
already exists.
