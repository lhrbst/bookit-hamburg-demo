import path from 'node:path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * Vite config. The dev server port and the backend origin it proxies to
 * (for local convenience only — the SPA still calls the backend's own
 * CORS-enabled origin directly via `src/lib`) are read from `.env` files,
 * not hardcoded, so environment differences never live in source.
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    server: {
      port: Number(env.VITE_PORT) || 5173,
    },
  };
});
