import { defineConfig, devices } from '@playwright/test';

const port = process.env.E2E_PORT ?? '8133';
const baseURL = `http://127.0.0.1:${port}`;

// Bare Chromium. Mobil (390 px) og laptop (1280 px). Alle testene deler én database og én bruker,
// så de kjøres etter hverandre (en arbeider).
export default defineConfig({
  testDir: './tests',
  outputDir: '../test-results',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI
    ? [['list'], ['html', { open: 'never', outputFolder: '../playwright-report' }]]
    : [['list']],
  globalTeardown: './global-teardown.mjs',
  use: {
    baseURL,
    locale: 'nb-NO',
    timezoneId: 'Europe/Oslo',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'mobil',
      use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 } },
    },
    {
      name: 'laptop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
  ],
  webServer: {
    command: 'node e2e/serve.mjs',
    cwd: '..',
    url: `${baseURL}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: { E2E_PORT: port },
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
