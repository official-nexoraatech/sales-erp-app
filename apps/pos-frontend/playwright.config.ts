import { defineConfig, devices } from '@playwright/test';

// Mirrors apps/web-frontend/playwright.config.ts — same mocked-API smoke tier shape,
// pointed at pos-frontend's own dev server port instead.
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 2 : 0,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5174',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:5174',
    reuseExistingServer: !process.env['CI'],
    timeout: 30_000,
  },
});
