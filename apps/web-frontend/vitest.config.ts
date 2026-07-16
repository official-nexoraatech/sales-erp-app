import { readFileSync } from 'node:fs';
import { defineConfig, configDefaults } from 'vitest/config';
import react from '@vitejs/plugin-react';

// vite.config.ts's `define` doesn't apply here — Vitest resolves this file independently
// (see the CSS-import-order-bug-class of gotcha this repo has hit before). Re-declared so
// __APP_VERSION__ (read by HelpPanel.tsx) resolves under `vitest` the same way it does
// under `vite build`/`vite dev`.
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8')) as {
  version: string;
};

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
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
