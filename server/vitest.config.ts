import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Integration suites share one database, so run test files one at a time.
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 30000,
    env: {
      // Test-only: lets the suite run on MongoDB-compatible servers without TTL indexes.
      CGI_DISABLE_TTL_INDEX: process.env.CGI_ENABLE_TTL_INDEX_IN_TESTS === '1' ? '0' : '1',
    },
  },
});
