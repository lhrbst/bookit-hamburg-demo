import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler';
import { PURPOSE_CATEGORIES } from '../domain/purposes';

/**
 * `GET /api/purposes` — the predefined purpose categories the booking form
 * offers as a fixed choice (FS-02 FR-1, FR-2 R-3, §6.1, issue #34).
 *
 * There is deliberately no create/edit/delete endpoint: the set is
 * application configuration (see `domain/purposes.ts`), not user-managed
 * data. The category string itself is used as both `id` and `label` so
 * `PURPOSE_CATEGORIES` stays the single source of truth this route and the
 * R-3 validity rule (issue #33) both read — introducing a separate id
 * scheme would create a second list to keep in sync.
 *
 * Static and auth-independent: this always succeeds with the full set,
 * with no per-caller filtering.
 */
export const purposesRouter = Router();

purposesRouter.get(
  '/api/purposes',
  asyncHandler(async (_req, res) => {
    res.json({
      purposes: PURPOSE_CATEGORIES.map((category) => ({
        id: category,
        label: category,
      })),
    });
  }),
);
