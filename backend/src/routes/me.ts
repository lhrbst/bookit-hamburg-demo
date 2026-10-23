import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler';
import { getCurrentPerson } from '../domain/currentPerson';

/**
 * `GET /api/me` — the identified current person (FS-02 FR-1/FR-3, §4,
 * §6.1, issue #35), used by the UI to pre-fill/display the booking
 * creator and to decide whether to offer the cancel action.
 *
 * Response shape matches `GET /api/people` entries: `{ id, name }`.
 *
 * Resolution goes entirely through the `getCurrentPerson` seam — there is
 * no auth system yet, so this always resolves to the same
 * configured/stand-in person (see `domain/currentPerson.ts`). This is the
 * same seam `POST /api/bookings` and `DELETE /api/bookings/:id` (issues
 * #36/#37) use for the authoritative `bookedBy`/creator identity; no
 * route may accept that identity from the request body instead.
 */
export const meRouter = Router();

meRouter.get(
  '/api/me',
  asyncHandler(async (_req, res) => {
    const person = await getCurrentPerson();
    res.json(person);
  }),
);
