import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/**/*.test.ts'],
    setupFiles: ['./tests/setup.ts'],
    testTimeout: 30_000,
    // Starting the in-memory replica set can be slow (first run downloads the mongod binary).
    hookTimeout: 120_000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      reporter: ['text', 'html'],
      // Spec §15.1: at least 80 % of lines on services and policies (checked per group).
      thresholds: {
        'src/services/**': { lines: 80 },
        'src/policies/**': { lines: 80 },
        'src/modules/**/*service.ts': { lines: 80 },
      },
    },
  },
});
