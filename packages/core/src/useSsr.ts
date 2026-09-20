import { basename, relative } from "node:path";

/**
 * "use ssr": a module that runs in the ssr environment and is called from
 * where server components render.
 *
 * react-dom/server cannot run where server components render. React's
 * server build refuses to load it, and the refusal is right: the renderer
 * needs the client build's internals, and the components it would render
 * import that same server `react` - no useState, no useContext. A template
 * and the call that renders it have to load together somewhere React DOM's
 * server renderer can: the ssr environment, which every app here already
 * has. plugin-rsc exposes that as a call to write by hand,
 * `import.meta.viteRsc.import('./render', { environment: 'ssr' })`, and
 * nobody should have to. So a directive names the module instead, the way
 * "use client" names one, and this rewrites it for the server-components
 * environment into proxies of its exports that call across. Everything
 * else imports it normally.
 *
 * The exports are functions and the calls are async, because the answer
 * crosses environments as a promise. Anything else is refused with the
 * export named, at build and in dev, rather than proxied into nonsense.
 */
const DIRECTIVE = /^\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*["']use ssr["']/;

/**
 * The module with its directive taken out, for the environment it runs in.
 *
 * Where server components render the directive turns the module into
 * proxies; in the ssr environment the module is the real thing and the
 * directive is a string with no meaning left - which the bundler says so
 * about, once per build, as MODULE_LEVEL_DIRECTIVE "may not be preserved".
 * Nothing needed preserving. Removed, and the warning with it. Null when the
 * code has no directive.
 */
export function withoutSsrDirective(code: string): string | null {
  if (!DIRECTIVE.test(code)) return null;

  return code.replace(/(^\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*)["']use ssr["'];?[ \t]*\n?/, "$1");
}

export const SSR_GUIDE = "https://docs.rsc-kit.dev/guides/emails";

export function hasUseSsr(code: string): boolean {
  return DIRECTIVE.test(code.slice(0, 2048));
}

export class UseSsrError extends Error {}

/** Comments blanked, so an `export` inside one is not read as one. */
function withoutComments(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(
      /(^|[^:\\])\/\/[^\n]*/g,
      (m, lead: string) => lead + " ".repeat(m.length - lead.length),
    );
}

const NAME = "[A-Za-z_$][\\w$]*";
const NON_FUNCTION = /^\s*(?:new\b|["'`\d[{]|true\b|false\b|null\b)/;

/** The runtime exports a "use ssr" module can offer: named functions, and a default. */
export function ssrExports(
  code: string,
  file: string,
): { named: string[]; hasDefault: boolean } {
  const src = withoutComments(code);
  const named = new Set<string>();
  let hasDefault = false;

  for (const m of src.matchAll(
    new RegExp(
      `^[ \\t]*export\\s+(async\\s+)?function\\s*\\*?\\s*(${NAME})`,
      "gm",
    ),
  )) {
    if (!m[1]) {
      throw new UseSsrError(
        `"use ssr": \`${m[2]}\` in ${file} is called from another environment, and the answer crosses as a promise. Make it an async function.`,
      );
    }

    named.add(m[2]);
  }

  for (const m of src.matchAll(
    new RegExp(
      `^[ \\t]*export\\s+(?:const|let|var)\\s+(${NAME})\\s*(?::[^=\\n]*)?=([^\\n]*)`,
      "gm",
    ),
  )) {
    if (NON_FUNCTION.test(m[2])) {
      throw new UseSsrError(
        `"use ssr": a module with the directive exports functions only; \`${m[1]}\` in ${file} is a value. Put it in a module without the directive.`,
      );
    }

    named.add(m[1]);
  }

  if (/^[ \t]*export\s+(?:const|let|var)\s*[[{]/m.test(src)) {
    throw new UseSsrError(
      `"use ssr": ${file} destructures an export. Export each function by its own name; that is what gets called across.`,
    );
  }

  if (/^[ \t]*export\s+(?:abstract\s+)?(?:class|enum)\b/m.test(src)) {
    throw new UseSsrError(
      `"use ssr": a module with the directive exports functions only; ${file} exports a class or enum.`,
    );
  }

  if (/^[ \t]*export\s*(?:\{|\*)/m.test(src)) {
    throw new UseSsrError(
      `"use ssr": ${file} re-exports. Export the functions where they are declared; \`export { … }\` and \`export *\` cannot be called across.`,
    );
  }

  const dflt = /^[ \t]*export\s+default\s+(async\s+)?(function\b)?/m.exec(src);

  if (dflt) {
    if (dflt[2] && !dflt[1]) {
      throw new UseSsrError(
        `"use ssr": the default export of ${file} is called from another environment. Make it an async function.`,
      );
    }

    hasDefault = true;
  }

  return { named: [...named], hasDefault };
}

/**
 * The module the server-components environment gets in place of a "use ssr"
 * one: its exports, as async proxies that call the real module where it
 * runs. Null when the module carries no directive.
 */
export function ssrProxyModule(
  code: string,
  id: string,
  root: string = process.cwd(),
): string | null {
  if (!hasUseSsr(code)) return null;

  const path = id.split("?")[0];
  const file = relative(root, path);
  const { named, hasDefault } = ssrExports(code, file);

  return (
    [
      `// "use ssr": ${file} runs in the ssr environment, where React DOM's server renderer can. These call across.`,
      `const __rsc_kit_ssr = import.meta.viteRsc.import(${JSON.stringify("./" + basename(path))}, { environment: 'ssr' });`,
      ...named.map(
        (name) =>
          `export const ${name} = async (...args) => (await __rsc_kit_ssr).${name}(...args);`,
      ),
      ...(hasDefault
        ? [
            "export default async (...args) => (await __rsc_kit_ssr).default(...args);",
          ]
        : []),
    ].join("\n") + "\n"
  );
}

/** Any of react-dom's server renderer entries. */
export const SERVER_RENDERER = /^react-dom\/server(?:\.[a-z]+)?$/;

/** What a module gets in place of react-dom/server where server components render. */
export function serverRendererMessage(importer: string | null): string {
  return (
    "react-dom/server cannot run where server components render: React's server build has no client internals for it, and the components it would render import that same React." +
    (importer ? ` Imported by ${importer}.` : "") +
    ' Put the rendering - the template and the call - in a module that starts with "use ssr": it runs in the ssr environment, and its exports are called from here as async functions. ' +
    SSR_GUIDE
  );
}
