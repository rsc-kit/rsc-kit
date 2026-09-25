import { defineConfig, devices } from '@playwright/test'

// The browser journeys. Each one is a bug that passed every unit test and was
// found by tapping through a real build on a phone - so these tap through a
// real build, as a phone, and assert what is ON SCREEN.
//
// Two servers from one build: the built server, and the same output compiled
// into a single binary - which merges module scopes, and once broke every
// resumed page. Build first: `bun run build`.
export default defineConfig({
  testDir: 'tests',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: process.env.CI ? [['list'], ['github']] : 'list',
  use: {
    ...devices['iPhone 13'],
    // Chromium, emulating the phone: the CPU throttle below needs CDP.
    browserName: 'chromium',
    baseURL: 'http://localhost:4600',
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'bun .output/server/index.mjs',
      port: 4600,
      env: { PORT: '4600' },
      reuseExistingServer: !process.env.CI,
    },
    {
      command: 'bun build --compile .output/server/compile.mjs --outfile .e2e-binary && ./.e2e-binary',
      port: 4601,
      env: { PORT: '4601' },
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
})
