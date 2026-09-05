import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";
import nimbus, { defineConfig as defineNimbusConfig } from "@cloudflare/nimbus-docs";
import { tableScroll } from "@cloudflare/nimbus-docs/markdown";

const nimbusConfig = defineNimbusConfig({
  site: "https://rsc-router.dev",
  title: "rsc-router",
  description:
    "React Server Components routing for any JavaScript backend — and for Laravel.",
  locale: "en",
  github: "https://github.com/rsc-router/rsc-router",
  socialImageAlt: "rsc-router documentation",
  sidebar: {
    items: [
      { label: "Introduction", link: "/introduction" },
      { label: "Installation", link: "/installation" },
      { label: "Getting started", link: "/getting-started" },
      { label: "Guides", autogenerate: { directory: "guides" } },
      { label: "Hosts", autogenerate: { directory: "hosts" } },
      { label: "Reference", autogenerate: { directory: "reference" } },
    ],
  },
});

export default defineConfig({
  output: "static",
  // Tailwind v4 via its Vite plugin (the integration Astro recommends for
  // Tailwind v4 — replaces the PostCSS plugin, which doesn't build under
  // Astro 7's Vite 8 bundler).
  vite: {
    plugins: [tailwindcss()],
  },
  // Hover-prefetch link targets so full-page navigations feel instant without
  // a client-side router.
  prefetch: {
    prefetchAll: true,
    defaultStrategy: "hover",
  },
  integrations: [
    nimbus(nimbusConfig, {
      rules: {
        "nimbus/frontmatter-shape": "error",
        "nimbus/internal-link": "error",
      },
      // Wrap wide tables so they scroll instead of overflowing the page
      // (styled by `.nb-table-scroll` in src/styles/prose.css). The
      // configuration and commands references both carry wide tables.
      markdown: {
        hastPlugins: [tableScroll()],
      },
    }),
  ],
});
