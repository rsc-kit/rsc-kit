# create-rsc-kit

Scaffold a React Server Components app that builds and runs before you edit it.

```sh
bun create rsc-kit my-app
```

Asks which server (Bun, Hono, Elysia or `node:http`), whether you want the React
Compiler, and whether to include Tailwind. Every answer has a flag, so it runs
unattended too:

```sh
bun create rsc-kit my-app --host=hono --compiler=oxc --tailwind
```

The point is not the typing it saves. Several things in this setup fail by
producing an app that looks nearly right — a server that serves a development
payload to a production client, a stylesheet with no server-component classes
in it, an engine declaration that typechecks the server and fails the prerender.
What comes out has those right.

Docs: https://rsc-kit.dev · Licence: MIT
