import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['tests/**/*.test.{ts,tsx}'],
    setupFiles: ['./tests/setup.ts'],
    // The API base URL the handlers in tests/msw answer on.
    env: { VITE_API_URL: 'http://localhost:5001/api/v1' },
  },
});
