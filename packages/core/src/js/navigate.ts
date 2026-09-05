/**
 * Core SPA navigation engine for RSC.
 *
 * Uses module-level state (singleton in the browser bundle).
 * The Flight deserializer is injected by createViteRscApp to avoid
 * duplicate bundling of react-server-dom-webpack.
 */

import { isSafeRedirect } from '../safeUrl.js'
import type { Href } from '../routes.js'
import { reportReachable } from "./onlineStore";
import { clearSlots, setSlot } from "./slotStore";
// Shared with the host: it stores a page under this key and the client looks
// under it, so the format cannot live in two places.
import { matchRoute, retentionKey as retentionKeyFor, sharedDepth } from "../routing";
import type { ManifestRoute } from "../manifest";

type ReactNode = unknown;
type Deserializer = (stream: ReadableStream, options: Record<string, unknown>) => Promise<ReactNode>;
type CallServerFn = (id: string, args: unknown[]) => Promise<unknown>;

interface CacheEntry {
  tree: Promise<ReactNode>;
  expiresAt: number;
  /**
   * What the server said about the payload. A prefetch is a real request, so
   * it comes back partial like any other — losing that and treating it as a
   * whole document replaces the root with a page that has no layouts.
   */
  segmentDepth: number;
  layouts: string[] | null;
  /**
   * The slot this payload fills, when it is one region rather than a segment.
   *
   * A prefetch is a real request and comes back as whatever the host answers.
   * An interception answers with the interceptor alone, and an entry that
   * forgets that is applied as a whole document — so a hovered modal link
   * renders the modal *as* the page, with nothing around it. Only after a
   * hover, which is why a scripted click never finds it.
   */
  slot: string | null;
  /**
   * The chain held when this was prefetched. A partial payload is only valid
   * against the chain it was rendered for; navigate somewhere else first and
   * it no longer composes.
   */
  heldWhenFetched: string;
}

interface InterceptEntry {
  urlPattern: string;
  slot: string;
}

let version = "";
let onNavigate: ((tree: ReactNode, key: string, segmentDepth: number) => void) | null = null;
let onRestore: ((key: string) => boolean) | null = null;
let flightDeserializer: Deserializer | null = null;
let callServerFn: CallServerFn | null = null;
let activeController: AbortController | null = null;
const cache = new Map<string, CacheEntry>();
/** In-flight prefetches, so one the pointer moved away from can be dropped. */
const prefetchControllers = new Map<string, AbortController>();
let interceptManifest: InterceptEntry[] = [];

// The layout chain currently mounted, outermost first. Sent so the server can
// skip re-rendering the layouts still on screen.
let heldLayouts: string[] = [];

/**
 * The boundary depth an interception was rendered at, while one is showing.
 *
 * An interceptor replaces a slot on the layout that declares it, so leaving the
 * intercepted view has to re-render that layout for the slot to go back to its
 * default. Left to itself the next navigation shares the whole chain, replaces
 * only the page below it, and the modal stays open over the new one.
 */
let interceptedAtDepth: number | null = null;

/**
 * The url showing underneath an open interception.
 *
 * An interception puts something in a slot on a page that stays where it is,
 * so closing it is not a navigation at all — the page beneath was never
 * replaced. Remembering which url that is means going back to it costs
 * nothing, rather than fetching and rebuilding a page that is already on
 * screen with everything the user typed into it.
 */
let interceptedOver: string | null = null;

const DEFAULT_PREFETCH_TTL = 30_000;

/**
 * Where a payload lives when there is no server to negotiate with.
 *
 * Normally the payload and the page share a url and are told apart by the
 * X-RSC header. A static host cannot vary by header — it serves one file per
 * url — so an exported build gives payloads their own addresses and the client
 * asks for those instead.
 */
let staticPayloadSuffix: string | null = null;

/**
 * The route table, on a static host only.
 *
 * A server works out how much of the page to send by comparing the chain the
 * client sent with the route's own, and says so in a header. A file server
 * does neither — so on an exported site the client has to know the target's
 * layout chain before it asks, or every navigation takes the whole document
 * and replaces the root, which unmounts everything retained behind it.
 *
 * Inlined into the browser entry by the build, so it costs no request.
 */
