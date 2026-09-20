import { registerDom } from "./dom";

registerDom();

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, test } from "bun:test";
import { RouteErrorBoundary } from "../../src/js/RouteErrorBoundary";
import { DefaultRouteError } from "../../src/js/DefaultRouteError";

/**
 * The boundary every page gets when no error.tsx covers it. A page that
 * throws used to unmount the document - a black page, the cause nowhere
 * near it. Now it is a page: the error and a retry, the layouts untouched.
 */
function Throws({ message }: { message: string }): never {
  throw new Error(message);
}

let container: HTMLElement;

afterEach(() => container?.remove());

describe("the default error page", () => {
  test("catches a throw no error.tsx covers, and offers a retry", async () => {
    container = document.body.appendChild(document.createElement("div"));
    const root = createRoot(container);
    const errors: unknown[] = [];
    const quiet = console.error;

    console.error = (e: unknown) => errors.push(e);

    try {
      await act(async () => {
        root.render(
          createElement(
            RouteErrorBoundary,
            { fallback: DefaultRouteError, resetKey: "/account" },
            createElement("nav", { id: "layout" }, "still here"),
            createElement(Throws, {
              message: 'column "original_key" does not exist',
            }),
          ),
        );
      });
    } finally {
      console.error = quiet;
    }

    const page = container.querySelector("[data-rsc-kit-error]");

    expect(page).not.toBeNull();
    expect(page!.textContent).toContain("Try again");
    expect(errors.length).toBeGreaterThan(0);
  });

  test("names the failure to the developer, and only the digest to a visitor", () => {
    const error = Object.assign(
      new Error('column "original_key" does not exist'),
      { digest: "abc123" },
    );
    const html = (node: unknown) => JSON.stringify(node);
    const rendered = html(DefaultRouteError({ error, reset: () => {} }));

    // Under bun test import.meta.env.DEV is unset, so this is the production
    // face: the digest, never the message.
    expect(rendered).toContain("abc123");
    expect(rendered).not.toContain("original_key");
    expect(rendered).toContain("Something went wrong");
    expect(rendered).toContain("logged on the server");
  });

  test("does not say the server logged what never reached it", () => {
    // A client reference the page could not load has no digest: React did
    // not replace the message, and nothing was sent anywhere. "Logged on
    // the server" was a lie a port had to read twice.
    const error = new Error("client reference not found 'cab89674a721'");
    const rendered = JSON.stringify(DefaultRouteError({ error, reset: () => {} }));

    expect(rendered).toContain("logged in the browser console");
    expect(rendered).not.toContain("logged on the server");
  });
});
