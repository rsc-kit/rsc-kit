import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { rscRoutes } from '@rsc-kit/core/vite'

export default defineConfig({
  plugins: [
    rscRoutes({
      sourceDir: 'src',
      outDir: 'build',
      assetsDir: 'build/public',
    }),
    // After rscRoutes(), and always present rather than only with the compiler.
    // This is what gives a client component Fast Refresh; without it an edit is
    // a full reload and whatever the component was holding is gone.
    react(),
  ],
})
