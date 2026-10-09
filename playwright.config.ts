import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  testMatch: '**/*.e2e.ts',
  timeout: 30_000,
  expect: { timeout: 12_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://127.0.0.1:5173',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: 'pnpm exec vite --host 127.0.0.1 --port 5173 --strictPort',
    url: 'http://127.0.0.1:5173',
    timeout: 60_000,
    reuseExistingServer: !process.env.CI,
    env: {
      VITE_THIEPN_ACCOUNT_URL: 'https://account.recipe-e2e.invalid',
      VITE_THIEPN_ACCOUNT_PUBLISHABLE_KEY: 'sb_publishable_browser_test_only',
      VITE_THIEPN_CORE_URL: 'https://core.recipe-e2e.invalid',
      VITE_RECIPE_WORKSPACE_SYNC: 'disabled',
    },
  },
});
