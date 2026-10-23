import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler';
import { listResources, getResourceById } from '../db/resourceRepository';
import { getResourceBookingsForDay } from '../db/bookingRepository';
import { parseScheduleQuery } from '../domain/scheduleQuery';
import { buildResourceSchedule } from '../domain/schedule';
import { NotFoundError } from '../domain/errors';

/**
 * `GET /api/resources` — lists every bookable resource, rooms and shared
 * equipment together in one list (FS-01 FR-1, §6.1, §7, AC-1, issue #51).
 *
 * No query params, no filtering: this is the full catalogue. An empty
 * catalogue returns 200 with `[]`, not an error (the empty state is a UI
 * concern). A resource without a description is still included — the
 * database column is `NOT NULL` but may be an empty string, which is
 * returned as-is rather than papered over with a placeholder.
 */
export const resourcesRouter = Router();

/** Matches a well-formed UUID; a malformed `:id` cannot identify a resource
 * and is treated the same as an unknown one (404), not a 500 from an
 * invalid `uuid`-typed query parameter reaching PostgreSQL. */
const UUID_SHAPE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

resourcesRouter.get(
  '/api/resources',
  asyncHandler(async (_req, res) => {
    const resources = await listResources();
    res.json(resources);
  }),
);

/**
 * `GET /api/resources/:id/schedule` — the single-resource, single-day
 * schedule view backing Flow A and the resource schedule UI (FS-01 FR-2,
 * §6.2, §7, §10, AC-2/AC-3/AC-4/AC-12/AC-13, issue #53).
 *
 * Query params (all optional, combined additively/AND):
 *   - `date=YYYY-MM-DD` — defaults to today in Europe/Berlin.
 *   - `bookedById`, `bookedForId` — UUIDs, narrow which bookings render as
 *     `booked` segments. They never change the 24-hour segment coverage —
 *     a booking excluded by these filters reverts its time to `free`
 *     rather than opening a gap (FS-01 §10).
 *
 * An unknown `:id` is a 404 (FS-01 §10 'selected resource no longer
 * exists'), not an empty schedule — unlike a filter matching no bookings,
 * which is a normal all-free response.
 */
resourcesRouter.get(
  '/api/resources/:id/schedule',
  asyncHandler(async (req, res) => {
    const resourceId = req.params.id;
    if (resourceId === undefined || !UUID_SHAPE.test(resourceId)) {
      throw new NotFoundError('This resource no longer exists.');
    }

    const resource = await getResourceById(resourceId);
    if (resource === null) {
      throw new NotFoundError('This resource no longer exists.');
    }

    const filters = parseScheduleQuery(req.query);
    const bookings = await getResourceBookingsForDay(resource.id, filters.bounds);
    const segments = buildResourceSchedule(bookings, filters.bounds, {
      bookedById: filters.bookedById,
      bookedForId: filters.bookedForId,
    });

    res.json({ resource, segments });
  }),
);
