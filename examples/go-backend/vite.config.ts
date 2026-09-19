import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { nitro } from 'nitro/vite'
import { rscKit } from '@rsc-kit/core/vite'

/**
 * Exactly what `bun create rsc-kit` writes. Nothing here says Go: the
 * renderer finds the backend from .env - RSC_BACKEND and
 * RSC_HOST_CALL_SECRET - and every rpc() below leaves as a POST to it.
 */
export default defineConfig({
  plugins: [
    nitro({ preset: 'bun', serveStatic: 'inline' }),
    rscKit({ sourceDir: 'src', outDir: 'build' }),
    react(),
  ],
})
