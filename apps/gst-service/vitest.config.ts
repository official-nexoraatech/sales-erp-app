import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // Default 5000ms was borderline for this service's cold module-import cost
    // (@erp/sdk pulls in a heavy dependency graph) — the first test in a fresh file
    // routinely took ~4.9s just importing, tipping over the default under any load.
    // Matches auth-service's vitest.config.ts, which hit the same class of issue.
    testTimeout: 15_000,
  },
});
