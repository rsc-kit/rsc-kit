# Go behind the renderer

The JavaScript half is exactly what `bun create rsc-kit` writes, plus two
lines in `.env`. The Go half is `backend/main.go`: the functions the pages
call, the guards `route.ts` names, and the one endpoint the renderer posts to.

```sh
bun run backend    # go run, on :8080, writing rsc-host-actions.json first
bun run dev        # vite, which reads .env and wires rpc() to the backend
```

Open the renderer's url. `/` reads its orders from Go; the form calls a Go
server action; `/admin` is guarded by Go's `auth` and `can` and redirects to
`/login`, which Go serves and the renderer forwards to. Set a cookie
`session=valid` to get past the guard.

Production is `bun run build` and `bun run start` with the same two
variables in the process environment.
