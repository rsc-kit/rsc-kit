// @generated — do not edit. Written by the RSC build from the route tree.
//
// Turns Link, navigate() and route() into typed apis: an href that no route
// answers stops compiling. Delete this file and they fall back to `string`,
// which is what a project that has not built yet gets.

// `export {}` is load-bearing: in a file with no import or export,
// `declare module` *replaces* the real module rather than augmenting it,
// and Href and route() vanish from it with no error to explain why.
export {}

declare module '@rsc-kit/core/routes' {
  interface Register {
    routes:
      | "/"
      | "/private"
  }
}
