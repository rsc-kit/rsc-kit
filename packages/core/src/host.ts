// Everything a JavaScript host has to do to serve the RSC engine.
//
// PHP needs ~2,400 lines for this because it cannot run JavaScript: a socket
// bridge, a worker pool, a frame protocol. A JS host imports the engine and
// calls it, and what remains is the part every host would otherwise rewrite —
// matching a url to a route, negotiating how much of the page to send, and
// speaking the header protocol the client expects.
//
// Deliberately not Hono, or Express, or anything: this takes a Request and
// returns a Response, so it runs under Bun.serve, Deno, Workers, Node's
// fetch adapters and any framework built on them. `./hono` is the three-line
// binding for one of them.
//
//   const rsc = createRscHandler({ engine, manifest, assets })
//   Bun.serve({ fetch: (req) => rsc(req).then((r) => r ?? new Response('', { status: 404 })) })

import {
  allowFor,
  matchApiRoute,
  matchIntercept,
  matchRoute,
  retentionKey,
  sharedDepth,
} from "./routing.js";
import { pathKey, patternKey } from "./prerender.js";
import { apiKey } from "./apiPrerender.js";
import { hostPath, hostSegment, routableHost } from "./hostRouting.js";
import type { FrozenApiResponse } from "./apiPrerender.js";
import { withRevalidation } from "./revalidate.js";
/**
 * @internal For a host adapter that embeds the engine. An app imports this
 * from `@rsc-kit/core/revalidate`.
 */
export { revalidate } from "./revalidate.js";
import { currentNotFound, withRedirect } from "./redirect.js";
import { compressed } from "./compress.js";
import { withCache } from "./cache.js";
import { takeAfterWork, withRequest, withResponseDraft } from "./request.js";
import { criticalAssetsOf, linkHeader, mergeAssets, type CriticalAssets } from "./earlyHints.js";
import { withHead } from "./shellHead.js";
import type { Redirection } from "./redirect.js";
/**
 * @internal For a host adapter that embeds the engine. An app imports this
 * from `@rsc-kit/core/redirect` - the one the guides teach, and the one an
 * editor should offer first.
 */
export { redirect } from "./redirect.js";
// Re-exported, not redefined: routing.ts is the one implementation, shared with
// the prerenderer and the generated bundle, and this stays the adapter's
// public surface so a host imports from one place.
/** @internal For a host adapter. An app never matches its own routes. */
export { matchIntercept, matchRoute, sharedDepth } from "./routing.js";
export type { MatchedRoute } from "./routing.js";
import {
  FLIGHT_TYPE,
  HEADER,
  HTML_TYPE,
  PER_CLIENT,
  REVALIDATE,
  VARY_ON_RSC,
} from "./headers.js";
import type { MatchedApiRoute, MatchedRoute } from "./routing.js";
import {
  ServerAuthenticationError,
  ServerAuthorizationError,
} from "./js/errors.js";
import type { RouteManifest } from "./manifest.js";

/** The built server bundle. Only the parts a host calls. */
export interface RscEngine {
  /** The route table this bundle was built from. */
  manifest?(): RouteManifest;
  /** A short id of this build's client, for the version the host answers with when given none. */
  buildId?(): Promise<string>;
  /** The stylesheet and client entry every document links, for the Link header a CDN sends ahead. */
  criticalAssets?(): CriticalAssets;
  installHostFn(fn: (name: string, ...args: unknown[]) => unknown): void;
  handleRscStream(
    component: string,
    props?: Record<string, unknown>,
    layouts?: { component: string; props: Record<string, unknown> }[],
    loadings?: string[],
    parallelSlots?: Record<string, string>,
    slotOverrides?: Record<string, unknown>,
    from?: number,
    pageKey?: string,
  ): Promise<{ stream: ReadableStream; segmentDepth: number }>;
  handleRscHtmlStream(
    component: string,
    props?: Record<string, unknown>,
    layouts?: { component: string; props: Record<string, unknown> }[],
    loadings?: string[],
    parallelSlots?: Record<string, string>,
    slotOverrides?: Record<string, unknown>,
    nonce?: string,
    pageKey?: string,
    bootstrap?: boolean,
  ): Promise<{ htmlStream: ReadableStream }>;
  /**
   * A form posted to the page's own url before the page had a runtime to
   * catch it: React wrote the action's id into the form, and this runs that
   * action from the posted fields, then renders the page with the result.
   * Optional: an engine built by an older plugin answers such a post 404.
   */
  handleRscFormPost?(
    component: string,
    props: Record<string, unknown>,
    layouts: { component: string; props: Record<string, unknown> }[],
    loadings: string[],
    parallelSlots: Record<string, string>,
    slotOverrides: Record<string, unknown>,
    nonce: string | undefined,
    pageKey: string,
    bootstrap: boolean,
    formData: FormData,
  ): Promise<{ htmlStream: ReadableStream }>;
  /**
   * Finish a shell frozen at build time, against data that exists now.
   *
   * Emits only the boundaries the shell left unfinished, meant to be written
   * straight after it. Optional so a host can be pointed at an engine built
   * before resuming existed; without it a shell has no way to be completed and
   * the page is rendered whole instead.
   */
  handleRscResume?(
    component: string,
    props?: Record<string, unknown>,
    layouts?: { component: string; props: Record<string, unknown> }[],
    loadings?: string[],
    parallelSlots?: Record<string, string>,
    slotOverrides?: Record<string, unknown>,
    postponed?: unknown,
    nonce?: string,
    pageKey?: string,
    pathname?: string | null,
  ): Promise<{ htmlStream: ReadableStream }>;
  handleRscRevalidate?(
    target: string,
    page: unknown,
  ): Promise<{ rscPayload: string }>;
  /**
   * The page's metadata for these params, merged with its layouts'. Used to
   * put the real title into a shell stored for a whole pattern, whose build
   * could not know the url.
   */
  resolveMetadata?(
    component: string,
    props?: Record<string, unknown>,
    layouts?: { component: string; props: Record<string, unknown> }[],
  ): Promise<Record<string, unknown> | null>;
  /**
   * Run a route's middleware without rendering anything.
   *
   * For a frozen page: the host reads it from disk and the engine never sees
   * the request, so the check has to be asked for separately.
   */
  runRouteMiddleware?(
    component: string,
    props: Record<string, unknown>,
  ): Promise<void>;
  handleAction(
    actionId: string,
    body: Uint8Array | string | FormData,
    contentType?: string,
    page?: unknown,
    takeRevalidated?: () => string[],
  ): Promise<{ stream: ReadableStream }>;
  /**
   * Answer one read declared with `query()`, or null if that id is not one.
   *
   * Optional so a host can be pointed at a bundle built before queries existed;
   * without it the endpoint 404s rather than throwing, which is what a client
   * built against the same old bundle expects anyway.
   */
  handleQuery?(
    id: string,
    args: string,
    report?: (error: unknown) => string,
  ): Promise<
    | { stream: ReadableStream; cacheControl: string }
    | { status: number; message: string; errors?: Record<string, string[]> }
    | null
  >;
  /**
   * Answer a `route.ts` — an api endpoint rather than a page.
   *
   * Optional so a host can be pointed at a bundle built before these existed;
   * without it the url falls through to page routing, which is what that
   * bundle would have done anyway.
   */
  handleApiRoute?(
    name: string,
    request: Request,
    params: Record<string, string>,
    allow: string,
  ): Promise<Response>;
}

