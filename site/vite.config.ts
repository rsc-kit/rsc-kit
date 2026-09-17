import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { rscKit } from '@rsc-kit/core/vite'
import { nitro } from 'nitro/vite'
import { fileURLToPath } from 'node:url'

// The documentation lived at rsc-kit.dev before it moved to docs.rsc-kit.dev,
// and every one of its urls is in someone's bookmarks, an AGENTS.md, a
// README on npm. They all answer with a 301 to the same path on the new host.
// Route rules run in the Worker before anything renders, so the redirect
// costs nothing here and the page itself stays the one route.
const DOCS = 'https://docs.rsc-kit.dev'
const MOVED = [
  'introduction',
  'quick-start',
  'installation',
  'getting-started',
  'coming-from-next',
  'guides',
  'hosts',
  'reference',
  'llms.txt',
  'llms-full.txt',
  'og',
]

export default defineConfig({
  plugins: [
    nitro({
      preset: 'cloudflare_module',
      serveStatic: 'inline',
      routeRules: Object.fromEntries(
        MOVED.flatMap((path) => [
          [`/${path}`, { redirect: { to: `${DOCS}/${path}`, status: 301 } }],
          [`/${path}/**`, { redirect: { to: `${DOCS}/${path}/**`, status: 301 } }],
        ]),
      ),
      cloudflare: {
        wrangler: {
          routes: [
            { pattern: 'rsc-kit.dev', custom_domain: true },
            { pattern: 'www.rsc-kit.dev', custom_domain: true },
          ],
        },
      },
    }),
    rscKit({
      sourceDir: 'src',
      outDir: 'build',
    }),
    react(),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})
