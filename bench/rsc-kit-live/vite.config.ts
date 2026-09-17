import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { rscKit } from '@rsc-kit/core/vite'
import { nitro } from 'nitro/vite'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  plugins: [
    nitro({ preset: "node", serveStatic: 'inline' }),
    rscKit({
      prerender: false,
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
