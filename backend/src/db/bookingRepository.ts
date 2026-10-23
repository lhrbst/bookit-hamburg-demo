import type { DatabaseError, QueryResult } from 'pg';
import { Temporal } from '@js-temporal/polyfill';
import { pool } from './pool';
import type {
  Booking,
  BookingDetail,
  BookingOverviewItem,
  CreateBookingInput,
} from '../domain/booking';
import { ConflictError, NotFoundError, type ConflictFieldError } from '../domain/errors';
import { clipToDay, type DayBounds } from '../domain/dayClipping';
import type { BookingQueryFilters } from '../domain/bookingQuery';
import type { ResourceBookingForSchedule } from '../domain/schedule';

/**
 * Raw shape of a row returned by the queries below. `pg` returns
 * `QueryResult<any>` by default, so every query here is given this row
 * type explicitly and mapped to the domain `Booking` shape at this edge —
 * callers never see raw driver rows.
 */
interface BookingRow {
  id: string;
  resource_id: string;
  booked_by: string;
  booked_for: string;
  purpose: string;
  start: Date;
  end: Date;
}

function toBooking(row: BookingRow): Booking {
  return {
    id: row.id,
    resourceId: row.resource_id,
    bookedBy: row.booked_by,
    bookedFor: row.booked_for,
    purpose: row.purpose,
    start: row.start.toISOString(),
    end: row.end.toISOString(),
  };
}

/**
 * Matches the `DETAIL` line PostgreSQL attaches to a `23P01` violation of
 * `booking_no_overlap`, e.g.:
 *
 *   Key (resource_id, during)=(123A, ["2010-01-01 14:30:00+01","2010-01-01 15:30:00+01"))
 *   conflicts with existing key (resource_id, during)=(123A, ["2010-01-01 14:00:00+01","2010-01-01 15:00:00+01")).
 *
 * The **existing** row is the second `(resource_id, during)` pair — the
 * one introduced by "conflicts with existing key" — which is what a
 * refusal must name (the first pair merely echoes back the just-rejected
 * insert, which the caller already knows). Captures the two bounds of
 * that second range loosely (matches either `+`/`-` offset or `Z`), and
 * is intentionally tolerant of exact spacing/quoting, since `DETAIL` is a
 * human-readable, `lc_messages`-localised string, not a stable API.
 */
const EXISTING_RANGE_PATTERN =
  /conflicts with existing key \([^)]*\)=\([^,]+,\s*\["?([^",]+)"?,\s*"?([^",)]+)"?[)\]]\)/;

/**
 * Parses the existing conflicting `[start, end)` range out of a `23P01`
 * error's `detail`, converting each bound to an absolute instant.
 *
 * Returns `null` on any parse failure — malformed match, or either bound
 * failing to parse as an instant — so the caller can still refuse the
 * booking with a clash message, just without a specific range, rather
 * than ever crashing or (worse) silently accepting the booking (Core
 * Rule 2).
 */
function parseConflictingRange(
  detail: string | undefined,
): { start: string; end: string } | null {
  if (detail === undefined) {
    return null;
  }

  const match = EXISTING_RANGE_PATTERN.exec(detail);
  if (!match) {
    return null;
  }

  const [, rawStart, rawEnd] = match;
  try {
    const start = Temporal.Instant.from(rawStart!.trim().replace(' ', 'T')).toString();
    const end = Temporal.Instant.from(rawEnd!.trim().replace(' ', 'T')).toString();
    return { start, end };
  } catch {
    return null;
  }
}

/** Formats an absolute instant as a business-readable Europe/Berlin local time. */
function formatBerlin(instant: string): string {
  const zoned = Temporal.Instant.from(instant).toZonedDateTimeISO('Europe/Berlin');
  return zoned.toPlainDateTime().toString({ smallestUnit: 'minute' }).replace('T', ' ');
}

/**
 * Builds the clash `ConflictError` for a `23P01` violation of
 * `booking_no_overlap` (FS-03 FR-3, AC-8). Attributed to both `start` and
 * `end` — those are the fields the user must change (§6.1) — and, per
 * FS-03 §12 Q1/Q2, names only the conflicting time range, never who holds
 * it or its purpose.
 */
