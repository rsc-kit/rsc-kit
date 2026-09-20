// Reading the request from inside a render.
//
//   import { headers, cookies } from '@rsc-kit/core/request'
//
//   export default async function middleware() {
//     const locale = cookies().get('locale')?.value ?? negotiate(headers().get('accept-language'))
//     if (!locale) redirect('/en')
//   }
//
// Server components have no arguments beyond their props, and middleware has
// none at all, so without this an app on a JavaScript host cannot see a header
// — no locale negotiation, no subdomain, no cookie. The Laravel host escaped
// that through rpc(), because PHP has the request; this is the same thing for
// everyone else.
//
// Read-only on purpose. Setting a cookie means writing a response header, and
// by the time a component renders the shell may already have been flushed — an
// API that appears to set one and silently does not is worse than not having
// it. Set them in the host, which owns the response.
//
// Asynchronous on purpose too, and not for ergonomics. A build has no request,
// so a read there suspends and never settles — which is the same thing the
// prerender probe does to a host call. Anything still waiting when the probe's
// budget expires becomes a fallback in the frozen shell, so a read inside a
// Suspense boundary leaves the shell frozen and makes only that boundary
// dynamic. Reading synchronously could only mark the whole route dynamic,
// because there would be nothing to suspend on.
//
// Scoped to the request, on the same store cache() uses. Two requests in
// flight cannot see each other's headers.

import { resolveScope } from "./revalidate.js";

/** What a host can supply: a real Request, or the parts of one. */
export type RequestLike =
  Request | { url: string; headers: Record<string, string> } | null;

interface Slot {
  /** False during a build: there is nothing to answer with. */
  request: boolean;
  url: string | null;
  /**
   * Held as Headers rather than as a Request.
   *
   * `new Request(url, { headers })` drops Cookie: a spec-compliant Headers
   * built with the "request" guard refuses the forbidden header names, and
   * Cookie is one of them. `new Headers()` has no guard and keeps it. Bun
   * happens to allow both, which is why rebuilding a Request looked fine until
   * it ran anywhere stricter — and what it loses is every cookie, silently.
   */
  headers: Headers;
  original: Request | null;
  /**
   * Whether anything asked. Only for the build's report — the classification
   * comes from the suspension, not from this.
   */
  read: boolean;
  /**
   * What read it, in the order they did.
   *
   * Only the name of the accessor — `cookies()`, `headers()` — which is enough
   * for the build to say why a page could not be frozen. Without it the answer
   * is "something in this page reached for the request", and finding which is
   * the part that takes an afternoon.
   */
  readBy: string[];
  /**
   * The same reads with the component that made each one - `cookies() in
   * RootLayout` - taken from the stack at the moment of the read, which is
   * still the component's own call: an accessor runs synchronously up to
   * the point it suspends. Only the build reads this. "Reads the request" is
   * a category; this is the line to open.
   */
  readWhere: string[];
  /**
   * Reads the server could not answer and React caught at a boundary - the
   * fallback is what got stored - with the component that made each:
   * `useSearchParams() in Query`. Noted by the SSR entry, read by the build,
   * which attaches them to the route so a page stored as its own loading
   * screen says why.
   */
  fallbacks: string[];
  /**
   * For a read made inside a cache()-wrapped helper: the components that
   * awaited that helper, first caller included. The helper runs once, so
   * the stack at the read names only whoever got there first; every later
   * awaiter is a cache hit that never reaches the accessor. The one above
   * every boundary is usually one of the later ones.
   */
  awaiters: Map<unknown, string[]>;
  /** The cache()-wrapped helper whose body is running, while it runs. */
  inHelper: unknown;
  /** readWhere entry -> the helper it was read inside. */
  readVia: Map<string, unknown>;
  /** Work to run once the answer is on its way - see after(). */
  after: (() => unknown)[];
}

const SCOPE = Symbol.for("@rsc-kit/core.request-scope");

/**
 * The accessors themselves and the plumbing under them: frames to walk past
 * on the way to the component that called.
 */
const NOT_A_CALLER = new Set([
  "never",
  "cache",
  "noteAwaiter",
  "withHelper",
  "noteRequestRead",
  "recordRead",
  "caller",
  "slot",
  "cookies",
  "headers",
  "connection",
  "searchParams",
  "request",
  "url",
  "parseParams",
  "parseSearchParams",
  "parseBody",
  "get",
  "set",
  "has",
]);

