import { Temporal } from '@js-temporal/polyfill';

/**
 * Pure clash-detection predicate (FS-03 FR-1, FR-2, FR-4, §7; issue #47).
 *
 * IMPORTANT — this module does NOT enforce non-overlap. Per ADR-003 and
 * this codebase's Core Rule 1, the actual, race-proof enforcement is the
 * database's `booking_no_overlap` exclusion constraint
 * (`EXCLUDE USING GIST (resource_id WITH =, during WITH &&)`), which fires
 * at INSERT time regardless of what any application code has previously
 * read. Re-implementing that check here as a read-then-insert guard would
 * be a time-of-check-to-time-of-use race and is explicitly forbidden.
 *
 * This function exists for two purposes that are NOT the insert path:
 *  1. Exhaustive, fast, database-free unit testing of the exact half-open
 *     interval-overlap semantics the spec requires (AC-6/AC-7 "touching is
 *     not clashing"), so that understanding is proven correct once, in
 *     isolation, before the same logic pattern is echoed anywhere else
 *     (e.g. issue #48's parsing of the database's own `23P01` conflict
 *     detail, or future in-memory/test-fixture tooling).
 *  2. A future, explicitly-not-the-insert-path consumer — e.g. a
 *     "does this slot look free before you submit" preview affordance,
 *     which may want a pure predicate to call via a read endpoint without
 *     it being the thing that prevents the clash.
 *
 * `POST /api/bookings` (issue #36, closed) does NOT call this function as
 * a pre-insert check, and issue #48's future 409 handling will not either
 * — it derives the conflicting range from the database's `DETAIL` message
 * on `23P01`, not from a second in-application overlap scan.
 */

/**
 * The minimal shape this predicate needs: a resource identity and an
 * absolute `[start, end)` instant range. Deliberately not the full
 * `Booking` domain type — this module has no interest in `bookedBy`,
 * `bookedFor`, or `purpose` (FS-03 §12: clash detection ignores who booked
 * or who it is for), and no interest in the many read-shaped `Booking*`
 * response types either.
 */
export interface BookingInterval {
  /** Optional — absent for a not-yet-created proposed booking. */
  id?: string;
  resourceId: string;
  /** Inclusive start instant, ISO-8601 with offset (or any Temporal.Instant-parseable string). */
  start: string;
  /** Exclusive end instant, ISO-8601 with offset. */
  end: string;
}

function overlaps(proposed: BookingInterval, existing: BookingInterval): boolean {
  const proposedStart = Temporal.Instant.from(proposed.start);
  const proposedEnd = Temporal.Instant.from(proposed.end);
  const existingStart = Temporal.Instant.from(existing.start);
  const existingEnd = Temporal.Instant.from(existing.end);

  // Half-open interval intersection (FS-03 §7), exactly as specified:
  // P-start < E-end AND P-end > E-start. Using <=/>= here would wrongly
  // reject legitimate back-to-back bookings that merely touch at a
  // boundary instant (AC-6/AC-7).
  return (
    Temporal.Instant.compare(proposedStart, existingEnd) < 0 &&
    Temporal.Instant.compare(proposedEnd, existingStart) > 0
  );
}

/**
 * Filters `existing` down to the bookings that clash with `proposed`
 * (FS-03 §7): same resource, not the same booking (guarded defensively by
 * `id`, though updates are out of scope per FS-02), and whose range
 * satisfies the half-open overlap test above.
 *
 * Cancelled bookings are never in `existing` in the first place — issue
 * #32 removes cancelled records outright — so there is nothing to filter
 * on a status flag here; a cancelled booking simply cannot appear in the
 * candidate set passed in.
 *
 * Returns every conflicting interval (not just the first), so a caller
 * can report more than one clash if it chooses to; a caller that only
 * needs to know "is there a clash" can check `.length > 0`, and a caller
 * that needs to name one conflicting range (e.g. a 409 body) can take the
 * first entry.
 */
export function findConflicts(
  proposed: BookingInterval,
  existing: BookingInterval[],
): BookingInterval[] {
  return existing.filter((candidate) => {
    if (candidate.resourceId !== proposed.resourceId) return false;
    if (proposed.id !== undefined && candidate.id === proposed.id) return false;
    return overlaps(proposed, candidate);
  });
}
