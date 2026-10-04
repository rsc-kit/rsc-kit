# A Rust adapter

Status: **design, not built.** Build it only when there is a Rust application
to put behind it. Of the three adapter designs here, this is the one with the
weakest case for building it ahead of demand.

This is how `rsc-kit` would sit in front of a Rust backend on axum: what the
application writes, how each part of the host protocol maps onto Rust, and
the places where Rust needs care. The protocol itself is in
[PROTOCOL.md](../PROTOCOL.md) and the backend guide
(`docs/src/content/docs/hosts/your-own-backend.mdx`); this document doesn't
restate it.

## Why Rust, and why not

**Rust's speed does not make rsc-kit pages faster.** The adapter is not where
the time goes:
- one host call costs about 30–50 µs over loopback, most of it TCP (measured
  when the socket protocol was replaced);
- a page's database queries and React rendering cost milliseconds, and the
  rendering happens in the JavaScript renderer whatever the backend is
  written in.

A Rust adapter would make the tens-of-microseconds hop a little shorter, and
no visitor would notice. A team choosing a backend language *for* rsc-kit has
no reason to choose Rust over Go, and either way they still run a JavaScript
process for the renderer.

**The value is the same as every adapter's: keeping a backend in the language
it is already in.** The people this suits already have an axum or tower
service and want a React frontend in front of it without writing a second
backend in JavaScript. That group exists, and is smaller than Python's,
Java's or .NET's. AI making Rust cheaper to write doesn't change the decision,
because the renderer stays JavaScript.

What Rust does offer is a reply table the compiler checks and types for
`rpc()` as precise as Go's. Those are reasons it would be a good adapter, not
reasons to build it before someone needs it.

## What it is, and what it isn't

The renderer owns the request: routing, rendering, prerendering, static files.
Rust answers what only it can: the data, the session, whether a route may
render. So the adapter is the same small set of pieces as Go and Laravel:

1. the host-call endpoint, with single calls and NDJSON batches;
2. a registry of the functions and actions an application exposes;
3. route guards, asked as `__rsc.middleware`;
4. name versions for `refreshOn`, answered as `__rsc.changed`;
5. `rsc-host.json`, written by a small binary in the app's own crate.

Not in it: rendering, routing, templates, a JavaScript runtime. Rust never
starts, locates or supervises the renderer. The two processes speak HTTP.

**Requirements:** stable Rust (2021 edition or later), tokio, and axum 0.7+.
The endpoint is a tower service, so another tower-based framework can mount
it, but axum is the one documented and tested.

## What an application writes

```toml
# Cargo.toml
[dependencies]
rsc-kit = { version = "0.1", features = ["postgres"] }
serde = { version = "1", features = ["derive"] }
schemars = "0.8"
```

```rust
// src/main.rs
let rsc = rsc_kit::Host::new(std::env::var("RSC_HOST_CALL_SECRET").ok())  // None or "": no endpoint
    .functions(rsc_kit::collect!())
    .state(app_state.clone());

let app = Router::new()
    .merge(rsc.router())                          // POST /__rsc/host-call
    .route("/webhooks/github", post(github))
    .layer(session_layer)                         // the app's own, e.g. tower-sessions
    .with_state(app_state);
```

### Functions and actions

```rust
#[derive(Serialize, JsonSchema)]
struct OrderView { id: i64, item: String, placed_at: OffsetDateTime }

#[derive(Deserialize, JsonSchema, Validate)]
struct CancelOrder { #[validate(range(min = 1))] id: i64 }

#[rsc_kit::function("Orders.recent")]
async fn recent(
    State(db): State<PgPool>,
    user: CurrentUser,                            // an ordinary axum extractor
    limit: i64,                                   // from the wire, positional
) -> Result<Vec<OrderView>, RscError> {
    Ok(orders::recent_for(&db, &user, limit).await?)
}

#[rsc_kit::action("Orders.cancel")]               // a "use server" stub: ordersCancel(input)
async fn cancel(
    State(db): State<PgPool>,
    user: RequireUser,
    input: Valid<CancelOrder>,
    rsc: Call,                                    // revalidate, per call
) -> Result<(), RscError> {
    orders::cancel(&db, input.id, &user).await?;
    rsc.revalidate("orders");
    Ok(())
}
```

