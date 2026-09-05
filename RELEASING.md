# Releasing

Two long-lived branches and an explicit release.

```
feature branch ──PR──▶ staging ──PR──▶ main ──▶ cut a GitHub Release ──▶ npm
                       (CI runs)      (CI runs)     tag vX.Y.Z
```

Merging to `main` publishes nothing. Publishing happens when you **push a
release** — the tag is the version, and cutting it is a deliberate act rather
than a side effect of a merge.

## Cutting a release

Make sure `main` is green, then:

```sh
gh release create v0.1.1 --generate-notes
```

That is the whole ceremony. The workflow takes the version from the tag, writes
it into all three packages, builds, verifies and publishes.

**The version is not committed.** `package.json` in the repository keeps
whatever it last had; the tag decides what ships. So the repo's own version
number lags the registry, which is expected here rather than a mistake.

`scripts/versions.mjs` applies the tag's version because a bump is never one
number: the three packages release in lockstep and `rsc-kit` pins the other
two, so setting three versions without rewriting those ranges publishes a CLI
that depends on an engine version which does not exist. It installs for nobody
and builds fine for us. The same script runs locally:

```sh
bun run version:set 0.1.1    # set all three, and the cross-dependencies
bun run version:check        # verify they agree
```

Publish order is `@rsc-kit/core`, `create-rsc-kit`, `rsc-kit`. The CLI depends
on the other two, so shipping it first leaves `bunx rsc-kit init` broken for
anyone who tries it in the gap. The workflow reads all three back off the
registry before it calls the release done.

## What CI actually guards

Most of it is ordinary — typecheck, unit tests, the example build, which
asserts `9 stored, 3 shells` rather than the exit code, because a page that
stops being prerendered still works and simply renders for every visitor
forever.

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

There is **no npm token**. All three packages authenticate through npm trusted
publishing over OIDC, configured once per package on npmjs.com:

| Field | Value |
| --- | --- |
| Publisher | GitHub Actions |
| Organization or user | `rsc-kit` |
| Repository | `rsc-kit` |
| Workflow filename | `publish.yml` |
| Environment name | *(blank)* |
| Allow `npm publish` | **checked** |

Two of those bite if you get them wrong. The **Allow `npm publish`** box is off
by default, and without it the connection permits only `npm stage publish`, so
the workflow fails on every package. And if you fill in **Environment name**,
the job has to declare a matching `environment:` or npm refuses the token.

This is why the workflow carries no secret and does not pass `--provenance`:
trusted publishing attests provenance on its own, and there is no long-lived
credential in the repository to leak or rotate. It does require the job to keep
`id-token: write`, and an npm new enough to speak OIDC — hence the explicit
upgrade step, whose absence shows up as an auth failure *after* the release tag
already exists.
