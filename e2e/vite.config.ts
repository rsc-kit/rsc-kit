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
    rscKit({ sourceDir: 'src', outDir: 'build' }),
    react(),
  ],
})