function buildConflictError(detail: string | undefined): ConflictError {
  const range = parseConflictingRange(detail);

  const message =
    range === null
      ? 'This resource is already booked for part of that time.'
      : `This resource is already booked from ${formatBerlin(range.start)} to ${formatBerlin(
          range.end,
        )}.`;

  const fieldErrors: ConflictFieldError[] = (['start', 'end'] as const).map((field) => ({
    field,
    rule: 'clash',
    message,
    ...(range !== null ? { conflict: range } : {}),
  }));

  return new ConflictError(message, fieldErrors);
}

/**
 * Persists a new booking and returns it, including its generated id.
 *
 * Performs no validation of its own. Booking validity rules (end-after-
 * start, not-in-the-past, valid purpose, DST rejection) are layered on
 * above this function by issue #33, before `start`/`end` ever reach here
 * as resolved absolute instants.
 *
 * Non-overlap is enforced entirely by the `booking_no_overlap` exclusion
 * constraint at commit (ADR-003) — this function does not pre-check
 * availability (that would be a read-then-insert race, Core Rule 1). It
 * always attempts the `INSERT` and only afterwards inspects any failure:
 * a concurrently conflicting insert on the same resource fails with
 * PostgreSQL error `23P01` on `booking_no_overlap`, which is caught here
 * (discriminated on both `code` and `constraint`, per Core Rule 2, so an
 * unrelated future exclusion constraint is never mistaken for a booking
 * clash) and translated into a `ConflictError` carrying the conflicting
 * range parsed from the driver error's `detail`. Any other database
 * error is rethrown unchanged and surfaces as the generic 500 — never
 * misreported as a clash.
 *
 * A single `pool.query` statement needs no explicit transaction/rollback:
 * its failure does not leave the underlying connection in an aborted
 * transaction state the way a multi-statement transaction would.
 */
export async function createBooking(input: CreateBookingInput): Promise<Booking> {
  let result: QueryResult<BookingRow>;
  try {
    result = await pool.query(
      `INSERT INTO booking (resource_id, booked_by, booked_for, purpose, during)
       VALUES ($1, $2, $3, $4, tstzrange($5, $6, '[)'))
       RETURNING
         id,
         resource_id,
         booked_by,
         booked_for,
         purpose,
         lower(during) AS start,
         upper(during) AS "end"`,
      [input.resourceId, input.bookedBy, input.bookedFor, input.purpose, input.start, input.end],
    );
  } catch (err) {
    const dbError = err as Partial<DatabaseError>;
    if (dbError.code === '23P01' && dbError.constraint === 'booking_no_overlap') {
      throw buildConflictError(dbError.detail);
    }
    throw err;
  }

  const row = result.rows[0];
  if (!row) {
    // INSERT ... RETURNING with no error and no row should not happen; this
    // guards `noUncheckedIndexedAccess` rather than a real expected path.
    throw new Error('Booking insert did not return the created row.');
  }

  return toBooking(row);
}

/**
 * Raw shape of a row returned by `getBookingById` below: the booking
 * joined with its `resource` and both `person` references, mirroring the
 * shape `POST /api/bookings` (issue #36) builds for its create response,
 * so `GET /api/bookings/:id` (issue #37) can return the identical shape.
 */
interface BookingDetailRow {
  id: string;
  resource_id: string;
  resource_name: string;
  resource_type: 'room' | 'equipment';
  booked_by_id: string;
  booked_by_name: string;
  booked_for_id: string;
  booked_for_name: string;
  purpose: string;
  start: Date;
  end: Date;
}

/**
 * Looks up a single booking by id, joined with resource/person identity
 * (`GET /api/bookings/:id`, issue #37; also used by `DELETE
 * /api/bookings/:id` to authorize the cancel before deleting). Returns
 * `null` rather than throwing when `id` does not identify an existing
 * booking — callers decide what that means (a `NotFoundError`'s "this
 * booking no longer exists" outcome); this is a pure read.
 */
