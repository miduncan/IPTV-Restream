import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch: 'games*.spec.mjs',
  workers: 1,
  timeout: 30_000,
  outputDir: './test-results/games',
  reporter: 'list',
  use: { baseURL: `http://127.0.0.1:${process.env.GAMES_TEST_PORT || '4184'}`, channel: 'chrome', headless: true, screenshot: 'only-on-failure' },
  webServer: {
    command: `./node_modules/.bin/vite --config vite.games.config.ts --host 127.0.0.1 --port ${process.env.GAMES_TEST_PORT || '4184'} --strictPort`,
    url: `http://127.0.0.1:${process.env.GAMES_TEST_PORT || '4184'}`,
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
