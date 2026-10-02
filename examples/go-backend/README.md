# Go behind the renderer

The JavaScript half is exactly what `bun create rsc-kit` writes, plus two
lines in `.env`. The Go half is `backend/main.go`: the functions the pages
call, the guards `middleware.ts` names, and the one endpoint the renderer posts to.

```sh
bun run backend    # go run, on :8080
bun run dev        # vite: writes rsc-host.json from Go first, and wires rpc() to the backend
```

`vite.config.ts` runs `go run . -manifest` as dev and every build start
(`hostManifest`), so the actions the client imports and the names `rpc()` is
typed with are always Go's current ones. `bun test` runs `tests/app.test.ts`,
which answers the Go functions and guards in the test, with no backend running.

Open the renderer's url. `/` reads its orders from Go; the form calls a Go
server action; `/admin` is guarded by Go's `auth` and `can` and redirects to
`/login`, which Go serves and the renderer forwards to. Set a cookie
`session=valid` to get past the guard.

Production is `bun run build` and `bun run start` with the same two
variables in the process environment.
