import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@erp/db': path.resolve(__dirname, '../db-client/src/index.ts'),
      '@erp/types': path.resolve(__dirname, '../shared-types/src/index.ts'),
      '@erp/logger': path.resolve(__dirname, '../logger/src/index.ts'),
      '@erp/config': path.resolve(__dirname, '../config/src/index.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts'],
      thresholds: {
        lines: 70,
        functions: 70,
        branches: 70,
        statements: 70,
      },
    },
    testTimeout: 10_000,
  },
});
