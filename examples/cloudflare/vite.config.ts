import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { rscKit } from '@rsc-kit/core/vite'
import { nitro } from 'nitro/vite'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  plugins: [
    // A pinned compatibility date: the Workers runtime behaves as it did on
    // that day whenever this is built. Nitro otherwise stamps the build's own
    // date, which a local wrangler older than the build refuses to run.
    // cloudflare_durable: the cloudflare_module Worker, plus a Durable Object
    // class the changes hub runs in - every tab watching /live is held by one
    // instance of it, rather than by whichever isolate it reached.
    nitro({ preset: 'cloudflare_durable', serveStatic: 'inline', compatibilityDate: '2026-09-01' }),
    rscKit({
      sourceDir: 'src',
      outDir: 'build',
    }),
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})
