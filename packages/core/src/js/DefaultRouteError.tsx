"use client";

// What a page that throws shows when no error.tsx covers it.
//
// Without this, nothing did: the Flight row failed, the browser rethrew on
// hydration with no boundary to catch it, and React unmounted the document -
// a black page with the cause nowhere near it. Next shows its overlay in
// development and a plain "something went wrong" in production; this is
// that, as a page, and the layouts above it stay on screen.
//
// In development the message and stack, because the developer is the one
// looking. In production React has already replaced the message with a
// digest, and the digest is what this shows: the line to search the server
// log for.

import { createElement, type ReactNode } from "react";
import type { RouteErrorProps } from "./RouteErrorBoundary";

const DEV =
  typeof import.meta !== "undefined" &&
  (import.meta as { env?: { DEV?: boolean } }).env?.DEV === true;

const mono = "ui-monospace,SFMono-Regular,Menlo,monospace";
const box = {
  maxWidth: "60rem",
  margin: "3rem auto",
  padding: "1.5rem",
  font: "14px/1.5 " + mono,
  color: "#fecaca",
  background: "#1f0b0b",
  border: "1px solid #7f1d1d",
  borderRadius: 8,
};
const heading = {
  margin: "0 0 .75rem",
  fontSize: 16,
  fontWeight: 600,
  color: "#fff",
};
const pre = {
  whiteSpace: "pre-wrap" as const,
  wordBreak: "break-word" as const,
  margin: ".75rem 0 0",
  color: "#fecaca",
};
const hint = { margin: ".75rem 0 0", color: "#fca5a5" };
const button = {
  marginTop: "1rem",
  padding: ".4rem .8rem",
  border: "1px solid #fca5a5",
  borderRadius: 6,
  background: "transparent",
  color: "#fff",
  cursor: "pointer",
  font: "inherit",
};

export function DefaultRouteError({
  error,
  reset,
}: RouteErrorProps): ReactNode {
  const name = error.name && error.name !== "Error" ? error.name + ": " : "";

  return createElement(
    "main",
    { role: "alert", style: box, "data-rsc-kit-error": "" },
    createElement(
      "h1",
      { style: heading },
      DEV ? "This page threw while rendering" : "Something went wrong",
    ),
    DEV
      ? createElement(
          "pre",
          { style: pre },
          error.stack || name + error.message,
        )
      : createElement(
          "p",
          { style: { margin: 0 } },
          "The error was logged on the server" +
            (error.digest ? " as " + error.digest : "") +
            ".",
        ),
    DEV
      ? createElement(
          "p",
          { style: hint },
          "Add an error.tsx beside the page to show something of your own here.",
        )
      : null,
    createElement(
      "button",
      { type: "button", style: button, onClick: reset },
      "Try again",
    ),
  );
}
