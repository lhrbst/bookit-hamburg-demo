import { z } from 'zod';
import { ValidationError } from './errors';
import type { DayBounds } from './dayClipping';
import { parseDayBounds } from './dayQuery';

/**
 * Query-parameter parsing for `GET /api/bookings` (FS-01 FR-3/FR-4).
 *
 * Validation here is intentionally minimal and reuses the existing
 * `ValidationError` shape as-is (per issue #21 scope) — a richer, shared
 * error-contract refinement for query-param validation across endpoints
 * is issue #22's job, not this ticket's.
 *
 * `date`/`bookedById`/`bookedForId` parsing is shared with the per-resource
 * schedule query (`domain/scheduleQuery.ts`, issue #53) via `dayQuery.ts`,
 * rather than duplicated — this file adds only the `resourceId` filter that
 * is specific to the cross-resource overview.
 */

// PostgreSQL accepts UUID-shaped values without RFC version/variant bits.
const QuerySchema = z.object({
  date: z.string().optional(),
  resourceId: z.guid('resourceId must be a valid identifier.').optional(),
  bookedById: z.guid('bookedById must be a valid identifier.').optional(),
  bookedForId: z.guid('bookedForId must be a valid identifier.').optional(),
});

export interface BookingQueryFilters {
  /** Resolved Europe/Berlin day boundaries, as absolute instants. */
  bounds: DayBounds;
  resourceId: string | undefined;
  bookedById: string | undefined;
  bookedForId: string | undefined;
}

/**
 * Parses and validates the query params of `GET /api/bookings` into a
 * filter set ready for `db/bookingRepository.ts#listBookings`.
 *
 * Throws `ValidationError` (400, existing shape) for a malformed `date`
 * or a syntactically invalid UUID filter. Unknown resource/person ids are
 * not rejected here — a filter that matches nothing yields an empty
 * result set (200, `[]`), per FR-3/AC-10, not a 400 or 404.
 */
export function parseBookingQuery(query: Record<string, unknown>): BookingQueryFilters {
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
    resourceId: result.data.resourceId,
    bookedById: result.data.bookedById,
    bookedForId: result.data.bookedForId,
  };
}
