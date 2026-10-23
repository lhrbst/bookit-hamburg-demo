import { Temporal } from '@js-temporal/polyfill';
import { ValidationError } from './errors';
import { dayBounds, type DayBounds } from './dayClipping';

/**
 * Shared `date` query-parameter parsing for every "bookings on a calendar
 * day" read (`GET /api/bookings`, issue #21; `GET
 * /api/resources/:id/schedule`, issue #53).
 *
 * Kept separate from `bookingQuery.ts` so the per-resource schedule query
 * (which has no `resourceId` filter — the resource is the path param) can
 * reuse exactly this parsing without duplicating it or depending on the
 * cross-resource query's shape.
 */

const DATE_SHAPE = /^\d{4}-\d{2}-\d{2}$/;

function parseDate(raw: string | undefined): Temporal.PlainDate {
  if (raw === undefined) {
    return Temporal.Now.plainDateISO('Europe/Berlin');
  }

  if (!DATE_SHAPE.test(raw)) {
    throw new ValidationError([
      {
        field: 'date',
        rule: 'invalid-date',
        message: 'date must be a valid calendar date in YYYY-MM-DD format.',
      },
    ]);
  }

  try {
    // overflow: 'reject' refuses out-of-range components (e.g. 2026-02-31)
    // instead of silently clamping them.
    return Temporal.PlainDate.from(raw, { overflow: 'reject' });
  } catch {
    throw new ValidationError([
      {
        field: 'date',
        rule: 'invalid-date',
        message: 'date must be a valid calendar date in YYYY-MM-DD format.',
      },
    ]);
  }
}

/**
 * Parses an optional `date=YYYY-MM-DD` query param (defaulting to today in
 * Europe/Berlin) into resolved day boundaries. Throws `ValidationError`
 * (400, existing shape) for a malformed or out-of-range date.
 */
export function parseDayBounds(raw: string | undefined): DayBounds {
  return dayBounds(parseDate(raw));
}
