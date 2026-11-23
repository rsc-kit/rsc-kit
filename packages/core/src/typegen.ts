#!/usr/bin/env node
// rsc-kit-typegen: write the route types without starting Vite.
//
// The types - every url the app has, for <Link href> and redirect() - are
// written when the dev server or a build starts, and again when a dev server
// sees a route added. A typecheck run with neither, by an agent or in CI,
// read the types from the last start: a route added since failed with
// '"/admin"' is not assignable to type Route until something started Vite.
//
// The app's own vite.config is loaded, through the app's own Vite, so the
// plugin's options - sourceDir, outDir, a host's route file - are the ones it
// builds with. Only the plugin's config step runs, which is what writes them.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, relative } from "node:path";
import { cwd, exit, stderr, stdout } from "node:process";
import { pathToFileURL } from "node:url";
import { withoutSources } from "./hostSources.js";

interface PluginLike {
  name?: string;
  config?: (config: object, env: { command: string; mode: string }) => unknown;
  api?: { generatedFiles?: () => string[]; info?: () => Record<string, unknown>; sourceDir?: () => string };
}

async function flatten(option: unknown): Promise<PluginLike[]> {
  const value = await option;

  if (Array.isArray(value)) return (await Promise.all(value.map(flatten))).flat();

  return value && typeof value === "object" ? [value as PluginLike] : [];
}

/**
 * Write the types; or, with `check`, say which committed generated files are
 * not what the backend and the route tree produce now, and change nothing.
 *
 * For CI: `rsc-kit-typegen --check` fails when rsc-host.json or the types were
 * committed and the backend has moved on since. Only files that were already
 * there are compared - one that is not committed is written fresh by every
 * build and cannot be stale - and every one is put back as it was.
 */
export async function typegen(root = cwd(), check = false): Promise<string[]> {
  const local = createRequire(join(root, "package.json"));
  let vitePath: string;

  try {
    vitePath = local.resolve("vite");
  } catch {
    throw new Error("No vite installed in " + root + ". Run this from the app's directory.");
  }

  const vite = (await import(pathToFileURL(vitePath).href)) as {
    loadConfigFromFile: (
      env: { command: string; mode: string },
      file?: string,
      root?: string,
    ) => Promise<{ config: { plugins?: unknown[] } } | null>;
  };

  // As a build would: a manifest command that fails is a failure, not a
  // warning, when the question is whether what is committed is current.
  const env = check ? { command: "build", mode: "production" } : { command: "serve", mode: "development" };
  const loaded = await vite.loadConfigFromFile(env, undefined, root);

  if (!loaded) throw new Error("No vite.config found in " + root + ".");

  const plugin = (await flatten(loaded.config.plugins ?? [])).find((p) => p.name === "rsc-kit");

  if (!plugin?.config) throw new Error("The vite.config in " + root + " does not use rscKit().");

  if (!check) {
    await plugin.config({}, env);

    return [];
  }

  const generated = plugin.api?.generatedFiles?.() ?? [];
  // A declaration's map is put back with it, and never compared.
  const files = generated.flatMap((f) => (f.endsWith(".d.ts") ? [f, f + ".map"] : [f]));
  const before = new Map(files.filter((f) => existsSync(f)).map((f) => [f, readFileSync(f, "utf-8")]));
  // Where the backend's functions are is the editor's, and moves with every
  // edit above them: a manifest that differs in that alone is not stale.
  const same = (f: string, text: string) => {
    const now = readFileSync(f, "utf-8");

    return f.endsWith("rsc-host.json") ? withoutSources(now) === withoutSources(text) : now === text;
  };

  try {
    await plugin.config({}, env);

    return [...before].filter(([f, text]) => !f.endsWith(".map") && (!existsSync(f) || !same(f, text))).map(([f]) => f);
  } finally {
    for (const [f, text] of before) writeFileSync(f, text);
  }
}

// Run as a command, not when imported.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href || process.argv[1]?.endsWith("rsc-kit-typegen")) {
  const check = process.argv.includes("--check");

  typegen(cwd(), check)
    .then((stale) => {
      if (!check) {
        stdout.write("rsc-kit: route types written\n");

        return;
      }

      if (stale.length === 0) {
        stdout.write("rsc-kit: generated files are current\n");

        return;
      }

      stderr.write(
        "rsc-kit-typegen --check: these are committed and no longer what the backend and the routes produce:\n" +
          stale.map((f) => "  " + relative(cwd(), f)).join("\n") +
          "\nRun rsc-kit-typegen and commit the result.\n",
      );
      exit(1);
    })
    .catch((error: unknown) => {
      stderr.write("rsc-kit-typegen: " + (error instanceof Error ? error.message : String(error)) + "\n");
      exit(1);
    });
}

/**
 * What a build of the app in `root` will produce - `{ output: "server", ... }`
 * or `{ output: "export", dir }` - read before building, from the app's own
 * Vite config, evaluated the way a build evaluates it. A value computed in
 * the config, or RSC_OUTPUT in the environment, resolves exactly as the build
 * resolves it, because it is the same code deciding.
 */
