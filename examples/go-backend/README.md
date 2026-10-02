# Go behind the renderer

The JavaScript half is a scaffolded app: the config
`bun create rsc-kit --backend=http://127.0.0.1:8080` writes, with
`RSC_BACKEND` and `RSC_HOST_CALL_SECRET` in `.env`, plus `hostManifest` in
`vite.config.ts`. The Go half is `backend/main.go`, on
`github.com/rsc-kit/go` v0.5: the functions the pages call, the action the
form posts to, the guards `middleware.ts` names, and the one endpoint the
renderer posts to.

```sh
bun run backend    # go run, on 127.0.0.1:8080, with RSC_DEBUG=1: a failure says where in Go
bun run dev        # vite: writes rsc-host.json from Go first, and wires rpc() to the backend
```

`vite.config.ts` runs `go run . -manifest ../rsc-host.json` in `backend/` as
dev and every build start (`hostManifest`), and again under dev when anything
in `backend/` changes (`watch`). `rsc-host.json` holds Go's actions, the names
`rpc()` may be called with, and their types, so the build writes the
`"use server"` stub the form imports (`src/server-actions.generated.ts`) and
types `rpc()` from Go. Both files are generated and ignored by git.

## What the code is

`backend/main.go` registers typed Go functions:

- `reg.Handle("Orders.recent", …)` — a read. The page's
  `rpc('Orders.recent', 5)` is `Order[]` without a type argument.
- `reg.HandleAction("ordersCreate", "Orders.create", …)` — a server action
  taking `NewOrder` and answering `Created`. An empty name is a field error;
  success revalidates the page.
- `reg.Middleware("auth", …)` and `reg.Middleware("can", …)` — the guards.
  `auth` redirects to `/login` without a `session=valid` cookie.

`src/app/page.tsx` is synchronous: the heading and the form paint at once, and
only the orders list waits for Go, under its own `<Suspense>`.
`src/app/CreateOrder.tsx` passes the form's `FormData` straight to
`ordersCreate`, which sends the fields as Go's `NewOrder`.
`src/app/admin/middleware.ts` names `['auth', 'can:manage-orders']`.

## Trying it

Open the renderer's url. `/` reads its orders from Go; the form calls the Go
action; `/admin` is guarded by Go's `auth` and `can` and redirects to
`/login`, which Go serves and the renderer forwards to. Set a cookie
`session=valid` to get past the guard.

## Testing

`bun test` runs `tests/app.test.ts` with no Go process running.
`createTestApp({ host, backend })` answers `Orders.recent`, `Orders.create`
and the guards (`HOST_MIDDLEWARE`, refusing with `hostReply`) in the test, and
`backend` stands in for the urls Go serves, such as `/login`. It builds first
when the source is newer than the last build, and the build runs `go run` for
the manifest, so the Go toolchain still has to be installed.

## Production

`bun run build` and `bun run start`, with `RSC_BACKEND` and
`RSC_HOST_CALL_SECRET` in the process environment, and the Go binary running
beside it without `RSC_DEBUG`.
