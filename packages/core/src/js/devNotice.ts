/**
 * A line at the bottom of the page, in development only.
 *
 * The dev server prints the boundary the build will want, and the browser
 * console reports it; the person looking at the page sees neither. Next.js
 * shows a small badge for the same reason. This is that: fixed to the bottom
 * of the viewport, the message and the component it came from, gone on a
 * click. Nothing here reaches a production bundle - the DEV check is a
 * constant at build time and the code behind it is dropped.
 */

const ID = "rsc-kit-dev-notice";

/** The first component in a React component stack: `at AuthTrigger (...)` → `AuthTrigger`. */
export function componentIn(
  componentStack: string | undefined | null,
): string | null {
  const match = /at ([A-Z][\w$]*)/.exec(componentStack ?? "");

  return match ? match[1]! : null;
}

export function showDevNotice(
  message: string,
  componentStack?: string | null,
): void {
  if (!import.meta.env?.DEV || typeof document === "undefined") return;

  const where = componentIn(componentStack);
  const text = (where ? `${where}: ` : "") + message;

  let box = document.getElementById(ID);

  if (!box) {
    box = document.createElement("div");
    box.id = ID;
    box.setAttribute("role", "status");
    box.style.cssText =
      "position:fixed;left:12px;right:12px;bottom:12px;z-index:2147483647;" +
      "font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;color:#fff;background:#b91c1c;" +
      "border-radius:6px;padding:10px 36px 10px 14px;box-shadow:0 4px 16px rgba(0,0,0,.35);" +
      "max-height:40vh;overflow:auto;white-space:pre-wrap;cursor:pointer";
    box.title = "rsc-kit · click to dismiss";
    box.addEventListener("click", () => box?.remove());
    document.body.appendChild(box);
  }

  // The same line twice is one problem, not two.
  for (const line of Array.from(box.children)) {
    if (line.textContent === text) return;
  }

  const line = document.createElement("div");

  line.textContent = text;
  box.appendChild(line);
}