export async function appInfo(root = cwd()): Promise<Record<string, unknown>> {
  const local = createRequire(join(root, "package.json"));
  let vitePath: string;

  try {
    vitePath = local.resolve("vite");
  } catch {
    throw new Error("No vite installed in " + root + ". Run this from the app's directory.");
  }

  const vite = (await import(pathToFileURL(vitePath).href)) as {
    loadConfigFromFile: (
      env: { command: string; mode: string },
      file?: string,
      root?: string,
    ) => Promise<{ config: { plugins?: unknown[] } } | null>;
  };
  // From inside the app, as a build runs: rscKit() takes its project root
  // from the working directory when the config creates it.
  const from = cwd();

  process.chdir(root);

  try {
    const loaded = await vite.loadConfigFromFile({ command: "build", mode: "production" }, undefined, root);

    if (!loaded) throw new Error("No vite.config found in " + root + ".");

    const plugin = (await flatten(loaded.config.plugins ?? [])).find((p) => p.name === "rsc-kit");

    if (!plugin?.api?.info) throw new Error("The vite.config in " + root + " does not use rscKit().");

    return plugin.api.info();
  } finally {
    process.chdir(from);
  }
}


/** A form's name from its action's: contactSend is contact-send. */
function formName(action: string): string {
  return action.replace(/\./g, "-").replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
}

/**
 * Write `<sourceDir>/forms/<name>.ts`: a public form drawn from a backend
 * action, the way the docs write it by hand. The backend is asked first, as a
 * dev server start asks it, so an action added a moment ago is there.
 *
 * The file is the app's to edit afterwards - a theme, labels, `done` - and is
 * never overwritten unless `force` says so.
 */
export async function makeForm(
  root: string,
  action: string,
  options: { name?: string; force?: boolean } = {},
): Promise<string> {
  await typegen(root);

  const local = createRequire(join(root, "package.json"));
  const vite = (await import(pathToFileURL(local.resolve("vite")).href)) as {
    loadConfigFromFile: (env: { command: string; mode: string }, file?: string, root?: string) => Promise<{ config: { plugins?: unknown[] } } | null>;
  };
  const loaded = await vite.loadConfigFromFile({ command: "serve", mode: "development" }, undefined, root);
  const plugin = (await flatten(loaded?.config.plugins ?? [])).find((p) => p.name === "rsc-kit");
  const files = plugin?.api?.generatedFiles?.() ?? [];
  const manifestFile = files.find((f) => f.endsWith("rsc-host.json"));

  if (!manifestFile || !existsSync(manifestFile)) {
    throw new Error("No rsc-host.json: this app has no backend that describes its actions (rscKit({ hostManifest }) or a Go registry).");
  }

  const manifest = JSON.parse(readFileSync(manifestFile, "utf-8")) as {
    actions?: Record<string, Record<string, string>>;
    types?: Record<string, { params?: unknown[] }>;
  };
  // Named as rpc() names it - Contact.send - and found in whichever module
  // the backend put it.
  const all = Object.entries(manifest.actions ?? {}).flatMap(([module, exports]) =>
    Object.entries(exports).map(([name, target]) => ({ module, name, target })),
  );
  const found = all.find((a) => a.target === action);
  const target = found?.target;

  if (!found || !target) {
    const known = all.map((a) => a.target);

    throw new Error(
      `The backend has no action named ${action}.` +
        (known.length ? ` It has: ${known.join(", ")}.` : " It has none: a form posts to an action, which is a class in app/Rsc/Actions in Laravel, or reg.HandleAction in Go."),
    );
  }

  const name = options.name ?? formName(action).replace(/-(send|submit|store|create)$/, "");
  const from = "../server-actions/" + found.module;

  if (!/^[a-z0-9-]+$/.test(name)) throw new Error(`A form's name is lowercase letters, digits and dashes: ${name}`);

  const sourceDir = plugin?.api?.sourceDir?.() ?? join(root, "src");
  const file = join(sourceDir, "forms", name + ".ts");

  if (existsSync(file) && !options.force) throw new Error(`${relative(root, file)} is already there. Pass --force to write over it.`);

  const exported = name.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());
  // The action under its own name - send - unless that is the form's, or a
  // word JavaScript keeps (delete): then send + Action. A default is named
  // after its module.
  const own = found.name === "default" ? found.module.split("/").pop()!.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase()) : found.name;
  const usable = (id: string) => {
    try {
      new Function(`let ${id}`);
      return id !== exported;
    } catch {
      return false;
    }
  };
  const reference = usable(own) ? own : own + "Action";
  const imported =
    found.name === "default"
      ? `import ${reference} from '${from}'`
      : `import { ${reference === found.name ? reference : `${found.name} as ${reference}`} } from '${from}'`;
  const text = `import { defineBlueprint } from '@rsc-kit/press/forms'
import { shadcn } from '@rsc-kit/press/shadcn'
${imported}

// The fields and every check are ${target}'s: the backend says what it takes,
// and its refusals land under the fields. Place it in any page: <${exported}.Form />.
// Add actions.update to edit a record with it too: <${exported}.Form id={...} values={...} />.
export const ${exported} = defineBlueprint({
  name: '${name}',
  actions: { create: ${reference} },
  theme: shadcn,
})
`;

  const { mkdirSync } = await import("node:fs");

  mkdirSync(join(sourceDir, "forms"), { recursive: true });
  writeFileSync(file, text);

  return file;
}
