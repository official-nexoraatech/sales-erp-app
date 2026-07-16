import { defineConfig, configDefaults } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/setupTests.ts'],
    testTimeout: 15_000,
    // e2e/ holds Playwright specs (test.describe from @playwright/test), not Vitest tests —
    // Vitest's default glob would otherwise try to collect them too and fail on the mismatched
    // test runner.
    exclude: [...configDefaults.exclude, '**/e2e/**'],
  },
});