let staticRoutes: ManifestRoute[] | null = null;

export function setStaticRoutes(routes: ManifestRoute[]): void {
  staticRoutes = routes;
}

/**
 * The layout chain of the page loaded from a file, since no header said.
 *
 * Without this the client believes it holds nothing, every navigation asks
 * for a whole document, and the depth variants sitting beside it are never
 * requested — the export looks correct and retention silently never happens.
 */
export function seedStaticChain(url: string): boolean {
  const segments = staticSegments(url);

  if (!segments) return false;

  heldLayouts = segments.chain;

  return true;
}

/**
 * The depth an exported payload should be asked for, and the chain it leaves
 * mounted — the two things a header would otherwise have carried.
 */
function staticSegments(
  url: string,
  held: string[] = heldLayouts,
): { depth: number; chain: string[] } | null {
  if (staticRoutes === null) return null;

  const path = new URL(url, window.location.origin).pathname;
  const match = matchRoute({ routes: staticRoutes } as never, path);

  if (!match) return null;

  return {
    // Against the chain the request is made with, never against whatever is
    // mounted by the time the answer arrives. A prefetch is fetched against
    // one chain and applied later, and reading live state here labels its
    // payload with a depth it was not rendered for.
    depth: sharedDepth(held.join(","), match.route.layouts),
    // Copied: this is the build's table, and the caller assigns it to the
    // chain it holds — handing out the array itself makes the two the same
    // object.
    chain: [...match.route.layouts],
  };
}

export function setStaticPayloads(suffix: string | null): void {
  staticPayloadSuffix = suffix;
}

/** The url to request a payload from, which is the page's own unless exported. */
export function payloadUrl(url: string, held: string[] = heldLayouts): string {
  if (staticPayloadSuffix === null) return url;

  const parsed = new URL(url, window.location.origin);
  const path = parsed.pathname.replace(/\/+$/, "");
  const segments = staticSegments(url, held);

  // The variant for exactly the depth this client shares. Asking for the whole
  // document when a segment would do is not merely wasteful: it replaces the
  // root, and replacing the root throws away every page retained behind it.
  const name =
    segments && segments.depth > 0
      ? staticPayloadSuffix.replace(/^index\./, `index.seg${segments.depth}.`)
      : staticPayloadSuffix;

  return `${path}/${name}${parsed.search}`;
}

/**
 * What a static payload was fetched as, recorded against its own response.
 *
 * The depth asked for and the depth applied have to be the same number. Worked
 * out separately at the two call sites they can disagree — and a payload
 * rendered whole but applied as a segment nests a boundary inside itself,
 * which does not error, it recurses until the renderer stops responding.
 */
const staticFetches = new WeakMap<Response, { depth: number; chain: string[] }>();

export function setVersion(v: string): void {
  version = v;
}

/**
 * The layout chain the client is holding.
 *
 * Seeded from the initial page's response and updated on every navigation, so
 * the next request can say what is already mounted.
 */
export function setHeldLayouts(chain: string[]): void {
  heldLayouts = chain;
}

export function getHeldLayouts(): string[] {
  return heldLayouts;
}

export function setNavigateHandler(fn: (tree: ReactNode, key: string, segmentDepth: number) => void): void {
  onNavigate = fn;
}

/**
 * How the router reveals a page that is still mounted behind the current one.
 *
 * Returning true means the page was restored with its client state intact and
 * no request was made.
 */
export function setRestoreHandler(fn: (key: string) => boolean): void {
  onRestore = fn;
}

export function setDeserializer(fn: Deserializer): void {
  flightDeserializer = fn;
}

export function setCallServer(fn: CallServerFn): void {
  callServerFn = fn;
}

export function setInterceptManifest(entries: InterceptEntry[]): void {
  interceptManifest = entries;
}

/**
 * Check if a URL matches any intercept pattern.
 * Returns the matching slot name, or null if no match.
 */
