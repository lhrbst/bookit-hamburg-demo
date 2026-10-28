import { createApp } from './app';
import { config } from './config';
import { pool } from './db/pool';

/**
 * Bootstrap / port entry point. Keeps process wiring (listen, logging)
 * separate from the composition root in `app.ts`, so `app.ts` can be
 * imported by tests without binding a port.
 */
const app = createApp();

const server = app.listen(config.port, '0.0.0.0', () => {
  // eslint-disable-next-line no-console
  console.log(`bookit-backend listening on http://localhost:${config.port}`);
});

let stopping = false;
function shutdown(): void {
  if (stopping) return;
  stopping = true;
  const timeout = setTimeout(() => {
    console.error('Graceful shutdown timed out');
    process.exit(1);
  }, 15_000);
  timeout.unref();
  server.close(() => {
    void pool.end().then(() => clearTimeout(timeout)).catch((error: unknown) => {
      console.error('Database shutdown failed', error);
      process.exitCode = 1;
    });
  });
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
