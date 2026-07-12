import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@erp/db': path.resolve(__dirname, '../../packages/db-client/src/index.ts'),
      '@erp/types': path.resolve(__dirname, '../../packages/shared-types/src/index.ts'),
      '@erp/logger': path.resolve(__dirname, '../../packages/logger/src/index.ts'),
      '@erp/config': path.resolve(__dirname, '../../packages/config/src/index.ts'),
      '@erp/sdk': path.resolve(__dirname, '../../packages/platform-sdk/src/index.ts'),
      '@erp/utils/server': path.resolve(__dirname, '../../packages/shared-utils/src/server.ts'),
      '@erp/utils': path.resolve(__dirname, '../../packages/shared-utils/src/index.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/main.ts'],
      thresholds: { lines: 60, functions: 60, branches: 60, statements: 60 },
    },
    testTimeout: 15_000,
  },
});