function matchIntercept(url: string): string | null {
  if (interceptManifest.length === 0) return null;

  let pathname: string;
  try {
    pathname = new URL(url, window.location.origin).pathname;
  } catch {
    pathname = url.split("?")[0];
  }

  for (const entry of interceptManifest) {
    // urlPattern already has a leading slash (e.g. "/docs/item/[id]")
    const regex = new RegExp(
      "^" +
        entry.urlPattern
          .replace(/\[\.\.\.(\w+)\]/g, "(.+)")
          .replace(/\[(\w+)\]/g, "([^/]+)") +
        "$"
    );

    if (regex.test(pathname)) {
      return entry.slot;
    }
  }

  return null;
}

export function renderTree(tree: ReactNode): void {
  onNavigate?.(tree, retentionKey(window.location.href, null), 0);
}

/**
 * Identity of a page for retention purposes.
 *
 * Path and query only: a hash is a position within the same page, and an
 * intercepted route is a different rendering of the same URL, so it retains
 * separately from the full page.
 */
export function retentionKey(url: string, interceptSlot: string | null): string {
  let path: string;

  try {
    const parsed = new URL(url, window.location.origin);
    path = parsed.pathname + parsed.search;
  } catch {
    path = url.split("#")[0];
  }

  return retentionKeyFor(path, interceptSlot);
}

export function getCallServer(): CallServerFn {
  if (!callServerFn) {
    throw new Error("callServer not initialized. Ensure createViteRscApp() has been called.");
  }
  return callServerFn;
}

function fetchRscPayload(
  url: string,
  signal?: AbortSignal,
  interceptSlot?: string,
  refererUrl?: string,
  chain: string[] = heldLayouts,
  // A prefetch is speculative and a navigation is not, but on the wire they
  // were identical — so a click could queue behind several prefetches the user
  // had already moved past. Over HTTP/1.1 a browser opens ~6 connections per
  // origin, which a sweep across a nav bar fills on its own.
  priority: "high" | "low" = "high",
): Promise<Response> {
  const headers: Record<string, string> = {
    "X-RSC": "true",
    "X-RSC-Version": version,
  };

  if (chain.length) {
    headers["X-RSC-Segments"] = chain.join(",");
  }

  if (interceptSlot) {
    headers["X-RSC-Intercept"] = interceptSlot;
  }

  if (refererUrl) {
    headers["X-RSC-Referer"] = refererUrl;
  }

  // `priority` is not in every lib.dom yet; browsers without it ignore it.
  const asked = staticSegments(url, chain);
  const request = fetch(payloadUrl(url, chain), { headers, signal, priority } as RequestInit).catch((err: unknown) => {
    // Nothing answered at all. An abort is our own doing, not the network's —
    // leaving a link cancels its prefetch, and that must not read as offline.
    if (!(err instanceof DOMException && err.name === "AbortError")) {
      reportReachable(false);
    }

    throw err;
  });

  return request.then(async (response) => {
    // What this payload was asked for, so the apply side cannot work out a
    // different answer from state that has moved on since.
    if (asked) staticFetches.set(response, asked);

    // Something answered, whatever it said. A 500 is a reachable server.
    reportReachable(true);
    // Adopt the server's build version from the first response that carries
    // one. Until we know it we send an empty version, which the middleware
    // treats as "no opinion"; afterwards a redeploy mid-session answers 409.
    const served = response.headers.get("X-RSC-Version");

    if (served && version === "") {
      version = served;
    }

    if (response.status === 409) {
      const location = response.headers.get("X-RSC-Location");
      // Server-chosen, so checked again here: the engine refuses these at the
      // source, but a host in front of it can put anything on the header.
      window.location.href = isSafeRedirect(location ?? url) ? (location ?? url) : url;
      throw new Error("Version mismatch — full reload triggered");
    }

    return response;
  });
}

/**
 * Deserialize a Flight response into a React tree.
 *
 * Client modules, CSS <link>s and <title>/<meta> all travel inside the Flight
 * payload — @vitejs/plugin-rsc emits stylesheet links as tree elements and
 * resolves client references through its own browser runtime, and React 19
 * hoists document metadata into <head>. Nothing needs injecting from headers.
 */
