import express from 'express';
import cors from 'cors';
import { config } from './config';
import { healthRouter } from './routes/health';
import { bookingsRouter } from './routes/bookings';
import { resourcesRouter } from './routes/resources';
import { peopleRouter } from './routes/people';
import { purposesRouter } from './routes/purposes';
import { meRouter } from './routes/me';
import { errorHandler } from './middleware/errorHandler';

/**
 * Application composition root.
 *
 * Assembles middleware and routers into a single Express app. JSON-only:
 * no view engine, no server-rendered templates are configured anywhere in
 * this file or elsewhere in the app.
 */
export function createApp() {
  const app = express();

  app.use(
    cors({
      origin: config.corsOrigin,
    }),
  );
  app.use(express.json());

  // Routers.
  app.use('/', healthRouter);
  app.use('/', bookingsRouter);
  app.use('/', resourcesRouter);
  app.use('/', peopleRouter);
  app.use('/', purposesRouter);
  app.use('/', meRouter);

  // 404 for anything unmatched, before the error handler. Same shape as
  // every `NotFoundError` rendered by `errorHandler.ts`, so the frontend
  // never sees a different error contract for an unknown route.
  app.use((req, res) => {
    res.status(404).json({
      error: {
        code: 'not_found',
        message: 'The requested endpoint does not exist.',
      },
    });
  });

  // Error-handling middleware must be registered last.
  app.use(errorHandler);

  return app;
}

