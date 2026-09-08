import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { nitro } from 'nitro/vite'
import { rscKit } from '@rsc-kit/core/vite'

/**
 * The full route tree, built the way every scaffolded app is built.
 *
 * Nitro owns the server and the entry is generated — there is no server file
 * in this directory, which is the point.
 */
export default defineConfig({
  plugins: [
    nitro({ preset: 'bun', serveStatic: 'inline' }),
    rscKit({
      sourceDir: 'src',
      outDir: 'build',
    }),
    react(),
  ],
})
