# A Python adapter

Status: **design, not built.** Build it when there is a Python application to
put behind it, as Go had a real service to port and Laravel had the docs app.
An adapter designed against no application gets the defaults wrong.

This is how `rsc-kit` would sit in front of a Python backend: FastAPI first,
Django as a second package. It covers what the application writes, how each
part of the host protocol maps onto Python, and the places where Python needs
care. The protocol itself is in [PROTOCOL.md](../PROTOCOL.md) and the backend
guide (`docs/src/content/docs/hosts/your-own-backend.mdx`); this document
doesn't restate it.

## Why Python

Of the adapters not yet written, this one has the largest audience. A great
many existing backends are Python, and AI and ML teams mostly run Python
servers: the model, the retrieval, the jobs. They often want a real frontend
in front of that service, and today they either write a separate JavaScript
backend that calls theirs or settle for a thinner UI. With an adapter, the
pages render in React and every read is a call into the Python they already
have.

## What it is, and what it isn't

The renderer owns the request: routing, rendering, prerendering, static files.
Python answers what only it can: the data, the session, whether a route may
render. So the adapter is the same small set of pieces as Go and Laravel:

1. the host-call endpoint, with single calls and NDJSON batches;
2. a registry of the functions and actions an application exposes;
3. route guards, asked as `__rsc.middleware`;
4. name versions for `refreshOn`, answered as `__rsc.changed`;
5. `rsc-host.json`, written by a command that imports the app without serving it.

Not in it: rendering, routing, templates, a JavaScript runtime. Python never
starts, locates or supervises the renderer. The two processes speak HTTP.

