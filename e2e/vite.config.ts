import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { nitro } from 'nitro/vite'
import { rscKit } from '@rsc-kit/core/vite'

// Not an example: the app the browser journeys drive. Shaped like the store
// demo where the bugs were found - nested layouts, pattern shells resumed per
// request, an action that revalidates the whole document.
export default defineConfig({
  plugins: [
    nitro({ preset: 'bun', serveStatic: 'inline' }),
    // /gitlab is a backend's, as in the app the handoff journeys were written for. A
    // build only carries the forwarding to one when it declares a backend, and
    // devFallback: '' does, with no address: the built server forwards where
    // RSC_BACKEND says (playwright.config.ts) and is a plain 404 where it is unset.
    rscKit({ sourceDir: 'src', outDir: 'build', backendPaths: ['/gitlab'], devFallback: '' }),
    react(),
  ],
})
