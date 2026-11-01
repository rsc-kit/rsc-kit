import { cookies } from "./request.js";
import { FLASH_COOKIE, readFlash, type FlashKind } from "./flashCookie.js";

export type { FlashKind, FlashMessage } from "./flashCookie.js";

/**
 * A message for the next page the visitor sees: "Saved." after a save that
 * redirects to the list. Call it in a server action, middleware or a
 * route.ts - anywhere a cookie can still be set - and show it with
 * useFlash() from @rsc-kit/core/useFlash.
 *
 * A cookie the browser takes, not one the server reads. A page that read it
 * would be a page that can never be stored or cached at the edge, and a
 * render cannot clear it anyway: its headers leave before it starts. So the
 * page is the same for everyone, and the browser picks the message up after
 * the navigation and clears it, once.
 *
 * Two calls in one request are two messages. Unread, it lapses after a
 * minute, so a message never turns up on some later, unrelated page.
 */
export async function flash(message: string, kind: FlashKind = "success"): Promise<void> {
  const jar = await cookies();
  const queued = readFlash(jar.get(FLASH_COOKIE)?.value);

  // Readable by script on purpose (no HttpOnly): the browser is what takes it.
  // It holds a message the app chose, never data.
  jar.set(FLASH_COOKIE, JSON.stringify([...queued, { message, kind }]), {
    path: "/",
    maxAge: 60,
    sameSite: "lax",
  });
}
