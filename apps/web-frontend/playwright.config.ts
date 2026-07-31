import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 2 : 0,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
    // CRM-ROADMAP Phase 3, Feature 4 (Mobile CRM) added a real service worker
    // (public/sw.js) for PWA installability. Playwright's own documented guidance is to
    // block service workers in E2E runs unless a spec is specifically testing one — an
    // active SW intercepting fetches alongside page.route() mocking is a known source of
    // flaky/order-dependent failures across an entire suite, not just PWA-related specs.
    serviceWorkers: 'block',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env['CI'],
    timeout: 30_000,
  },
});