function deserializeResponse(response: Response): Promise<ReactNode> {
  return flightDeserializer!(response.body!, {
    callServer: callServerFn ?? (async () => {
      throw new Error("Server actions not initialized");
    }),
  });
}

function isExternalUrl(url: string): boolean {
  try {
    return new URL(url, window.location.origin).origin !== window.location.origin;
  } catch {
    return false;
  }
}

/**
 * Whether a cached payload can be used for a navigation claiming this chain.
 *
 * A partial payload only composes against the chain it was rendered for, so
 * the chain it was fetched against has to be the one the navigation is about
 * to claim — not whatever happens to be mounted.
 */
function isUsable(cached: CacheEntry | undefined, chain: string[]): boolean {
  return (
    cached !== undefined &&
    cached.expiresAt > Date.now() &&
    cached.heldWhenFetched === chain.join(",")
  );
}

/**
 * Whether a navigation to this url would be served from the prefetch cache.
 *
 * Lets a caller decide whether showing an already-fetched page is free. A form
 * uses it to put its target route's shell on screen while the real query runs:
 * worth doing when the shell is in hand, never worth an extra request.
 */
export function isPrefetched(url: string): boolean {
  if (isExternalUrl(url)) return false;

  const interceptSlot = matchIntercept(url);
  const cacheKey = retentionKeyFor(url, interceptSlot);

  return isUsable(cache.get(cacheKey), claimedChain(interceptSlot));
}

/**
 * The layout chain a navigation to a url will claim.
 *
 * Leaving an interception claims fewer layouts than are held, which is what
 * forces the layout owning the slot to render again so the slot can empty.
 * Both sides have to agree on it: a prefetch recorded against a different
 * chain can never be used, so the close of every modal refetched a payload it
 * had already fetched.
 */
function claimedChain(interceptSlot: string | null): string[] {
  return !interceptSlot && interceptedAtDepth !== null
    ? heldLayouts.slice(0, interceptedAtDepth)
    : heldLayouts;
}

/**
 * How many redirects a single navigation will follow before giving up.
 *
 * A page that redirects to itself is a mistake someone will make, and without
 * a ceiling it is an unbounded loop of requests rather than an error. The
 * browser's own limit for HTTP redirects is 20; this is smaller because these
 * are full renders, not header exchanges.
 */
const MAX_REDIRECTS = 8;

/**
 * Go to a url, the way a Link does.
 *
 * `url` is typed to the routes the build found; cast with `as Href` when the
 * destination is computed rather than written.
 */
