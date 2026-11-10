// A file in public/ at a url the app also answers.
//
// The app serves a few files at the site's root from beside its root layout:
// favicon.ico, robots.txt (or robots.ts), a sitemap, llms.txt. public/ is
// served at the root too, and whatever serves it - Herd's or any nginx in
// front of Laravel, Nitro's static handler - answers before the request
// reaches the app. So a file of the same name there wins, and the app's is
// never seen.
//
// It happens without anyone choosing it: Laravel's skeleton ships an empty
// public/favicon.ico and a public/robots.txt. The empty favicon answers 404
// through Herd, and the browser's console says only "favicon.ico not found"
// on an app that has one. Said at dev start and at build, naming both files.

import { existsSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { METADATA_ROUTES, ROOT_FILES } from "./metadataRoutes.js";

export interface ShadowedRootFile {
  /** The url both claim, e.g. /favicon.ico. */
  url: string;
  /** The file in public/ that is answered instead. */
  publicFile: string;
  /** The app's own, which is never reached. */
  appFile: string;
  /** The public/ file is empty: a placeholder, Laravel's skeleton's own. */
  empty: boolean;
}

const SOURCE_EXTENSIONS = ["ts", "tsx", "js", "mjs"];

/** Every url the app's own directory answers at the root, with the file that answers it. */
function appRootFiles(appDir: string): Map<string, string> {
  const owned = new Map<string, string>();

  if (!existsSync(appDir)) return owned;

  const names = readdirSync(appDir);

  if (names.includes("favicon.ico")) owned.set("favicon.ico", "favicon.ico");

  for (const name of names) {
    if (ROOT_FILES.test(name)) owned.set(name, name);
  }

  for (const [kind, { file }] of Object.entries(METADATA_ROUTES)) {
    const source = SOURCE_EXTENSIONS.map((ext) => `${kind}.${ext}`).find((name) => names.includes(name));

    if (source) owned.set(file, source);
  }

  return owned;
}

export function shadowedRootFiles(appDir: string, publicDir: string): ShadowedRootFile[] {
  if (!existsSync(publicDir)) return [];

  const shadowed: ShadowedRootFile[] = [];

  for (const [served, source] of appRootFiles(appDir)) {
    const publicFile = join(publicDir, served);

    if (!existsSync(publicFile) || !statSync(publicFile).isFile()) continue;

    shadowed.push({
      url: `/${served}`,
      publicFile,
      appFile: join(appDir, source),
      empty: statSync(publicFile).size === 0,
    });
  }

  return shadowed.sort((a, b) => a.url.localeCompare(b.url));
}

export function shadowedRootFileMessage(file: ShadowedRootFile, root: string): string {
  const pub = relative(root, file.publicFile);
  const app = relative(root, file.appFile);

  return (
    `[rsc-kit] ${pub} is answered at ${file.url}, not ${app}: public/ is served before the app is reached. ` +
    (file.empty
      ? `It is empty - a placeholder, as Laravel's skeleton ships - so ${file.url} answers nothing (Herd: 404). `
      : "") +
    `Delete ${pub} to serve the app's.`
  );
}
