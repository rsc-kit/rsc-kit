import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";
import nimbus, { defineConfig as defineNimbusConfig } from "@cloudflare/nimbus-docs";
import { tableScroll } from "@cloudflare/nimbus-docs/markdown";

const nimbusConfig = defineNimbusConfig({
  site: "https://docs.rsc-kit.dev",
  title: "rsc-kit",
  description:
    "React Server Components as a Vite plugin — deploy to Bun, Node, Workers, Vercel or Deno.",
  locale: "en",
  github: "https://github.com/rsc-kit/rsc-kit",
  socialImageAlt: "rsc-kit documentation",
  sidebar: {
    items: [
      { label: "Introduction", link: "/introduction" },
      { label: "Quick start", link: "/quick-start" },
      { label: "Installation", link: "/installation" },
      { label: "Getting started", link: "/getting-started" },
      { label: "Coming from Next.js", link: "/coming-from-next" },
      { label: "Coming from Inertia", link: "/coming-from-inertia" },
      { label: "Tutorial", autogenerate: { directory: "tutorial" } },
      {
        label: "Guides",
        // Grouped by when a reader needs them, not alphabetically: a flat
        // list put "Admin plugins" first, and "Pages from blocks" (Press)
        // where someone looking for pages would click. Every guide is in
        // exactly one group - packages/mcp/tests/docsSidebar.test.ts holds
        // the list to that, so a new guide cannot go missing from it.
        items: [
          {
            label: "Essentials",
            items: [
              { label: "Routing", link: "/guides/routing" },
              { label: "Navigation", link: "/guides/navigation" },
              { label: "Queries", link: "/guides/queries" },
              { label: "Server actions", link: "/guides/server-actions" },
              { label: "Forms", link: "/guides/forms" },
              { label: "Validation", link: "/guides/validation" },
              { label: "Errors and 404s", link: "/guides/errors" },
              { label: "Authorization", link: "/guides/authorization" },
              { label: "Redirects", link: "/guides/redirects" },
              { label: "Page metadata", link: "/guides/metadata" },
              { label: "Headers and cookies", link: "/guides/response-headers" },
              { label: "API routes", link: "/guides/api-routes" },
            ],
          },
          {
            label: "Rendering and caching",
            items: [
              { label: "Static generation", link: "/guides/static-generation" },
              { label: "Rendering per request", link: "/guides/connection" },
              { label: "Partial prerendering", link: "/guides/ppr" },
              { label: "Asking once per request", link: "/guides/caching" },
              { label: "ISR", link: "/guides/isr" },
              { label: "Edge caching", link: "/guides/edge-caching" },
              { label: "A page with no JavaScript", link: "/guides/no-javascript" },
            ],
          },
          {
            label: "Live updates",
            items: [
              { label: "Live data", link: "/guides/live-data" },
              { label: "Live data in production", link: "/guides/live-data-in-production" },
              { label: "Sections", link: "/guides/sections" },
            ],
          },
          {
            label: "Building out",
            collapsed: true,
            items: [
              { label: "File uploads", link: "/guides/file-uploads" },
              { label: "Images", link: "/guides/images" },
              { label: "Fonts", link: "/guides/fonts" },
              { label: "Emails and other HTML", link: "/guides/emails" },
              { label: "Domains and subdomains", link: "/guides/domains" },
              { label: "Typed routes", link: "/guides/typed-routes" },
              { label: "Typed URLs", link: "/guides/url-validation" },
              { label: "Route interception", link: "/guides/route-interception" },
              { label: "robots, sitemap and llms.txt", link: "/guides/seo-files" },
              { label: "Third-party scripts", link: "/guides/third-party-scripts" },
              { label: "Feature flags", link: "/guides/feature-flags" },
              { label: "Startup", link: "/guides/instrumentation" },
              { label: "Commands", link: "/guides/commands" },
              { label: "Testing", link: "/guides/testing" },
            ],
          },
          {
            label: "Going further",
            collapsed: true,
            items: [
              { label: "Progressive web apps", link: "/guides/pwa" },
              { label: "Offline", link: "/guides/offline" },
              { label: "View transitions", link: "/guides/view-transitions" },
              { label: "React Compiler", link: "/guides/react-compiler" },
              { label: "Content Security Policy", link: "/guides/content-security-policy" },
              { label: "OpenAPI", link: "/guides/openapi" },
              { label: "Working with an AI agent", link: "/guides/mcp" },
            ],
          },
          {
            label: "Press: admin panels and forms",
            collapsed: true,
            items: [
              { label: "Admin panels", link: "/guides/admin" },
              { label: "Admin plugins", link: "/guides/admin-plugins" },
              { label: "Blueprints", link: "/guides/blueprints" },
              { label: "Pages from blocks", link: "/guides/pages" },
            ],
          },
        ],
      },
      {
        label: "Hosts",
        items: [
          "hosts/where-it-runs",
          "hosts/deployment",
          "hosts/backend-answered-pages",
          { label: "Laravel", collapsed: true, autogenerate: { directory: "hosts/laravel" } },
          "hosts/bap-vs-inertia",
          { label: "Go", collapsed: true, autogenerate: { directory: "hosts/go" } },
          "hosts/your-own-backend",
          "hosts/bun",
        ],
      },
      { label: "Reference", autogenerate: { directory: "reference" } },
    ],
  },
});

export default defineConfig({
  output: "static",
  // The landing page is rsc-kit.dev, built with the framework itself (site/).
  // This host is the documentation, and its root is the first page of it -
  // redirected at the edge by public/_redirects, not by an Astro redirect,
  // which is a page with a meta refresh and paints before it leaves.
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
