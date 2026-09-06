// @generated — do not edit.
//
// rpc() is installed on globalThis by the RSC worker, so it has no
// import to resolve. This declares it for the typechecker; run
// `tsc --noEmit` to catch calls to a host global that no longer exists.
//
// Deliberately not a module — no import/export — so the declaration is
// global to the project without every file having to reference it.

declare function rpc<T = unknown>(name: string, ...args: unknown[]): Promise<T>;