export interface RscHostOptions {
  /** The built server bundle — `import * as engine from './build/rsc/index.js'`. */
  engine: RscEngine;
  /**
   * The route table. Defaults to the one the bundle was built with, which is
   * almost always what you want — a manifest passed separately can go stale
   * against the bundle it is describing.
   */
  manifest?: RouteManifest;
  /**
   * Functions the app's server components call as `await rpc('name', ...args)`.
   *
   * In the Laravel host this crosses a socket into PHP. Here they are just
   * functions, which is the whole reason a JS host is smaller.
   */
  rpc?: Record<string, (...args: unknown[]) => unknown>;
  /**
   * Where a host call goes when this process cannot answer it.
   *
   * `rpc` is checked first, so a host can answer some calls in JS and leave
   * the rest to a backend. `httpHostCalls` in `@rsc-kit/core/host-calls`
   * builds one of these over an ordinary POST, which is how a host written in
   * another language answers without implementing the socket framing.
   */
  hostCalls?: (name: string, ...args: unknown[]) => Promise<unknown>;
  /**
   * Props for a page, given whatever its url bound.
   *
   * Defaults to the url params alone. A host that loads a user, reads a
   * session or resolves a tenant does it here — this is the one place the
   * engine cannot supply anything for.
   */
  props?: (
    match: MatchedRoute,
    request: Request,
  ) => Record<string, unknown> | Promise<Record<string, unknown>>;
  /**
   * Reads what the prerenderer wrote, if this build has any.
   *
   * A function rather than a directory, because not every host has a
   * filesystem: on an edge runtime these live in a KV store or a static-asset
   * binding. `prerenderedFrom` in `@rsc-kit/core/files` is the one for a disk.
   *
   * Checked before rendering, and anything it cannot find falls through to
   * being rendered now — so a partial prerender is a valid state, not a
   * broken one.
   */
  prerendered?: (name: string) => Promise<string | null> | string | null;
  /** Serve a built browser asset. Return null for anything not found. */
  assets?: (
    pathname: string,
    request: Request,
  ) => Promise<Response | null> | Response | null;
  /**
   * Identifies this build to the client, which says it back on every
   * navigation and is sent to load the document when it differs. For an
   * engine with no `buildId` of its own; the generated one has, and every
   * document it renders says that id, so a version named here would
   * disagree with what the client was told and refuse every navigation.
   */
  version?: string;
  /**
   * The most an action body may be, in bytes. 8 MB unless said otherwise.
   *
   * Everything an action receives arrives in one body - arguments, and the
   * files a form uploads - and it is read whole before the action runs. With
   * no ceiling a single request could ask this process to hold as much as a
   * caller cares to send. Above the ceiling the answer is 413, before a byte
   * of the body is kept. Raise it for an app that uploads larger files
   * through actions; a proxy in front usually has its own limit too.
   */
  maxActionBody?: number;
  /**
   * gzip what this host answers, for a request that accepts it.
   *
   * On by default where the runtime has a compressor - Node and Bun - and
   * never on a Worker, where the platform compresses. Behind a CDN or a
   * proxy that compresses, the proxy sees an already-encoded answer and
   * leaves it; a bun or node server answering the internet by itself sent
   * every byte raw, which was a port's whole mobile performance story. Off
   * for a deployment that would rather its proxy did it.
   */
  compress?: boolean;
}

/**
 * The answer to a redirect that was decided before anything was written.
 *
 * A document gets a real status code. A payload request must NOT: `fetch`
 * follows a 3xx transparently, so the client would receive the destination's
 * HTML and hand it to the Flight decoder, which reports its own confusion
 * rather than the redirect. It gets 204 and a header instead, and navigates
 * itself — which is also what makes the redirect an SPA one.
 */
/**
 * A string safe to write inside a <script> element.
 *
 * `JSON.stringify` escapes for JavaScript, and this is not a JavaScript
 * context — it is HTML that happens to contain JavaScript. The parser ends the
 * element at the first `</script`, wherever it appears, so a destination
 * carrying one closes the tag and whatever follows is markup the browser runs.
 *
 * That destination is routinely computed rather than written — redirect()
 * documents "remembering where someone was going and sending them back to it"
 * as the usual case, which is a query string or a cookie arriving verbatim
 * here. U+2028 and U+2029 are escaped too: legal in JSON, line terminators in
 * JavaScript.
 */
function inScript(value: string): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

/**
 * Whether the browser itself asked, for a document.
 *
 * Sec-Fetch-Mode is what every current browser sends and nothing else does;
 * the Accept fallback is for the ones that do not, and for a test's Request.
 * A payload request never counts, whatever it accepts.
 */
function isNavigation(request: Request): boolean {
  if (request.headers.has(HEADER.rsc)) return false;

  const mode = request.headers.get("sec-fetch-mode");

  if (mode) return mode === "navigate";

  return (request.headers.get("accept") ?? "").includes("text/html");
}

function redirectResponse(
  to: Redirection,
  isPayloadRequest: boolean,
): Response {
  if (isPayloadRequest) {
    return new Response(null, {
      status: 204,
      headers: { [HEADER.redirect]: to.location, Vary: VARY_ON_RSC },
    });
  }

  return new Response(null, {
    status: to.status,
    headers: { Location: to.location, Vary: VARY_ON_RSC },
  });
}

/**
 * Append the redirect a render asked for after its shell had already gone out.
 *
 * The status line is spent by then, so the instruction travels in the body. A
 * script rather than waiting for hydration to notice the error digest: it runs
 * as the browser parses it, which is sooner, and it is the only path that
 * works at all for a route shipping no client runtime.
 *
 * Read on flush, because that is when the render has finished and a redirect
 * from inside a Suspense boundary is finally known.
 */
