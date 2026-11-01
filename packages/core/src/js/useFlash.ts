"use client";

import { useEffect, useRef } from "react";
import { FLASH_COOKIE, readFlash, type FlashMessage } from "../flashCookie.js";

export type { FlashKind, FlashMessage } from "../flashCookie.js";

/**
 * Hands each message flash() queued to `onMessage`, once, and clears it.
 *
 *   useFlash(({ message, kind }) => (kind === 'error' ? toast.error : toast.success)(message))
 *
 * Put it in a client component in the root layout: it looks on mount, after
 * every navigation (an action's redirect is one), and whenever the cookie
 * changes where the browser can say so - an action that stays on the page.
 * Render the message as text; it is a cookie, and a cookie can be set by
 * anything on the domain.
 */
export function useFlash(onMessage: (message: FlashMessage) => void): void {
  const latest = useRef(onMessage);

  latest.current = onMessage;

  useEffect(() => {
    const take = () => {
      for (const message of takeFlash()) latest.current(message);
    };

    take();

    // CookieStore says when a response set the cookie, even with no
    // navigation. Where it is missing (or the page is not a secure context),
    // a navigation is still the moment that matters.
    const store = (globalThis as { cookieStore?: EventTarget }).cookieStore;

    window.addEventListener("rsc-navigate", take);
    window.addEventListener("popstate", take);
    store?.addEventListener("change", take);

    return () => {
      window.removeEventListener("rsc-navigate", take);
      window.removeEventListener("popstate", take);
      store?.removeEventListener("change", take);
    };
  }, []);
}

/** The queued messages, taken: read, then cleared, so each is shown once. */
export function takeFlash(): FlashMessage[] {
  if (typeof document === "undefined") return [];

  const prefix = `${FLASH_COOKIE}=`;
  const raw = document.cookie.split("; ").find((part) => part.startsWith(prefix));

  if (!raw) return [];

  document.cookie = `${FLASH_COOKIE}=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/; SameSite=Lax`;

  let value: string;

  try {
    value = decodeURIComponent(raw.slice(prefix.length));
  } catch {
    return [];
  }

  return readFlash(value);
}
