"use client";

import { LinkStatusContext } from "./useLinkStatus";
import { prefetchWhenVisible } from "./viewportPrefetch";
import { type Route, type SearchProp, withSearch } from "../routes.js";
import {
  type AnchorHTMLAttributes,
  type MouseEvent,
  type Ref,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

type PrefetchStrategy = "hover" | "mount" | "click" | "none" | boolean;

interface LinkBaseProps<H extends Route> extends Omit<
  AnchorHTMLAttributes<HTMLAnchorElement>,
  "href"
> {
  /**
   * Where this goes. Typed to the routes the build found, so a link to a page
   * that does not exist stops compiling; `path as Route` when it is computed.
   */
  href: H;
  /**
   * The underlying anchor.
   *
   * Spread onto it like any other prop — React 19 passes ref through a
   * function component without forwardRef — but declared here because it is
   * not part of AnchorHTMLAttributes. A link that cannot be focused is a link
   * a dialog cannot move focus to when it opens.
   */
  ref?: Ref<HTMLAnchorElement>;
  prefetch?: PrefetchStrategy;
  cacheFor?: number;
  replace?: boolean;
  preserveScroll?: boolean;
}

/**
 * `search` is typed to the page's own `searchParams` schema when it exports
 * one — the same schema the page parses with, so a key it never reads or a
 * number written as text does not compile, and a key it requires is required
 * here. With no schema, any scalars. See SearchFor in routes.ts.
 */
type LinkProps<H extends Route> = LinkBaseProps<H> & SearchProp<H>;

function isExternalUrl(url: string): boolean {
  try {
    return (
      new URL(url, window.location.origin).origin !== window.location.origin
    );
  } catch {
    return false;
  }
}

function shouldInterceptClick(e: MouseEvent<HTMLAnchorElement>): boolean {
  return (
    !e.defaultPrevented &&
    e.button === 0 &&
    !e.metaKey &&
    !e.ctrlKey &&
    !e.shiftKey &&
    !e.altKey
  );
}

/**
 * How long a pointer has to settle on a link before it prefetches.
 *
 * A pointer crossing a nav bar enters every link on the way, and each one used
 * to fire a request immediately — enough to fill the browser's per-origin
 * connection limit with pages the user never meant to visit. Waiting is close
 * to free: the prefetch only has to beat the click, and a click that follows a
 * hover this short would not have had its payload back anyway.
 */
const HOVER_PREFETCH_DELAY_MS = 100;

export default function Link<H extends Route>({
  href: path,
  search,
  prefetch: prefetchProp = "hover",
  cacheFor,
  replace = false,
  preserveScroll = false,
  children,
  onClick,
  onMouseEnter,
  onMouseLeave,
  ref: callerRef,
  ...rest
}: LinkProps<H>) {
  // The string the anchor and the router both use: the path, with the typed
  // search params serialised onto it.
  const href = (search ? withSearch(path, search as object) : path) as Route;
  const [pending, setPending] = useState(false);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const prefetchStrategy =
    prefetchProp === true
      ? "hover"
      : prefetchProp === false
        ? "none"
        : prefetchProp;

  const doPrefetch = useCallback(() => {
    if (isExternalUrl(href)) return;
    const fn = (window as any).__rsc_prefetch;
    fn?.(href, cacheFor);
  }, [href, cacheFor]);

  // Only useEffect needed: prefetch on mount strategy
  useEffect(() => {
    if (prefetchStrategy === "mount") {
      doPrefetch();
    }
  }, [prefetchStrategy, doPrefetch]);

  // Where nothing can hover, the link prefetches as it comes into view -
  // the head start a touch gives is a round trip short. See viewportPrefetch.
  const anchor = useRef<HTMLAnchorElement | null>(null);

  useEffect(() => {
    if (prefetchStrategy !== "hover") return;

    return prefetchWhenVisible(anchor.current, doPrefetch);
  }, [prefetchStrategy, doPrefetch]);

  const handleClick = useCallback(
    (e: MouseEvent<HTMLAnchorElement>) => {
      onClick?.(e);

      if (e.defaultPrevented) return;

      const target = (e.currentTarget as HTMLAnchorElement).target;
      if (target && target !== "_self") return;
      if (!shouldInterceptClick(e) || isExternalUrl(href)) return;

      // Hash-only links (#section) — let the browser scroll natively
      if (href.startsWith("#")) return;

      e.preventDefault();
      setPending(true);

      // A hover that had not yet prefetched: the click is the navigation, and
      // a prefetch of the page being left for, firing after it, is a request
      // for nothing - seen as a stray 204 for a guarded link after landing
      // on the login page.
      if (hoverTimer.current !== null) {
        clearTimeout(hoverTimer.current);
        hoverTimer.current = null;
      }

      // navigate() returns a Promise — clear pending when it resolves or rejects
      const nav = (window as any).__rsc_navigate;
      const promise = nav?.(href, { replace, preserveScroll });
      promise?.then(
        () => setPending(false),
        () => setPending(false),
      );
    },
    [href, replace, preserveScroll, onClick],
  );

  const handleMouseEnter = useCallback(
    (e: MouseEvent<HTMLAnchorElement>) => {
      onMouseEnter?.(e);

      if (prefetchStrategy !== "hover" && prefetchStrategy !== "click") return;

      if (hoverTimer.current !== null) clearTimeout(hoverTimer.current);

      hoverTimer.current = setTimeout(() => {
        hoverTimer.current = null;
        doPrefetch();
      }, HOVER_PREFETCH_DELAY_MS);
    },
    [prefetchStrategy, doPrefetch, onMouseEnter],
  );

  const handleMouseLeave = useCallback(
    (e: MouseEvent<HTMLAnchorElement>) => {
      onMouseLeave?.(e);

      // Never fired: the pointer passed over on its way somewhere else.
      if (hoverTimer.current !== null) {
        clearTimeout(hoverTimer.current);
        hoverTimer.current = null;
      }

      // Already in flight: give the connection back to whatever the pointer is
      // heading for. A prefetch that has landed is kept — see cancelPrefetch.
      if (isExternalUrl(href)) return;
      (window as any).__rsc_cancel_prefetch?.(href);
    },
    [href, onMouseLeave],
  );

  // Touch gets no delay. There is no hovering to disambiguate — a touch is
  // already the start of a tap — and touchstart leads the click by little
  // enough that spending any of it waiting would waste the head start.
  const handleTouchStart = useCallback(() => {
    if (prefetchStrategy === "hover" || prefetchStrategy === "click") {
      doPrefetch();
    }
  }, [prefetchStrategy, doPrefetch]);

  // A link unmounted mid-hover (navigating away) must not prefetch afterwards.
  useEffect(
    () => () => {
      if (hoverTimer.current !== null) clearTimeout(hoverTimer.current);
    },
    [],
  );

  return (
    <LinkStatusContext.Provider value={{ pending }}>
      <a
        // The caller's ref still fills: a dialog moving focus to its link
        // needs the element as much as the observer above does.
        ref={(node) => {
          anchor.current = node;

          if (typeof callerRef === "function") callerRef(node);
          else if (callerRef) (callerRef as { current: HTMLAnchorElement | null }).current = node;
        }}
        href={href}
        onClick={handleClick}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onTouchStart={handleTouchStart}
        data-pending={pending ? "" : undefined}
        {...rest}
      >
        {children}
      </a>
    </LinkStatusContext.Provider>
  );
}