/** The accessors a component calls by name. One calling another is plumbing, not a second read. */
const ACCESSORS = new Set([
  "cookies",
  "headers",
  "connection",
  "searchParams",
  "request",
  "url",
]);

/**
 * The nearest named function above the accessor on the stack, and whether
 * another accessor sits between: `cookies()` reads through `headers()`, and
 * that inner read is not a second thing the component did.
 *
 * Read from a thrown-away Error: the one thing a build cannot otherwise learn
 * is which component reached for the request, and the stack knows. Function
 * names survive a server bundle, which is not minified, so this is
 * `RootLayout` and not a line number in a chunk. Internal names are walked
 * past; an anonymous frame is skipped rather than reported as `<anonymous>`.
 */
function caller(own: string): { name: string | null; nested: boolean } {
  const stack = new Error().stack ?? "";
  let accessors = 0;
  let helper: string | null = null;

  for (const line of stack.split("\n")) {
    const match = /^\s*at (?:async )?([^\s(]+)/.exec(line);

    if (!match) continue;

    const name = match[1]!.split(".").pop()!;

    // A frame with no function name prints its location instead - `js:6054:8`
    // - which is not a name to report.
    if (!/^[\w$]+$/.test(name)) continue;

    if (ACCESSORS.has(name)) accessors++;
    if (
      NOT_A_CALLER.has(name) ||
      name === "<anonymous>" ||
      name === "Object" ||
      name === "Promise"
    )
      continue;

    const nested = accessors > (ACCESSORS.has(own) ? 1 : 0);

    // A function that is not a component - getCurrentUser, wrapped in
    // cache() - is the shared helper the read lives in. Named, because with
    // cache() the read runs once, on whichever component called first, and
    // every other caller of the helper is invisible to the stack. The helper
    // is what they have in common.
    if (/^[a-z_$]/.test(name) && !/^use[A-Z]/.test(name)) {
      helper ??= name;

      continue;
    }

    return {
      name: helper && helper !== name ? `${helper} (from ${name})` : name,
      nested,
    };
  }

  return { name: helper, nested: accessors > (ACCESSORS.has(own) ? 1 : 0) };
}

function recordRead(store: Slot, by: string): void {
  if (!store.readBy.includes(by)) store.readBy.push(by);

  // Older stores, written by a bundle built before this field existed.
  store.readWhere ??= [];

  const { name, nested } = caller(by.replace(/\(.*$/, ""));

  if (nested) return;

  const entry = name ? `${by} in ${name}` : by;

  if (!store.readWhere.includes(entry)) store.readWhere.push(entry);
  if (store.inHelper) (store.readVia ??= new Map()).set(entry, store.inHelper);
}

const globals = globalThis as Record<symbol | string, unknown>;

let ready: Promise<void> | null = null;

interface Scope {
  getStore(): Slot | undefined;
  run<T>(store: Slot, fn: () => T): T;
}

function scope(): Scope | null {
  return (globals[SCOPE] as Scope | undefined) ?? null;
}

function slot(): Slot {
  const store = scope()?.getStore();

  if (!store) {
    throw new Error(
      "No request in scope. headers() and cookies() are for a render — middleware, a layout, " +
        "a page — and there is nothing to read outside one.",
    );
  }

  store.read = true;

  return store;
}

/**
 * The request's headers.
 *
 * Empty during a build, where there is no request: the page is marked as
 * needing one instead, and rendered on demand rather than frozen.
 */
export async function headers(): Promise<Headers> {
  const store = slot();

  return store.request ? store.headers : never("headers()");
}

/** How a cookie should be written. The names browsers use. */
export interface CookieOptions {
  path?: string;
  domain?: string;
  maxAge?: number;
  expires?: Date;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "strict" | "lax" | "none";
  partitioned?: boolean;
}

/** One cookie as the request carried it: the shape Next's `cookies().get()` returns. */
export interface RequestCookie {
  name: string;
  value: string;
}

/**
 * The cookie jar, in the shape Next's `cookies()` has.
 *
 * `get()` returns `{ name, value }` rather than the string, because the guide
 * says "the same names from `@rsc-kit/core/request`" and a name that is the
 * same with a different return shape is the worst of both: ported code
 * reading `?.value` off a string got `undefined`, silently. `getAll()` is a
 * list for the same reason, and because a list composes where a record does
 * not.
 */
export interface Cookies {
  get(name: string): RequestCookie | undefined;
  has(name: string): boolean;
  getAll(): RequestCookie[];
  /**
   * Write one on the response.
   *
   * Only from a server action, which has a response of its own that has not
   * been sent. A render has already flushed its headers by the time a
   * component runs — that is what makes the first paint fast — so this throws
   * there rather than appearing to work.
   *
   * Either call shape Next takes: `set(name, value, options)` or
   * `set({ name, value, ...options })`.
   */
  set(name: string, value: string, options?: CookieOptions): void;
  set(cookie: RequestCookie & CookieOptions): void;
  /** Write one that expires immediately. Same rule about where. */
  delete(name: string, options?: CookieOptions): void;
}

/** Kept for the name it had when it could only read. */
export type ReadonlyCookies = Cookies;

/**
 * The response being built, while it can still be changed.
 *
 * Open from the moment a request is picked up until the host constructs its
 * Response, and sealed the instant it does. Middleware runs inside that window
 * — before any rendering starts — so a header set there is on the answer. A
 * component runs after it, during streaming, where the status line and headers
 * are already on the wire; setting one there is refused rather than dropped.
 */
interface Draft {
  headers: Headers;
  sealed: boolean;
  /**
   * What this request wrote to the jar, over what it arrived with: a value,
   * or null for a deletion. Read back by `cookies()` for the rest of the
   * request, so a render that follows the write - the sections an action
   * revalidates travel back with its answer, rendered in the same request -
   * sees what the browser is about to hold. Next has the same rule, which
   * is why `set` then `revalidate` is what every port writes; without it
   * the sidebar re-rendered with the cookie the request arrived with, and
   * showed the old choice until a reload.
   */
  cookies: Map<string, string | null>;
}

const DRAFT = Symbol.for("@rsc-kit/core.response-draft");

let draftReady: Promise<void> | null = null;

interface DraftScope {
  getStore(): Draft | undefined;
  run<T>(store: Draft, fn: () => T): T;
}

function draft(): DraftScope | null {
  return (globals[DRAFT] as DraftScope | undefined) ?? null;
}

/** The open draft, or an explanation of why there is not one. */
function writable(what: string): Draft {
  const open = draft()?.getStore();

  if (!open) {
    throw new Error(
      `${what} needs a response that has not been sent. Middleware and server actions have one; ` +
        "a script outside a request does not.",
    );
  }

  if (open.sealed) {
    throw new Error(
      `${what} was called after the response had been sent. Headers go out before the render ` +
        "starts — that is what makes the first paint fast — so set them in middleware, which " +
        "runs before it.",
    );
  }

  return open;
}

/**
 * Headers to put on the answer.
 *
 * Mutate it as you would any Headers. `append` is the one to reach for when a
 * header may legitimately appear twice; `set` replaces.
 */
/**
 * The draft's headers, refusing writes once the response has gone.
 *
 * A proxy rather than the Headers itself: returning the live object means code
 * that captured it before the response was built can go on mutating a thing
 * nobody will read. Nothing in this package does that — the host copies the
 * headers onto the response the instant it seals — but "safe because of the
 * order two other functions happen to run in" is not a property, and an app
 * holding the object across an await would find writes silently doing nothing.
 */
function sealable(draft: Draft): Headers {
  const guard =
    (method: "set" | "append" | "delete") =>
    (...args: [string, string]) => {
      writable("responseHeaders()");

      return (draft.headers[method] as (...a: string[]) => void)(...args);
    };

  const proxy: Headers = new Proxy(draft.headers, {
    get(target, property, receiver) {
      if (
        property === "set" ||
        property === "append" ||
        property === "delete"
      ) {
        return guard(property);
      }

      // A maplike forEach passes the object it was called on as the third
      // callback argument, and binding to the target makes that the raw
      // Headers — a live, unguarded reference handed out by the very method
      // meant to be read-only. Substituted for the proxy so there is no way
      // through.
      if (property === "forEach") {
        return (
          fn: (value: string, key: string, parent: Headers) => void,
          thisArg?: unknown,
        ) =>
          target.forEach((value, key) => fn.call(thisArg, value, key, proxy));
      }

      const value = Reflect.get(target, property, receiver);

      return typeof value === "function" ? value.bind(target) : value;
    },
  });

  return proxy;
}

export function responseHeaders(): Headers {
  return sealable(writable("responseHeaders()"));
}

/**
 * Run a request with a response that can still be changed, and take what was
 * put on it.
 *
 * `seal()` is called by the host the moment it builds the Response, so
 * anything set afterwards is refused instead of silently going nowhere.
 */
export async function withResponseDraft<T>(
  run: (draft: { taken: () => Headers; seal: () => void }) => Promise<T>,
): Promise<T> {
  if (!globals[DRAFT]) {
    draftReady ??= resolveScope().then((resolved) => {
      globals[DRAFT] ??= resolved as unknown as DraftScope;
    });

    await draftReady;
  }

  const open: Draft = { headers: new Headers(), sealed: false, cookies: new Map() };

  return await draft()!.run(open, () =>
    run({
      taken: () => open.headers,
      seal: () => {
        open.sealed = true;
      },
    }),
  );
}

/**
 * A cookie name, as RFC 6265 defines one: a token, so no separators at all.
 *
 * Checked rather than escaped because there is no escaping — a name is not a
 * quoted string. An app that derives one from user input (`pref_${key}`) would
 * otherwise let that input close the pair and open another: a name of
 * `session=attacker; Path=/; HttpOnly; x` serializes to a header whose *first*
 * pair is a session cookie the caller chose, and the browser reads the first.
 */
const COOKIE_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

/** No separator may appear in an attribute either, for the same reason. */
const COOKIE_ATTRIBUTE = /[;,\r\n]/;

/** `name=value; Path=/; HttpOnly` — the header a browser expects. */
export function serializeCookie(cookie: {
  name: string;
  value: string;
  options: CookieOptions;
}): string {
  if (!COOKIE_NAME.test(cookie.name)) {
    throw new Error(
      `Not a usable cookie name: ${JSON.stringify(cookie.name)}. ` +
        "A name is a token — letters, digits and !#$%&'*+-.^_`|~ — with no spaces, " +
        "semicolons or equals signs. Nothing escapes them, so one cannot be encoded around.",
    );
  }

  if (cookie.options.sameSite !== undefined) {
    const value = String(cookie.options.sameSite).toLowerCase();

    if (value !== "strict" && value !== "lax" && value !== "none") {
      throw new Error(
        `Not a SameSite value: ${JSON.stringify(cookie.options.sameSite)}. ` +
          "It is written into the header as given, so anything else becomes further attributes.",
      );
    }
  }

  for (const [attribute, value] of [
    ["path", cookie.options.path],
    ["domain", cookie.options.domain],
  ] as const) {
    if (typeof value === "string" && COOKIE_ATTRIBUTE.test(value)) {
      throw new Error(
        `The cookie ${attribute} ${JSON.stringify(value)} contains a separator. ` +
          "It would be read as further attributes rather than as part of this one.",
      );
    }
  }

  // Typed as a Date, but a cast reaches this and the result lands in the
  // header verbatim. Checked apart from the others because a date has commas
  // in it by definition - "Sun, 20 Sep 2026 14:49:56 GMT" - and the general
  // check refused every Expires ever written.
  const expires = cookie.options.expires?.toUTCString();

  if (typeof expires === "string" && /[;\r\n]/.test(expires)) {
    throw new Error(
      `The cookie expires ${JSON.stringify(expires)} contains a separator. ` +
        "It would be read as further attributes rather than as part of this one.",
    );
  }

  const parts = [`${cookie.name}=${encodeURIComponent(cookie.value)}`];
  const o = cookie.options;

  if (o.maxAge !== undefined) parts.push(`Max-Age=${Math.floor(o.maxAge)}`);
  if (o.expires) parts.push(`Expires=${o.expires.toUTCString()}`);
  // Defaulted, because a cookie without one is scoped to the path that set it
  // — a session written by POST /_rsc/action would not be sent for any page.
  parts.push(`Path=${o.path ?? "/"}`);
  if (o.domain) parts.push(`Domain=${o.domain}`);
  if (o.sameSite)
    parts.push(`SameSite=${o.sameSite[0].toUpperCase()}${o.sameSite.slice(1)}`);
  if (o.secure) parts.push("Secure");
  if (o.httpOnly) parts.push("HttpOnly");
  if (o.partitioned) parts.push("Partitioned");

  return parts.join("; ");
}

export async function cookies(): Promise<Cookies> {
  // Named before the await, because `headers()` never settles during a build —
  // nothing after this line runs there, and the reason would be recorded as
  // headers() for a call nobody wrote.
  const store = slot();

  if (!store.request) recordRead(store, "cookies()");

  const parsed = parseCookies((await headers()).get("cookie") ?? "");

  // What arrived, then what this request wrote over it. Read at each call
  // rather than once: a write between two reads is the case that matters.
  const jar = (): Record<string, string> => {
    const written = draft()?.getStore()?.cookies;

    if (!written?.size) return parsed;

    const merged = { ...parsed };

    for (const [name, value] of written) {
      if (value === null) delete merged[name];
      else merged[name] = value;
    }

    return merged;
  };

  const write = (
    name: string,
    value: string,
    options: CookieOptions = {},
  ): void => {
    const open = writable("cookies().set()");

    // Appended, never set: several cookies on one response are several
    // Set-Cookie headers, and replacing would leave only the last.
    open.headers.append("Set-Cookie", serializeCookie({ name, value, options }));

    // A cookie told to expire is one the browser will not send back.
    const gone =
      options.maxAge !== undefined ? options.maxAge <= 0 : options.expires !== undefined && options.expires.getTime() <= Date.now();

    open.cookies.set(name, gone ? null : value);
  };

  return {
    get: (name) => {
      const current = jar();

      return name in current ? { name, value: current[name] } : undefined;
    },
    has: (name) => name in jar(),
    getAll: () => Object.entries(jar()).map(([name, value]) => ({ name, value })),
    set: (nameOrCookie: string | (RequestCookie & CookieOptions), value?: string, options?: CookieOptions) => {
      if (typeof nameOrCookie === "string") return write(nameOrCookie, value ?? "", options);

      const { name, value: v, ...rest } = nameOrCookie;

      return write(name, v, rest);
    },
    // Expired rather than removed: a browser drops a cookie when it is told
    // one has already passed, and there is no other way to say it.
    delete: (name, options = {}) => write(name, "", { ...options, maxAge: 0 }),
  };
}

/**
 * The whole request, for a host-specific need the accessors do not cover.
 *
 * Null on a host that forwards only the parts — the worker behind Laravel has
 * a socket, not a request. Use headers() and cookies(), which work everywhere.
 */
export async function request(): Promise<Request | null> {
  const store = slot();

  return store.request ? store.original : never("request()");
}

/**
 * Mark everything below as belonging to the request, not to the build.
 *
 *     export default async function Orders() {
 *       await connection()
 *
 *       const rows = await db.query('select * from orders')
 *
 *       return <ul>{rows.map(...)}</ul>
 *     }
 *
 * At build time this never resolves, so nothing after it runs: the query is not
 * made, the boundary above becomes a hole, and the rest of the page still
 * freezes. At request time it resolves immediately and the component runs
 * normally.
 *
 * **Once is enough.** It is a barrier, not a wrapper — everything after it in
 * this component belongs to the request, however many calls that is. Repeating
 * it before each query does nothing.
 *
 * It needs a boundary above it. With a <Suspense> or a loading.tsx there is a
 * fallback to store and the page becomes a shell; with neither, nothing can
 * paint and the build refuses the route rather than storing a blank.
 *
 * Reach for it when the build should not run something — a database the build
 * machine cannot see, or a value that must differ per visitor. A query the
 * build CAN run, whose answer is the same for everyone, wants none of this: it
 * should be frozen.
 *
 * The same name and behaviour as Next's `connection()`.
 */
export async function connection(): Promise<void> {
  const store = slot();

  // No request means a build. Suspend rather than continue, the same way
  // headers() and cookies() do.
  if (!store.request) return never("connection()");
}

/** The url this request was made to, whichever way the host supplied it. */
export async function url(): Promise<string | null> {
  const store = slot();

  return store.request ? store.url : never("url()");
}

function parseCookies(header: string): Record<string, string> {
  const out: Record<string, string> = {};

  for (const part of header.split(";")) {
    const eq = part.indexOf("=");

    if (eq === -1) continue;

    const name = part.slice(0, eq).trim();

    if (!name) continue;

    // Decoded because that is how they were written. A malformed escape is
    // left as it arrived rather than throwing the render away.
    const raw = part.slice(eq + 1).trim();

    try {
      out[name] = decodeURIComponent(raw);
    } catch {
      out[name] = raw;
    }
  }

  return out;
}

/**
 * Run one request with its headers readable.
 *
 * `null` is the build: a scope with nothing in it, so a page that reads is
 * caught rather than silently frozen holding whatever the machine that built
 * it happened to send.
 */
export async function withRequest<T>(
  from: RequestLike,
  run: () => Promise<T>,
): Promise<T> {
  if (!globals[SCOPE]) {
    ready ??= resolveScope().then((resolved) => {
      globals[SCOPE] ??= resolved as unknown as Scope;
    });

    await ready;
  }

  const isRequest = from instanceof Request;
  const store: Slot = {
    request: from !== null,
    url: from ? (isRequest ? from.url : from.url) : null,
    headers: from
      ? isRequest
        ? from.headers
        : new Headers(from.headers)
      : new Headers(),
    original: isRequest ? from : null,
    read: false,
    readBy: [],
    readWhere: [],
    fallbacks: [],
    awaiters: new Map(),
    inHelper: null,
    readVia: new Map(),
    after: [],
  };

  return await scope()!.run(store, run);
}

/**
 * A promise that never settles, so the caller suspends.
 *
 * What a read does during a build. React treats it exactly as it treats a host
 * call that never answers: the component suspends, its Suspense fallback goes
 * into the shell, and the probe's budget decides the rest.
 */
/**
 * The build's probe hands a route a Request that records what is read out of
 * it, and a read of `url` marks the route as depending on the caller — the
 * Next way to read a query is `new URL(request.url).searchParams`, which the
 * probe cannot otherwise see. The engine itself reads the url to resolve the
 * awaited `searchParams`, and that read is accounted for by `searchParams`,
 * not by `url`; this is the door it goes through. A probe answers the real
 * Request to this key; anything else answers nothing, and the request is its
 * own.
 */
export const UNPROBED = Symbol.for("rsc-kit.unprobed");

/** The request's url, read by the engine rather than the route. */
export function urlOf(request: Request): string {
  return ((request as unknown as Record<symbol, Request | undefined>)[UNPROBED] ?? request).url;
}

/**
 * Record a read without suspending on it.
 *
 * For a reader that CAN answer during a build but whose answer would be wrong
 * to store — an api route's query string, which exists and is empty, and which
 * the build has no business freezing an answer to. `never()` is for a reader
 * with nothing to return; this is for one that has something and should still
 * be noticed.
 *
 * A no-op outside a render scope, so a handler called at request time pays a
 * property read and nothing else.
 */
export function noteRequestRead(by: string): void {
  const store = scope()?.getStore();

  if (!store) return;

  recordRead(store, by);
}

function never(by: string): Promise<never> {
  const store = slot();

  store.read = true;
  recordRead(store, by);

  return new Promise(() => {});
}

/**
 * Whether anything read the request during the scope that is open.
 *
 * For the prerenderer, which opens one with no request and asks afterwards.
 */
export function requestWasRead(): boolean {
  return scope()?.getStore()?.read ?? false;
}

/**
 * What reached for the request during the scope that is open.
 *
 * For the build, which asks afterwards so it can say why a page is rendered per
 * visitor rather than only that it is.
 */
export function requestReadBy(): string[] {
  return scope()?.getStore()?.readBy ?? [];
}

/** A read React caught at a boundary during SSR: `useSearchParams() in Query`. */
export function noteFallback(text: string): void {
  const store = scope()?.getStore();

  if (!store) return;

  store.fallbacks ??= [];

  if (!store.fallbacks.includes(text)) store.fallbacks.push(text);
}

/**
 * Run something once the answer is on its way, without making it wait.
 *
 * Logging, an audit row, an email, a cache warm: work the visitor should not
 * pay for, and that must still finish. Next's `after()`, and needed for the
 * same reason on every host: on a long-lived process a detached promise
 * happens to run to completion, but a Worker tears the isolate down when the
 * response ends unless the work is registered with the platform's
 * `waitUntil` - so a fire-and-forget promise there dies silently, some of
 * the time. The host hands these to `waitUntil` where one exists and runs
 * them detached where a process will keep them.
 *
 * From a component, a middleware, a server action or an api route. A
 * rejection is reported and never reaches the response, which has already
 * gone. Outside a request - a build - the work runs at once.
 */
export function after(work: () => unknown): void {
  const store = scope()?.getStore();

  if (!store || !store.request) {
    void Promise.resolve().then(work).catch(reportAfter);

    return;
  }

  store.after.push(work);
}

function reportAfter(error: unknown): void {
  console.error("[rsc-kit] after() work failed:", error);
}

/**
 * @internal For the host: the work `after()` collected for this request, as
 * one promise that never rejects. Taken once; a second call has nothing.
 */
export function takeAfterWork(): Promise<void> | null {
  const store = scope()?.getStore();

  if (!store || store.after.length === 0) return null;

  const work = store.after.splice(0);

  return Promise.allSettled(
    work.map((run) => Promise.resolve().then(run)),
  ).then((results) => {
    for (const result of results) {
      if (result.status === "rejected") reportAfter(result.reason);
    }
  });
}

/** The reads caught at a boundary during this render, with their components. */
export function requestFallbacks(): string[] {
  return scope()?.getStore()?.fallbacks ?? [];
}

/**
 * A component called a cache()-wrapped helper. Recorded on every call, hit
 * or miss, so a read the helper makes can name everyone who waited for it.
 */
export function noteAwaiter(helper: unknown): void {
  const store = scope()?.getStore();

  if (!store) return;

  const { name } = caller("cache");

  if (!name) return;

  store.awaiters ??= new Map();

  const list = store.awaiters.get(helper) ?? [];

  if (!list.includes(name)) list.push(name);

  store.awaiters.set(helper, list);
}

/** Run a cache()-wrapped helper's body, so a read inside it is filed under the helper. */
export function withHelper<T>(helper: unknown, run: () => T): T {
  const store = scope()?.getStore();

  if (!store) return run();

  const before = store.inHelper;

  store.inHelper = helper;

  try {
    return run();
  } finally {
    store.inHelper = before;
  }
}

/**
 * The same reads, each with the component that made it: `cookies() in
 * RootLayout`. A read inside a cached helper with more than one awaiter
 * names them all - `connection() awaited by AuthLinks, AuthDialogSlot` -
 * because the stack saw only the first, and the first is rarely the one
 * that blocks.
 */
export function requestReadWhere(): string[] {
  const store = scope()?.getStore();

  if (!store?.readWhere?.length) return store?.readBy ?? [];

  return store.readWhere.map((entry) => {
    const helper = store.readVia?.get(entry);
    const awaiters = helper ? store.awaiters?.get(helper) : undefined;

    if (!awaiters || awaiters.length < 2) return entry;

    const names =
      awaiters.length === 2
        ? awaiters.join(" and ")
        : awaiters.slice(0, -1).join(", ") + " and " + awaiters.at(-1);

    return `${entry.split(" in ")[0]} awaited by ${names}`;
  });
}

/**
 * The query string, as a page receives it.
 *
 * Derived from the request rather than passed down the render, so no host has
 * to forward it separately — and so it suspends during a build for the same
 * reason every other read does. A frozen page cannot know the query it will be
 * asked for.
 */
export async function searchParams(): Promise<URLSearchParams> {
  // Named before the await, so the build reports the call someone wrote rather
  // than url(), which this happens to be built on.
  const store = slot();

  if (!store.request && !store.readBy.includes("searchParams()")) {
    store.readBy.push("searchParams()");
  }

  const from = await url();

  return from ? new URL(from).searchParams : new URLSearchParams();
}
