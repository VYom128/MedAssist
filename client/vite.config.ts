import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

/**
 * A production build must know where the API and the socket are (D201): `VITE_API_URL` is
 * `/api/v1` behind the Vercel rewrite (or an absolute URL), `VITE_SOCKET_URL` the API's own origin.
 * Without them the bundle would silently call localhost, so the build fails instead.
 */
const REQUIRED_IN_PRODUCTION = ['VITE_API_URL', 'VITE_SOCKET_URL'] as const;

export default defineConfig(({ command, mode }) => {
  if (command === 'build' && mode === 'production') {
    const env = { ...loadEnv(mode, process.cwd(), 'VITE_'), ...process.env };
    const missing = REQUIRED_IN_PRODUCTION.filter((key) => !env[key]);
    if (missing.length > 0) {
      throw new Error(
        `Set ${missing.join(' and ')} for the production build (see docs/DEPLOYMENT.md).`,
      );
    }
  }
  return {
    plugins: [react(), tailwindcss()],
    server: {
      port: 5173,
      strictPort: true,
    },
  };
});
