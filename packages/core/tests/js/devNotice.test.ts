import { registerDom } from "./dom";

registerDom();

const { describe, expect, test } = await import("bun:test");

// Bun mirrors process.env into import.meta.env; the notice is dev-only.
process.env.DEV = "1";

const { componentIn, showDevNotice } = await import("../../src/js/devNotice");

/**
 * The terminal and the console say where the boundary belongs; the person
 * looking at the page sees neither. A line at the bottom of the page does.
 */
describe("the dev notice", () => {
  test("names the component from a React component stack", () => {
    expect(
      componentIn(
        "\n    at AuthTrigger (http://x/auth-trigger.tsx:21:23)\n    at PathnameProvider",
      ),
    ).toBe("AuthTrigger");
    expect(componentIn(undefined)).toBeNull();
  });

  test("shows once per message, selectable, and goes on its own button", () => {
    showDevNotice(
      "useSearchParams() was read on the server",
      "\n    at AuthTrigger (x)",
    );
    showDevNotice(
      "useSearchParams() was read on the server",
      "\n    at AuthTrigger (x)",
    );

    const box = document.getElementById("rsc-kit-dev-notice")!;
    const lines = Array.from(box.children).filter(
      (el) => el.tagName !== "BUTTON",
    );

    expect(lines.length).toBe(1);
    expect(lines[0]!.textContent).toBe(
      "AuthTrigger: useSearchParams() was read on the server",
    );
    expect(box.style.position).toBe("fixed");
    expect(box.style.userSelect).toBe("text");

    // A click on the text is someone selecting it to copy; the box stays.
    (lines[0] as HTMLElement).click();
    expect(document.getElementById("rsc-kit-dev-notice")).not.toBeNull();

    box.querySelector("button")!.click();
    expect(document.getElementById("rsc-kit-dev-notice")).toBeNull();
  });
});
