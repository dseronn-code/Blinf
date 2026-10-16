import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  test: { include: ['tests/*.test.ts'], exclude: ['tests/e2e/**', 'node_modules/**'], environment: 'node', testTimeout: 60000, hookTimeout: 120000, fileParallelism: false },
});
