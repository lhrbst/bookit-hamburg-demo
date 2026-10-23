import { createApp } from './app';
import { config } from './config';

/**
 * Bootstrap / port entry point. Keeps process wiring (listen, logging)
 * separate from the composition root in `app.ts`, so `app.ts` can be
 * imported by tests without binding a port.
 */
const app = createApp();

app.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log(`bookit-backend listening on http://localhost:${config.port}`);
});

