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
  showOverlay(overlayError(described));
}

/** At most this much of an answer nobody described goes in the overlay. */
const ANSWER_LINES = 60;

/**
 * A failed answer's body as lines of text: an HTML page's words without its
 * markup, scripts or styles, anything else as it came.
 *
 * Text, not the page: the overlay shows text, and the page in a frame would
 * inherit this one's policy - its inline scripts and styles refused, so a
 * backend's debug page arrived unstyled and inert anyway. The words are what
 * say what went wrong.
 */
export function answerAsText(body: string, contentType: string): string[] {
  const html = /html/i.test(contentType) || /^\s*<(!doctype|html)/i.test(body);
  const text = html
    ? body
        .replace(/<(script|style|template|noscript|svg|head)\b[\s\S]*?<\/\1\s*>/gi, "")
        .replace(/<(br|\/?(p|div|li|tr|h[1-6]|pre|section|header|footer|main|article|table|ul|ol))\b[^>]*>/gi, "\n")
        .replace(/<[^>]*>/g, " ")
        .replace(/&(#x?[0-9a-f]+|amp|lt|gt|quot|apos|nbsp);/gi, (_, entity: string) => {
          const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
          const lower = entity.toLowerCase();

          if (named[lower]) return named[lower];

          const code = lower.startsWith("#x") ? parseInt(lower.slice(2), 16) : parseInt(lower.slice(1), 10);

          return Number.isFinite(code) ? String.fromCodePoint(code) : "";
        })
    : body;

  return text
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line !== "");
}

/**
 * What the overlay shows for a failed action nobody described: the status,
 * and what came with it.
 */
export function unexplainedActionError(status: number, statusText: string, lines: string[]): { message: string; stack: string; plugin: string } {
  const shown = lines.slice(0, ANSWER_LINES);
  const more = lines.length - shown.length;

  return {
    message: `Server action failed with ${status}${statusText ? " " + statusText : ""}`,
    stack: [
      shown.length
        ? "The answer did not say what failed in a form the renderer writes - it came from the renderer before the action ran, or from a backend or proxy in front of it. What it said:"
        : "The answer was empty: it came from the renderer before the action ran, or from a backend or proxy in front of it.",
      "",
      ...shown.map((line) => "    " + line),
      ...(more > 0 ? [`    … ${more} more lines`] : []),
    ].join("\n"),
    plugin: "rsc-kit",
  };
}

function showOverlay(error: { message: string; stack: string; id?: string; plugin: string }): void {
  if (typeof document === "undefined") return;

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
 *
 * An answer the renderer did not describe is shown too, as text. Laravel's
 * page saying no renderer is running, a proxy's 502, a refused origin: each
 * reached the form as "Server action failed with 502", and what it said was
 * only in the network tab. A navigation that gets one leaves for it as a
 * document load and shows it; an action has no page to leave for.
 */
export function installDevActionErrors(): void {
  (globalThis as { __rscKitDevActionError?: (response: Response) => Promise<void> }).__rscKitDevActionError = async (response) => {
    if (response.headers.get("X-RSC-Dev-Error") !== "1") {
      const body = await response.text().catch(() => "");

      showOverlay(unexplainedActionError(response.status, response.statusText, answerAsText(body, response.headers.get("Content-Type") ?? "")));

      return;
    }

    const described = (await response.json().catch(() => null)) as DescribedActionError | null;

    if (!described?.message) return;

    showDevActionError(described);

    throw new Error(described.message);
  };

  // A page that threw while rendering, caught by the boundary around it. It
  // is drawn there - the layouts stay - and opened here as well, the way a
  // document load that fails opens it: arriving at the page by a link, the
  // error was only in the page's place, and in the overlay after a reload.
  (globalThis as { __rscKitDevRenderError?: (error: unknown) => void }).__rscKitDevRenderError = (error) => {
    const failure = error instanceof Error ? error : new Error(String(error));
    const name = failure.name && failure.name !== "Error" ? failure.name + ": " : "";

    showOverlay({ message: name + failure.message, stack: failure.stack ?? "", plugin: "rsc-kit" });
  };
}
