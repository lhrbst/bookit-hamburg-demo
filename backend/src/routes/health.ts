import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler';
import { pool } from '../db/pool';
import { config } from '../config';
import { now } from '../domain/clock';

export const healthRouter = Router();

healthRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    res.json({
      status: 'ok',
      service: 'bookit-backend',
      timestamp: now().toString(),
    });
  }),
);

healthRouter.get('/ready', asyncHandler(async (_req, res) => {
  try {
    const result = await pool.query<{ ready: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM person WHERE id = $1)
        AND EXISTS (SELECT 1 FROM pg_constraint
          WHERE conrelid = 'public.booking'::regclass
            AND conname = 'booking_no_overlap' AND contype = 'x')
        AND has_table_privilege(current_user, 'public.resource', 'SELECT')
        AND has_table_privilege(current_user, 'public.booking', 'SELECT')
        AND has_table_privilege(current_user, 'public.booking', 'INSERT')
        AND has_table_privilege(current_user, 'public.booking', 'DELETE')
        AS ready`,
      [config.currentPersonId],
    );
    if (!result.rows[0]?.ready) {
      console.error('Readiness failed: schema, privileges or current person missing');
      res.status(503).json({ status: 'not_ready' });
      return;
    }
    res.json({ status: 'ready' });
  } catch (error) {
    console.error('Readiness database check failed', error);
    res.status(503).json({ status: 'not_ready' });
  }
}));

healthRouter.get(
  '/health',
  asyncHandler(async (_req, res) => {
    res.json({ status: 'ok' });
  }),
);