export async function navigate(
  url: Href,
  opts?: {
    replace?: boolean;
    preserveScroll?: boolean;
    restore?: boolean;
    /** Internal: how many redirects led here. */
    redirectsFollowed?: number;
  }
): Promise<void> {
  const redirectsFollowed = opts?.redirectsFollowed ?? 0;

  if (redirectsFollowed > MAX_REDIRECTS) {
    throw new Error(
      `Too many redirects following a navigation (${MAX_REDIRECTS}); last was ${url}`,
    );
  }

  // External URLs can't be fetched (CORS) — go directly to full page navigation
  if (isExternalUrl(url)) {
    window.location.href = url;
    return;
  }

  // Hash-only URLs — let the browser handle scrolling natively
  if (url.startsWith("#")) {
    window.location.hash = url;
    return;
  }

  // Abort any in-flight navigation
  activeController?.abort();

  // If the initial HTML stream is still loading (Suspense completions streaming),
  // stop it so the single-threaded PHP server can handle the new request.
  if (document.readyState === "loading") {
    window.stop();
  }

  const controller = new AbortController();
  activeController = controller;

  // Check if this URL matches an intercept pattern.
  // If so, send the intercept slot + current URL as referer so the server
  // renders the full tree with the interceptor in the right slot.
  const interceptSlot = matchIntercept(url);
  const currentUrl = interceptSlot
    ? window.location.pathname + window.location.search
    : undefined;

  const activityKey = retentionKey(url, interceptSlot);

  // Back and forward are the browser's own gesture for returning to a page you
  // were just on, so they reveal the retained one — instantly, and with the
  // form you were filling in still filled in. A link is a fresh request: the
  // server may have different data to say, and silently showing a stale page
  // would be the wrong default.
  // Closing an interception. The page underneath was never replaced, so this
  // is a matter of emptying the slot — no request, and nothing rebuilt. The
  // form behind the modal is still the one the user was filling in.
  if (
    !interceptSlot &&
    interceptedOver !== null &&
    retentionKey(url, null) === retentionKey(interceptedOver, null)
  ) {
    clearSlots();
    interceptedOver = null;
    interceptedAtDepth = null;

    if (opts?.replace) {
      history.replaceState({ rscUrl: url }, "", url);
    } else {
      history.pushState({ rscUrl: url }, "", url);
    }

    window.dispatchEvent(new CustomEvent("rsc-navigate", { detail: url }));

    return;
  }

  if (opts?.restore && onRestore?.(activityKey)) {
    // A restored tree carries its own slot contents, so the flag only has to
    // reflect whether what is now showing is an intercepted view.
    if (!interceptSlot) interceptedAtDepth = null;

    if (opts.replace) {
      history.replaceState({ rscUrl: url }, "", url);
    } else {
      history.pushState({ rscUrl: url }, "", url);
    }

    window.dispatchEvent(new CustomEvent("rsc-navigate", { detail: url }));

    return;
  }

  // A prefetched payload was rendered against the chain held at prefetch time.
  let segmentDepth = 0;
  let nextLayouts: string[] | null = null;
  /** The slot this answer fills, when it is one region rather than a segment. */
  let slotPayload: string | null = null;
  /** The cache entry this navigation is using, whose metadata settles with it. */
  let reused: CacheEntry | null = null;
  const previousUrl = window.location.pathname + window.location.search;

  try {
    const cacheKey = retentionKeyFor(url, interceptSlot);
    const cached = cache.get(cacheKey);
    let treePromise: Promise<ReactNode>;

    const chain = claimedChain(interceptSlot);

    // A partial payload only composes against the chain it was rendered for —
    // the one this navigation is about to claim, not whatever is mounted.
    // Hovering a link inside a modal prefetches it against the full chain, so
    // reusing that here would skip the layout holding the modal and leave it
    // open over the page behind it.
    const usable = isUsable(cached, chain);

    if (usable) {
      treePromise = cached!.tree;
      // Read after the tree resolves, not now. A prefetch fills these in when
      // its response lands, and a click can land first — hover a modal link
      // and click it quickly and the entry still says depth 0, so the
      // interceptor is applied as a whole document and the modal renders *as*
      // the page. The fields are set before the tree promise resolves, so
      // waiting for it is what makes them true.
      reused = cached!;
      cache.delete(cacheKey);
    } else {
      cache.delete(cacheKey);

      const response = await fetchRscPayload(url, controller.signal, interceptSlot ?? undefined, currentUrl, chain);

      // The check is for a host that answered the page instead of the
      // payload, which is what a server does when it does not recognise the
      // header. An exported build asks a url that only ever holds a payload,
      // and a file server labels it by extension — commonly
      // application/octet-stream — so the check would reject every navigation
      // and send the browser on a full page load instead.
      // The render asked to go somewhere else, and said so before writing
      // anything — so this is still a navigation, not a page load. A redirect
      // decided later than that cannot travel here; it arrives in the payload
      // as an error digest and RedirectBoundary performs it.
      const redirectTo = response.headers.get("X-RSC-Redirect");

      if (redirectTo) {
        // replace: the url that redirected never became a page the user was
        // on, so Back must not return to it and redirect again.
        // Chosen by the server, not written here.
        await navigate(redirectTo as Href, { replace: true, redirectsFollowed: redirectsFollowed + 1 });

        return;
      }

      const contentType = response.headers.get("Content-Type") ?? "";

      if (staticPayloadSuffix === null && !contentType.includes("text/x-component")) {
        window.location.href = url;
        return;
      }

      // Headers on a server; worked out locally on a static host, where there
      // is nothing to send them.
      const served = staticFetches.get(response) ?? null;

      segmentDepth = Number(response.headers.get("X-RSC-Segment-Depth") ?? served?.depth ?? 0) || 0;

      // Named region rather than a segment — see the apply below.
      slotPayload = response.headers.get("X-RSC-Revalidate");

      const servedLayouts = response.headers.get("X-RSC-Layouts");

      if (servedLayouts !== null) {
        nextLayouts = servedLayouts === "" ? [] : servedLayouts.split(",");
      } else if (served) {
        nextLayouts = served.chain;
      }

      treePromise = deserializeResponse(response);
    }

    const tree = await treePromise;

    if (reused) {
      segmentDepth = reused.segmentDepth;
      nextLayouts = reused.layouts;
      slotPayload = reused.slot;
    }

    if (controller.signal.aborted) return;

    if (opts?.replace) {
      history.replaceState({ rscUrl: url }, "", url);
    } else {
      history.pushState({ rscUrl: url }, "", url);
    }

    if (nextLayouts !== null) heldLayouts = nextLayouts;

    // The answer is one region, not a piece of the page: the host rendered
    // only the interceptor because the page underneath is already mounted and
    // still correct. Putting it in the slot leaves that page — and everything
    // typed into it — exactly as it was.
    if (slotPayload !== null) {
      setSlot(slotPayload, tree as ReactNode);
      interceptedOver = interceptedOver ?? previousUrl;
      interceptedAtDepth = null;

      return;
    }

    // A slot rendered for the page being left has no claim on the one being
    // arrived at.
    clearSlots();

    interceptedOver = null;
    interceptedAtDepth = interceptSlot ? segmentDepth : null;

    onNavigate?.(tree, activityKey, segmentDepth);

    if (!opts?.preserveScroll && !interceptSlot) {
      // Wait for React to commit the DOM update before scrolling.
      // Intercepted navigations preserve scroll (e.g. modal over current page).
      requestAnimationFrame(() => {
        window.scrollTo(0, 0);
      });
    }

    window.dispatchEvent(new CustomEvent("rsc-navigate", { detail: url }));
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") return;

    // Without this a navigation that fails does nothing observable: the click
    // clears its own pending state and the page stays as it was, with no
    // error, no fallback and nothing for an app to react to. Dispatched before
    // rethrowing, so a programmatic caller still sees the failure.
    window.dispatchEvent(
      new CustomEvent("rsc-navigate-error", { detail: { url, error: err } })
    );

    throw err;
  } finally {
    if (activeController === controller) {
      activeController = null;
    }
  }
}

