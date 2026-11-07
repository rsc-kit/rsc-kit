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
import { basename, join, relative } from "node:path";
import { cwd, exit, stderr, stdout } from "node:process";
import { pathToFileURL } from "node:url";

interface PluginLike {
  name?: string;
  config?: (config: object, env: { command: string; mode: string }) => unknown;
  api?: { generatedFiles?: () => string[]; info?: () => Record<string, unknown> };
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

  const files = plugin.api?.generatedFiles?.() ?? [];
  const before = new Map(files.filter((f) => existsSync(f)).map((f) => [f, readFileSync(f, "utf-8")]));

  try {
    await plugin.config({}, env);

    return [...before].filter(([f, text]) => !existsSync(f) || readFileSync(f, "utf-8") !== text).map(([f]) => f);
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
  return action.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
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
  const actionsFile = files.find((f) => f.endsWith("server-actions.generated.ts"));

  if (!manifestFile || !actionsFile || !existsSync(manifestFile)) {
    throw new Error("No rsc-host.json: this app has no backend that describes its actions (rscKit({ hostManifest }) or a Go registry).");
  }

  const manifest = JSON.parse(readFileSync(manifestFile, "utf-8")) as {
    actions?: Record<string, string>;
    types?: Record<string, { params?: unknown[] }>;
  };
  const actions = manifest.actions ?? {};
  const target = actions[action];

  if (!target) {
    const known = Object.keys(actions);

    throw new Error(
      `The backend has no action named ${action}.` +
        (known.length ? ` It has: ${known.join(", ")}.` : " It has none: a form posts to an action, which is a class in app/Rsc/Actions in Laravel, or reg.HandleAction in Go."),
    );
  }

  const name = options.name ?? formName(action).replace(/-(send|submit|store|create)$/, "");

  if (!/^[a-z0-9-]+$/.test(name)) throw new Error(`A form's name is lowercase letters, digits and dashes: ${name}`);

  const sourceDir = join(actionsFile, "..");
  const file = join(sourceDir, "forms", name + ".ts");

  if (existsSync(file) && !options.force) throw new Error(`${relative(root, file)} is already there. Pass --force to write over it.`);

  const exported = name.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());
  const text = `import { defineForm } from '@rsc-kit/press/forms'
import { shadcn } from '@rsc-kit/press/shadcn'
import { ${action} } from '../${basename(actionsFile, ".ts")}'

// The fields and every check are ${target}'s: the backend says what it takes,
// and its refusals land under the fields. Place it in any page: <${exported}.Form />
export const ${exported} = defineForm({
  name: '${name}',
  action: ${action},
  theme: shadcn,
})
`;

  const { mkdirSync } = await import("node:fs");

  mkdirSync(join(sourceDir, "forms"), { recursive: true });
  writeFileSync(file, text);

  return file;
}
