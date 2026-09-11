import { defineConfig, devices } from '@playwright/test';

const PROD_URL = 'https://stunning-kleicha-f61101.netlify.app';
const V3_URL = process.env.HK_PLANNER_V3_URL || 'http://localhost:8890';

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

  // Un serveur statique local sert la v3 : les projets `desktop` et `mobile`
  // continuent de taper la prod Netlify, les projets v3 tapent l'arbre de travail.
  // `webServer` est global : il demarre aussi pour `desktop` et `mobile`, qui
  // tapent la prod et n'en ont pas besoin. Le cout est de quelques secondes, et
  // c'est le prix d'une configuration qui reste lisible.
  webServer: {
    command: 'python3 -m http.server 8890',
    // On attend /v3/index.html, pas la racine : avec `reuseExistingServer`, un
    // serveur tiers deja en ecoute sur 8890 passerait la porte sur index.html et
    // les tests v3 tourneraient contre le mauvais arbre sans rien dire.
    url: 'http://localhost:8890/v3/index.html',
    reuseExistingServer: true,
    timeout: 30_000,
  },

  projects: [
    {
      name: 'desktop',
      testIgnore: /v3\//,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'mobile',
      testIgnore: /v3\//,
      use: { ...devices['iPhone 13'] },
    },
    {
      name: 'v3-mobile',
      testMatch: /v3\/.*\.spec\.ts/,
      use: { ...devices['iPhone 13'], baseURL: V3_URL },
    },
    {
      name: 'v3-desktop',
      testMatch: /v3\/.*\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 }, baseURL: V3_URL },
    },
  ],
});