export async function getBookingById(id: string): Promise<BookingDetail | null> {
  const result: QueryResult<BookingDetailRow> = await pool.query(
    `SELECT
       b.id                AS id,
       b.resource_id       AS resource_id,
       r.name              AS resource_name,
       r.type              AS resource_type,
       bb.id               AS booked_by_id,
       bb.name             AS booked_by_name,
       bf.id               AS booked_for_id,
       bf.name             AS booked_for_name,
       b.purpose           AS purpose,
       lower(b.during)     AS start,
       upper(b.during)     AS "end"
     FROM booking b
     JOIN resource r ON r.id = b.resource_id
     JOIN person bb ON bb.id = b.booked_by
     JOIN person bf ON bf.id = b.booked_for
     WHERE b.id = $1`,
    [id],
  );

  const row = result.rows[0];
  if (row === undefined) {
    return null;
  }

  return {
    id: row.id,
    resource: {
      id: row.resource_id,
      name: row.resource_name,
      type: row.resource_type,
    },
    bookedBy: { id: row.booked_by_id, name: row.booked_by_name },
    bookedFor: { id: row.booked_for_id, name: row.booked_for_name },
    purpose: { id: row.purpose, label: row.purpose },
    start: row.start.toISOString(),
    end: row.end.toISOString(),
  };
}

/**
 * Removes a booking outright (FS-02 §12: cancellation is not a soft
 * delete/tombstone). Once removed, the slot disappears from every read
 * that scans the `booking` table with no extra "not cancelled" filtering
 * required, and the time becomes bookable again with no further logic —
 * the exclusion constraint only ever sees rows that still exist.
 *
 * Throws `NotFoundError` when `id` does not identify an existing booking
 * (already cancelled, or never existed), so that outcome is distinguishable
 * from a successful cancellation for callers such as issue #37's route.
 */
export async function cancelBooking(id: string): Promise<void> {
  const result = await pool.query('DELETE FROM booking WHERE id = $1 RETURNING id', [id]);

  if (result.rowCount === 0) {
    throw new NotFoundError('This booking no longer exists.');
  }
}

/**
 * Raw shape of a row returned by `listBookings` below: `booking` joined
 * with its `resource` and both `person` references, so the response can
 * carry resource/person identity without a second round trip.
 */
interface BookingOverviewRow {
  id: string;
  resource_id: string;
  resource_name: string;
  resource_type: 'room' | 'equipment';
  start: Date;
  end: Date;
  booked_by_id: string;
  booked_by_name: string;
  booked_for_id: string;
  booked_for_name: string;
}

/**
 * Finds every booking whose `during` range overlaps the requested
 * Europe/Berlin calendar day, optionally narrowed (additively/AND) by
 * resource, booker, and booked-for person (FS-01 FR-3/FR-4).
 *
 * Non-overlap between bookings is a database invariant (`booking_no_overlap`,
 * ADR-003); this query does not enforce or assume anything about it beyond
 * reading whatever rows exist — it is a pure read, not a clash check.
 *
 * A booking spanning midnight overlaps the day via `&&` even though only
 * part of it falls inside `bounds`; `clipToDay` (see `domain/dayClipping.ts`)
 * trims the displayed `start`/`end` to the day's boundaries and flags when
 * the booking actually continues beyond them (AC-13).
 *
 * Ordering is by the *clipped* start ascending, then resource name
 * ascending (FR-4) — `GREATEST(lower(during), $1)` mirrors the clipping
 * that `clipToDay` applies in JS, so SQL ordering and the returned
 * `start` values agree.
 *
 * A filter combination matching nothing returns an empty array, not an
 * error (FS-01 §10, AC-10).
 */
