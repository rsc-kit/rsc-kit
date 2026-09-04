"use client";

import {
  type AnchorHTMLAttributes,
  type MouseEvent,
  type Ref,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

type PrefetchStrategy = "hover" | "mount" | "click" | "none" | boolean;

interface LinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> {
  href: string;
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

const LinkStatusContext = createContext<{ pending: boolean }>({ pending: false });

export function useLinkStatus(): { pending: boolean } {
  return useContext(LinkStatusContext);
}

function isExternalUrl(url: string): boolean {
  try {
    return new URL(url, window.location.origin).origin !== window.location.origin;
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

export default function Link({
  href,
  prefetch: prefetchProp = "hover",
  cacheFor,
  replace = false,
  preserveScroll = false,
  children,
  onClick,
  onMouseEnter,
  onMouseLeave,
  ...rest
}: LinkProps) {
  const [pending, setPending] = useState(false);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const prefetchStrategy = prefetchProp === true
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

      // navigate() returns a Promise — clear pending when it resolves or rejects
      const nav = (window as any).__rsc_navigate;
      const promise = nav?.(href, { replace, preserveScroll });
      promise?.then(
        () => setPending(false),
        () => setPending(false),
      );
    },
    [href, replace, preserveScroll, onClick]
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
    [prefetchStrategy, doPrefetch, onMouseEnter]
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
    [href, onMouseLeave]
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
  useEffect(() => () => {
    if (hoverTimer.current !== null) clearTimeout(hoverTimer.current);
  }, []);

  return (
    <LinkStatusContext.Provider value={{ pending }}>
      <a
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
