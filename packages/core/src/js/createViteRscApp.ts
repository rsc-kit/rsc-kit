// Vite-engine client bootstrap. Uses @vitejs/plugin-rsc's browser runtime as
// the Flight deserializer + action encoder, and drives the package's engine-agnostic
// navigate.ts SPA engine (Link, prefetch, popstate) through it. This replaces
// the bun engine's createRscApp + the hand-rolled webpack shim — the plugin
// resolves client references itself.
import { SEARCH_PARAMS_FALLBACK } from "./useSearchParams";
import { recoverFromStaleAssets } from "./staleAssets";
import { afterHydration, replayEarlyClicks } from "./earlyClicks";
import { parseRedirectDigest } from "../redirectDigest.js";
import { showDevNotice } from "./devNotice";
import { caughtByLoading } from "./fallbackReport";
import { noteNavigation } from "./segmentStore";
import type { Route } from "../routes.js";
import { isSafeRedirect } from "../safeUrl.js";
import {
  createFromReadableStream,
  encodeReply,
  setServerCallback,
} from "@vitejs/plugin-rsc/browser";
import { createElement, startTransition } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { activityMarkersIn } from "./activityMarkers";
import { ActivityRoot } from "./ActivityRouter";
import { ServerRedirectError, noteRedirected, throwForFailedAction } from "./errors";
import { fetchPagePayload } from "./pagePayload";
import { claimRead, setQueryCodec } from "./queryClient";
import { clearSegments, dropHidden, isHeld, prerenderSegment, restoreSegments, setSegment } from "./segmentStore";
import type { ReactNode } from "react";
import {
  cancelPrefetch,
  isPrefetched,
  navigate,
  setApiRoutes,
  refresh,
  applyRevalidations,
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
  getHeldLayouts,
  setNavigateHandler,
  setHeldHandlers,
  setPrerenderHandler,
  setReplaceRootHandler,
  setRestoreHandler,
  setVersion,
} from "./navigate";


/**
 * A redirect that travelled as an error: the digest of the error itself, or
 * of the cause React wraps it in when it reports client-rendering a boundary
 * the server had already failed.
 */
function isRedirect(error: unknown): boolean {
  const digest = (error as { digest?: unknown } | null)?.digest;
  const cause = (error as { cause?: { digest?: unknown } } | null)?.cause;

  return parseRedirectDigest(digest) !== null || parseRedirectDigest(cause?.digest) !== null;
}