export async function listBookings(filters: BookingQueryFilters): Promise<BookingOverviewItem[]> {
  const { bounds, resourceId, bookedById, bookedForId } = filters;

  const result: QueryResult<BookingOverviewRow> = await pool.query(
    `SELECT
       b.id                AS id,
       b.resource_id       AS resource_id,
       r.name              AS resource_name,
       r.type              AS resource_type,
       lower(b.during)     AS start,
       upper(b.during)     AS "end",
       bb.id               AS booked_by_id,
       bb.name             AS booked_by_name,
       bf.id               AS booked_for_id,
       bf.name             AS booked_for_name
     FROM booking b
     JOIN resource r ON r.id = b.resource_id
     JOIN person bb ON bb.id = b.booked_by
     JOIN person bf ON bf.id = b.booked_for
     WHERE b.during && tstzrange($1, $2, '[)')
       AND ($3::uuid IS NULL OR b.resource_id = $3)
       AND ($4::uuid IS NULL OR b.booked_by = $4)
       AND ($5::uuid IS NULL OR b.booked_for = $5)
     ORDER BY GREATEST(lower(b.during), $1) ASC, r.name ASC`,
    [
      bounds.start.toString(),
      bounds.end.toString(),
      resourceId ?? null,
      bookedById ?? null,
      bookedForId ?? null,
    ],
  );

  return result.rows.map((row) => toBookingOverviewItem(row, bounds));
}

/**
 * Raw shape of a row returned by `getResourceBookingsForDay` below: the
 * booking joined with both `person` references, scoped to one resource.
 */
interface ResourceScheduleRow {
  id: string;
  start: Date;
  end: Date;
  booked_by_id: string;
  booked_by_name: string;
  booked_for_id: string;
  booked_for_name: string;
}

/**
 * Finds every real booking on `resourceId` whose `during` range overlaps
 * the requested Europe/Berlin calendar day (FS-01 FR-2, issue #53).
 *
 * Deliberately unfiltered by `bookedById`/`bookedForId`: this always
 * returns the full, real set of bookings for the resource/day so that
 * `domain/schedule.ts#buildResourceSchedule` can compute correct 24-hour
 * free/booked coverage regardless of which bookings the caller's person
 * filters ultimately allow to render as `booked` (FS-01 §10 — filtering a
 * booking out reverts its time to free, it does not open a gap).
 *
 * Like `listBookings`, this is a pure read: non-overlap between bookings
 * is a database invariant (`booking_no_overlap`, ADR-003) this query does
 * not check or assume beyond reading whatever rows exist.
 */
export async function getResourceBookingsForDay(
  resourceId: string,
  bounds: DayBounds,
): Promise<ResourceBookingForSchedule[]> {
  const result: QueryResult<ResourceScheduleRow> = await pool.query(
    `SELECT
       b.id                AS id,
       lower(b.during)     AS start,
       upper(b.during)     AS "end",
       bb.id               AS booked_by_id,
       bb.name             AS booked_by_name,
       bf.id               AS booked_for_id,
       bf.name             AS booked_for_name
     FROM booking b
     JOIN person bb ON bb.id = b.booked_by
     JOIN person bf ON bf.id = b.booked_for
     WHERE b.resource_id = $1
       AND b.during && tstzrange($2, $3, '[)')
     ORDER BY b.during ASC`,
    [resourceId, bounds.start.toString(), bounds.end.toString()],
  );

  return result.rows.map((row) => ({
    id: row.id,
    start: Temporal.Instant.from(row.start.toISOString()),
    end: Temporal.Instant.from(row.end.toISOString()),
    bookedBy: { id: row.booked_by_id, name: row.booked_by_name },
    bookedFor: { id: row.booked_for_id, name: row.booked_for_name },
  }));
}

function toBookingOverviewItem(row: BookingOverviewRow, bounds: DayBounds): BookingOverviewItem {
  const clipped = clipToDay(
    Temporal.Instant.from(row.start.toISOString()),
    Temporal.Instant.from(row.end.toISOString()),
    bounds,
  );

  return {
    id: row.id,
    resource: {
      id: row.resource_id,
      name: row.resource_name,
      type: row.resource_type,
    },
    start: clipped.start,
    end: clipped.end,
    bookedBy: {
      id: row.booked_by_id,
      name: row.booked_by_name,
    },
    bookedFor: {
      id: row.booked_for_id,
      name: row.booked_for_name,
    },
    continuesFromPreviousDay: clipped.continuesFromPreviousDay,
    continuesIntoNextDay: clipped.continuesIntoNextDay,
  };
}
