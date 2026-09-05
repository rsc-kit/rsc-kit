// Vite-engine client bootstrap. Uses @vitejs/plugin-rsc's browser runtime as
// the Flight deserializer + action encoder, and drives the package's engine-agnostic
// navigate.ts SPA engine (Link, prefetch, popstate) through it. This replaces
// the bun engine's createRscApp + the hand-rolled webpack shim — the plugin
// resolves client references itself.
import type { Href } from "../routes.js";
import { createFromReadableStream, encodeReply, setServerCallback } from "@vitejs/plugin-rsc/browser";
import { createElement } from "react";
import { hydrateRoot } from "react-dom/client";
import { ActivityRoot } from "./ActivityRouter";
import { ServerRedirectError, throwForFailedAction } from "./errors";
import { fetchPagePayload } from "./pagePayload";
import { clearSegments, restoreSegments, setSegment } from "./segmentStore";
import type { ReactNode } from "react";
import {
  cancelPrefetch,
  isPrefetched,
  navigate,
  refresh,
  applyRevalidated,
  prefetch,
  retentionKey,
  setCallServer,
  setHeldLayouts,
  setStaticPayloads,
  setStaticRoutes,
  seedStaticChain,
  payloadUrl,
  setDeserializer,
  setInterceptManifest,
  setNavigateHandler,
  setRestoreHandler,
  setVersion,
} from "./navigate";

