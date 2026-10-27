import path from 'node:path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { validateRuntimeConfig } from './runtime-config.mjs';

/**
 * Vite config. The dev server port and the backend origin it proxies to
 * (for local convenience only — the SPA still calls the backend's own
 * CORS-enabled origin directly via `src/lib`) are read from `.env` files,
 * not hardcoded, so environment differences never live in source.
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [
      react(),
      tailwindcss(),
      {
        name: 'local-runtime-configuration',
        apply: 'serve',
        configureServer(server) {
          const value = validateRuntimeConfig({ apiBaseUrl: env.API_BASE_URL ?? 'http://localhost:3001' });
          server.middlewares.use('/config.json', (_req, res) => {
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Cache-Control', 'no-store');
            res.end(JSON.stringify(value));
          });
        },
      },
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    server: {
      port: Number(env.VITE_PORT) || 5173,
      strictPort: true,
    },
  };
});