/**
 * Put something the server re-rendered on screen.
 *
 * The trees arrive with an action's answer rather than being fetched, so this
 * is the same apply path a navigation uses — without a request, a url change
 * or a history entry.
 */
export function applyRevalidated(target: string, tree: ReactNode): void {
  const url = window.location.pathname + window.location.search;
  const key = retentionKey(url, null);

  if (target === 'all') {
    // Depth 0 replaces the root, which is what re-rendering the layouts means.
    onNavigate?.(tree, key, 0);

    return;
  }

  if (target === 'page') {
    onNavigate?.(tree, key, heldLayouts.length);

    return;
  }

  setSlot(target, tree);
}

/**
 * Ask the server for part of this page again.
 *
 *   refresh()          the page, leaving the layouts mounted
 *   refresh('all')     the whole document, layouts included
 *   refresh('orders')  one parallel slot, by the name its directory gave it
 *
 * The same words an action uses, so a thing can be invalidated from either
 * side. This is the path for a refresh nobody mutated anything to earn — a
 * button, a poll, a message saying that table has moved; what an action
 * invalidated travels back inside the action's own answer instead.
 *
 * A slot is the only region smaller than a page the server can name, so two
 * tables refresh apart from each other only if they are two slots. The page
 * form leaves the layouts alone, which is what makes it cheap and also why a
 * count living in a layout will not move until you ask for 'all'.
 */