function appendLateRedirect(
  stream: ReadableStream,
  taken: () => Redirection | null,
): ReadableStream {
  // An engine that answered with a finished body rather than a stream has no
  // late window at all: the render was over before this was called, so the
  // caller's own check already saw everything there was to see.
  if (typeof stream?.getReader !== "function") return stream;

  const encoder = new TextEncoder();
  const reader = stream.getReader();

  // Read-and-re-emit rather than pipeThrough(new TransformStream(...)): a
  // TransformStream from a different realm than the stream it is piped into
  // is rejected outright, and a host embedded in a runtime that supplies its
  // own web streams is exactly that case.
  return new ReadableStream({
    async pull(controller) {
      const { done, value } = await reader.read();

      if (!done) {
        controller.enqueue(value);

        return;
      }

      const to = taken();

      // replace, so Back does not return to a url that redirected.
      if (to) {
        controller.enqueue(
          encoder.encode(
            `<script>location.replace(${inScript(to.location)})</script>`,
          ),
        );
      }

      controller.close();
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
}

/**
 * The status a refusal deserves, or null when this was not one.
 *
 * A host answers an unauthenticated call 401 and an unauthorized one 403, and
 * the transport raises each as its own error. Without this they arrive at the
 * render as ordinary failures and leave as 500s — which reads, to anyone
 * looking at a log or a browser, as the application being broken rather than
 * the visitor being turned away.
 */
function refusalStatus(error: unknown): number | null {
  if (error instanceof ServerAuthenticationError) return 401;
  if (error instanceof ServerAuthorizationError) return 403;

  // Named rather than matched by identity, because the error may have been
  // raised by another copy of the module: an app's actions are bundled apart
  // from the engine, and instanceof is false across that seam.
  const name = (error as { name?: string } | null)?.name;

  if (name === "ServerAuthenticationError") return 401;
  if (name === "ServerAuthorizationError") return 403;

  // A status the host chose — a throttle's 429, a policy's 403 — carried on
  // the error by the transport. Bounded to refusals: a host answering 500
  // should not be able to make this look like a client's fault, and one
  // answering 200 should not turn a failed render into a success.
  const carried = (error as { refusalStatus?: unknown } | null)?.refusalStatus;

  if (typeof carried === "number" && carried >= 400 && carried <= 499)
    return carried;

  return null;
}

function refusalMessage(error: unknown): string {
  const message = (error as { message?: string } | null)?.message;

  return typeof message === "string" && message !== "" ? message : "Refused.";
}

/**
 * Whether a browser was told it could post this action.
 *
 * Defence in depth, not the only defence. An action already requires the
 * X-RSC-Action header, which makes a cross-origin post a non-simple request —
 * so the browser must preflight it, and nothing here answers a preflight. A
 * browser can be tricked into sending cookies; it cannot be tricked into
 * sending a header it does not know. This is the belt to that pair of braces,
 * and it is what Next does for server actions.
 *
 * Compared against X-Forwarded-Host first, because a proxied deployment is the
 * normal one: the backend forwards the name the visitor typed, while Host is
 * this process on loopback. Comparing against Host alone would reject every
 * legitimate action that arrived through a proxy — a check that only fires on
 * correct requests is worse than none.
 *
 * No Origin at all is allowed through. It is absent on same-origin requests in
 * some browsers and on anything that is not a browser, and refusing those would
 * break server-to-server callers to catch an attacker who is already blocked by
 * the preflight.
 */
export function actionOriginAllowed(request: Request, url: URL): boolean {
  const origin = request.headers.get("origin");

  if (!origin) return true;

  const expected =
    request.headers.get("x-forwarded-host") ??
    request.headers.get("host") ??
    url.host;

  try {
    return new URL(origin).host === expected;
  } catch {
    // An Origin that is not a url is not one this can vouch for.
    return false;
  }
}

const DEFAULT_MAX_ACTION_BODY = 8 * 1024 * 1024;

/**
 * The body, read whole, or null once it has passed the ceiling.
 *
 * Content-Length is checked first because it is free, and the stream is
 * counted anyway because a body need not announce its size and a stated size
 * need not be true. Reading stops at the first byte over: what was held is
 * dropped, and the caller answers 413 rather than holding the rest.
 */
async function readBodyUpTo(
  request: Request,
  limit: number,
): Promise<Uint8Array | null> {
  const declared = Number(request.headers.get("content-length"));

  if (Number.isFinite(declared) && declared > limit) return null;
  if (!request.body) return new Uint8Array(0);

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let held = 0;

  for (;;) {
    const { done, value } = await reader.read();

    if (done) break;

    held += value.byteLength;

    if (held > limit) {
      await reader.cancel().catch(() => {});
      return null;
    }

    chunks.push(value);
  }

  const body = new Uint8Array(held);
  let at = 0;

  for (const chunk of chunks) {
    body.set(chunk, at);
    at += chunk.byteLength;
  }

  return body;
}

/**
 * The page a client says it was on, as a path this router can match - or
 * null. A header is a string anyone can send, and `new URL` throws on one
 * that is not a url; that must not become a 500 on the action endpoint.
 */
function refererPath(
  referer: string | null,
  origin: string,
  hosts: readonly string[] = [],
): string | null {
  if (!referer) return null;

  try {
    const parsed = new URL(referer, origin);

    // The page the action was invoked from is routed the way a request for
    // it would be: on a tenant host, the referer's host names the segment.
    return hostPath(parsed.host, parsed.pathname, hosts);
  } catch {
    return null;
  }
}

/**
 * How large a query url may be before it is refused.
 *
 * Matched to the client's own limit, and enforced here too because the limit is
 * what keeps an attacker from making this endpoint decode megabytes of
 * attacker-chosen payload per request.
 *
 * Module scope, not inside the handler: everything declared after the handler
 * is returned never initialises, and a `const` read from the closure then
 * throws on every request instead of being undefined.
 */
const MAX_QUERY = 8_000;

/**
 * The host segment a routed url begins with, by url. Kept beside the url
 * rather than in it, so the pathname stays what a page and a stored file
 * are keyed by, and the matcher alone is told the leading part is the host's.
 */
const hostOf = new WeakMap<URL, string>();

function matchPage(routes: RouteManifest, url: URL): MatchedRoute | null {
  return matchRoute(routes, url.pathname, hostOf.get(url) ?? null);
}

export function createRscHandler(
  options: RscHostOptions,
): (request: Request) => Promise<Response | null> {
  const { engine, assets } = options;
  // The build's own id, which is also what every document says it is - the
  // two must agree, or a client's honest claim is a 409 on every request.
  // A version named by the app applies only to an engine with no id of its
  // own. Resolved on the first request: the engine reads it from a build
  // product it only has at runtime.
  let version = engine.buildId ? undefined : options.version;
  const maxActionBody = options.maxActionBody ?? DEFAULT_MAX_ACTION_BODY;
  const compress = options.compress ?? true;
  // Annotated rather than inferred: the narrowing below is lost inside the
  // closures that use it, and every one of them runs after the throw.
  const manifest: RouteManifest | undefined =
    options.manifest ?? engine.manifest?.();

  if (!manifest) {
    throw new Error(
      "No route table. Pass `manifest`, or build with a plugin version that embeds one in the bundle.",
    );
  }

  const routes: RouteManifest = manifest;

  // Only when this host has functions of its own. Installing unconditionally
  // overwrites whatever was already registered — a prerenderer sharing the
  // same engine instance, or a host that set its own up first — and the
  // symptom is every call failing as unregistered.
  if (options.rpc || options.hostCalls)
    installHostFunctions(options.rpc ?? {}, options.hostCalls);

  function installHostFunctions(
    fns: NonNullable<RscHostOptions["rpc"]>,
    remote: RscHostOptions["hostCalls"],
  ): void {
    engine.installHostFn(async (name: string, ...args: unknown[]) => {
      const fn = fns[name];

      if (fn) return await fn(...args);

      // A remote transport cannot enumerate what the backend registered, so
      // an unknown name is the backend's to reject — with a message naming the
      // function, which is more than this side could say.
      if (remote) return await remote(name, ...args);

      // Louder than returning null: a typo in a server component otherwise
      // renders as missing data with nothing anywhere saying why.
      throw new Error(
        `No host function named ${JSON.stringify(name)}. Registered: ${Object.keys(fns).join(", ") || "(none)"}`,
      );
    });
  }

  async function propsFor(
    match: MatchedRoute,
    request: Request,
  ): Promise<Record<string, unknown>> {
    return options.props ? await options.props(match, request) : match.params;
  }

  /** The page a server action was invoked from, so it can re-render regions of it. */
  function pageContext(match: MatchedRoute, props: Record<string, unknown>, url?: string) {
    return {
      component: match.route.component,
      props,
      url,
      layouts: match.route.layouts.map((component) => ({
        component,
        props: {},
      })),
      loadings: match.route.loadings,
      parallelSlots: match.route.slots,
      // What may be named in X-RSC-Revalidate — see renderRevalidated.
      sections: match.route.sections,
    };
  }

  function withVersion(
    headers: Record<string, string>,
  ): Record<string, string> {
    return version ? { ...headers, [HEADER.version]: version } : headers;
  }

  // A build made for export ships a client that asks for payloads by url,
  // because a static host cannot read a header. Serving that build from a
  // server is a reasonable thing to do — previewing an export, or one build
  // used both ways — and without this every navigation 404s in the console
  // while the page itself looks fine.
  const payloadName = manifest.build?.payloadName || "";
  /** The site's own hosts; any other host is routed with its segment in front of the path. */
  const siteHosts = manifest.build?.hosts ?? [];
  /** Whether responses say what built them. How they were served is always said. */
  const identify = Boolean(manifest.build?.identify);
  /** How a response was answered, for X-RSC-Kit: a file the build wrote, or a shell of one. */
  const servedFrom = new WeakMap<Response, "stored" | "shell">();
  /** What a stored document's head names, read once per file, for the Link header. */
  const hinted = new WeakMap<Response, CriticalAssets>();
  const hintsByKey = new Map<string, CriticalAssets>();
  const EMPTY_ASSETS: CriticalAssets = { styles: [], modules: [], fonts: [] };

  /**
   * The page a payload url belongs to, if this is one.
   *
   * Both the whole-document name and the depth variants beside it: a client
   * built for export asks for index.seg1.rsc when it already holds a layout,
   * and matching only the plain name leaves that as a 404 no page reports.
   */
  const payloadNames = new RegExp(
    "/" +
      payloadName
        .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
        .replace(/^index\\\./, "index(\\.seg\\d+)?\\.") +
      "$",
  );

  function pageForPayload(pathname: string): string | null {
    if (payloadName === "") return null;

    const match = payloadNames.exec(pathname);

    if (!match) return null;

    return pathname.slice(0, match.index) || "/";
  }

  // One memo table per request, opened at the outermost point so that
  // everything below shares it: middleware, layouts, the page, and an action. A
  // guard that reads the session and a layout that reads it again are one
  // query, not two.
  /**
   * The fields of a form posted to a page, or null for anything else.
   *
   * A POST with a form body, from this origin, to a url that is a page and
   * not the action endpoint, with an engine that can run what the form
   * names. Read here so the decision is made once; the action reads the
   * same fields from what is returned.
   */
  async function formPostOf(request: Request, url: URL): Promise<FormData | null> {
    if (request.method !== "POST" || !engine.handleRscFormPost) return null;
    if (request.headers.has(HEADER.rsc)) return null;

    const type = request.headers.get("content-type") ?? "";

    if (!/^(?:application\/x-www-form-urlencoded|multipart\/form-data)/i.test(type)) return null;
    if (!matchPage(routes, url)) return null;
    if (!actionOriginAllowed(request, url)) return null;

    try {
      return await request.formData();
    } catch {
      return null;
    }
  }

  /**
   * What a stored answer's compressed bytes are kept under.
   *
   * The build, the url, and the value of every request header the answer
   * says it varies on - which is what tells the document for /login apart
   * from the payload for /login. Keyed by the path alone, the payload
   * request found the document's bytes waiting and hydration decoded HTML
   * as Flight, silently, on every stored page in production.
   */
  function storedKey(request: Request, response: Response): string {
    const url = new URL(request.url);
    const varies = (response.headers.get("Vary") ?? "")
      .split(",")
      .map((name) => name.trim().toLowerCase())
      .filter((name) => name && name !== "*" && name !== "accept-encoding")
      .sort()
      .map((name) => `${name}=${request.headers.get(name) ?? ""}`);

    return [version ?? "", url.pathname + url.search, ...varies].join("\n");
  }

  return async function handle(request: Request): Promise<Response | null> {
    if (version === undefined && engine.buildId) version = await engine.buildId();

    return await withRequest(request, () =>
      withCache(() =>
        // Open for the whole request and sealed the moment an answer exists,
        // so middleware — which runs before any rendering — can put headers on
        // it, and a component, which runs after, is told why it cannot.
        withResponseDraft(async ({ taken, seal }) => {
          const response = await route(request);

          seal();

          if (!response) return null;

          const collected = taken();

          collected.forEach((value, name) => {
            // Set-Cookie is applied below, once per cookie: iterating a Headers
            // gives it joined in some runtimes and per-cookie in others, and a
            // joined one is a single malformed cookie the browser discards.
            if (name.toLowerCase() === "set-cookie") return;

            // set, not append: a middleware asking for a header means that
            // value, not that value added to whatever the host already chose.
            response.headers.set(name, value);
          });

          // Appended, because several cookies are several headers.
          for (const cookie of collected.getSetCookie()) {
            response.headers.append("Set-Cookie", cookie);
          }

          // How this answer was served - the header a developer reads in the
          // Network tab, the way X-Nextjs-Cache is. Always: it names no
          // product, and a CDN rule or a check can key on it.
          response.headers.set("X-RSC-Kit", servedFrom.get(response) ?? "rendered");

          // What the document needs first, as a Link header: a CDN sends it
          // ahead as 103 Early Hints, and the stylesheet, the entry and the
          // fonts download while the HTML is still being written. Every
          // document, stored ones included - a stored document's own head
          // names its fonts; a rendered one's is not known until too late.
          if (response.status === 200 && (response.headers.get("Content-Type") ?? "").startsWith("text/html")) {
            const link = linkHeader(mergeAssets(hinted.get(response) ?? EMPTY_ASSETS, engine.criticalAssets?.() ?? null));

            if (link) response.headers.set("Link", link);
          }

          // What built it. The name only, never the version - a version in
          // every response is what a vulnerability scanner filters on - and
          // off for a team whose policy strips every framework identifier.
          if (identify) response.headers.set("X-Powered-By", "rsc-kit");

          // Work after() queued, now that the answer exists. A Worker keeps
          // the isolate alive only for what is handed to waitUntil - Nitro's
          // Cloudflare preset puts the execution context on the request - so
          // it goes there where it can; a process keeps a detached promise.
          const pending = takeAfterWork();

          if (pending) {
            const context = (request as Request & { context?: { waitUntil?: (p: Promise<unknown>) => void } }).context;

            if (typeof context?.waitUntil === "function") context.waitUntil(pending);
          }

          // Last, over the finished answer, headers and all. A stored answer
          // is the same bytes for everyone and is compressed once, keyed by
          // the build and the url it was stored for.
          if (compress) {
            const answer = await compressed(
              request,
              response,
              servedFrom.get(response) === "stored" ? storedKey(request, response) : undefined,
            );

            const from = servedFrom.get(response);

            if (answer !== response && from) servedFrom.set(answer, from);

            return answer;
          }

          return response;
        }),
      ),
    );
  };

  async function route(request: Request): Promise<Response | null> {
    let url = new URL(request.url);

    // A host other than the site's own is matched with its segment in front
    // of the path, once, here: everything below - the api match, the page
    // match, the stored answer, the payload - sees that path and nothing
    // else knows a host was involved. The visitor's url is untouched.
    // Compared against X-Forwarded-Host first, for the same reason the
    // action's origin check is: a proxied deployment is the common one.
    // Only when a route can begin with that segment - a [domain] directory or
    // one named for the host - so an app with a metadataBase and no tenant
    // tree routes every host by path, and a proxy forwarding by an internal
    // name is not read as a tenant.
    if (siteHosts.length > 0) {
      const host =
        request.headers.get("x-forwarded-host") ??
        request.headers.get("host") ??
        url.host;
      const segment = hostSegment(host, siteHosts);

      if (segment !== null && routableHost(segment, routes.routes)) {
        url = new URL(
          hostPath(host, url.pathname, siteHosts) + url.search,
          url.origin,
        );
        hostOf.set(url, segment);
      }
    }

    const asPayload = pageForPayload(url.pathname);

    if (asPayload !== null) {
      // Rewritten to the page it is asking about, with the header the rest of
      // this handler reads — one path through, however the client asked.
      const host = hostOf.get(url);

      url = new URL(asPayload + url.search, url.origin);
      if (host !== undefined) hostOf.set(url, host);
      const headers = new Headers(request.headers);

      headers.set(HEADER.rsc, "1");
      request = new Request(url, { method: request.method, headers });
    }

    if (assets) {
      const asset = await assets(url.pathname, request);

      if (asset) return asset;
    }

    if (request.method === "POST" && url.pathname === HEADER.actionPath) {
      if (!actionOriginAllowed(request, url)) {
        return new Response("Cross-origin action", { status: 403 });
      }

      return await handleAction(request, url);
    }

    // Api routes first. A url is one or the other, and a page that shares a
    // path with a route.ts would otherwise win by accident of ordering.
    const api = matchApiRoute(routes, url.pathname);

    if (api && engine.handleApiRoute) {
      // The guards above it run first, exactly as they would for a page in the
      // same directory. A route.ts is colocated with the pages it belongs
      // with, so adding one under a guarded path must not open a way around
      // the guard.
      const refused = await refuseApiUnlessAllowed(request, api);

      if (refused) return refused;

      const stored = await frozenApi(request, url, api);

      if (stored) return stored;

      // A redirect() thrown from the handler is the route's answer, not a
      // fault: a real Location, because whoever asked is meant to go there
      // - a browser that followed a link to this route, or a fetch of an
      // export that lives on a signed url. notFound() is its 404.
      return await withRedirect(async (taken) => {
        try {
          return await engine.handleApiRoute!(
            api.route.name,
            request,
            api.params,
            allowFor(api.route),
          );
        } catch (error) {
          const redirected = taken();

          if (redirected) return redirectResponse(redirected, false);
          if (currentNotFound()) return new Response("Not found", { status: 404 });

          throw error;
        }
      });
    }

    if (request.method === "GET" && url.pathname === HEADER.queryPath) {
      // Same check as an action, for a smaller reason: a cross-origin page
      // cannot read this answer — CORS sees to that — but it can still cause
      // the read to run with the visitor's cookies. A query is side-effect
      // free by contract, so this is depth rather than the only defence.
      if (!actionOriginAllowed(request, url)) {
        return new Response("Cross-origin query", { status: 403 });
      }

      return await handleQuery(request, url);
    }

    // The two halves an edge cache needs: hand it a shell it may keep, and
    // finish that shell for a visitor it cannot answer for itself.
    if (options.prerendered && url.pathname === HEADER.pprShellPath) {
      return await servePprShell(request, url, options.prerendered);
    }

    if (
      request.method === "POST" &&
      options.prerendered &&
      url.pathname === HEADER.pprResumePath
    ) {
      return await servePprResume(request, url, options.prerendered);
    }

    // A form submitted before the page had a runtime: the browser posts it
    // to the page's own url, as React wrote it, with the action's id among
    // the fields. The action runs and the page renders with the result -
    // what the guide promises for a form that had to work without
    // javascript. Same-origin, as an action is; anything else that is not
    // a read is not this host's.
    const formPost = await formPostOf(request, url);

    if (!formPost && request.method !== "GET" && request.method !== "HEAD") return null;

    // A client saying which build it runs, and it is not this one: its
    // manifest cannot load what this build's payload names - a client
    // component added since is "client reference not found" and the route's
    // error boundary, on a page that worked a click ago. Under a service
    // worker that serves the last build's document first, that is every
    // returning visitor's first navigation after a deploy, not an open tab.
    // A 409 sends the client to load the document instead, from this build.
    const claimed = request.headers.get(HEADER.version);

    if (claimed !== null && claimed !== "" && version && claimed !== version && request.headers.get(HEADER.rsc) !== null) {
      return new Response(null, {
        status: 409,
        headers: withVersion({ "X-RSC-Location": url.pathname + url.search, "Cache-Control": "no-store" }),
      });
    }

    // One named region of this page, asked for without mutating anything to
    // earn it. What an action invalidated does not come through here — that
    // travels back inside the action's own answer, which is the whole point of
    // marking rather than telling the client to go and ask.
    const revalidating = request.headers.get(HEADER.revalidate);

    if (revalidating !== null && request.headers.get(HEADER.rsc) !== null) {
      return await handleRevalidate(request, url, revalidating);
    }

    // An intercepted navigation renders the page you are already on, with the
    // interceptor dropped into one of its slots — so the modal opens over it
    // and the url changes. Only ever on a client navigation: a hard load has
    // no referer to open over and gets the real page.
    const interceptSlot = request.headers.get(HEADER.intercept);

    if (interceptSlot !== null && request.headers.get(HEADER.rsc) !== null) {
      return await handleIntercept(request, url, interceptSlot);
    }

    // Only now. A frozen page is a whole page, and both requests above ask for
    // something smaller than one: answering a named region with the whole
    // document puts the entire page inside that region, and answering an
    // interception with it replaces the page the modal was opening over.
    const match = matchPage(routes, url);

    if (options.prerendered && !formPost) {
      // A guarded route can still be frozen: whether the content is the same
      // for everyone, and whether this caller may see it, are different
      // questions. The build answers the first; this answers the second, and
      // only then is the frozen page handed over.
      const refusal = await refuseUnlessAllowed(request, match);

      if (refusal) return refusal;

      const frozen = await servePrerendered(request, url, options.prerendered);

      // A whole page from a file, or a shell of one with the holes rendered
      // now: the header says which. servePrerendered marks the shell.
      if (frozen && !servedFrom.has(frozen)) servedFrom.set(frozen, "stored");

      if (frozen) return frozen;
    }

    if (!match) return null;

    const props = await propsFor(match, request);
    const layouts = match.route.layouts.map((component) => ({
      component,
      props: {},
    }));
    const chain = match.route.layouts;

    // A payload request says so with a header on the page's own url, so one
    // route serves both the document and the navigation that follows it.
    if (request.headers.get(HEADER.rsc) === null) {
      // Scoped to this render, so two requests redirecting at once cannot read
      // each other's destination.
      return await withRedirect(async (taken) => {
        // Awaited, and that await is the whole design: React resolves this
        // when the SHELL is ready, so a redirect thrown above every Suspense
        // boundary rejects here — before a byte is written, with a status line
        // still available. Nothing is buffered to make that true.
        let htmlStream: ReadableStream;

        try {
          ({ htmlStream } = formPost
            ? await engine.handleRscFormPost!(
                match.route.component,
                props,
                layouts,
                match.route.loadings,
                match.route.slots,
                {},
                undefined,
                url.pathname,
                true,
                formPost,
              )
            : await engine.handleRscHtmlStream(
                match.route.component,
                props,
                layouts,
                match.route.loadings,
                match.route.slots,
                {},
                undefined,
                url.pathname,
                // A route that ships no runtime gets no bootstrap and no segment
                // boundary — the boundary is itself a client component, so leaving
                // it in means no page could ever be JS-free.
                true,
              ));
        } catch (error) {
          // A rejected shell is how a redirect above every boundary arrives:
          // React could not finish the shell, because the component that would
          // have produced it left instead.
          //
          // The scope decides, not the error. React catches what a component
          // threw and re-raises its own — whose message is stripped in
          // production — so testing the caught value for a redirect signal
          // fails exactly where it matters, and the answer is a 500 with the
          // destination sitting in a scope nobody read.
          const refused = taken();

          if (refused) return redirectResponse(refused, false);

          // The page said this url names nothing. Null rather than a rendered
          // 404: null is already how this host says "not mine", and the caller
          // in front answers it with not-found.tsx and the right status. One
          // path, so a page that calls notFound() and a url that matched no
          // route are indistinguishable to whoever is asking — which is the
          // point of a 404.
          if (currentNotFound()) return null;

          // A guard refusing is not a failed render. Without this a visitor
          // who may not see the page gets a 500, which reads as the
          // application being broken rather than them being turned away —
          // and a host middleware refusal arrives exactly here, because the
          // engine asks before it renders anything.
          const status = refusalStatus(error);

          if (status) return new Response(refusalMessage(error), { status });
          throw error;
        }

        const early = taken();

        if (early) return redirectResponse(early, false);

        // Above every boundary, so the shell resolving means the page did not
        // refuse itself. Deeper than that and the shell is already on the wire
        // — the digest carries it to the boundary instead, and the status
        // stays 200 because the status line has gone.
        if (currentNotFound()) return null;

        return new Response(appendLateRedirect(htmlStream, taken), {
          headers: withVersion({
            "Content-Type": HTML_TYPE,
            [HEADER.layouts]: chain.join(","),
            Vary: VARY_ON_RSC,
            // The answer to a post is the result of something that happened
            // once; nothing may keep it.
            "Cache-Control": formPost
              ? "no-store"
              : match.route.middleware?.length
                ? PER_CLIENT
                : REVALIDATE,
          }),
        });
      });
    }

    const from = sharedDepth(request.headers.get(HEADER.segments), chain);

    // Proposed by the host, decided by the engine: an interceptor can force a
    // wider render than the client asked for, so what goes back is the depth
    // that came out, never the one that went in.
    return await withRedirect(async (taken) => {
      let stream: ReadableStream;
      let segmentDepth: number;

      try {
        ({ stream, segmentDepth } = await engine.handleRscStream(
          match.route.component,
          props,
          layouts,
          match.route.loadings,
          match.route.slots,
          {},
          from,
          url.pathname,
        ));
      } catch (error) {
        // Same reasoning as the document path: what the render recorded is
        // reliable, what React re-raised is not.
        const refused = taken();

        if (refused) return redirectResponse(refused, true);

        // Same answer the document path gives, so a client navigating to a
        // url and a browser loading it fresh agree about whether it exists.
        if (currentNotFound()) return null;

        // A payload request is guarded exactly as the document is. Narrowing
        // a request must never narrow what is checked.
        const status = refusalStatus(error);

        if (status) return new Response(refusalMessage(error), { status });
        throw error;
      }

      const early = taken();

      // 204 and a header. A payload request that redirected later than this
      // carries the destination in the error digest instead, and the client's
      // RedirectBoundary performs it.
      if (early) return redirectResponse(early, true);

      return new Response(stream, {
        headers: withVersion({
          "Content-Type": FLIGHT_TYPE,
          [HEADER.segmentDepth]: String(segmentDepth),
          [HEADER.layouts]: chain.join(","),
          Vary: VARY_ON_RSC,
          "Cache-Control": PER_CLIENT,
        }),
      });
    });
  }

  /**
   * A page rendered at build time, if there is one for this url.
   *
   * The payload has to match the depth the client shares, not simply exist.
   * Serving the whole document to a client that already holds the layouts
   * replaces the root — and replacing the root unmounts everything retained
   * behind it, so going back stops restoring what you had.
   */
  /**
   * The shell an edge cache may hold, for a route named by `?url=`.
   *
   * Only ever a build artifact, so there is nothing here that belongs to
   * whoever asked. What it deliberately does NOT return is the postponed
   * state. Next's protocol hands that to the CDN and takes it back on the
   * resume, which makes the resume endpoint parse a blob an attacker can write
   * — the shape of a known denial-of-service against it. Our origin has the
   * file already, so the state never needs to leave.
   *
   * A guarded route is refused outright rather than guarded here. Its shell is
   * not cacheable by a shared cache at all, so handing one to an edge that
   * exists to cache things is an invitation to a mistake nobody would see.
   */
  /**
   * The answer the build stored for this route, if it stored one.
   *
   * Three conditions, each closing a way the stored answer could be wrong:
   *
   * GET or HEAD, because a stored answer to a POST is a stored answer to
   * something that was meant to happen once.
   *
   * No query string. The build answered the bare url, and a route that reads
   * the query would answer differently for every one — so rather than trying
   * to detect that during the probe, anything carrying a query goes to the
   * route itself. A stored answer is for the url it was stored for.
   *
   * No middleware. A guarded route answers differently depending on who is
   * asking, which is the point of the guard; one stored answer served to
   * everyone is how a guard is quietly removed. The build refuses to store one
   * for the same reason, so this is the second of two locks on the same door.
   */
  async function frozenApi(
    request: Request,
    url: URL,
    api: MatchedApiRoute,
  ): Promise<Response | null> {
    if (!options.prerendered) return null;
    if (request.method !== "GET" && request.method !== "HEAD") return null;
    if (api.route.middleware.length > 0) return null;

    const stored = await options.prerendered(apiKey(url.pathname));

    if (stored === null) return null;

    let frozen: FrozenApiResponse;

    try {
      frozen = JSON.parse(stored) as FrozenApiResponse;
    } catch {
      // A file this host wrote and cannot read back is a bug, not a request
      // to answer badly. Falling through runs the route, which is correct.
      return null;
    }

    // The build said whether this route's answer depends on the query. A route
    // that never awaited searchParams gives the same answer whatever is on the
    // end of the url — which matters more than it sounds, because every
    // ?utm_source= and ?fbclid= would otherwise miss the stored answer.
    //
    // Defaulting to varying when the field is absent: a file written by an
    // older build did not record this, and serving it for every query would be
    // guessing on the unsafe side.
    if (url.search && frozen.varies !== false) return null;

    const answer = new Response(request.method === "HEAD" ? null : frozen.body, {
      status: frozen.status,
      headers: withVersion(Object.fromEntries(frozen.headers)),
    });

    servedFrom.set(answer, "stored");

    return answer;
  }

  async function servePprShell(
    request: Request,
    url: URL,
    read: NonNullable<RscHostOptions["prerendered"]>,
  ): Promise<Response | null> {
    if (request.method !== "GET" && request.method !== "HEAD") return null;

    const target = url.searchParams.get("url");

    if (!target || !target.startsWith("/")) {
      return new Response("A url is required", { status: 400 });
    }

    // Matched from the url asked for, never from anything else the caller sent.
    const route = matchRoute(routes, new URL(target, url.origin).pathname);

    if (!route) return new Response("No such page", { status: 404 });

    if (route.route.middleware?.length) {
      return new Response("This route is not edge-cacheable", { status: 404 });
    }

    const key = pathKey(new URL(target, url.origin).pathname);
    const shell =
      (await read(`${key}.ppr.html`)) ??
      (await read(`${patternKey(route.route)}.ppr.html`));

    if (shell === null)
      return new Response("No shell for this page", { status: 404 });

    return new Response(JSON.stringify({ shell, version: version ?? null }), {
      headers: withVersion({
        "Content-Type": "application/json",
        // Deliberately NOT the REVALIDATE the rest of the host sends. That is
        // `max-age=0, must-revalidate`, which a cache honours by treating the
        // entry as stale the moment it arrives — an edge would store this and
        // never once serve it, so the whole thing would quietly do nothing
        // while looking like it worked, because the miss path serves correct
        // pages.
        //
        // This is build output with nothing of the caller in it, and a guarded
        // route never reaches here at all, so it is genuinely cacheable. An
        // hour bounds how long a deploy can be served against a stale shell;
        // the version below catches it sooner than that.
        "Cache-Control": "public, max-age=3600",
      }),
    });
  }

  /**
   * Finish a shell for the visitor this request belongs to.
   *
   * The whole security question lives here, because the holes are the part a
   * guard exists to protect — the shell is chrome, and everything private is
   * behind the boundaries this fills in. So it runs exactly the guard chain the
   * page itself would, derived from the url and nothing else, against the
   * cookies and headers the caller actually sent.
   *
   * Which means an edge worker must forward the visitor's request, not make one
   * of its own. A resume asked for with no cookies is an anonymous visitor and
   * gets an anonymous answer.
   */
  async function servePprResume(
    request: Request,
    url: URL,
    read: NonNullable<RscHostOptions["prerendered"]>,
  ): Promise<Response | null> {
    const target = url.searchParams.get("url");

    if (!target || !target.startsWith("/")) {
      return new Response("A url is required", { status: 400 });
    }

    const pathname = new URL(target, url.origin).pathname;
    const route = matchRoute(routes, pathname);

    if (!route) return new Response("No such page", { status: 404 });

    // The same refusal the document would get, before a byte of the holes is
    // rendered. Nothing below runs for a caller this turns away.
    const refusal = await refuseUnlessAllowed(request, route);

    if (refusal) return refusal;

    if (!engine.handleRscResume) {
      return new Response("This engine cannot resume", { status: 500 });
    }

    const key = pathKey(pathname);
    const pattern = patternKey(route.route);

    let shellKey: string | null = null;

    if ((await read(`${key}.ppr.html`)) !== null) shellKey = key;
    else if ((await read(`${pattern}.ppr.html`)) !== null) shellKey = pattern;

    // Read from our own artifacts. Never from the request body — that is the
    // difference between this and the protocol it is modelled on.
    const state =
      shellKey === null ? null : await read(`${shellKey}.postponed.json`);

    if (state === null)
      return new Response("Nothing to resume", { status: 404 });

    const { htmlStream } = await engine.handleRscResume(
      route.route.component,
      route.params,
      route.route.layouts.map((component) => ({ component, props: {} })),
      route.route.loadings,
      route.route.slots,
      {},
      JSON.parse(state),
      undefined,
      shellKey === key ? pathname : "",
      pathname,
    );

    // Carries the build version so a caller holding a cached shell can tell
    // that it no longer belongs to this origin. A shell from an older build
    // does not make the resume fail — it replays against slots that have moved
    // and React falls back to client rendering, silently and for good. Nothing
    // else would ever report it.
    return new Response(htmlStream, {
      headers: withVersion({
        "Content-Type": HTML_TYPE,
        // Rendered for whoever asked. Never cacheable.
        "Cache-Control": PER_CLIENT,
      }),
    });
  }

  async function servePrerendered(
    request: Request,
    url: URL,
    source: NonNullable<RscHostOptions["prerendered"]>,
  ): Promise<Response | null> {
    const key = pathKey(url.pathname);
    const read = async (name: string) => await source(name);

    // Before anything else: a route that only redirects was frozen as the
    // redirect itself, so there is no page under this url and never will be.
    const frozenRedirect = await read(`${key}.redirect.json`);

    if (frozenRedirect !== null) {
      const to = JSON.parse(frozenRedirect) as {
        status: number;
        location: string;
      };

      return redirectResponse(to, request.headers.get(HEADER.rsc) !== null);
    }

    if (request.headers.get(HEADER.rsc) === null) {
      // A frozen page first; then a shell, under this url or under the route's
      // pattern. Nothing in a shell varies by param, so one shell serves every
      // url its route matches — which is the only way a route whose urls were
      // never listed gets anything frozen at all.
      const route = matchPage(routes, url);
      const whole = await read(`${key}.html`);

      // A whole page is finished. Nothing to resume, nothing to render.
      if (whole !== null) {
        const response = new Response(whole, {
          headers: withVersion({
            "Content-Type": HTML_TYPE,
            Vary: VARY_ON_RSC,
            "Cache-Control": route?.route.middleware?.length
              ? PER_CLIENT
              : REVALIDATE,
          }),
        });

        // Its head is in hand, so its fonts are too. Read once per file.
        let found = hintsByKey.get(key);

        if (!found) {
          found = criticalAssetsOf(whole);
          hintsByKey.set(key, found);
        }

        hinted.set(response, found);

        return response;
      }

      // Then a shell, under this url or under the route's pattern. Which of the
      // two answered is tracked, because the state that resumes it sits beside
      // the file that was found rather than beside the url that was asked for.
      let shellKey: string | null = null;
      let shell = await read(`${key}.ppr.html`);

      if (shell !== null) {
        shellKey = key;
      } else if (route) {
        const pattern = patternKey(route.route);

        shell = await read(`${pattern}.ppr.html`);

        if (shell !== null) shellKey = pattern;
      }

      if (shell === null || shellKey === null) return null;

      const state = await read(`${shellKey}.postponed.json`);

      // A shell with no state cannot be finished by anyone. It was frozen with
      // its fallbacks showing and there is no record of what came next, so
      // serving it would be serving a page that stays on its loading state for
      // good. Fall through and render the page now instead.
      if (state === null || !engine.handleRscResume || !route) return null;

      const { htmlStream } = await engine.handleRscResume(
        route.route.component,
        route.params,
        // Empty props, because that is what the build passed. Resuming replays
        // the tree against the slots the shell left, and React matches those by
        // key — so an argument that differs from the frozen render at all is a
        // tree that "doesn't match", and every boundary falls back to the
        // client instead of being filled here.
        route.route.layouts.map((component) => ({ component, props: {} })),
        route.route.loadings,
        route.route.slots,
        {},
        JSON.parse(state),
        undefined,
        // A shell found under the route's pattern was frozen for no particular
        // url, so it was rendered with no page key. Handing one over now would
        // key the tree differently from the one being resumed.
        shellKey === key ? url.pathname : "",
        // But the url itself, for the hooks: the holes are rendered for it.
        url.pathname,
      );

      // A shell stored for the pattern was built without a url, so its title
      // is the layouts' - the page's generateMetadata reads the params and
      // was left out. This request has the params.
      const served =
        shellKey === key || !engine.resolveMetadata
          ? shell
          : withHead(
              shell,
              await engine
                .resolveMetadata(
                  route.route.component,
                  route.params,
                  route.route.layouts.map((component) => ({ component, props: {} })),
                )
                .catch(() => null),
            );

      // The shell first, then whatever the resume writes. React's own script
      // travels with the resumed segments and moves them into place, so this is
      // a plain concatenation and the holes land without hydration.
      const body = new ReadableStream({
        async start(controller) {
          controller.enqueue(new TextEncoder().encode(served));

          const reader = htmlStream.getReader();

          try {
            while (true) {
              const { done, value } = await reader.read();

              if (done) break;

              controller.enqueue(value);
            }
          } finally {
            controller.close();
          }
        },
      });

      const withHoles = new Response(body, {
        headers: withVersion({
          "Content-Type": HTML_TYPE,
          Vary: VARY_ON_RSC,
          // The shell is cacheable; this response is not. It carries the holes,
          // which were rendered for whoever asked.
          "Cache-Control": PER_CLIENT,
        }),
      });

      servedFrom.set(withHoles, "shell");

      // The shell's head is the document's head; its fonts are known too.
      let found = hintsByKey.get(shellKey);

      if (!found) {
        found = criticalAssetsOf(shell);
        hintsByKey.set(shellKey, found);
      }

      hinted.set(withHoles, found);

      return withHoles;
    }

    // Only the document is ever served frozen for a shell. The payload is what
    // fills it in, and it has to be rendered now — answering with a frozen one
    // would hand back the same fallbacks the shell already shows, and the page
    // would never finish loading.

    const meta = await read(`${key}.meta.json`);

    // Both or neither: without the chain there is no way to know which depth a
    // payload is for, and guessing means handing the client a segment for a
    // boundary it does not have.
    if (meta === null) return null;

    const chain = (JSON.parse(meta).layouts ?? []) as string[];
    const shared = sharedDepth(request.headers.get(HEADER.segments), chain);

    // The variant for exactly this depth, or the whole document. Anything else
    // would be a payload for a boundary the client is not holding.
    const variant =
      shared > 0 ? await read(`${key}.seg${shared}.flight`) : null;
    const payload = variant ?? (await read(`${key}.flight`));

    if (payload === null) return null;

    // As cacheable as the document it boots: the same build-time bytes for
    // everyone, unless a guard above the route decides who may have them.
    // Marked no-store, the service worker refused to keep it, and a
    // precached page rendered offline and never hydrated - the markup was
    // there and the payload it boots from was not.
    const guarded = matchPage(routes, url)?.route.middleware?.length ?? 0;

    return new Response(payload, {
      headers: withVersion({
        "Content-Type": FLIGHT_TYPE,
        [HEADER.segmentDepth]: String(variant ? shared : 0),
        [HEADER.layouts]: chain.join(","),
        Vary: VARY_ON_RSC,
        "Cache-Control": guarded ? PER_CLIENT : REVALIDATE,
      }),
    });
  }

  /**
   * The middleware of a route, or null to go ahead.
   *
   * Used wherever a render can be reached without the engine running the chain
   * itself: a page served from disk, and an interception, which renders a
   * component the route table did not choose.
   *
   * Asked before anything is read or rendered — the answer to a refusal must
   * not be a page that has already been fetched.
   */
  async function refuseUnlessAllowed(
    request: Request,
    match: MatchedRoute | null,
  ): Promise<Response | null> {
    // hostMiddleware as well as the engine's own. A page served from disk
    // never touches the engine, so a route guarded only by the host would be
    // handed over without anyone being asked — the guard would hold right up
    // until the build froze the page, then silently stop.
    if (!match) return null;

    const guarded =
      (match.route.middleware?.length ?? 0) > 0 ||
      (match.route.hostMiddleware?.length ?? 0) > 0;

    if (!guarded) return null;

    // A route that declares middleware and an engine that cannot run it is not
    // "no middleware" — it is a check that silently does not happen. Refusing
    // is the only safe reading, and it names the cause rather than serving the
    // guarded page. Reachable when a host runs a bundle built by an older
    // plugin, where the export did not exist.
    if (!engine.runRouteMiddleware) {
      return new Response(
        "This route declares middleware, and the engine cannot run it. " +
          "Rebuild the app against the current @rsc-kit/core.",
        { status: 500 },
      );
    }

    const asPayload = request.headers.get(HEADER.rsc) !== null;

    return await withRedirect(async (taken) => {
      try {
        await engine.runRouteMiddleware!(
          match.route.component,
          await propsFor(match, request),
        );
      } catch (error) {
        const refused = taken();

        if (refused) return redirectResponse(refused, asPayload);

        // A visitor who may not see this page has not caused a server
        // error. Answering 500 makes a guarded route indistinguishable from
        // a broken one, in the logs and to the person looking at it.
        const status = refusalStatus(error);

        if (status) return new Response(refusalMessage(error), { status });

        throw error;
      }

      const refused = taken();

      return refused ? redirectResponse(refused, asPayload) : null;
    });
  }

  async function handleRevalidate(
    request: Request,
    url: URL,
    target: string,
  ): Promise<Response> {
    if (!engine.handleRscRevalidate) {
      return new Response("This build cannot revalidate", { status: 501 });
    }

    const match = matchPage(routes, url);

    if (!match) return new Response("No such page", { status: 404 });

    // Scoped like the render paths: a guard above the target may refuse, and
    // that refusal is an answer rather than a failure.
    return await withRedirect(async (taken) => {
      let rscPayload: string;

      try {
        ({ rscPayload } = await engine.handleRscRevalidate!(
          target,
          pageContext(match, await propsFor(match, request)),
        ));
      } catch (error) {
        const refused = taken();

        if (refused) return redirectResponse(refused, true);

        throw error;
      }

      const refused = taken();

      if (refused) return redirectResponse(refused, true);

      return new Response(rscPayload, {
        headers: withVersion({
          "Content-Type": FLIGHT_TYPE,
          // Echoed so the client can tell which region it is holding.
          [HEADER.revalidate]: target,
          Vary: VARY_ON_RSC,
          "Cache-Control": "private, no-store",
        }),
      });
    });
  }

  async function handleIntercept(
    request: Request,
    url: URL,
    slot: string,
  ): Promise<Response> {
    const intercept = matchIntercept(routes, url.pathname, slot);

    if (!intercept)
      return new Response("No interceptor for this url", { status: 404 });

    // The guards of the route being intercepted, before anything is rendered.
    //
    // An interceptor exists to show the same resource as the route it stands in
    // for — a modal over /orders/[id] shows that order. So it has to be behind
    // the same checks, and nothing else in this path runs them: the engine is
    // handed the interceptor component, which the route table did not choose
    // and whose middleware chain is keyed off manifest().routes, where an
    // interceptor does not appear.
    //
    // Derived from the url, never from X-RSC-Referer. The referer is a header
    // the caller writes, and guarding by it means the caller picks the guard.
    const intercepted = matchPage(routes, url);

    // Nothing to guard means nothing to serve. A url that matches an
    // interceptor but no route has no middleware chain to consult, so there is
    // no way to know whether this caller may see it — and an interceptor
    // stands in for a route, so a url with no route behind it is not a page
    // anyone was entitled to open a modal over.
    if (!intercepted) return new Response("No such page", { status: 404 });

    const refusal = await refuseUnlessAllowed(request, intercepted);

    if (refusal) return refusal;

    const from = refererPath(
      request.headers.get(HEADER.referer),
      url.origin,
      siteHosts,
    );
    const under = from ? matchRoute(routes, from) : null;

    // Without a page to open over there is nothing to intercept: render the
    // interceptor on its own rather than answering with the wrong page.
    const component = under ? under.route.component : intercept.component;
    const props = under ? await propsFor(under, request) : intercept.params;
    const chain = under ? under.route.layouts : [];
    const slots = under ? under.route.slots : {};
    const loadings = under ? under.route.loadings : [];

    // The interceptor alone, when there is a page to open it over and this
    // build can render a region on its own.
    //
    // Re-rendering the page underneath would put the modal on screen at the
    // cost of rebuilding everything below the layout that declares the slot —
    // so opening a modal from a half-filled form throws the form away. The
    // page beneath is already mounted and correct; only the slot is new.
    if (under && engine.handleRscRevalidate) {
      const { rscPayload } = await engine.handleRscRevalidate(slot, {
        component: under.route.component,
        // The target's params, not the page's: a modal for /posts/hello opened
        // from /feed is about hello.
        props: intercept.params,
        layouts: [],
        loadings: [],
        // Named as the slot so the renderer finds it there, but pointing at
        // the interceptor rather than the default this route would otherwise
        // fill it with.
        parallelSlots: { [slot]: intercept.component },
      });

      return new Response(rscPayload, {
        headers: withVersion({
          "Content-Type": FLIGHT_TYPE,
          // Says what this payload is, so the client puts it in the slot
          // instead of treating it as a segment of the page.
          [HEADER.revalidate]: slot,
          Vary: VARY_ON_RSC,
          // Per-client by construction: which region this is was chosen by a
          // request header, so a shared cache has nothing useful to key on.
          "Cache-Control": "private, no-store",
        }),
      });
    }

    const { stream, segmentDepth } = await engine.handleRscStream(
      component,
      props,
      chain.map((layout) => ({ component: layout, props: {} })),
      loadings,
      slots,
      {},
      sharedDepth(request.headers.get(HEADER.segments), chain),
      retentionKey(url.pathname, slot),
    );

    return new Response(stream, {
      headers: withVersion({
        "Content-Type": FLIGHT_TYPE,
        [HEADER.segmentDepth]: String(segmentDepth),
        [HEADER.layouts]: chain.join(","),
        Vary: VARY_ON_RSC,
        "Cache-Control": PER_CLIENT,
      }),
    });
  }

  /**
   * Run an api route's middleware, and answer instead of it if one refuses.
   *
   * Separate from the page version because the answer is different. A caller
   * that is not a browser gets a status rather than a redirect to a login page
   * it cannot render — a fetch would follow the 302 and hand back the login
   * HTML as though it were the api's answer.
   */
  async function refuseApiUnlessAllowed(
    request: Request,
    api: {
      route: { name: string; middleware?: string[] };
      params: Record<string, string>;
    },
  ): Promise<Response | null> {
    if (!(api.route.middleware?.length ?? 0)) return null;

    // A route that declares middleware and an engine that cannot run it is not
    // "no middleware" — it is a check that silently does not happen.
    if (!engine.runRouteMiddleware) {
      return new Response(
        "This route declares middleware, and the engine cannot run it. " +
          "Rebuild the app against the current @rsc-kit/core.",
        { status: 500 },
      );
    }

    return await withRedirect(async (taken) => {
      try {
        await engine.runRouteMiddleware!(api.route.name, api.params);
      } catch (error) {
        // A redirect is a refusal here. Where it was going is told rather than
        // followed, so a client can decide for itself.
        const redirected = taken();

        if (redirected) return apiRedirect(request, redirected);

        // A visitor who may not use this endpoint has not caused a server
        // error, and answering 500 makes a guarded route indistinguishable
        // from a broken one. Null means the middleware threw something that is
        // not a refusal, which is a real fault and says so.
        const status = refusalStatus(error);

        if (status === null) throw error;

        return new Response(status === 401 ? "Unauthorized" : "Forbidden", {
          status,
        });
      }

      const redirected = taken();

      if (redirected) return apiRedirect(request, redirected);

      return null;
    });
  }

  /**
   * A guard's redirect on a route.ts, answered for whoever asked.
   *
   * A browser that navigated here - followed a link to the route, typed the
   * url - is sent on with a real Location; a 401 would show it "Unauthorized"
   * over a page it cannot see. Code that fetched the route is told instead:
   * fetch follows a Location on its own and would hand back the login page's
   * html as the endpoint's answer, so it gets the 401 with the destination in
   * a header, and decides for itself.
   */
  function apiRedirect(request: Request, to: Redirection): Response {
    if (isNavigation(request)) return redirectResponse(to, false);

    return new Response("Unauthorized", {
      status: 401,
      headers: { "X-RSC-Redirect": to.location },
    });
  }

  async function handleQuery(
    request: Request,
    url: URL,
  ): Promise<Response | null> {
    if (!engine.handleQuery) return null;

    // Required, and the reason is CSRF rather than routing. A GET carrying no
    // unusual header is a SIMPLE request: any page anywhere can trigger one
    // with <img src="…/_rsc/query?…"> and it goes out with the visitor's
    // cookies. CORS stops them reading the answer; it does not stop the read
    // running. This header is not CORS-safelisted, so a browser preflights it
    // and nothing here answers a preflight — the same protection a POST
    // carrying X-RSC-Action already had.
    if (!request.headers.get(HEADER.query)) {
      return new Response("Missing " + HEADER.query, { status: 400 });
    }

    const id = url.searchParams.get("id");
    const args = url.searchParams.get("args");

    if (!id || args === null)
      return new Response("Missing id or args", { status: 400 });

    // Enforced here as well as in the client, because the limit is what keeps
    // an attacker from making this endpoint decode megabytes of their payload
    // per request.
    if (url.search.length > MAX_QUERY)
      return new Response("Query too large", { status: 414 });

    const answered = await engine.handleQuery(id, args);

    // Unknown id and registered-but-not-a-query are the same answer on purpose.
    if (!answered) return new Response("No such query", { status: 404 });

    // The read refused. Answered as a status with the message in the body, so
    // the fetcher rejects with something a person can read — a failure rendered
    // into a 200 would reach the browser as React's opaque error instead.
    if (!("stream" in answered)) {
      return new Response(
        JSON.stringify({ message: answered.message, errors: answered.errors }),
        {
          status: answered.status,
          headers: withVersion({
            "Content-Type": "application/json",
            "Cache-Control": PER_CLIENT,
          }),
        },
      );
    }

    return new Response(answered.stream, {
      headers: withVersion({
        "Content-Type": FLIGHT_TYPE,
        "Cache-Control": answered.cacheControl,
        // The answer is narrowed by who is asking whenever a read touches the
        // session, and the request that carries that is the cookie. Without
        // this a shared cache keyed on the url alone hands one visitor
        // another's answer — for any query that opted out of no-store.
        Vary: "Cookie, " + HEADER.referer,
      }),
    });
  }

  async function handleAction(request: Request, url: URL): Promise<Response> {
    const actionId = request.headers.get(HEADER.action);

    if (!actionId) return new Response("Missing X-RSC-Action", { status: 400 });

    // The body travels as application/octet-stream so a host that parses
    // multipart cannot consume it first; its real type rides in a header.
    const body = await readBodyUpTo(request, maxActionBody);

    if (body === null) {
      return new Response(`Action body over ${maxActionBody} bytes`, {
        status: 413,
      });
    }

    const contentType =
      request.headers.get(HEADER.contentType) ?? "text/plain;charset=UTF-8";

    // Where it was invoked from, so anything the action invalidates can be
    // re-rendered against the page that is actually on screen.
    const from = refererPath(
      request.headers.get(HEADER.referer),
      url.origin,
      siteHosts,
    );
    const match = from ? matchRoute(routes, from) : null;
    const page = match
      ? pageContext(match, await propsFor(match, request), from ?? undefined)
      : undefined;

    // Scoped to this action: revalidate() called anywhere inside it, at any
    // depth, marks here and nowhere else — two requests can be in flight and
    // marking is per-request state. And redirect(): the guide says "throw
    // from the action and the client follows it", and the client does
    // follow an X-RSC-Redirect on an action's response — but the signal the
    // throw raises was never caught here, so every login that redirected
    // after signing in was a 500. Caught, it is the instruction the client
    // already knows how to read.
    return await withRedirect(async (redirected) => {
      let stream: ReadableStream;

      try {
        ({ stream } = await withRevalidation((taken) =>
          engine.handleAction(actionId, body, contentType, page, taken),
        ));
      } catch (error) {
        const to = redirected();

        if (to) return redirectResponse(to, true);

        throw error;
      }

      return new Response(stream, {
        headers: withVersion({
          "Content-Type": "text/x-component; charset=utf-8",
        }),
      });
    });
  }
}
