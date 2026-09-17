import { defineConfig } from 'vite'

import { tanstackStart } from '@tanstack/react-start/plugin/vite'

import viteReact from '@vitejs/plugin-react'
import { nitro } from 'nitro/vite'

const config = defineConfig({
  resolve: { tsconfigPaths: true },
  plugins: [
    nitro({ rollupConfig: { external: [/^@sentry\//] } }),

    tanstackStart({ prerender: { enabled: true, crawlLinks: false, filter: ({ path }) => path === '/static' || path === '/' } }),
    viteReact(),
  ],
})

export default config
