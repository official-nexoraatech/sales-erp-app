import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@erp/db': path.resolve(__dirname, '../../packages/db-client/src/index.ts'),
      '@erp/types': path.resolve(__dirname, '../../packages/shared-types/src/index.ts'),
      '@erp/logger': path.resolve(__dirname, '../../packages/logger/src/index.ts'),
      '@erp/config': path.resolve(__dirname, '../../packages/config/src/index.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 10_000,
  },
});
