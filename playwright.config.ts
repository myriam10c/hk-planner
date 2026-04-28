import { defineConfig, devices } from '@playwright/test';

const PROD_URL = 'https://stunning-kleicha-f61101.netlify.app';

export default defineConfig({
  testDir: './tests',
  // Smoke suite runs serially — tests share the same prod URL and contention
  // against a Netlify cold-start path produces noisy timeouts.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  timeout: 60_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: process.env.HK_PLANNER_URL || PROD_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    // The app registers a service worker; without blocking it, browser context
    // teardown hangs past the test timeout.
    serviceWorkers: 'block',
  },

  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'mobile',
      use: { ...devices['iPhone 13'] },
    },
  ],
});