export async function refresh(target = 'page'): Promise<void> {
  const url = window.location.pathname + window.location.search;

  if (target !== 'page' && target !== 'all') {
    const response = await fetch(payloadUrl(url), {
      headers: { "X-RSC": "true", "X-RSC-Version": version, "X-RSC-Revalidate": target },
    });

    if (!response.ok) {
      throw new Error(`Could not revalidate ${target}: the server answered ${response.status}`);
    }

    setSlot(target, await deserializeResponse(response));

    return;
  }

  const interceptSlot = matchIntercept(url);
  const cacheKey = retentionKeyFor(url, interceptSlot);

  // Never from the cache: refreshing asks what the server says now, not what
  // it said a moment ago.
  cache.delete(cacheKey);

  if (target === 'all') {
    heldLayouts = [];
  }

  // A refresh is not a navigation: the same page stays under the reader, so
  // where they were reading has to survive the tree being replaced.
  //
  // `preserveScroll` is not enough on its own. It stops navigate() scrolling
  // to the top deliberately, and says nothing about the scroll positions
  // *inside* the page. Refreshing everything replaces the root, so every
  // element that scrolls is a new node and starts at zero — a sidebar,
  // a code block, any pane with its own overflow. The window survives because
  // the document element is not the thing being replaced, which is why this
  // looks fine until a page has a second scroller in it.
  const positions = scrollPositions();

  await navigate(url as Href, { replace: true, preserveScroll: true });

  restoreScroll(positions);
}

interface ScrollPosition {
  tag: string;
  top: number;
  left: number;
}

/** Every element that can scroll, whether or not it currently is. */
function scrollables(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('*')].filter(
    (el) => el.scrollHeight > el.clientHeight || el.scrollWidth > el.clientWidth,
  );
}

/**
 * Where everything on the page is scrolled to, in document order.
 *
 * Identified by position in the list rather than by a selector: a refresh
 * re-renders the same page, so the nth scrollable element is the same one, and
 * a selector would have to survive whatever classes the markup happens to use.
 * The tag is carried only to notice when that assumption has broken.
 *
 * Everything that *can* scroll, not everything that *is* scrolled — the two
 * lists have to be built the same way or they do not line up. Recording only
 * the scrolled ones and restoring over the scrollable ones puts a sidebar's
 * position onto whatever element happens to come first, which on any page long
 * enough to scroll is <html>.
 */
function scrollPositions(): ScrollPosition[] {
  return [
    { tag: 'window', top: window.scrollY, left: window.scrollX },
    ...scrollables().map((el) => ({ tag: el.tagName, top: el.scrollTop, left: el.scrollLeft })),
  ];
}

/**
 * Put the page back where it was, once React has finished replacing it.
 *
 * Applied over several ticks rather than once, because `root.render()`
 * schedules the update instead of performing it: a single pass writes the
 * position onto the nodes that are about to be thrown away, and the ones that
 * replace them start at zero. There is nothing to await — the navigation
 * resolves when the tree is handed to React, not when React has committed it.
 *
 * `setTimeout`, not `requestAnimationFrame`. A hidden tab never runs an
 * animation frame, so a refresh in a background tab — an HMR update, a poll —
 * would leave the scroll state wrong the moment it came back into view. It
 * also makes this untestable in an automated browser, where the tab under test
 * is usually not the visible one.
 */
const RESTORE_ATTEMPTS = 5;

function restoreScroll(positions: ScrollPosition[]): void {
  const [win, ...inner] = positions;

  const apply = (attempt: number) => {
    if (window.scrollY !== win.top || window.scrollX !== win.left) {
      window.scrollTo(win.left, win.top);
    }

    const now = scrollables();

    for (let i = 0; i < inner.length && i < now.length; i++) {
      // A different element here means the page came back a different shape,
      // and guessing further would scroll something nobody touched.
      if (now[i].tagName !== inner[i].tag) break;

      if (inner[i].top !== 0 && now[i].scrollTop !== inner[i].top) now[i].scrollTop = inner[i].top;
      if (inner[i].left !== 0 && now[i].scrollLeft !== inner[i].left) now[i].scrollLeft = inner[i].left;
    }

    if (attempt < RESTORE_ATTEMPTS) setTimeout(() => apply(attempt + 1), 16);
  };

  apply(1);
}

