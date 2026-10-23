import { z } from 'zod';
import { ValidationError } from './errors';
import type { DayBounds } from './dayClipping';
import { parseDayBounds } from './dayQuery';

/**
 * Query-parameter parsing for `GET /api/resources/:id/schedule` (FS-01
 * FR-2, §6.2, AC-2/AC-3/AC-4/AC-12/AC-13, issue #53).
 *
 * Shares its `date` parsing with `GET /api/bookings` (issue #21) via
 * `dayQuery.ts` rather than duplicating it. There is no `resourceId` field
 * here — the resource is identified by the route's `:id` path param, which
 * the route handler resolves (and 404s on) separately.
 */

const QuerySchema = z.object({
  date: z.string().optional(),
  bookedById: z.string().uuid('bookedById must be a valid identifier.').optional(),
  bookedForId: z.string().uuid('bookedForId must be a valid identifier.').optional(),
});

export interface ScheduleQueryFilters {
  /** Resolved Europe/Berlin day boundaries, as absolute instants. */
  bounds: DayBounds;
  bookedById: string | undefined;
  bookedForId: string | undefined;
}

/**
 * Parses and validates the query params of `GET /api/resources/:id/schedule`
 * into a filter set. Throws `ValidationError` (400, existing shape) for a
 * malformed `date` or a syntactically invalid UUID filter.
 *
 * `bookedById`/`bookedForId` narrow which bookings render as *booked*
 * segments; they do not change the 24-hour segment coverage — a booking
 * excluded by these filters reverts its time to a free segment rather than
 * disappearing (FS-01 §10). That combination is applied in
 * `domain/schedule.ts`, not here.
 */
export function parseScheduleQuery(query: Record<string, unknown>): ScheduleQueryFilters {
  const result = QuerySchema.safeParse(query);
  if (!result.success) {
    const fieldErrors = result.error.issues.map((issue) => ({
      field: issue.path.join('.') || 'query',
      rule: 'invalid-id',
      message: issue.message,
    }));
    throw new ValidationError(fieldErrors);
  }

  return {
    bounds: parseDayBounds(result.data.date),
    bookedById: result.data.bookedById,
    bookedForId: result.data.bookedForId,
  };
}
