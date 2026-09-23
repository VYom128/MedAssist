import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globalSetup: ['tests/setup/globalSetup.ts'],
    setupFiles: ['tests/setup/db.ts'],
    // Starting a replica set can be slow on first run (binary download).
    hookTimeout: 120_000,
    testTimeout: 20_000,
    env: {
      NODE_ENV: 'test',
      // Real URI comes from MongoMemoryReplSet (see tests/setup); this only satisfies env validation.
      MONGO_URI: 'mongodb://127.0.0.1:1/placeholder',
      CLIENT_URL: 'http://localhost:5173',
      LOG_LEVEL: 'silent',
      RATE_LIMIT_MAX: '10000',
    },
  },
});
