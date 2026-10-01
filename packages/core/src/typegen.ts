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

import { createRequire } from "node:module";
import { join } from "node:path";
import { cwd, exit, stderr, stdout } from "node:process";
import { pathToFileURL } from "node:url";

interface PluginLike {
  name?: string;
  config?: (config: object, env: { command: string; mode: string }) => unknown;
}

async function flatten(option: unknown): Promise<PluginLike[]> {
  const value = await option;

  if (Array.isArray(value)) return (await Promise.all(value.map(flatten))).flat();

  return value && typeof value === "object" ? [value as PluginLike] : [];
}

export async function typegen(root = cwd()): Promise<void> {
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

  const env = { command: "serve", mode: "development" };
  const loaded = await vite.loadConfigFromFile(env, undefined, root);

  if (!loaded) throw new Error("No vite.config found in " + root + ".");

  const plugin = (await flatten(loaded.config.plugins ?? [])).find((p) => p.name === "rsc-kit");

  if (!plugin?.config) throw new Error("The vite.config in " + root + " does not use rscKit().");

  await plugin.config({}, env);
}

// Run as a command, not when imported.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href || process.argv[1]?.endsWith("rsc-kit-typegen")) {
  typegen()
    .then(() => {
      stdout.write("rsc-kit: route types written\n");
    })
    .catch((error: unknown) => {
      stderr.write("rsc-kit-typegen: " + (error instanceof Error ? error.message : String(error)) + "\n");
      exit(1);
    });
}
