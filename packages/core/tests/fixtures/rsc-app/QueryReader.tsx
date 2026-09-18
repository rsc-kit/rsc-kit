"use client";

import { useSearchParams } from "@rsc-kit/core/useSearchParams";

// Reads the query string, which the server cannot answer while storing a
// page: the nearest fallback is what gets stored, and the build says which.
export function QueryReader() {
  return <p id="query-value">{useSearchParams().get("q") ?? "(none)"}</p>;
}