**Requirements:** Python 3.11+, FastAPI 0.110+ and Pydantic v2. FastAPI is
first because it is already async and Pydantic-typed, which is most of what
the protocol needs. Django comes second, as its own package (see
[Django](#django)).

## What an application writes

```sh
pip install rsc-kit            # or: uv add rsc-kit
```

```python
# app/main.py
from fastapi import FastAPI
from rsc_kit import Rsc

app = FastAPI()
rsc = Rsc(secret=settings.rsc_host_call_secret)   # None or "": the endpoint is not mounted at all
app.include_router(rsc.router)                    # POST /__rsc/host-call
```

### Functions and actions

```python
# app/rsc/orders.py
from datetime import datetime

from fastapi import Depends
from pydantic import BaseModel, PositiveInt
from rsc_kit import revalidate

from app.auth import User, current_user, require_user
from app.main import rsc

class OrderView(BaseModel):
    id: int
    item: str
    placed_at: datetime

class CancelOrder(BaseModel):
    id: PositiveInt

@rsc.function("Orders.recent")
async def recent(limit: int, user: User = Depends(current_user)) -> list[OrderView]:
    return await orders.recent_for(user, limit)

@rsc.action("Orders.cancel")                      # a "use server" stub: ordersCancel(input)
async def cancel(input: CancelOrder, user: User = Depends(require_user)) -> None:
    await orders.cancel(input.id, user)
    revalidate("orders")
```

- **The name is given, not derived.** `Orders.recent` is written once, in the
  decorator, so renaming a Python function never silently renames what
  JavaScript calls. Two functions with the same name fail at import, naming
  both.
- **Positional arguments are the parameters without a default `Depends`.**
  `recent` takes one argument from the wire, `limit`. `user` comes from the
  request, through FastAPI's own dependency injection, so the app's existing
  `current_user` and `require_user` work unchanged.
- **An action is also a function**: one the browser may call through a
  generated stub.
- **Sync functions work too.** A plain `def` runs in the threadpool, as a
  FastAPI route would.

### Guards

```python
from fastapi import HTTPException
from rsc_kit import Redirect

@rsc.guard("admin")                               # middleware.ts: export const middleware = ['admin']
async def admin(user: User | None = Depends(current_user)) -> None:
    if user is None:
        raise Redirect("/login")
    if not user.is_admin:
        raise HTTPException(403)
```

A guard returns nothing to pass and raises to refuse. A guard nobody
registered refuses. It never passes by default.

### Saying data changed

```python
@app.post("/webhooks/github")
async def github(push: Push):
    await rsc.changed(f"team:{push.team_id}:repos")
```

## The endpoint

`POST /__rsc/host-call` (`Rsc(path=...)`), mounted by `rsc.router` only when
the secret is set.

| Step | FastAPI |
| --- | --- |
| The secret | Checked first, in a dependency that runs before the body is read. An empty configured secret refuses everyone, and is checked before the comparison. The comparison is `hmac.compare_digest`. Wrong or missing: 403. |
| The body | Read as JSON into `{ function, args }` or `{ calls }`. Not an object, a missing `function` or `args` that isn't a list: 400. A function nothing registered: 404. |
| The visitor | The renderer forwards `Cookie` and `Authorization` unchanged. The endpoint is an ordinary route inside the app, so its session middleware and the `Depends` it already uses for authentication see the person the page is rendered for. At build time there is no visitor and no cookie, and that is not an error. |
| CSRF | FastAPI has none built in. An app that added a CSRF middleware exempts this path; the docs give the one line for the common ones. The reason is the protocol's: CSRF protects a browser tricked into posting with its cookies, and this caller holds a secret a browser cannot be tricked into sending. |
| Arguments | Positional. The registry builds one Pydantic `TypeAdapter` per function, over a tuple of its wire parameters, at decoration time. Validating `args` against it converts each one to its annotated type. A wrong count or a value that won't convert is a 422 with `validationErrors`, not a 500: the caller sent it. |
| Dependencies | Resolved with FastAPI's own `solve_dependencies` against this request, so a dependency that raises `HTTPException(401)` refuses the call the same way it would refuse a route. |

### The reply

| Raised in Python | Status | Fields |
| --- | --- | --- |
| nothing | 200 | `result` (and `revalidate` if marked) |
| `pydantic.ValidationError`, `RequestValidationError`, `rsc_kit.Invalid` | 422 | `validationErrors`, `error` |
| `HTTPException(401)`, `rsc_kit.Unauthenticated` | 401 | `unauthenticated: true`, `error` |
| `HTTPException(403)`, `rsc_kit.Unauthorized` | 403 | `unauthorized: true`, `error` |
| `rsc_kit.Redirect("/login")` | **200** | `redirect`, `redirectStatus` |
| `HTTPException` with any other 4xx or 5xx, `rsc_kit.refuse(429, "Slow down.")` | that status | `error`, `refusalStatus` |
| anything else | 500 | `error` (`"Server Error"` unless `debug`), and under `debug` a `debug` block with the type, the message and the frames, newest first |

- **Field paths** in `validationErrors` come from each Pydantic error's `loc`,
  dot-joined (`address.city`). A model-level error goes under `""`. The
  leading argument index is dropped when the function takes a single model,
  so a form's fields line up with its inputs.
- **`revalidate` is a context variable**, set per call and read on every way
  out, so a call that marked a region and then raised does not leak its mark
  into the next one, and concurrent calls never see each other's.
- **Serialisation** goes through the function's return annotation with
  Pydantic (`TypeAdapter(ReturnType).dump_python(value, mode="json")`), the
  same way a FastAPI route serialises its `response_model`. That makes two of
  the conformance suite's checks automatic: `datetime` becomes ISO 8601, and
  a `list[...]` annotation can never come out as `null`. A function with no
  annotation is dumped as-is and typed `unknown` in the manifest.
- **A failure is logged** through the `rsc_kit` logger before the reply. The
  endpoint answers it itself, so the app's exception handlers never see it.
- **A cookie set during a single call** (a login) rides on this response. The
  renderer puts it on the page's response.

### Batches

`{ "calls": [...] }` is answered as NDJSON through a `StreamingResponse`, with
`Content-Type: application/x-ndjson` and `X-Accel-Buffering: no`. Each line
carries `index`, the `status` the call would have had alone, its fields, and
its own `revalidate`, and is written the moment that call finishes.

- **The calls run concurrently** on the event loop, one task each
  (`asyncio.TaskGroup` with each call's errors caught, so one failing call
  never cancels the others). The renderer issued them in one tick precisely
  because they don't depend on each other. Lines arrive in completion order,
  which is why each carries its `index`.
- **Every call is answered.** A refusal is that call's line.
- At most 50 calls; more is 413, and an empty `calls` is 400. Both are a single
  JSON reply written before the first line.
- **Headers leave before the first call runs**, so a cookie set by a batched
  call has nothing to ride on. Reads don't set cookies, and the engine never
  batches an action.

### Concurrency

Each call runs in its own `contextvars` context, copied from the request's,
which is how `revalidate` and anything else request-scoped stays with its own
call. Two things need care:

- **A sync function blocks a threadpool thread**, as a sync FastAPI route
  does. Starlette's default pool has 40 threads. That is fine for reads, but a
  batch of slow sync calls can use them up; the docs recommend `async def`
  for anything that waits on I/O.
- **A held `__rsc.changed` call waits up to 30 seconds** as an `await` on an
  `asyncio.Event`, which costs a coroutine, not a thread. Under several
  Uvicorn workers each worker holds its own; see [Name versions](#name-versions)
  for how they hear each other.

## Guards

The engine asks the guards a route's `middleware.ts` names as the reserved
function `__rsc.middleware`, with the names as the first argument. The
dispatcher runs each named guard in order, outermost first. The first that
raises is the answer, encoded as the reply table above encodes it. Only if all
pass is the result the literal `true`. A guard that crashes is a 500 without a
`refusalStatus`, and that is still a refusal: any answer other than a literal
`true` keeps the page from rendering.

## Name versions

`rsc.changed(*names)` moves each name's version to `max(current + 1, now in
ms)`, so a version never repeats and old names can be pruned at any time.
`__rsc.changed` is answered by holding the call until a name the renderer holds
moves or the wait runs out, capped at 30 seconds.

| Store | When |
| --- | --- |
| `MemoryVersions` (the default) | One process. `changed` wakes held calls at once, and old names are forgotten after 30 days. |
| `SqlVersions(engine)` | Several processes, or several Uvicorn workers, which are separate processes. The shared `rsc_versions(name TEXT PRIMARY KEY, version BIGINT NOT NULL)` table, through SQLAlchemy's async engine. A held call reads it every second. |
| `SqlVersions(engine, notify="rsc_versions")` on Postgres | Several processes, instant. Each bump sends `pg_notify`, and the adapter listens. |
| `RedisVersions(redis)` | Apps that already run Redis: versions in a hash, announcements over pub/sub. |

**Listening is built in, unlike Go.** Both Postgres drivers can listen:
asyncpg with `connection.add_listener`, psycopg 3 with `connection.notifies()`.
The adapter detects which the app's engine uses and holds one dedicated
connection for it, so it adds no dependency. LISTEN needs a real session, so
through PgBouncer in transaction mode it takes its own direct `listen_url`. If
the connection drops, the listener retries with backoff, and held calls read
the store every second until it is back.

**Workers are processes.** Uvicorn's `--workers 4` and Gunicorn's workers are
separate processes, so `MemoryVersions` there is four stores that don't share.
The adapter warns once at startup when it sees more than one worker with the
memory store, the same warning the JavaScript side gives.

**After commit.** `changed` doesn't know about the app's transaction, because
Python has no single one. The docs show calling it after `commit()`, and
`SqlVersions` takes an optional `session` so the bump and the notification go
out in the app's own transaction and are sent only if it commits.

Pruning: `await store.prune(days=30)`, from whatever scheduler the app already
runs. There is also `python -m rsc_kit prune-versions` for cron.

## `rsc-host.json`, without serving the app

The JavaScript build runs the manifest command at every dev start and every
build. Importing a FastAPI app is fast; serving it is not needed. So the
command imports the module, reads the registry and writes the file, without
running the lifespan or opening a database connection:

```sh
python -m rsc_kit manifest app.main:app          # writes rsc-host.json beside vite.config.ts
python -m rsc_kit manifest app.main:app --print  # to stdout
```

```ts
rscKit({ hostManifest: { command: ['uv', 'run', 'python', '-m', 'rsc_kit', 'manifest', 'app.main:app'] } })
```

The registry only knows the functions in modules that were imported, which is
the one limit of discovering by decorator. `Rsc(modules=["app.rsc"])` names
the packages whose submodules are imported first, so a function in a module
nothing else imports still appears. The command fails, naming the module, if
an import fails, rather than writing a manifest with functions missing.

The file has:
- `functions`, every name, sorted;
- `actions`, mapping each action's JavaScript name (`ordersCancel`) to its
  call name (`Orders.cancel`), always an object even when empty;
- `types` and `defs`, from the annotations.

### Types

Pydantic writes the JSON Schema: `TypeAdapter(tuple[...]).json_schema()` for
the parameters and `TypeAdapter(ReturnType).json_schema(mode="serialization")`
for the result. Its `$defs` are rewritten to the manifest's `#/defs/Name`.

| Python | JSON Schema |
| --- | --- |
| `int` | `integer` |
| `float`, `Decimal` | `number` (Pydantic dumps `Decimal` as a string in JSON mode; the adapter's default is a number, and the schema says which) |
| `str`, `UUID` | `string` (`UUID` with `format: uuid`) |
| `bool` | `boolean` |
| `datetime`, `date` | `string` with `format: date-time` / `date` |
| `list[T]`, `tuple[T, ...]`, `set[T]` | `array` of `T` |
| `dict[str, T]` | `object` with `additionalProperties: T` |
| `T \| None`, a parameter with a default | nullable / optional (trailing defaults are counted as `optional`) |
| a `BaseModel`, `TypedDict` or dataclass | a `defs` entry, referenced by `$ref`, one TypeScript interface each |
| an `Enum`, `Literal[...]` | `string` with `enum` |
| `Any`, no annotation | `{}`, which becomes `unknown` |
| `None` | `null` |

Field aliases are honoured, so the type matches what is actually sent.

## Django

Django is the second most common Python backend and gets its own package,
`rsc-kit-django`, sharing the registry, the reply table, versions and the
manifest command with the core package. What differs:

- **The endpoint is a view** in `urls.py`: `path("__rsc/host-call", rsc.view)`.
- **The visitor comes from Django's own middleware.** `SessionMiddleware` and
  `AuthenticationMiddleware` run on the forwarded cookie, so `request.user` is
  the visitor. A function asks for it with a `request` parameter, which is
  excluded from the wire arguments.
- **CSRF**: the view is `@csrf_exempt`, for the protocol's reason.
- **Errors**: `PermissionDenied` is 403, `Http404` is a 404 refusal,
  `django.core.exceptions.ValidationError` is 422 with its `message_dict`.
- **Sync or async**: functions may be either. The view is async, and sync
  functions go through `sync_to_async`, so a held `__rsc.changed` call
  doesn't hold a worker under ASGI. **Under WSGI it does**, for up to 30
  seconds, so with WSGI the adapter answers `__rsc.changed` at once, as
  Laravel does under PHP-FPM, and the renderer asks again on its interval.
  Both are conformant.
- **Versions**: the `SqlVersions` table as a Django model and migration, and
  the bump inside `transaction.on_commit`.
- **Manifest**: `python manage.py rsc_host_manifest`, after `django.setup()`,
  with the apps' `rsc` modules imported the way `admin` modules are.

## Urls Python owns

The recommended arrangement is the **renderer in front**: the renderer forwards
any url its route tree doesn't own (`/login`, `/webhooks/...`, `/api/...`) to
`RSC_BACKEND` with `X-Forwarded-*` and `x-rsc-renderer-fallback: 1`. The app
trusts the renderer as a proxy (Uvicorn's `--forwarded-allow-ips`, Django's
`SECURE_PROXY_SSL_HEADER` and `USE_X_FORWARDED_HOST`) so its absolute urls
come out against the public origin.

Python in front, proxying pages to the renderer, is not in the first version.
A proxy holds a worker for the whole render while the render calls back for
data, and with a small pool that is the loop the backend guide warns about.

The host-call endpoint must not face the internet: bind it to loopback,
restrict it at the proxy, or serve it on a unix socket (`uvicorn --uds`).

## Testing

- **The conformance suite** runs in CI against a fixture application that
  registers the `Conformance.*` functions and the `conformance-allow` and
  `conformance-deny` guards with the ordinary decorators, exactly as the
  backend guide lists them. This is what says the adapter is done. Both
  FastAPI and Django run it.
- **`rsc_kit.testing.RscClient`**, for application tests: built on the app's
  `TestClient` (or Django's `Client`), it posts a call the way the renderer
  would, with the secret and an optional cookie, and returns the decoded reply.
  `client.call("Orders.recent", 5).result`, `.validation_errors`,
  `.assert_unauthenticated()`. Works with pytest and with `unittest`.
- The package's own tests are pytest, covering the reply table, batches,
  guards, versions (Postgres through testcontainers for LISTEN, with both
  asyncpg and psycopg) and the manifest command against fixture modules.

## Packages

| Package | What |
| --- | --- |
| `rsc-kit` (import `rsc_kit`) | The registry, the reply table, versions, the manifest command, the FastAPI router, `rsc_kit.testing` |
| `rsc-kit-django` | The Django view, `request.user`, the model and migration, the management commands |

Published to PyPI. Typed (`py.typed`) and checked with mypy and pyright, since
an app's editor is where most of the API is discovered.

Estimate: 1,200 to 2,000 lines of Python for the core and FastAPI, about the
Laravel adapter's size, and 400 to 600 more for Django. Pydantic and FastAPI
do the heavy lifting: validation, schemas and dependency injection.

## Order of work

Each stage ends with something the conformance suite can check.

1. **Single calls.** The router, the secret, the registry, argument
   validation, `Depends`, the reply table. Conformance passes everything
   except batches and guards.
2. **Batches and guards.** NDJSON over concurrent tasks, `__rsc.middleware`.
   Conformance passes in full.
3. **The manifest.** `python -m rsc_kit manifest` with types; a fixture app's
   `rpc()` typechecks against it.
4. **Versions.** In memory, SQL, then Postgres LISTEN (asyncpg and psycopg),
   the several-workers warning and committing with the app's session.
5. **`RscClient`, docs, and the first release**: a hosts page beside Go and
   Laravel, an MCP recipe, and a rules file for Python apps.
6. **Django**, as `rsc-kit-django`, running the same conformance suite.

## Open questions

- **Flask and Litestar.** Flask is sync and has no dependency injection, so it
  would need its own way to give a function the user, plus the WSGI answer for
  `__rsc.changed`. Litestar is close to FastAPI. Decide when an app on either
  is the one behind it.
- **Positional or keyword.** The wire is positional because `rpc()` is.
  Python callers are used to keywords; a function taking one model keeps the
  JavaScript side to one object argument. The docs should probably recommend
  that for anything with more than two arguments.
- **Pydantic v1.** Not supported. It's past end of life, and its schemas
  differ enough to make a second code path.
- **Where the registry lives.** `Rsc()` as an app-level object is explicit but
  means importing `app.main` from every `rsc` module. A module-level default
  registry is shorter and makes test isolation harder. The explicit one is the
  safer default.
