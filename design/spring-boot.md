# A Spring Boot adapter

Status: **design, not built.** Build it when there is a Spring application to
put behind it, as Go had a real service to port and Laravel had the docs app.
An adapter designed against no application gets the defaults wrong.

This is how `rsc-kit` would sit in front of a Spring Boot backend: what the
application writes, how each part of the host protocol maps onto Spring, and
the few places where Spring needs care. The protocol itself is in
[PROTOCOL.md](../PROTOCOL.md) and the backend guide
(`docs/src/content/docs/hosts/your-own-backend.mdx`); this document doesn't
restate it.

## What it is, and what it isn't

The renderer owns the request: routing, rendering, prerendering, static files.
Spring answers what only it can: the data, the session, whether a route may
render. So the adapter is the same small set of pieces as Go and Laravel:

1. the host-call endpoint, with single calls and NDJSON batches;
2. discovery of the functions and actions an application exposes;
3. route guards, asked as `__rsc.middleware`;
4. name versions for `refreshOn`, answered as `__rsc.changed`;
5. `rsc-host.json`, written at compile time.

Not in it: rendering, routing, a view technology, a JavaScript runtime. Spring
never starts, locates or supervises the renderer. The two processes speak
HTTP.

**Requirements:** Java 21 and Spring Boot 3.2+, on Spring MVC (the servlet
stack). Java 21 is required for virtual threads (see
[Threads](#threads)). WebFlux can come later if someone asks; nothing in the
protocol needs it.

## What an application writes

```kotlin
// build.gradle.kts
dependencies {
    implementation("dev.rsc-kit:rsc-kit-spring-boot-starter:0.1.0")
    annotationProcessor("dev.rsc-kit:rsc-kit-processor:0.1.0")
}
```

```yaml
# application.yml
rsc:
  host-call-secret: ${RSC_HOST_CALL_SECRET}   # unset: the endpoint is not registered at all
```

### Functions and actions

```java
@RscFunctions("Orders")          // the prefix: rpc('Orders.recent', 5)
@Service
class OrdersRsc {
    private final OrderRepository orders;

    OrdersRsc(OrderRepository orders) { this.orders = orders; }

    @RscFunction                                     // Orders.recent
    List<OrderView> recent(int limit) {
        return orders.recentFor(Rsc.user(), limit);
    }

    @RscAction                                       // a "use server" stub: ordersCancel(input)
    @PreAuthorize("isAuthenticated()")
    void cancel(@Valid CancelOrder input) {
        orders.cancel(input.id(), Rsc.user());
        Rsc.revalidate("orders");
    }
}

record CancelOrder(@Positive long id) {}
record OrderView(long id, String item, Instant placedAt) {}
```

- The name is `Prefix.method`. An explicit `@RscFunction("Orders.latest")`
  overrides it. Two methods with the same name fail startup and the
  annotation processor, naming both.
- `@RscAction` is also a function: an action is a function the browser may
  call through a generated stub.
- Overloads are refused. Calls are positional and untyped on the wire, so
  overloads would make the dispatch a guess.

### Guards

```java
@RscGuard("admin")               // middleware.ts: export default ['admin']
@Component
class AdminGuard implements RscGuardCheck {
    public RscGuardResult check(Authentication auth) {
        return auth != null && auth.getAuthorities().contains(ADMIN)
            ? RscGuardResult.allow()
            : RscGuardResult.redirect("/login");
    }
}
```

A guard nobody registered refuses. It never passes by default.

### Saying data changed

```java
@PostMapping("/webhooks/github")
void github(@RequestBody Push push) {
    rsc.changed("team:" + push.teamId() + ":repos");
}
```

`Rsc` is an injectable bean, plus static helpers for the request-scoped
pieces (`Rsc.user()`, `Rsc.revalidate`, `Rsc.redirect`).

## The endpoint

`POST /__rsc/host-call` (`rsc.host-call-path`), registered by
auto-configuration only when `rsc.host-call-secret` is set.

| Step | Spring |
| --- | --- |
| The secret | Checked first, before Spring Security's filters dispatch anything (an `OncePerRequestFilter` ordered ahead of the security chain). An empty configured secret refuses everyone, and is checked before the comparison. The comparison is `MessageDigest.isEqual`. Wrong or missing: 403. |
| The body | Jackson, into `{ function, args }` or `{ calls }`. Malformed: 400. A function nothing registered: 404. |
| The visitor | The renderer forwards `Cookie` and `Authorization` unchanged. The request then runs through the application's own `SecurityFilterChain` like any other, so the session, `SecurityContextHolder` and `@PreAuthorize` all see the person the page is rendered for. At build time there is no visitor and no cookie, and that is not an error. |
| CSRF | Off for this path only. The starter contributes a customizer that adds the path to `csrf().ignoringRequestMatchers(...)`. CSRF protects a browser tricked into posting with its cookies, and this caller holds a secret a browser cannot be tricked into sending. Without the exclusion, every call answers 403 from the CSRF filter. |
| Arguments | Positional. Each one goes through `ObjectMapper.convertValue` to its parameter's generic type (`JavaType` from the `Method`), so `List<Long>` and records arrive typed. A wrong arity or a value that cannot convert is a 422 with `validationErrors` under the parameter's index, not a 500: the caller sent it. |
| Validation | Bean Validation on `@Valid` parameters and on the method (`MethodValidationPostProcessor`). |

### The reply

| Thrown in Java | Status | Fields |
| --- | --- | --- |
| nothing | 200 | `result` (and `revalidate` if marked) |
| `ConstraintViolationException`, `MethodArgumentNotValidException`, `RscInvalid` | 422 | `validationErrors`, `error` |
| `AuthenticationException`, `AuthenticationCredentialsNotFoundException` | 401 | `unauthenticated: true`, `error` |
| `AccessDeniedException` (what `@PreAuthorize` throws) | 403 | `unauthorized: true`, `error` |
| `RscRedirect` (`throw Rsc.redirect("/login")`) | **200** | `redirect`, `redirectStatus` |
| `ResponseStatusException` with 4xx | that status | `error`, `refusalStatus` |
| anything else | 500 | `error` (`"Server Error"` unless `rsc.debug`), and under `rsc.debug` a `debug` block with the type and the first frames |

- **Field paths** in `validationErrors` are dot-joined (`address.city`), from
  the violation's property path. A class-level constraint goes under `""`.
- **`AccessDeniedException` for an anonymous user is a 401**, not a 403. That
  is what Spring Security's own `ExceptionTranslationFilter` decides, and the
  dispatcher asks the same `AuthenticationTrustResolver`.
- **`revalidate` is taken on every way out**, so a call that marked a region
  and then threw does not leak its mark into the next one.
- **Serialisation is the application's `ObjectMapper`**, with two checks the
  conformance suite makes: an empty list is `[]`, never `null` (Jackson's
  default for a null `List` is `null`, so the dispatcher writes `[]` where the
  declared type is a collection), and a time is ISO 8601
  (`WRITE_DATES_AS_TIMESTAMPS` off for this endpoint, whatever the app chose).
- **A failure is logged** through the app's logger before the reply. The
  endpoint answers it itself, so Spring's error handling never sees it.
- **A cookie set during a single call** (a login) rides on this response. The
  renderer puts it on the page's response.

### Batches

`{ "calls": [...] }` is answered as NDJSON through `StreamingResponseBody`,
with `Content-Type: application/x-ndjson` and `X-Accel-Buffering: no`. Each
line carries `index`, the `status` the call would have had alone, its fields,
and its own `revalidate`, and is flushed the moment that call finishes.

- **The calls run concurrently**, one virtual thread each. The renderer issued
  them in one tick precisely because they don't depend on each other, and
  Spring can do what PHP couldn't. Lines arrive in completion order, which is
  why each carries its `index`.
- **Every call is answered.** A refusal is that call's line.
- At most 50 calls; more is 413, empty is 400. Both are a single JSON reply
  written before the first line.
- **Headers leave before the first call runs**, so a cookie set by a batched
  call has nothing to ride on. Reads don't set cookies, and the engine never
  batches an action.

### Threads

Spring keeps the signed-in user (`SecurityContextHolder`), the request
(`RequestContextHolder`) and the transaction in thread-locals. That matters
twice:

- **Batched calls on their own threads** need the security context and
  request attributes copied onto each one. Spring Security's
  `DelegatingSecurityContextExecutor` wraps a virtual-thread executor for
  this, and the request attributes are set and cleared around each call.
  Transactions are never shared: each call opens its own, as it would alone.
- **A held `__rsc.changed` call waits up to 30 seconds.** On a virtual thread
  a blocked wait costs almost nothing. That is the reason for Java 21. On
  platform threads it would need `DeferredResult` and a scheduler, which is
  more code for an outcome the JDK now gives for free.

With `spring.threads.virtual.enabled=true` the whole endpoint runs on virtual
threads. The starter does not require it and does not set it.

## Guards

The engine asks the guards a route's `middleware.ts` names as the reserved
function `__rsc.middleware`, with the names as the first argument. The
dispatcher runs each named `RscGuardCheck` in order. The first that refuses
or redirects is the answer, as the reply table above encodes it. Only if all
pass is the result the literal `true`. A guard that throws is a refusal, never
a pass: any answer other than a literal `true` keeps the page from rendering.

## Name versions

`rsc.changed(names...)` moves each name's version to
`max(current + 1, now in ms)`, so a version never repeats and old names can
be pruned at any time. `__rsc.changed` is answered by holding the call until
a name the renderer holds moves or the wait runs out.

| Store | When |
| --- | --- |
| `InMemoryVersions` (the default) | One instance. `changed` wakes held calls at once, and old names are forgotten after 30 days. |
| `JdbcVersions(DataSource)` | Several instances. The shared `rsc_versions(name TEXT PRIMARY KEY, version BIGINT NOT NULL)` table; a held call reads it every second. |
| `JdbcVersions` with `notify("rsc_versions")` on Postgres | Several instances, instant. Each bump sends `pg_notify`, and the starter listens. |

**Listening is built in, unlike Go.** pgjdbc supports LISTEN natively
(`PGConnection.getNotifications(timeoutMillis)`), and a Spring app on Postgres
already has pgjdbc, so the starter can hold one dedicated connection for
listening without adding a dependency. It is enabled by
`rsc.versions.listen=true` and needs a real session, so through PgBouncer in
transaction mode it takes its own direct `rsc.versions.listen-url`. If the
connection drops, the listener retries with backoff, and held calls read the
store every second until it is back. Other announcers (Redis pub/sub, a
broadcast server) plug in through the same `VersionListener` interface.

**After commit.** `changed` inside a transaction is deferred to
`TransactionSynchronization.afterCommit`, so no tab refreshes onto data that
was then rolled back. Outside a transaction it is immediate. This is the
same guarantee Laravel's after-commit event gives.

Pruning: `JdbcVersions.prune(Duration)`, wired to a `@Scheduled` daily job by
`rsc.versions.prune=true`.

## `rsc-host.json`, at compile time

The JavaScript build runs the manifest command at every dev start and every
build. Booting a Spring context for it takes seconds, so the manifest is not
written by the running application. An **annotation processor** writes it
during `javac`, from the same annotations, in milliseconds, into
`build/generated/rsc-host.json`. A one-line Gradle or Maven task copies it to
the project root, and the app's `vite.config.ts` names that task:

```ts
rscKit({ hostManifest: { command: ['./gradlew', '-q', 'rscManifest'] } })
```

The processor emits:
- `functions`, every `@RscFunction` and `@RscAction` name, sorted;
- `actions`, mapping each action's JavaScript name (`ordersCancel`) to its
  call name (`Orders.cancel`), always an object even when empty;
- `types` and `defs`, from the method signatures.

The limit this sets: a function registered programmatically, not by
annotation, does not appear. The adapter does not offer programmatic
registration, so there is one way to expose a function, and the manifest can
always see it.

### Types

Java's signatures are fully typed, generics included, so `rpc()` comes out as
precise as with Go and more precise than with PHP:

| Java | JSON Schema |
| --- | --- |
| `int`, `long`, `Integer`, `Long` | `integer` |
| `double`, `BigDecimal` | `number` (`BigDecimal` written as a number, per Jackson's default) |
| `String`, `UUID` | `string` (`UUID` with `format: uuid`) |
| `boolean` | `boolean` |
| `Instant`, `OffsetDateTime`, `LocalDate` | `string` with `format: date-time` / `date` |
| `List<T>`, `Set<T>`, `T[]` | `array` of `T` |
| `Map<String, T>` | `object` with `additionalProperties: T` |
| `Optional<T>`, `@Nullable T` | `T`, not required / nullable |
| a record or a bean | a `defs` entry, referenced by `$ref`, one TypeScript interface each |
| an enum | `string` with `enum` |
| `Object`, a raw type, `JsonNode` | `{}`, which becomes `unknown` |
| `void` | `null` |

`@JsonProperty` names and `@JsonIgnore` are honoured, so the type matches
what Jackson actually writes. Trailing `Optional` parameters are counted as
`optional`.

## Urls Spring owns

The recommended arrangement is the **renderer in front**: the renderer forwards
any url its route tree doesn't own (`/login`, `/webhooks/...`, `/api/...`) to
`RSC_BACKEND` with `X-Forwarded-*` and `x-rsc-renderer-fallback: 1`. The app
sets `server.forward-headers-strategy=framework` so its absolute urls come
out against the public origin.

Spring in front, proxying pages to the renderer the way Laravel does, is
possible but not in the first version. A proxy holds a request thread for the
whole render while the render calls back for data, and the loop rules in the
backend guide then apply.

## Testing

- **The conformance suite** runs in CI against a fixture application that
  registers the `Conformance.*` functions and the `conformance-allow` and
  `conformance-deny` guards with the ordinary annotations, exactly as the
  backend guide lists them. This is what says the adapter is done.
- **`RscTest`**, for application tests: a MockMvc-based helper that posts a
  call the way the renderer would, with the secret and an optional user from
  `@WithMockUser`, and returns the decoded reply.
  `rscTest.call("Orders.recent", 5).result(...)`,
  `.assertUnauthenticated()`, `.validationErrors()`.
- The starter's own tests are JUnit 5 and the Spring test context, covering
  the reply table, batches, guards, versions (including a Testcontainers
  Postgres for LISTEN) and the processor's output against fixture classes.

## Modules

| Module | What |
| --- | --- |
| `rsc-kit-spring-boot-starter` | Auto-configuration, the endpoint, dispatcher, guards, versions, `Rsc` |
| `rsc-kit-processor` | The annotation processor: names, `rsc-host.json`, types |
| `rsc-kit-annotations` | The annotations alone, shared by both and with no Spring dependency |
| `rsc-kit-test` | `RscTest` |

Published to Maven Central under a group the project owns. That needs a
verified namespace before the first release, so it gates the first release
and should be claimed early.

Estimate: 1,500 to 2,500 lines of Java, about the Go adapter's size. Spring
does the heavy lifting: security, validation and JSON.

## Order of work

Each stage ends with something the conformance suite can check.

1. **Single calls.** The endpoint, the secret, discovery at startup, the reply
   table, Security and CSRF wiring. Conformance passes everything except
   batches and guards.
2. **Batches and guards.** NDJSON, virtual threads with the context copied,
   `__rsc.middleware`. Conformance passes in full.
3. **The processor.** `rsc-host.json` with types; a fixture app's
   `rpc()` typechecks against it.
4. **Versions.** In memory, JDBC, then Postgres LISTEN and after-commit
   deferral.
5. **`RscTest`, docs, and the first release**: a hosts page beside Go and
   Laravel, an MCP recipe, and a Boost-style rules file for Spring apps.

## Open questions

- **Kotlin.** Suspend functions as callables would need coroutine support in
  the dispatcher. Plain Kotlin classes work as written. Decide when a Kotlin
  app is the one behind it.
- **WebFlux.** Leave it out until asked. A reactive dispatcher is a second
  implementation of the reply table, and two implementations drift.
- **Spring Security absent.** An app without it gets no session, so
  `unauthenticated` can only come from the app's own `RscUnauthenticated`.
  Support it, but the docs should lead with Security.
- **Records only for `defs`?** Beans with getters work through Jackson, but
  their nullability is guesswork without annotations. Probably support both,
  and recommend records.
