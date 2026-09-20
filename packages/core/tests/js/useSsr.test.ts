import { describe, expect, test } from "bun:test";

import {
  hasUseSsr,
  serverRendererMessage,
  ssrExports,
  ssrProxyModule,
  UseSsrError,
  withoutSsrDirective,
} from "../../src/useSsr";

/**
 * A "use ssr" module is rewritten, for the server-components environment,
 * into proxies that call the real module in the ssr environment - the
 * cross-environment import plugin-rsc offers, written for the developer.
 */
describe('a "use ssr" module', () => {
  test("is named by its directive, comments before it or not", () => {
    expect(hasUseSsr('"use ssr";\nexport async function a() {}')).toBe(true);
    expect(hasUseSsr("// why\n'use ssr'\n")).toBe(true);
    expect(hasUseSsr("/* why */ 'use ssr'\n")).toBe(true);
    expect(hasUseSsr('export async function a() {}\n"use ssr";')).toBe(false);
    expect(hasUseSsr('"use client";\n')).toBe(false);
  });

  test("becomes proxies of its exports that call across, named and default", () => {
    const code = [
      '"use ssr";',
      "import { renderToStaticMarkup } from 'react-dom/server';",
      "export async function renderCard(title: string): Promise<string> { return '' }",
      "export const renderMail = async (to: string) => '';",
      "export type Options = { pretty?: boolean };",
      "export default async function (x: number) { return x }",
    ].join("\n");

    const out = ssrProxyModule(code, "/app/src/lib/email/render.tsx", "/app")!;

    expect(out).toContain(
      "import.meta.viteRsc.import(\"./render.tsx\", { environment: 'ssr' })",
    );
    expect(out).toContain(
      "export const renderCard = async (...args) => (await __rsc_kit_ssr()).renderCard(...args);",
    );
    expect(out).toContain(
      "export const renderMail = async (...args) => (await __rsc_kit_ssr()).renderMail(...args);",
    );
    expect(out).toContain(
      "export default async (...args) => (await __rsc_kit_ssr()).default(...args);",
    );
    expect(out).not.toContain("react-dom/server");
    expect(out).not.toContain("Options");
    expect(out).toContain("src/lib/email/render.tsx");

    // The cross-environment import sits inside a function. The build turns
    // it into an `await import()`, and at the top level that is a top-level
    // await - the one thing a bytecode-compiled binary cannot express.
    const topLevel = out.split("\n").filter((line) => !line.startsWith("//") && !line.startsWith("export"));

    expect(topLevel.some((line) => line.includes("import.meta.viteRsc.import") && !line.includes("async () =>"))).toBe(false);
  });

  test("is left alone without the directive", () => {
    expect(
      ssrProxyModule("export async function a() {}", "/app/a.ts", "/app"),
    ).toBeNull();
  });

  test("refuses a sync function: the answer crosses as a promise", () => {
    expect(() =>
      ssrExports('"use ssr";\nexport function render() {}', "render.tsx"),
    ).toThrow(UseSsrError);
    expect(() =>
      ssrExports('"use ssr";\nexport function render() {}', "render.tsx"),
    ).toThrow("`render` in render.tsx");
    expect(() =>
      ssrExports('"use ssr";\nexport default function () {}', "render.tsx"),
    ).toThrow("default export");
  });

  test("refuses what cannot be called: values, classes, re-exports, destructuring", () => {
    expect(() =>
      ssrExports('"use ssr";\nexport const limit = 5', "m.ts"),
    ).toThrow("`limit` in m.ts is a value");
    expect(() =>
      ssrExports('"use ssr";\nexport const name: string = "x"', "m.ts"),
    ).toThrow("is a value");
    expect(() =>
      ssrExports('"use ssr";\nexport class Mailer {}', "m.ts"),
    ).toThrow("class or enum");
    expect(() =>
      ssrExports('"use ssr";\nexport { render } from "./x"', "m.ts"),
    ).toThrow("re-exports");
    expect(() => ssrExports('"use ssr";\nexport * from "./x"', "m.ts")).toThrow(
      "re-exports",
    );
    expect(() =>
      ssrExports('"use ssr";\nexport const { a } = fns', "m.ts"),
    ).toThrow("destructures");
  });

  test("does not read an export mentioned in a comment", () => {
    const code =
      '"use ssr";\n// export function old() {}\n/* export const x = 1 */\nexport async function fresh() {}';

    expect(ssrExports(code, "m.ts")).toEqual({
      named: ["fresh"],
      hasDefault: false,
    });
  });
});

describe("react-dom/server where server components render", () => {
  test("throws the fix, naming the app file that imported it", () => {
    const message = serverRendererMessage("src/lib/nodemailer.ts");

    expect(message).toContain("Imported by src/lib/nodemailer.ts");
    expect(message).toContain('"use ssr"');
    expect(message).toContain("https://docs.rsc-kit.dev/guides/emails");
    expect(serverRendererMessage(null)).not.toContain("Imported by");
  });
});

describe("the directive where the module runs", () => {
  test("is taken out, comments before it kept, and nothing else touched", () => {
    // In the ssr environment the module is the real thing and the directive
    // is a string with no meaning left, which the bundler warned about on
    // every build: MODULE_LEVEL_DIRECTIVE "may not be preserved".
    const source = `// what this renders\n"use ssr";\n\nimport { render } from '@react-email/render'\n\nexport async function renderOtp(code: string) { return render(code) }\n`;

    expect(withoutSsrDirective(source)).toBe(
      `// what this renders\n\nimport { render } from '@react-email/render'\n\nexport async function renderOtp(code: string) { return render(code) }\n`,
    );
  });

  test("leaves a module without the directive alone", () => {
    expect(withoutSsrDirective("export const x = 'use ssr in a string'\n")).toBeNull();
  });
});
