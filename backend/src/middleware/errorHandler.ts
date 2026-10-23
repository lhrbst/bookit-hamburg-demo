import type { Request, Response, NextFunction } from 'express';
import {
  ValidationError,
  NotFoundError,
  ForbiddenError,
  ConflictError,
} from '../domain/errors';

/**
 * Single error-handling middleware for the whole API.
 *
 * Must be registered last, after every router, and must declare all four
 * parameters — Express identifies error middleware by arity; dropping
 * `next` turns this into ordinary middleware that never runs on error.
 *
 * This is the only place refusal wording is shaped. It never leaks stack
 * traces, SQLSTATE codes, driver messages, constraint names, or SQL.
 *
 * Response shape (see the contract documented on `domain/errors.ts`):
 *
 *   { "error": { "code": "...", "message": "...", "fieldErrors"?: [...] } }
 *
 * `error` is always an object keyed by a stable, machine-consumable
 * `code`, so the frontend can branch on it without string-matching a
 * human-readable message. `fieldErrors` is present on both
 * `validation_error` and `conflict` (issue #48) — the two remain
 * distinguishable purely by `error.code`, never by shape.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (err instanceof ValidationError) {
    res.status(err.status).json({
      error: {
        code: 'validation_error',
        message: err.message,
        fieldErrors: err.fieldErrors,
      },
    });
    return;
  }

  if (err instanceof NotFoundError) {
    res.status(err.status).json({
      error: {
        code: 'not_found',
        message: err.message,
      },
    });
    return;
  }

  if (err instanceof ForbiddenError) {
    res.status(err.status).json({
      error: {
        code: 'forbidden',
        message: err.message,
      },
    });
    return;
  }

  if (err instanceof ConflictError) {
    res.status(err.status).json({
      error: {
        code: 'conflict',
        message: err.message,
        fieldErrors: err.fieldErrors,
      },
    });
    return;
  }

  // Unrecognised failure: never leak internals to the client.
  // eslint-disable-next-line no-console
  console.error(err);
  res.status(500).json({
    error: {
      code: 'internal_error',
      message: 'Something went wrong. Please try again.',
    },
  });
}
