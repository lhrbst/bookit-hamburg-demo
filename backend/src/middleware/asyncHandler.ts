import type { Request, Response, NextFunction, RequestHandler } from 'express';

/**
 * Wraps an async Express handler so a rejected promise is forwarded to the
 * error-handling middleware via `next`.
 *
 * Express 4 does not catch rejected promises from async handlers itself;
 * without this wrapper (or an equivalent `.catch(next)`), a thrown error
 * inside an async route leaves the request hanging with no response.
 *
 * Apply this uniformly to every async route handler.
 */
export function asyncHandler<T extends RequestHandler>(fn: T): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

