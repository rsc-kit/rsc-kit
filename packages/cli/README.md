# rsc-kit

The command line for [rsc-kit](https://rsc-kit.dev) — React Server Components
as a Vite plugin, deployed wherever Nitro deploys.

```sh
bunx rsc-kit@latest init        # add it to the project in this directory
```

Starting from nothing instead:

```sh
bun create rsc-kit@latest my-app
```

## Commands

**`rsc-kit init`** adds rsc-kit to the project in this directory, or starts
one there if it is empty. Nothing existing is rewritten: it writes the files
you do not have, adds the dependencies you are missing, adds its entry to
list-like files (`.mcp.json`, `AGENTS.md`, `tsconfig.json`'s `include`,
`.env`) with yours left as written, and for anything else already there, such
as your vite config, prints the exact edit for you to make. In a Go module it does the JavaScript half — `package.json`, the
route tree, `vite.config.ts`, `.env` with `RSC_BACKEND` and a generated
secret — and prints the Go half ([Go](https://docs.rsc-kit.dev/hosts/go)). A
Laravel app runs it through `php artisan rsc:install`
([Laravel](https://docs.rsc-kit.dev/hosts/laravel)). `rsc-kit init --help`
lists its flags.

**`rsc-kit typegen`** writes the route types without starting Vite, for a
typecheck after a route was added. `--check` writes nothing and exits
non-zero when the committed `rsc-host.json` or route types are no longer what
the backend and the routes produce — a CI step.

Name the tag: `bunx rsc-kit init` reuses whatever copy bunx downloaded first,
while `bunx rsc-kit@latest init` fetches the current one.

Installing this package also gives you [`@rsc-kit/core`](https://www.npmjs.com/package/@rsc-kit/core),
so `import { rscKit } from '@rsc-kit/core/vite'` works after `bun add rsc-kit`.

Docs: https://docs.rsc-kit.dev · Licence: MIT
