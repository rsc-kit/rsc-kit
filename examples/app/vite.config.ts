import { defineConfig } from 'vite'
import { rscRoutes } from '@rsc-router/core/vite'

export default defineConfig({
  plugins: [
    rscRoutes({
      sourceDir: 'src',
      outDir: 'build',
      assetsDir: 'build/public',
    }),
  ],
})
