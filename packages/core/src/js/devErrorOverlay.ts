/**
 * A failed server action, shown on the page in development.
 *
 * In Vite's own error overlay - the one a broken import or a failed render
 * opens - so the failure looks like every other one the developer has seen
 * here. Its first line is the backend's exception when the backend threw,
 * its file the first frame in the app's own code rather than the framework's,
 * and the framework's frames are counted rather than listed. Where the
 * overlay is not defined (the page was not served by Vite's dev server) the
 * dev notice says it instead.
 *
 * Installed by the generated browser entry under import.meta.env.DEV, which
 * Vite removes from a production build, as a hook the action's failure path
 * calls: imported there directly, all of it would be in the runtime every
 * production page loads.
 */

import { showDevNotice } from "./devNotice.js";

export interface DescribedActionError {
  message: string;
  stack: string;
  backend?: { type: string; message: string; frames: string[] };
}

/** A dependency's frame, not the app's: Composer's, npm's, Go's module cache. */
const DEPENDENCY = /(^|[\s/])(vendor|node_modules|pkg\/mod)\//;

/** What Vite's overlay takes: its message, the file it names, and the stack under it. */
export function overlayError(described: DescribedActionError): { message: string; stack: string; id?: string; plugin: string } {
  const backend = described.backend;

  if (!backend) return { message: described.message, stack: described.stack, plugin: "rsc-kit" };

  const own = backend.frames.filter((frame) => !DEPENDENCY.test(frame));
  const hidden = backend.frames.length - own.length;
  const where = own.map((frame) => frame.split(" ")[0]!).find((file) => /:\d+$/.test(file));
  const lines = [
    "In the backend:",
    ...own.map((frame) => "    at " + frame),
    ...(hidden > 0 ? [`    … ${hidden} more in dependencies`] : []),
    "",
    "In the renderer:",
    described.stack,
  ];

  return {
    message: `${backend.type}: ${backend.message}`,
    stack: lines.join("\n"),
    ...(where ? { id: where } : {}),
    plugin: "rsc-kit",
  };
}

export function showDevActionError(described: DescribedActionError): void {
  if (typeof document === "undefined") return;

  const error = overlayError(described);
  const Overlay = typeof customElements === "undefined" ? undefined : customElements.get("vite-error-overlay");

  if (!Overlay) {
    showDevNotice(`${error.message}\n${error.stack}`);

    return;
  }

  // One at a time: a second failure replaces the first, as Vite's does.
  for (const open of Array.from(document.querySelectorAll("vite-error-overlay"))) open.remove();

  document.body.appendChild(new (Overlay as unknown as new (err: unknown) => HTMLElement)(error));
}

/**
 * Read a failed action's answer for what the renderer said about it
 * (devActionError.ts) and, when it said something, show it and throw it -
 * the message, so the caller sees what failed rather than a status.
 */
export function installDevActionErrors(): void {
  (globalThis as { __rscKitDevActionError?: (response: Response) => Promise<void> }).__rscKitDevActionError = async (response) => {
    if (response.headers.get("X-RSC-Dev-Error") !== "1") return;

    const described = (await response.json().catch(() => null)) as DescribedActionError | null;

    if (!described?.message) return;

    showDevActionError(described);

    throw new Error(described.message);
  };
}
