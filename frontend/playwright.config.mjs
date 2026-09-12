import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 15 * 60 * 1000,
  expect: {
    timeout: 20_000,
  },
  outputDir: './test-results/stream-soak',
  reporter: [
    ['list'],
    ['html', { outputFolder: './playwright-report/stream-soak', open: 'never' }],
  ],
  use: {
    baseURL: process.env.SOAK_BASE_URL || 'http://localhost',
    channel: process.env.SOAK_BROWSER_CHANNEL || 'chrome',
    headless: process.env.SOAK_HEADED !== 'true',
    ignoreHTTPSErrors: process.env.SOAK_IGNORE_HTTPS_ERRORS === 'true',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'on',
  },
});
