"use client";

/**
 * The nonce the page's Content-Security-Policy allows inline code by, for a
 * library that writes its own: next-themes' `nonce` prop, a `<style>` a
 * component inserts, an analytics snippet.
 *
 * A client hook, not a server function, because the nonce that matters is
 * the document's. The policy is fixed by the response that delivered the
 * document; a navigation's payload is rendered later, with a nonce of its
 * own that the document has never heard of. A layout handing a server-read
 * nonce down as a prop would hand down the wrong one the first time it was
 * re-rendered by a navigation or a refresh. So the server render supplies the
 * nonce it is writing the document with, and the browser reads it back from
 * the document itself - the scripts React wrote carry it.
 *
 * Undefined where the page has no nonce: no policy, or a page whose inline
 * code is allowed by hash - one stored at build, a shell, a render a cache
 * keeps. An inline script rendered into such a page is hashed with the rest
 * of it and runs without one; code inserted later, after hydration, has
 * nothing to run by.
 */

import { createContext, useContext } from "react";
import type { Context } from "react";

/**
 * The nonce of the response the server is rendering. Set by the server's
 * render around the whole tree; absent in the browser.
 *
 * Kept on a global symbol so the server's entry and the copy of this module
 * the client components were bundled with agree on one context.
 */
export function nonceContext(): Context<string | undefined> {
  const key = Symbol.for("rsc-kit.nonce");
  const store = globalThis as Record<symbol, Context<string | undefined> | undefined>;

  return (store[key] ??= createContext<string | undefined>(undefined));
}

let documentNonce: string | undefined;

/**
 * The nonce the document's own scripts carry. The attribute reads empty once
 * the browser has applied the policy - it hides it from the page's other
 * scripts - so it is the property that is read. Only a found nonce is kept:
 * a shell's holes, and their nonced scripts, can arrive after the first read.
 */
export function nonceOfDocument(): string | undefined {
  if (documentNonce || typeof document === "undefined") return documentNonce;

  for (const script of document.querySelectorAll<HTMLScriptElement>("script[nonce]")) {
    if (script.nonce) return (documentNonce = script.nonce);
  }

  return undefined;
}

export function useNonce(): string | undefined {
  const rendering = useContext(nonceContext());

  return typeof document === "undefined" ? rendering : nonceOfDocument();
}

export default useNonce;
