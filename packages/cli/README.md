# rsc-kit

The command line for [rsc-kit](https://rsc-kit.dev) — React Server Components
as a Vite plugin, on any JavaScript server.

```sh
bunx rsc-kit init        # add it to a project you already have
bunx rsc-kit prerender   # render every route once and store what it can
```

Starting from nothing instead:

```sh
bun create rsc-kit my-app
```

`init` never rewrites anything that exists. It writes the files you do not have,
adds the dependencies you are missing, and for your vite config and your server
— the two files most likely to hold work that took a while to get right — it
prints the exact edit for you to make.

Installing this package also gives you [`@rsc-kit/core`](https://www.npmjs.com/package/@rsc-kit/core),
so `import { rscRoutes } from '@rsc-kit/core/vite'` works after `bun add rsc-kit`.

Docs: https://rsc-kit.dev · Licence: MIT