export async function createViteRscApp(
  container: Document | Element = document,
  interceptEntries: { urlPattern: string; slot: string }[] = [],
  options: { staticPayloads?: string | null; routes?: unknown[] | null } = {},
): Promise<void> {
  // An exported build has no server to negotiate with, so payloads live at
  // their own urls rather than behind a header on the page's url.
  setStaticPayloads(options.staticPayloads ?? null);
  // Only an exported build ships this: with no server to negotiate with, the
  // client works out for itself how much of a page it still holds.
  if (options.routes) setStaticRoutes(options.routes as never);
  // The router has to recognise an intercepted link before it asks the server,
  // so the patterns are baked into the generated browser entry. Without them
  // every intercepted route falls through to a full-page navigation.
  setInterceptManifest(interceptEntries);

  async function callServer(id: string, args: unknown[]): Promise<unknown> {
    const encoded = await encodeReply(args);

    // encodeReply returns FormData as soon as an argument contains a File.
    // Sending that as multipart would make PHP consume php://input while
    // parsing it, leaving the action with an empty body — so serialize it to
    // raw bytes under an opaque content-type and send the real one in
    // X-RSC-Content-Type for the worker to rebuild FormData from.
    let body: BodyInit;
    let realContentType: string;

    if (encoded instanceof FormData) {
      const serialized = new Response(encoded);
      body = await serialized.arrayBuffer();
      realContentType = serialized.headers.get("content-type") ?? "multipart/form-data";
    } else {
      body = encoded as BodyInit;
      realContentType = "text/plain;charset=UTF-8";
    }

    const res = await fetch("/_rsc/action", {
      method: "POST",
      headers: {
        "X-RSC-Action": id,
        // Where the action was invoked from. The host resolves it to the
        // components that render the page, so anything the action says it
        // invalidated can come back with the answer instead of being fetched
        // afterwards.
        "X-RSC-Referer": window.location.pathname + window.location.search,
        "X-RSC-Content-Type": realContentType,
        "Content-Type": "application/octet-stream",
        "X-XSRF-TOKEN": decodeURIComponent(
          document.cookie.match(/XSRF-TOKEN=([^;]+)/)?.[1] ?? "",
        ),
      },
      body,
    });

    // A failed action does not answer with a Flight stream, and the decoder
    // cannot tell — it reports its own parse failure instead of what the
    // server said.
    try {
      await throwForFailedAction(res);
    } catch (err) {
      // A redirect is an instruction, not something for a form to display:
      // an expired session answers this way, and the destination is the login
      // page rather than a message about one.
      if (err instanceof ServerRedirectError) {
        window.location.href = err.location;
      }

      throw err;
    }

    const answer = await createFromReadableStream(res.body!, { callServer });

    return unwrapRevalidated(answer);
  }

  /**
   * Put anything the action re-rendered on screen, and hand back its result.
   *
   * The trees travel with the answer rather than being fetched afterwards, so
   * the caller sees only what its action returned and never knows the page
   * was updated around it.
   */
  function unwrapRevalidated(answer: unknown): unknown {
    if (answer === null || typeof answer !== "object" || !("__rscRevalidated" in answer)) {
      return answer;
    }

    const envelope = answer as { __rscRevalidated: Record<string, unknown>; result: unknown };

    for (const [target, tree] of Object.entries(envelope.__rscRevalidated)) {
      applyRevalidated(target, tree);
    }

    return envelope.result;
  }

  setDeserializer(createFromReadableStream as never);
  setCallServer(callServer);
  // The plugin's own "use server" client stubs route through its registered
  // server callback — register the same transport there too.
  setServerCallback(callServer as never);

  // Link / Form / router live in a separate build graph and reach the SPA
  // engine through these globals.
  (window as unknown as { __rsc_navigate: typeof navigate }).__rsc_navigate = navigate;
  (window as unknown as { __rsc_prefetch: typeof prefetch }).__rsc_prefetch = prefetch;
  (window as unknown as { __rsc_cancel_prefetch: typeof cancelPrefetch }).__rsc_cancel_prefetch =
    cancelPrefetch;
  (window as unknown as { __rsc_is_prefetched: typeof isPrefetched }).__rsc_is_prefetched =
    isPrefetched;
  (window as unknown as { __rsc_refresh: typeof refresh }).__rsc_refresh = refresh;

  // Hydrate from the RSC endpoint (same url + X-RSC, no version header).
  //
  // Everything from here to the decode is failure handling, because this is
  // the one request with nothing watching it. A page whose shell is already
  // rendered looks fine while this fails, and its fallbacks stay on screen
  // indefinitely with nothing reported anywhere.
  const res = await fetchPagePayload(payloadUrl(window.location.href));

  // Seed the SPA engine with the build this page was served from, so a
  // redeploy mid-session is caught on the next navigation. This matters most
  // behind a CDN, where the shell may be cached from an older build.
  const servedVersion = res.headers.get("X-RSC-Version");

  if (servedVersion) {
    setVersion(servedVersion);
  }

  // The chain this page is built from, so the next navigation can say what is
  // already mounted and be sent only what changed.
  // A server says what this page is built from; a file server says nothing,
  // so an exported build works it out from the table it was given.
  const servedLayouts = res.headers.get("X-RSC-Layouts");

  if (servedLayouts !== null) {
    setHeldLayouts(servedLayouts.split(","));
  } else if (!seedStaticChain(window.location.href)) {
    setHeldLayouts([]);
  }
  const tree = await createFromReadableStream(res.body!, { callServer });

  // Retaining the previous page behind <Activity> needs a wrapper above the
  // page, and React will not hydrate a *document* container through one: the
  // root child of a document has to be <html>, and wrapping it hangs the
  // renderer outright (React 19.2.7). An app whose root layout owns <html>
  // therefore hydrates the tree directly and navigations replace it, as before.
  //
  // Apps that hydrate into an element get retention. Giving it to document-
  // rooted apps means SPA navigation returning only the changed segment rather
  // than a whole document, which is an engine change, not a client one.
  const retains = container !== document;

  const shell = retains
    ? createElement(ActivityRoot, {
        initialKey: retentionKey(window.location.href, null),
        initialTree: tree as ReactNode,
      })
    : (tree as ReactNode);

  const root = hydrateRoot(container, shell, {
    onRecoverableError(error: unknown, errorInfo: unknown) {
      // A PPR shell is served with its Suspense boundaries deliberately
      // unfinished — the build aborts the render once the static part is out.
      // React reports that as #419 and client-renders the boundary from the
      // Flight payload, which is the intended path, not a fault to report.
      const message = String((error as { message?: string })?.message ?? error);

      if (message.includes("419") || message.includes("did not finish this Suspense boundary")) {
        return;
      }

      console.error(error, errorInfo);
    },
  });

  // Depth 0 is a whole document and replaces the root. Anything deeper is one
  // segment: handing it to the boundary at that depth leaves the layouts above
  // it mounted, which is the point of asking for a partial render at all.
  setNavigateHandler((tree: unknown, key: string, segmentDepth: number) => {
    const newTree = tree as ReactNode;

    if (segmentDepth > 0) {
      setSegment(segmentDepth, key, newTree);

      return;
    }

    clearSegments();
    root.render(newTree);
  });

  // Back and forward reveal a page the boundaries are still holding, with the
  // form you were filling in still filled in, and without asking the server.
  setRestoreHandler((key: string) => restoreSegments(key));

  window.addEventListener("popstate", () => {
    // restore: back and forward reveal the page you were on, with its state.
    // Wherever the browser just went; not a literal this app wrote.
    navigate(window.location.href as Href, { replace: true, restore: true });
  });

  history.replaceState({ rscUrl: window.location.href }, "", window.location.href);
}
