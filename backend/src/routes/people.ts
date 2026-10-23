import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler';
import { listPeople } from '../db/personRepository';

/**
 * `GET /api/people` — lists the maintained set of people, used to
 * populate 'booked by' and 'booked for' filter/select controls across
 * FS-01 and FS-02 (issue #52).
 *
 * No query params, no filtering: this is the full set. An empty set
 * returns 200 with `[]`, not an error (a degenerate case that should not
 * occur given seed data, but must still be handled).
 */
export const peopleRouter = Router();

peopleRouter.get(
  '/api/people',
  asyncHandler(async (_req, res) => {
    const people = await listPeople();
    res.json(people);
  }),
);
