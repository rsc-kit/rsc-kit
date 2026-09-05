# Releasing

Two long-lived branches. Work lands on `staging`, and **merging `staging` into
`main` is the release** — there is no separate publish command to remember, and
no way to ship something that did not go through CI.

```
feature branch ──PR──▶ staging ──PR──▶ main ──▶ npm + tag + GitHub release
                       (CI runs)      (CI runs again, then publishes)
```

## Cutting a release

Bump the version on `staging`, in its own pull request:

```sh
bun run version:set 0.1.1
```

That writes all three packages **and** the cross-dependencies, which is the
whole reason it is a script. The three release in lockstep and `rsc-kit`
depends on the other two, so a hand-edited bump that misses
`packages/cli/package.json` publishes a CLI pinned to an engine version that
does not exist. It installs for nobody and builds fine for us.

Then open `staging` → `main`. On merge, the release workflow:

1. reads the version and refuses to continue if the three disagree,
2. **skips silently if that version is already on npm** — so an ordinary merge
   that changes no version is a no-op, not a red build,
3. re-runs the full verification, including the packed-tarball install,
4. publishes `@rsc-kit/core`, then `create-rsc-kit`, then `rsc-kit`,
5. tags the commit and opens a GitHub release,
6. reads all three back off the registry before calling it done.

Publish order is load-bearing: `rsc-kit` depends on the other two, so shipping
it first leaves `bunx rsc-kit init` broken for anyone who tries it in the gap.

## What CI actually guards

Most of it is ordinary — typecheck, unit tests, the example build. Two jobs
exist because of specific failures that nothing else can see:

**`package`** packs and installs on both Node and Bun. In the workspace,
`node_modules/@rsc-kit/core` is a symlink resolving *outside* `node_modules`,
so Node strips types happily and shipping TypeScript looks fine — while every
real install dies with `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`. That bug
was live for every user while the monorepo was green.

**`scaffold`** installs the packed tarballs into a throwaway project and serves
it, because everything else tests the repository rather than the artifact. It
asserts three things a passing build cannot: that an unmatched route returns
`404` and is handed back to the host, that the page renders, and that React's
debug rows are absent — a development bundle renders every page perfectly and
hydrates none of them, silently.

## Requirements

- `NPM_TOKEN` — an npm **automation** token in repository secrets. A publish
  token that expects a one-time password cannot work unattended.
- Publishes use `--provenance`, which needs `id-token: write` and a public
  repository. It links each tarball to the commit and workflow that built it.