export async function createViteRscApp(
  container: Document | Element = document,
  interceptEntries: { urlPattern: string; slot: string }[] = [],
  options: { staticPayloads?: string | null; routes?: unknown[] | null; apiRoutes?: string[] } = {},
): Promise<void> {
  // The urls a route.ts answers: a link to one is an anchor, never a
  // prefetch, never a payload fetch.
  if (options.apiRoutes) setApiRoutes(options.apiRoutes);
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
    // A read opened a slot before calling the reference, and this is the first
    // point at which the id exists on the client — React keeps it private and
    // hands it over only here. Claiming the slot enqueues the read for the
    // batched GET instead of posting it.
    const read = claimRead(id, args);

    if (read) return await read;

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
      realContentType =
        serialized.headers.get("content-type") ?? "multipart/form-data";
    } else {
      body = encoded as BodyInit;
      realContentType = "text/plain;charset=UTF-8";
    }

    // Where the action was invoked from. The host resolves it to the
    // components that render the page, so anything the action says it
    // invalidated can come back with the answer instead of being fetched
    // afterwards - and what comes back is for this page, not whichever is
    // showing when it lands.
    const from = window.location.pathname + window.location.search;

    const res = await fetch("/_rsc/action", {
      method: "POST",
      headers: {
        "X-RSC-Action": id,
        "X-RSC-Referer": from,
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
        // The destination came off a response header, so it is checked here
        // too — the engine refuses these at the source, but a proxy or a host
        // in front of it can write whatever it likes. A navigation, not a
        // document load: the layouts stay mounted and the history entry the
        // form was on is replaced, the way a redirect after a POST should
        // be - Back does not return to the submitted form.
        if (isSafeRedirect(err.location)) {
          void navigate(err.location as Route, { replace: true });
        }

        // Performed, so resolved - not thrown. The call's answer is "you are
        // being taken somewhere": an object saying so, the shape an action's
        // result already has, so a caller reading result.validationErrors
        // reads undefined rather than throwing. A caller that awaited the
        // action in a plain startTransition had no catch for a throw, the
        // rejection reached React, and the root unmounted to a white page
        // on every logout.
        noteRedirected(err.location);

        return { redirected: err.location };
      }

      throw err;
    }

    const answer = await createFromReadableStream(res.body!, { callServer });

    return unwrapRevalidated(answer, from);
  }

  /**
   * Put anything the action re-rendered on screen, and hand back its result.
   *
   * The trees travel with the answer rather than being fetched afterwards, so
   * the caller sees only what its action returned and never knows the page
   * was updated around it.
   */
  function unwrapRevalidated(answer: unknown, from: string): unknown {
    if (
      answer === null ||
      typeof answer !== "object" ||
      !("__rscRevalidated" in answer)
    ) {
      return answer;
    }

    const envelope = answer as {
      __rscRevalidated: Record<string, unknown>;
      result: unknown;
    };

    applyRevalidations(from, envelope.__rscRevalidated as Record<string, ReactNode>);

    return envelope.result;
  }

  setDeserializer(createFromReadableStream as never);
  // The query transport speaks Flight too, and reaches the runtime through here
  // rather than importing it: a second import of the browser runtime from the
  // client-component graph is a second client-reference registry, and the
  // symptom is components that render as undefined with nothing logged.
  setQueryCodec({
    deserialize: (stream) =>
      createFromReadableStream(stream, { callServer }) as Promise<unknown>,
    encode: (args) => encodeReply(args) as Promise<string | FormData>,
    // The way back when a read cannot ride in a url. Re-entering callServer is
    // safe: the slot was cleared the moment the reference returned, so this
    // takes the ordinary POST path rather than claiming a read again.
    asAction: (id, args) => callServer(id, args),
  });
  setCallServer(callServer);
  // The plugin's own "use server" client stubs route through its registered
  // server callback — register the same transport there too.
  setServerCallback(callServer as never);

  // Link / Form / router live in a separate build graph and reach the SPA
  // engine through these globals.
  (window as unknown as { __rsc_navigate: typeof navigate }).__rsc_navigate =
    navigate;
  (window as unknown as { __rsc_prefetch: typeof prefetch }).__rsc_prefetch =
    prefetch;
  (
    window as unknown as { __rsc_cancel_prefetch: typeof cancelPrefetch }
  ).__rsc_cancel_prefetch = cancelPrefetch;
  (
    window as unknown as { __rsc_is_prefetched: typeof isPrefetched }
  ).__rsc_is_prefetched = isPrefetched;
  (window as unknown as { __rsc_refresh: typeof refresh }).__rsc_refresh =
    refresh;

  // Hydrate from the RSC endpoint (same url + X-RSC, no version header).
  //
  // Everything from here to the decode is failure handling, because this is
  // the one request with nothing watching it. A page whose shell is already
  // rendered looks fine while this fails, and its fallbacks stay on screen
  // indefinitely with nothing reported anywhere.
  const res = await fetchPagePayload(payloadUrl(window.location.href));

  // Seed the router with the build this DOCUMENT is, so a redeploy is caught
  // on the next navigation: the host answers 409 to a client of another
  // build, and the document is loaded again. From the document's own meta
  // first - a document a service worker served from its cache is the last
  // build's, while the payload just fetched is this one's, and seeding from
  // the payload would have the old client claim to be new. The header is
  // the fallback for a document with no meta.
  const documentBuild = document.querySelector('meta[name="rsc-kit:build"]')?.getAttribute("content");
  const servedVersion = documentBuild || res.headers.get("X-RSC-Version");

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

  // A document that cannot be hydrated by this tree is client-rendered
  // instead - a repaint, not a freeze. React 19.2 does not recover from a
  // hydration mismatch at an <Activity>: it retries hydrating the boundary,
  // mismatches again, and never returns to the main thread. Every segment
  // boundary is an Activity, one per layout, so a document with none where
  // the page has layouts is that mismatch, guaranteed, before React starts.
  // What produced one: a parameterised route's PPR shell, rendered without
  // a page key and, by a build before this one, without the Activities too.
  // None rather than fewer: a boundary inside a Suspense hole the shell left
  // unfinished has no marker and is client-rendered by React on its own,
  // which is not a mismatch. The stale-asset reload does not apply - the
  // document would come back the same.
  const missing = retains && getHeldLayouts().length > 0 && activityMarkersIn(container) === 0;

  if (missing) {
    console.warn(
      "[rsc-kit] The document has no <Activity> boundaries where the page has layouts, so it cannot be hydrated; rendering the page instead. A PPR shell built by an earlier release lacks them - rebuild.",
    );
  }

  const onRecoverableError = (error: unknown, errorInfo: unknown) => {
      // A client component whose chunk the server no longer has fails while
      // hydrating, and React reports that as recoverable: the page is loaded
      // again, with the current names.
      if (recoverFromStaleAssets(error)) return;

      // A redirect decided inside a boundary: the server's row carried it as
      // the digest, React client-renders the boundary and reports that it
      // did, and the RedirectBoundary is already performing it. Nothing to
      // read in the console about a page doing what it was told.
      if (isRedirect(error)) return;

      // A PPR shell is served with its Suspense boundaries deliberately
      // unfinished — the build aborts the render once the static part is out.
      // React reports that as #419 and client-renders the boundary from the
      // Flight payload, which is the intended path, not a fault to report.
      const message = String((error as { message?: string })?.message ?? error);

      if (
        message.includes("419") ||
        message.includes("did not finish this Suspense boundary")
      ) {
        return;
      }

      // A view transition the browser cancelled because the tab was not
      // visible. React reports it here; the update still landed, and a tab
      // in the background is not a fault in the page.
      if (message.includes("Transition was aborted")) return;

      // A navigation another one overtook: its request was aborted, and a
      // row of its payload that a component was still reading rejects with
      // the abort. React recovers by rendering the root again synchronously
      // and reports the recovery here as #520, with the abort as the cause.
      // The page it recovered to is the one the second navigation asked for;
      // the abort was the design, not a fault.
      const cause = (error as { cause?: { name?: string; message?: string } } | null)?.cause;

      if (
        cause?.name === "AbortError" ||
        /\baborted\b/i.test(cause?.message ?? "") ||
        /\baborted\b/i.test(message)
      ) {
        return;
      }
      // A page whose query string was read under a boundary carries the
      // fallback there; React reports the recovery on hydration. Under a
      // boundary the developer wrote, that is the designed path and nothing
      // is said. With nothing closer than a loading.tsx, the whole segment
      // showed the fallback until the query arrived - said here, in the
      // page and the console, for whoever is looking at either. Production
      // has no stack to tell the two apart; the build's note on the route is
      // the record there.
      if (
        (error as { digest?: string })?.digest === SEARCH_PARAMS_FALLBACK ||
        message.includes("useSearchParams()")
      ) {
        const stack = (errorInfo as { componentStack?: string } | null)
          ?.componentStack;

        if (!caughtByLoading(stack)) return;

        const hint =
          "useSearchParams() was read on the server with nothing closer than a loading.tsx, so the " +
          "whole segment showed that fallback until the query arrived. A <Suspense> around the " +
          "component that reads keeps the rest of the page painted.";

        showDevNotice(hint, stack);
        console.error(new Error(hint), errorInfo);

        return;
      }

      console.error(error, errorInfo);
  };

  const rootOptions = {
    onRecoverableError,
    // A chunk the deploy no longer serves is not a fault in the page; the
    // document is loaded again, and the new names come with it. Anything
    // else is reported the way React would have.
    onUncaughtError(error: unknown, errorInfo: unknown) {
      if (recoverFromStaleAssets(error)) return;

      console.error(error, errorInfo);
    },
    onCaughtError(error: unknown, errorInfo: unknown) {
      if (recoverFromStaleAssets(error)) return;
      // Caught by the RedirectBoundary, which is performing it.
      if (isRedirect(error)) return;

      console.error(error, errorInfo);
    },
  };

  const root = missing
    ? (() => {
        const created = createRoot(container as Element, rootOptions);

        created.render(shell);

        return created;
      })()
    : hydrateRoot(container, shell, rootOptions);

  // Depth 0 is a whole document and replaces the root. Anything deeper is one
  // segment: handing it to the boundary at that depth leaves the layouts above
  // it mounted, which is the point of asking for a partial render at all.
  setNavigateHandler((tree: unknown, key: string, segmentDepth: number) => {
    const newTree = tree as ReactNode;

    // From here on the boundary animates; the seed commit before this did not.
    noteNavigation();

    if (segmentDepth > 0) {
      setSegment(segmentDepth, key, newTree);

      return;
    }

    clearSegments();
    root.render(newTree);
  });

  // The whole document again, in place - revalidate("all"). Not through the
  // handler above: that clears the boundaries and renders the tree as a new
  // page, and a boundary emptied re-keys its Activity to the current url and
  // remounts everything under it. A port's "added to cart" went with the
  // form's state that way, on every product reached by a link. Here the root
  // takes the tree in a transition and each boundary hands its page the new
  // children under the key it has - see replaceActive.
  setReplaceRootHandler((tree: unknown) => {
    startTransition(() => root.render(tree as ReactNode));
  });

  // Back and forward reveal a page the boundaries are still holding, with the
  // form you were filling in still filled in, and without asking the server.
  setRestoreHandler((key: string, maxAge?: number) =>
    restoreSegments(key, maxAge),
  );
  setHeldHandlers(isHeld, dropHidden);

  // A touch or a settled hover: the page is rendered hidden now, and the
  // click reveals it. See warm() in navigate.ts and prerenderSegment.
  setPrerenderHandler((tree: unknown, key: string, segmentDepth: number) => {
    prerenderSegment(segmentDepth, key, tree as ReactNode);
  });

  window.addEventListener("popstate", () => {
    // restore: back and forward reveal the page you were on, with its state.
    // Wherever the browser just went; not a literal this app wrote.
    navigate(window.location.href as Route, { replace: true, restore: true });
  });

  history.replaceState(
    { rscUrl: window.location.href },
    "",
    window.location.href,
  );

  // A tap held by the bootstrap script, navigated to once hydration has
  // committed - not now: the runtime's script running is seconds before
  // React can dispatch a click on a phone still downloading chunks, and
  // a tap in that window would be the browser's. See earlyClicks.ts.
  afterHydration(() => replayEarlyClicks((url) => navigate(url as Route)));
}

