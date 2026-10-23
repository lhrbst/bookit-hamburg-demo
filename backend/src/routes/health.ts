import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler';

/**
 * Health / root router.
 *
 * Serves a JSON response confirming the API is up. Later tickets add
 * resource, booking, and person routers alongside this one; this scaffold
 * intentionally contains no domain endpoints.
 */
export const healthRouter = Router();

healthRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    res.json({
      status: 'ok',
      service: 'bookit-backend',
      timestamp: new Date().toISOString(),
    });
  }),
);

healthRouter.get(
  '/health',
  asyncHandler(async (_req, res) => {
    res.json({ status: 'ok' });
  }),
);

