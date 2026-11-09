import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Each test builds a fresh PGlite database; with every file running in parallel the
    // first one in a file can take well over 30s on a busy machine.
    testTimeout: 60000,
    // beforeEach hooks create the same in-memory database the tests do
    hookTimeout: 60000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