- **Extractors come first, wire arguments after.** A parameter whose type
  implements axum's `FromRequestParts` is extracted from the request, so the
  app's existing `CurrentUser`, `State` and session extractors work
  unchanged. The rest are the positional arguments, deserialized with serde.
  The macro tells them apart by trait, at compile time.
- **The name is given, not derived.** `"Orders.recent"` is written once, in
  the attribute. Two functions with the same name are a panic at startup,
  naming both, and a failed test in the app's own `cargo test` (see
  [Testing](#testing)).
- **An action is also a function**: one the browser may call through a
  generated stub.

### Guards

```rust
#[rsc_kit::guard("admin")]                        // middleware.ts: export const middleware = ['admin']
async fn admin(user: Option<CurrentUser>) -> Result<(), RscError> {
    match user {
        None => Err(RscError::redirect("/login")),
        Some(u) if !u.is_admin => Err(RscError::Unauthorized(None)),
        Some(_) => Ok(()),
    }
}
```

A guard nobody registered refuses. It never passes by default.

### Saying data changed

```rust
async fn github(State(rsc): State<rsc_kit::Versions>, Json(push): Json<Push>) -> StatusCode {
    rsc.changed([format!("team:{}:repos", push.team_id)]).await.ok();
    StatusCode::NO_CONTENT
}
```

## Registering functions

Rust has no reflection, so something has to list the functions. Two ways,
and the design takes the explicit one:

- **`inventory`**, where each `#[rsc_kit::function]` submits itself to a
  global list at link time. No list to maintain, but it depends on linker
  behaviour that differs across platforms and fails silently: a function in a
  crate the linker dropped is simply not there.
- **`collect!()`**, the default. The attribute macro writes each function's
  registration next to it, and `collect!()` names the modules to gather from
  (`collect!(crate::rsc)`). It is one line, it can't be silently empty, and
  both the router and the manifest binary call the same function, so what is
  served and what is typed can't disagree.

## The endpoint

`POST /__rsc/host-call` (`Host::path`), routed by `rsc.router()` only when the
secret is set.

| Step | axum |
| --- | --- |
| The secret | Checked first, before the body is read. An empty configured secret refuses everyone, and is checked before the comparison. The comparison is constant-time (`subtle::ConstantTimeEq`). Wrong or missing: 403. |
| The body | serde_json, into `{ function, args }` or `{ calls }`. Not an object, a missing `function` or `args` that isn't an array: 400. A function nothing registered: 404. |
| The visitor | The renderer forwards `Cookie` and `Authorization` unchanged. The endpoint is a route inside the app's own `Router`, under its layers, so the session layer and the app's extractors see the person the page is rendered for. At build time there is no visitor and no cookie, and that is not an error. |
| CSRF | axum has none built in. An app with a CSRF layer leaves this route out of it, for the protocol's reason: CSRF protects a browser tricked into posting with its cookies, and this caller holds a secret a browser cannot be tricked into sending. |
| Arguments | Positional. The macro generates a tuple of the wire parameters and deserializes `args` into it with serde. A wrong count or a value that won't deserialize is a 422 with `validationErrors` under the argument's index, not a 500: the caller sent it. `Valid<T>` runs the `validator` crate after deserializing. |

### The reply

`RscError` is the reply table as an enum. A function returns
`Result<T, RscError>`, and `?` converts any error the app's own error type
says how to convert:

```rust
pub enum RscError {
    Invalid(BTreeMap<String, Vec<String>>),         // 422, validationErrors
    Unauthenticated(Option<String>),                // 401, unauthenticated: true
    Unauthorized(Option<String>),                   // 403, unauthorized: true
    Redirect { to: String, status: u16 },           // 200, redirect, redirectStatus
    Refuse { status: StatusCode, message: String }, // that status, error, refusalStatus
    Fail(anyhow::Error),                            // 500, error; debug only in development
}
```

| Returned or raised in Rust | Status | Fields |
| --- | --- | --- |
| `Ok(value)` | 200 | `result` (and `revalidate` if marked) |
| `RscError::Invalid`, a `validator::ValidationErrors`, a deserialization error | 422 | `validationErrors`, `error` |
| `RscError::Unauthenticated`, an extractor rejecting with 401 | 401 | `unauthenticated: true`, `error` |
| `RscError::Unauthorized`, an extractor rejecting with 403 | 403 | `unauthorized: true`, `error` |
| `RscError::Redirect` | **200** | `redirect`, `redirectStatus` |
| `RscError::Refuse`, an extractor rejecting with any other status | that status | `error`, `refusalStatus` |
| `RscError::Fail`, a panic | 500 | `error` (`"Server Error"` unless `debug`), and under `debug` a `debug` block with the error chain and backtrace frames |

- **A panic is one failed call.** Each call runs inside `catch_unwind`
  (through `FutureExt::catch_unwind`), so a panic is that call's 500 and the
  other calls in flight carry on.
- **Field paths** from `validator` are dot-joined (`address.city`). A
  struct-level error goes under `""`.
- **`revalidate` lives on the `Call` extractor**, one per call, read on every
  way out, so an error after marking a region doesn't leak the mark into the
  next call.
- **Serialisation is serde_json.** An empty `Vec` is `[]`, so that conformance
  check is automatic. Times need the `time` or `chrono` serde feature that
  writes RFC 3339; the docs say which, and the conformance suite catches the
  wrong one (a `SystemTime` serializes as an object).
- **A failure is logged** through `tracing` before the reply, with the
  function's name on the span.
- **A cookie set during a single call** (a login, through the session layer)
  rides on this response. The renderer puts it on the page's response.

### Batches

`{ "calls": [...] }` is answered as NDJSON through a streaming `Body`, with
`Content-Type: application/x-ndjson` and `X-Accel-Buffering: no`. Each line
carries `index`, the `status` the call would have had alone, its fields, and
its own `revalidate`, and is written the moment that call finishes.

- **The calls run concurrently**, as a `FuturesUnordered` on the request's
  task. They don't need `tokio::spawn`, so nothing request-scoped has to be
  `'static` or copied to another task. Lines arrive in completion order, which
  is why each carries its `index`.
- **Every call is answered.** A refusal is that call's line.
- At most 50 calls; more is 413, and an empty `calls` is 400. Both are a single
  JSON reply written before the first line.
- **Headers leave before the first call runs**, so a cookie set by a batched
  call has nothing to ride on. Reads don't set cookies, and the engine never
  batches an action.
- **Each call extracts from the same request parts.** Axum's extractors take
  `&mut Parts`, so the dispatcher clones the parts once per call. A session
  extractor that caches in the request's extensions therefore loads once for
  the batch, which is what the app would want.

### Holding calls

A held `__rsc.changed` call waits up to 30 seconds on a `tokio::sync::Notify`.
That costs a future, not a thread. A server with the default
`TimeoutLayer` shorter than 30 seconds would cut it off, so the router sets
the endpoint's own timeout and the docs say to keep app-wide timeouts above
it.

## Guards

The engine asks the guards a route's `middleware.ts` names as the reserved
function `__rsc.middleware`, with the names as the first argument. The
dispatcher runs each named guard in order, outermost first. The first `Err` is
the answer, encoded as the reply table above encodes it. Only if all pass is
the result the literal `true`. A guard that panics is a 500 without a
`refusalStatus`, and that is still a refusal: any answer other than a literal
`true` keeps the page from rendering.

## Name versions

`changed(names)` moves each name's version to `max(current + 1, now in ms)`,
so a version never repeats and old names can be pruned at any time.
`__rsc.changed` is answered by holding the call until a name the renderer
holds moves or the wait runs out.

| Store | When |
| --- | --- |
| `MemoryVersions` (the default) | One process. `changed` wakes held calls at once, and old names are forgotten after 30 days. |
| `SqlVersions` (feature `postgres`, `mysql` or `sqlite`) | Several processes. The shared `rsc_versions(name TEXT PRIMARY KEY, version BIGINT NOT NULL)` table through sqlx; a held call reads it every second. |
| `SqlVersions::notify("rsc_versions")` on Postgres | Several processes, instant. Each bump sends `pg_notify`, and the adapter listens. |

**Listening is built in, unlike Go.** sqlx has `PgListener`, which reconnects
on its own, and an app on Postgres with sqlx already depends on it, so this is
a feature flag, not a new dependency. LISTEN needs a real session, so through
PgBouncer in transaction mode it takes its own direct `listen_url`. While the
listener is reconnecting, held calls read the store every second. Other
announcers (Redis pub/sub, a broadcast server) plug in through the same
`VersionListener` trait, which is what an app on diesel or another driver
implements too.

**After commit.** `changed_in(&mut tx, names)` bumps inside the app's own sqlx
transaction, so the version moves, and the notification is sent, only if it
commits. Outside a transaction `changed` is immediate.

Pruning: `store.prune(Duration::from_secs(30 * 86_400))`, from the app's scheduler or a
`tokio::time::interval` task the docs show.

## `rsc-host.json`, from a binary

There is no reflection, so the manifest comes from the same registration the
router uses, run by a small binary in the app's crate:

```rust
// src/bin/rsc-manifest.rs
fn main() { rsc_kit::write_manifest(my_app::rsc::functions()); }
```

```ts
rscKit({ hostManifest: { command: ['cargo', 'run', '-q', '--bin', 'rsc-manifest'] } })
```

It starts nothing and connects to nothing: it walks the registrations and
writes the file. The cost is compilation. The first `cargo run` after a change
compiles the crate, so the dev server's start waits for an incremental build.
That is the same wait the developer already has for their own server, and the
docs suggest a `[profile.dev]` with dependencies optimised once, as most axum
projects already have.

The file has:
- `functions`, every name, sorted;
- `actions`, mapping each action's JavaScript name (`ordersCancel`) to its
  call name (`Orders.cancel`), always an object even when empty;
- `types` and `defs`, from the signatures.

### Types

`schemars` derives the JSON Schema from the same types serde uses, honouring
serde's attributes (`rename`, `skip`, `flatten`, `tag`), so the type matches
what is actually sent. The macro requires `JsonSchema` on every wire
parameter and every result, so a function can't be registered with a type the
manifest can't describe.

| Rust | JSON Schema |
| --- | --- |
| `i32`, `i64`, `u32`, `u64` | `integer` |
| `f64`, `rust_decimal::Decimal` | `number` (`Decimal` as a string unless its `serde-float` feature is on; the schema says which) |
| `String`, `&str`, `Uuid` | `string` (`Uuid` with `format: uuid`) |
| `bool` | `boolean` |
| `OffsetDateTime`, `DateTime<Utc>`, `Date` | `string` with `format: date-time` / `date` |
| `Vec<T>`, `[T; N]`, `HashSet<T>` | `array` of `T` |
| `HashMap<String, T>`, `BTreeMap<String, T>` | `object` with `additionalProperties: T` |
| `Option<T>` | nullable; a trailing `Option` parameter counts as `optional` |
| a struct | a `defs` entry, referenced by `$ref`, one TypeScript interface each |
| a unit-only enum | `string` with `enum` |
| an enum with data | `oneOf`, following serde's tagging, which becomes a TypeScript union |
| `serde_json::Value` | `{}`, which becomes `unknown` |
| `()` | `null` |

`i64` and `u64` are the one trap: JavaScript numbers are exact only to 2^53.
The docs say so, and an id that can exceed it should be a string on the wire.

## Urls Rust owns

The recommended arrangement is the **renderer in front**: the renderer forwards
any url its route tree doesn't own (`/login`, `/webhooks/...`, `/api/...`) to
`RSC_BACKEND` with `X-Forwarded-*` and `x-rsc-renderer-fallback: 1`. The app
reads the forwarded host and scheme (axum-extra's `Host` and a
forwarded-headers layer) so its absolute urls come out against the public
origin.

Rust in front, proxying pages to the renderer, is not in the first version.
With an async server there is no worker pool to exhaust, so it is less risky
than in PHP, but it is a second way to run the app with no one asking for it.

The host-call endpoint must not face the internet: bind its listener to
loopback, restrict it at the proxy, or serve it on a unix socket
(`tokio::net::UnixListener`).

## Testing

- **The conformance suite** runs in CI against a fixture application that
  registers the `Conformance.*` functions and the `conformance-allow` and
  `conformance-deny` guards with the ordinary attributes, exactly as the
  backend guide lists them. This is what says the adapter is done.
- **`rsc_kit::testing`**, for application tests: built on
  `tower::ServiceExt::oneshot`, it posts a call the way the renderer would,
  with the secret and an optional cookie, and returns the decoded reply.
  `host.call("Orders.recent", (5,)).await.result::<Vec<OrderView>>()`,
  `.validation_errors()`, `.assert_unauthenticated()`. It also has
  `assert_unique_names(functions())`, a one-line test that fails the build
  when two functions share a name.
- The crate's own tests cover the reply table, batches, guards, panics,
  versions (Postgres through testcontainers for LISTEN) and the manifest
  against fixture functions, plus `trybuild` tests for the macro's compile
  errors: a wire parameter without `Deserialize`, a result without
  `JsonSchema`, an extractor after a wire argument.

## Crates

| Crate | What |
| --- | --- |
| `rsc-kit` | The `Host`, the router, `RscError`, the dispatcher, versions (features `postgres`, `mysql`, `sqlite`, `redis`), the manifest writer, `testing` |
| `rsc-kit-macros` | `#[function]`, `#[action]`, `#[guard]` and `collect!`, re-exported by `rsc-kit` |

Published to crates.io. The macros crate is internal: apps depend on
`rsc-kit` alone.

Estimate: 1,800 to 2,800 lines of Rust, slightly more than Go because of the
macros and their compile-error tests. axum, serde and schemars do the heavy
lifting.

## Order of work

Each stage ends with something the conformance suite can check.

1. **Single calls.** The router, the secret, the macros, extractors before
   wire arguments, `RscError`, panics caught. Conformance passes everything
   except batches and guards.
2. **Batches and guards.** NDJSON over `FuturesUnordered`,
   `__rsc.middleware`. Conformance passes in full.
3. **The manifest.** The `rsc-manifest` binary with types; a fixture app's
   `rpc()` typechecks against it.
4. **Versions.** In memory, sqlx, then Postgres LISTEN and `changed_in` with
   the app's transaction.
5. **`testing`, docs, and the first release**: a hosts page beside Go and
   Laravel, an MCP recipe, and a rules file for Rust apps.

## Open questions

- **Frameworks other than axum.** actix-web isn't tower-based, so it would
  need its own router and extractor bridge. Leave it out until an actix app
  is the one behind it.
- **Manifest without compiling.** Parsing the source with `syn` in a
  `build.rs` would avoid running the binary, but could only see types
  written in the attribute's own crate and would re-implement serde's
  attribute rules. The binary is slower to start and always right; keep it.
- **`inventory` as an option.** Some apps would rather not maintain
  `collect!`. It could be a feature flag, documented with its platform caveat.
- **Validation crate.** `validator` is the common one; `garde` is newer.
  `Valid<T>` could be generic over a small trait so either works.
