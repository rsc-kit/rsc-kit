# create-rsc-kit

Scaffold a React Server Components app that builds and runs before you edit it.

```sh
bun create rsc-kit@latest my-app
```

It asks where the app will run (Bun, Node or Cloudflare Workers — a Nitro
preset), whether you want the React Compiler, Tailwind and, if so, shadcn/ui,
oxlint, a validation library, typed environment variables, and whether the
app should be installable. Every answer has a flag, so it runs unattended too:

```sh
bun create rsc-kit@latest my-app --host=bun --compiler=oxc --tailwind --yes
```

| Flag | What it does |
| --- | --- |
| `--host=bun\|node\|worker` | Where it runs, which picks the Nitro preset |
| `--compiler=none\|oxc\|babel` | The React Compiler; the prompt offers oxc |
| `--tailwind`, `--no-tailwind` | Include Tailwind |
| `--shadcn` | shadcn/ui, set up for RSC; needs Tailwind |
| `--lint`, `--no-lint` | Include oxlint |
| `--validation=zod\|valibot\|arktype\|none` | The schema library forms, actions and env use |
| `--env`, `--no-env` | Typed environment variables |
| `--pwa`, `--no-pwa` | Installable: offline, a manifest, starter icons (off by default) |
| `--source-dir=<dir>` | Where `app/` lives (default `src`) |
| `--backend=<url>` | A backend answering `rpc()`, such as a Go server; writes `.env` with a secret |
| `--no-install`, `--no-git` | Skip installing dependencies, or `git init` |
| `--yes` | Accept every default and ask nothing |

Use `--yes`, not `-y`, with `bun create`: Bun reads `-y` as its own flag.
`bunx create-rsc-kit my-app -y` accepts either.

The point is not the typing it saves. Several things in this setup fail by
producing an app that looks nearly right — a stylesheet with no
server-component classes in it, shadcn's components written without
`"use client"`, an engine declaration that typechecks the server and fails the
prerender. What comes out builds, prerenders, typechecks and serves.

To add rsc-kit to a project that already exists, use
[`rsc-kit init`](https://www.npmjs.com/package/rsc-kit) instead.

Docs: https://docs.rsc-kit.dev/installation · Licence: MIT
