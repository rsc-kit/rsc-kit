import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { rscKit } from "@rsc-kit/core/vite";
import { fileURLToPath } from "node:url";

/**
 * The full route tree, built the way every scaffolded app is built.
 *
 * Nitro owns the server and the entry is generated — there is no server file
 * in this directory, which is the point.
 */
export default defineConfig({
  plugins: [
    nitro({ preset: "bun", serveStatic: "inline" }),
    rscKit({
      sourceDir: "src",
      outDir: "build",
      offline: true,
    }),
    react(),
  ],
  // `@/thing` for `src/thing`, the same alias tsconfig.json declares in
  // `paths`: both, or the import type-checks and then fails to resolve.
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