export function prefetch(url: string, cacheForMs?: number): void {
  if (isExternalUrl(url)) return;

  const ttl = cacheForMs ?? DEFAULT_PREFETCH_TTL;
  const interceptSlot = matchIntercept(url);

  if (interceptSlot) {
    // Intercepted route — only prefetch the intercepted variant
    const currentUrl = window.location.pathname + window.location.search;
    const cacheKey = retentionKeyFor(url, interceptSlot);
    prefetchUrl(cacheKey, url, ttl, interceptSlot, currentUrl);
  } else {
    prefetchUrl(url, url, ttl);
  }
}

function prefetchUrl(
  cacheKey: string,
  url: string,
  ttl: number,
  interceptSlot?: string,
  refererUrl?: string
): void {
  const chain = claimedChain(interceptSlot ?? null);
  const existing = cache.get(cacheKey);

  if (existing && existing.expiresAt > Date.now()) {
    return;
  }

  cache.delete(cacheKey);

  const controller = new AbortController();
  prefetchControllers.set(cacheKey, controller);

  const entry: CacheEntry = {
    tree: Promise.resolve(null),
    expiresAt: Date.now() + ttl,
    segmentDepth: 0,
    layouts: null,
    slot: null,
    heldWhenFetched: chain.join(","),
  };

  // Low priority: the browser then lets a real navigation overtake a queue of
  // speculative requests instead of serving them in the order they were made.
  entry.tree = fetchRscPayload(url, controller.signal, interceptSlot, refererUrl, chain, "low")
    .then((response) => {
      // On a static host there are no headers to read, and dropping the depth
      // is not a small loss: the entry then claims a segment is a whole
      // document, and rendering a layout-less page as the document root does
      // not warn — it hangs the renderer.
      // A prefetch that lands on a redirect is not cached. Following it would
      // navigate on hover, and storing it would hand the click a 204 with no
      // body to deserialize. The click re-requests and redirects properly.
      if (response.headers.get("X-RSC-Redirect")) {
        cache.delete(cacheKey);

        return null;
      }

      entry.slot = response.headers.get("X-RSC-Revalidate");

      const local = staticFetches.get(response) ?? null;

      entry.segmentDepth = Number(response.headers.get("X-RSC-Segment-Depth") ?? local?.depth ?? 0) || 0;

      const served = response.headers.get("X-RSC-Layouts");

      if (served !== null) {
        entry.layouts = served === "" ? [] : served.split(",");
      } else if (local) {
        entry.layouts = local.chain;
      }

      return deserializeResponse(response);
    })
    .catch(() => {
      cache.delete(cacheKey);
      return null;
    })
    .finally(() => {
      // Settled, so there is nothing left to abort. A completed prefetch stays
      // in the cache — only an in-flight one is ever dropped.
      if (prefetchControllers.get(cacheKey) === controller) {
        prefetchControllers.delete(cacheKey);
      }
    });

  cache.set(cacheKey, entry);
}

/**
 * Drop a prefetch that is still in flight — the pointer left the link.
 *
 * The cache entry goes synchronously rather than in the abort's catch: the
 * rejection lands a tick later, and a click in between would find an entry
 * whose tree resolves to null and navigate to a blank page. A prefetch that
 * has already completed is kept; there is no request left to cancel and the
 * payload is still good.
 */
export function cancelPrefetch(url: string): void {
  if (isExternalUrl(url)) return;

  const interceptSlot = matchIntercept(url);
  const cacheKey = retentionKeyFor(url, interceptSlot);
  const controller = prefetchControllers.get(cacheKey);

  if (!controller) return;

  prefetchControllers.delete(cacheKey);
  cache.delete(cacheKey);
  controller.abort();
}
