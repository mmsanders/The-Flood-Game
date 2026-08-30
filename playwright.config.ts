import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

/**
 * Some sandboxes ship a Chromium build that doesn't match what this Playwright
 * version would download. Point at the preinstalled binary when it's there,
 * and fall back to Playwright's own resolution everywhere else.
 */
const PREINSTALLED = '/opt/pw-browsers/chromium';
const launchOptions = existsSync(PREINSTALLED)
  ? { executablePath: PREINSTALLED, args: ['--no-sandbox'] }
  : {};

/**
 * Screenshot harness.
 *
 * The point is not assertion coverage — it's that changes to the look of the
 * game can be reviewed as images, in CI and on a phone, without anyone having
 * to run the thing locally.
 */
export default defineConfig({
  testDir: './tests/e2e',
  outputDir: './test-results',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list']] : [['list']],

  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'off',
  },

  projects: [
    {
      name: 'desktop',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 900 },
        launchOptions,
      },
    },
    {
      name: 'phone',
      use: { ...devices['Pixel 7'], launchOptions },
    },
  ],

  webServer: {
    // --host 127.0.0.1 is load-bearing: vite preview otherwise binds "localhost",
    // which resolves to ::1 on CI runners while this readiness check polls the
    // IPv4 address, so the server never appears to come up.
    command: 'npm run build && npx vite preview --port 4173 --strictPort --host 127.0.0.1',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
