import { describe, expect, test } from "bun:test";

import { rscKit } from "../../src/vite.js";

/**
 * plugin-rsc stands in for a client export on the server with an arrow
 * function that throws when called. An arrow function cannot be extended,
 * and base-ui extends one - `class NullStore extends ReactStore`, with only
 * the base marked "use client" - so a server component importing the library
 * died at a class declaration. The stub is rewritten to a `function`, which
 * has a prototype, and still throws if constructed.
 */
describe("a client reference stub can be extended on the server", () => {
  const plugin = rscKit().find(
    (
      p,
    ): p is {
      name: string;
      transform: (code: string) => { code: string } | undefined;
    } =>
      !!p &&
      typeof p === "object" &&
      "name" in p &&
      p.name === "rsc-kit:extendable-client-references",
  )!;

  const stub =
    'export const ReactStore = $$ReactServer.registerClientReference(  () => { throw new Error("Unexpectedly client reference export \'" + "ReactStore" + "\' is called on server") },  "key",  "ReactStore")';

  test("rewrites the arrow stub into a function with a prototype", () => {
    const out = plugin.transform(stub)!.code;

    expect(out).toContain(
      'registerClientReference(function () { throw new Error("Unexpectedly client reference export',
    );
    expect(out).not.toContain("() => { throw");

    const registerClientReference = (value: unknown) => value;
    const ReactStore = new Function(
      "$$ReactServer",
      out.replace("export const ", "return "),
    )({
      registerClientReference,
    }) as new () => object;

    class NullStore extends ReactStore {}

    expect(() => new NullStore()).toThrow(/ReactStore.*called on server/);
  });

  test("leaves other modules alone", () => {
    expect(plugin.transform("export const x = 1")).toBeUndefined();
  });
});
