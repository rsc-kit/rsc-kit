/**
 * The one-time message's cookie, shared by the server that writes it and the
 * browser that takes it. No imports: the hook that reads it is in the
 * browser bundle, and request.ts must never be.
 */
export const FLASH_COOKIE = "rsc-flash";

export type FlashKind = "success" | "error" | "info" | "warning";

export interface FlashMessage {
  message: string;
  kind: FlashKind;
}

const KINDS = new Set<string>(["success", "error", "info", "warning"]);

/**
 * What a cookie value holds, keeping only well-formed messages. The value
 * crossed the network and could have been written by anything that shares
 * the domain, so nothing here trusts it beyond being text.
 */
export function readFlash(value: string | undefined | null): FlashMessage[] {
  if (!value) return [];

  let parsed: unknown;

  try {
    parsed = JSON.parse(value);
  } catch {
    return [];
  }

  if (!Array.isArray(parsed)) return [];

  return parsed.flatMap((entry): FlashMessage[] => {
    if (typeof entry !== "object" || entry === null) return [];

    const { message, kind } = entry as Record<string, unknown>;

    if (typeof message !== "string" || message === "") return [];

    return [
      { message, kind: typeof kind === "string" && KINDS.has(kind) ? (kind as FlashKind) : "info" },
    ];
  });
}
