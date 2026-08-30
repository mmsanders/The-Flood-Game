import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/e2e/**'],
    // Worldgen suites generate many full worlds; the default 5s is too tight.
    testTimeout: 60_000,
  },
});
